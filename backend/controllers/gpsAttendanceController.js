const Lecture = require('../models/Lecture');
const Section = require('../models/Section');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const { uploadToCloudinary } = require('../config/cloudinary');
const { verifyFace } = require('../utils/apiClient');
const { CLOUDINARY_FOLDERS, ROLES, VERIFICATION_METHODS } = require('../config/constants');

/**
 * Haversine formula — returns distance in metres between two GPS coords.
 */
function haversineDistanceMetres(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Anti-spoofing checks on incoming GPS from client.
 * Returns { ok: true } or { ok: false, reason: string }
 */
function validateGpsPayload({ lat, lng, accuracy, timestamp, clientTime }) {
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return { ok: false, reason: 'Invalid GPS coordinates — lat/lng must be numbers' };
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { ok: false, reason: 'GPS coordinates out of valid range' };
    }

    if (typeof accuracy !== 'number' || accuracy > 200) {
        return {
            ok: false,
            reason: `GPS accuracy too low (${Math.round(accuracy || 0)} m reported). Move to an open area or near a window.`,
        };
    }

    const serverNow = Date.now();
    if (typeof timestamp !== 'number' || Math.abs(serverNow - timestamp) > 300_000) {
        return { ok: false, reason: 'GPS fix is too old (> 5 minutes). Go back and re-acquire your location.' };
    }

    if (typeof clientTime !== 'number' || Math.abs(serverNow - clientTime) > 180_000) {
        return { ok: false, reason: 'Request timestamp mismatch. Sync your device clock and retry.' };
    }

    return { ok: true };
}

/**
 * Verify teacher face via Python face recognition service ONLY.
 * No local fallback — Python service must be running.
 * Returns { verified: boolean, confidence: number, method: string }
 * Throws with { serviceUnavailable: true } if Python service is down.
 */
async function verifyTeacherFaceViaPython(user, imageBuffer) {
    try {
        const result = await verifyFace(user._id.toString(), imageBuffer);
        return {
            verified: result.verified,
            confidence: result.confidence || 0,
            method: 'python_ai',
        };
    } catch (serviceErr) {
        console.error('❌ Python face service unavailable for GPS attendance — no fallback allowed.');
        const err = new Error('Face recognition service is currently unavailable. Please ensure the Python service is running and try again.');
        err.serviceUnavailable = true;
        throw err;
    }
}

/**
 * POST /api/gps-attendance/mark
 *
 * Body: { lectureId, lat, lng, accuracy, timestamp, clientTime, livePhoto, faceImage }
 * Only TEACHER / ADMIN role allowed.
 *
 * Flow:
 *   1. Validate GPS payload
 *   2. Find & authorise lecture
 *   3. GPS proximity check
 *   4. *** FACE RECOGNITION CHECK (mandatory) ***
 *   5. Upload live photo evidence
 *   6. Create attendance record
 */
const markGpsAttendance = async (req, res, next) => {
    try {
        const { lectureId, lat, lng, accuracy, timestamp, clientTime, livePhoto, faceImage } = req.body;

        // ── Basic required field checks ────────────────────────────────────────
        if (!lectureId) return res.status(400).json({ success: false, message: 'lectureId is required' });
        if (!livePhoto) return res.status(400).json({ success: false, message: 'Live photo is required' });
        if (!faceImage) return res.status(400).json({ success: false, message: 'Face image is required for biometric verification' });

        // ── GPS anti-spoofing validation ───────────────────────────────────────
        const gpsCheck = validateGpsPayload({ lat, lng, accuracy, timestamp, clientTime });
        if (!gpsCheck.ok) {
            return res.status(422).json({ success: false, message: gpsCheck.reason });
        }

        // ── Verify lecture belongs to this teacher ─────────────────────────────
        const lecture = await Lecture.findById(lectureId).populate({
            path: 'sectionId',
            select: 'teacherId sectionName classroomLocation students',
            populate: { path: 'courseId', select: 'courseName courseCode' },
        });

        if (!lecture) {
            return res.status(404).json({ success: false, message: 'Lecture not found' });
        }

        // ── Gate 2: The logged-in teacher must be the one assigned to THIS lecture ──
        // Gate 1 (role guard) already ran in middleware: only TEACHER role reaches here.
        // This second check ensures the right teacher is marking — not a colleague.
        const isTeacher =
            (lecture.teacherId && lecture.teacherId.toString() === req.user._id.toString()) ||
            (lecture.sectionId?.teacherId && lecture.sectionId.teacherId.toString() === req.user._id.toString());

        if (!isTeacher) {
            console.warn(`🚨 GPS AUTH FAIL: teacher=${req.user._id} tried to mark attendance for lecture=${lectureId} (not their class)`);
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only the teacher assigned to this lecture can mark GPS attendance for it.',
            });
        }

        // ── Lecture must be ONGOING ─────────────────────────────────────────────
        if (lecture.status !== 'ONGOING') {
            return res.status(400).json({
                success: false,
                message: `This lecture is not currently active (status: ${lecture.status}). Start the session first from the Live Attendance page.`,
            });
        }

        // ── GPS proximity check ─────────────────────────────────────────────────
        const section = lecture.sectionId;
        const clLat = section?.classroomLocation?.lat;
        const clLng = section?.classroomLocation?.lng;
        const radiusMeters = section?.classroomLocation?.radiusMeters || 50;

        let distanceM = 0;
        let locationVerified = false;

        if (clLat && clLng) {
            distanceM = haversineDistanceMetres(lat, lng, clLat, clLng);
            if (distanceM > radiusMeters) {
                return res.status(422).json({
                    success: false,
                    message: `You are ${Math.round(distanceM)} m from the classroom. You must be within ${radiusMeters} m to mark GPS attendance.`,
                    data: { distanceM: Math.round(distanceM), radiusMeters },
                });
            }
            locationVerified = true;
        } else {
            console.warn(`⚠️ GPS attendance marked WITHOUT classroom location check for section ${section?._id}`);
            locationVerified = false;
        }

        // ── FACE RECOGNITION CHECK (mandatory — Python AI only) ──────────────
        const teacher = await User.findById(req.user._id).select('+faceEncoding +faceImageData');

        if (!teacher || (!teacher.faceEncoding && !teacher.faceImageData)) {
            return res.status(400).json({
                success: false,
                message: 'Face not registered. Please register your face in Profile before marking GPS attendance.',
                data: { faceNotRegistered: true },
            });
        }

        const faceBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');

        let faceResult;
        try {
            faceResult = await verifyTeacherFaceViaPython(teacher, faceBuffer);
        } catch (faceErr) {
            if (faceErr.serviceUnavailable) {
                return res.status(503).json({
                    success: false,
                    message: '⚠️ Face recognition service is unavailable. Please ensure the Python AI service is running and retry.',
                    data: { serviceUnavailable: true },
                });
            }
            throw faceErr;
        }

        if (!faceResult.verified) {
            console.warn(
                `🚨 GPS FACE MISMATCH: teacherId=${req.user._id} | confidence=${(faceResult.confidence * 100).toFixed(1)}% | method=${faceResult.method} | lectureId=${lectureId} | ip=${req.ip}`
            );
            return res.status(401).json({
                success: false,
                message: `🚫 Face not recognised. GPS attendance declined — your face must match your registered profile. (${(faceResult.confidence * 100).toFixed(0)}% match)`,
                data: {
                    verified: false,
                    confidence: faceResult.confidence,
                    method: faceResult.method,
                    hint: 'Ensure good lighting, face the camera directly, and that you have registered your face in Profile.',
                },
            });
        }

        console.log(`✅ GPS face verified: teacher=${req.user._id}, confidence=${(faceResult.confidence * 100).toFixed(1)}%, method=${faceResult.method}`);

        // ── Upload live photo to Cloudinary (evidence) ──────────────────────────
        let photoUrl = null;
        try {
            const result = await uploadToCloudinary(livePhoto, CLOUDINARY_FOLDERS.FACES, 'image');
            photoUrl = result.url;
        } catch (err) {
            console.warn('⚠️ Cloudinary upload failed for GPS photo:', err.message);
        }

        // ── Server-authoritative timestamp ──────────────────────────────────────
        const serverTimestamp = new Date();

        // ── Prevent duplicate attendance ────────────────────────────────────────
        const existingRecord = await AttendanceRecord.findOne({ lectureId, studentId: req.user._id });
        if (existingRecord) {
            return res.status(400).json({
                success: false,
                message: 'You have already marked attendance for this lecture.',
                data: { record: existingRecord },
            });
        }

        // ── Create attendance record ────────────────────────────────────────────
        const record = await AttendanceRecord.create({
            lectureId,
            studentId: req.user._id,
            status: 'PRESENT',
            markedAt: serverTimestamp,
            verificationMethod: VERIFICATION_METHODS.GPS,
            confidenceScore: locationVerified ? faceResult.confidence : Math.min(faceResult.confidence, 0.8),
            location: { latitude: lat, longitude: lng },
            gpsVerification: {
                lat,
                lng,
                accuracy,
                distanceFromClassroom: Math.round(distanceM),
                photoUrl,
            },
            faceImageUrl: photoUrl, // The live classroom photo serves as face evidence
        });

        const distanceText = locationVerified
            ? `You were ${Math.round(distanceM)} m from the classroom.`
            : `No classroom GPS configured — location not verified.`;

        res.json({
            success: true,
            message: `✅ GPS attendance marked! ${distanceText}`,
            data: {
                record,
                serverTimestamp,
                distance: Math.round(distanceM),
                locationVerified,
                photoUrl,
                faceVerification: {
                    verified: true,
                    confidence: faceResult.confidence,
                    method: faceResult.method,
                },
            },
        });
    } catch (error) {
        console.error('GPS attendance error:', error);
        next(error);
    }
};

/**
 * PATCH /api/gps-attendance/set-location/:sectionId
 * Sets GPS coordinates for a classroom.
 * Body: { lat, lng, radiusMeters? }
 */
const setClassroomLocation = async (req, res, next) => {
    try {
        const { sectionId } = req.params;
        const { lat, lng, radiusMeters = 50 } = req.body;

        if (typeof lat !== 'number' || typeof lng !== 'number') {
            return res.status(400).json({ success: false, message: 'lat and lng are required numbers' });
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return res.status(400).json({ success: false, message: 'GPS coordinates out of range' });
        }

        const section = await Section.findOne({ _id: sectionId, teacherId: req.user._id });
        if (!section) {
            return res.status(404).json({ success: false, message: 'Section not found or not yours' });
        }

        section.classroomLocation = {
            lat,
            lng,
            radiusMeters: Math.min(Math.max(Number(radiusMeters), 10), 500),
        };
        await section.save();

        res.json({
            success: true,
            message: `📍 Classroom GPS saved — (${lat.toFixed(5)}, ${lng.toFixed(5)}) · ${section.classroomLocation.radiusMeters} m radius.`,
            data: { classroomLocation: section.classroomLocation },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { markGpsAttendance, setClassroomLocation };
