const Lecture = require('../models/Lecture');
const Section = require('../models/Section');
const AttendanceRecord = require('../models/AttendanceRecord');
const { uploadToCloudinary } = require('../config/cloudinary');
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
 *
 * Timestamp window is 5 minutes to account for the time a teacher spends
 * navigating from GPS step → photo step → submit. The actual GPS position
 * cannot be changed once captured on the device — only the freshness is
 * verified here. The distance check provides the main location security.
 */
function validateGpsPayload({ lat, lng, accuracy, timestamp, clientTime }) {
    // 1. Coordinate range
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return { ok: false, reason: 'Invalid GPS coordinates — lat/lng must be numbers' };
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { ok: false, reason: 'GPS coordinates out of valid range' };
    }

    // 2. Accuracy must be declared and reasonable (≤ 200 m; browser sometimes reports 150-200 m indoors)
    if (typeof accuracy !== 'number' || accuracy > 200) {
        return {
            ok: false,
            reason: `GPS accuracy too low (${Math.round(accuracy || 0)} m reported). Move to an open area or near a window.`,
        };
    }

    // 3. GPS fix timestamp — must be from the last 5 minutes (300 s)
    //    This allows for the multi-step flow (GPS fix → photo → submit) without forcing a new fix each time.
    const serverNow = Date.now();
    if (typeof timestamp !== 'number' || Math.abs(serverNow - timestamp) > 300_000) {
        return { ok: false, reason: 'GPS fix is too old (> 5 minutes). Go back and re-acquire your location.' };
    }

    // 4. Client-submitted time vs server time — must match within 3 minutes (anti-replay)
    if (typeof clientTime !== 'number' || Math.abs(serverNow - clientTime) > 180_000) {
        return { ok: false, reason: 'Request timestamp mismatch. Sync your device clock and retry.' };
    }

    return { ok: true };
}

/**
 * POST /api/gps-attendance/mark
 *
 * Body: { lectureId, lat, lng, accuracy, timestamp, clientTime, livePhoto }
 * Only TEACHER / ADMIN role allowed.
 */
const markGpsAttendance = async (req, res, next) => {
    try {
        const { lectureId, lat, lng, accuracy, timestamp, clientTime, livePhoto } = req.body;

        // ── Basic required field checks ────────────────────────────────────────
        if (!lectureId) return res.status(400).json({ success: false, message: 'lectureId is required' });
        if (!livePhoto) return res.status(400).json({ success: false, message: 'Live photo is required' });

        // ── GPS anti-spoofing validation ───────────────────────────────────────
        const gpsCheck = validateGpsPayload({ lat, lng, accuracy, timestamp, clientTime });
        if (!gpsCheck.ok) {
            return res.status(422).json({ success: false, message: gpsCheck.reason });
        }

        // ── Verify lecture belongs to this teacher ─────────────────────────────
        // Use lecture.teacherId (the direct field) — faster & no populate needed for auth
        const lecture = await Lecture.findById(lectureId).populate({
            path: 'sectionId',
            select: 'teacherId sectionName classroomLocation students',
            populate: { path: 'courseId', select: 'courseName courseCode' },
        });

        if (!lecture) {
            return res.status(404).json({ success: false, message: 'Lecture not found' });
        }

        // Check via lecture.teacherId (direct, always set) OR section teacher
        const isTeacher =
            (lecture.teacherId && lecture.teacherId.toString() === req.user._id.toString()) ||
            (lecture.sectionId?.teacherId && lecture.sectionId.teacherId.toString() === req.user._id.toString());

        if (!isTeacher) {
            return res.status(403).json({ success: false, message: 'You are not the teacher of this lecture' });
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
            // Classroom GPS is configured — enforce Haversine check
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
            // Classroom GPS not configured yet — accept the attendance but flag as UNVERIFIED_LOCATION.
            // Teacher is encouraged to set classroom coordinates for stricter verification.
            console.warn(`⚠️ GPS attendance marked WITHOUT classroom location check for section ${section?._id}`);
            locationVerified = false;
        }

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
            confidenceScore: locationVerified ? 1.0 : 0.7,
            location: { latitude: lat, longitude: lng },
            gpsVerification: {
                lat,
                lng,
                accuracy,
                distanceFromClassroom: Math.round(distanceM),
                photoUrl,
            },
        });

        const distanceText = locationVerified
            ? `You were ${Math.round(distanceM)} m from the classroom.`
            : `No classroom GPS configured — location not verified. Set classroom coords for stricter checks.`;

        res.json({
            success: true,
            message: `✅ GPS attendance marked! ${distanceText}`,
            data: {
                record,
                serverTimestamp,
                distance: Math.round(distanceM),
                locationVerified,
                photoUrl,
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
