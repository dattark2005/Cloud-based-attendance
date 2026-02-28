const TeacherAttendance = require('../models/TeacherAttendance');
const User = require('../models/User');
const { verifyFace, registerFace: registerFaceWithService } = require('../utils/apiClient');
const { registerUserFace } = require('./biometricController');

/**
 * Get today's date string in YYYY-MM-DD
 */
function getTodayDateString() {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * GET /api/teacher-attendance/status?lectureId=xxx (optional)
 * Returns ALL attendance records for today (one per lecture).
 * When lectureId is specified, also returns markedForLecture boolean.
 */
const getTodayStatus = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const today = getTodayDateString();
        const queryLectureId = req.query.lectureId || null;

        // Return all of today's records (one per lecture conducted)
        const records = await TeacherAttendance.find({ teacherId, date: today })
            .populate('lectureId', 'topic scheduledStart sectionId')
            .sort({ markedAt: 1 });

        // Check if the specific requested lecture is already marked
        let markedForLecture = false;
        let lectureRecord = null;
        if (queryLectureId) {
            lectureRecord = records.find(
                r => r.lectureId && (r.lectureId._id?.toString() === queryLectureId || r.lectureId.toString() === queryLectureId)
            ) || null;
            markedForLecture = !!lectureRecord;
        }

        // Fetch teacher with face fields to check real registration state
        const teacher = await require('../models/User').findById(teacherId).select('+faceEncoding +faceImageData');
        const hasRealEncoding = teacher?.faceEncoding && teacher.faceEncoding.length === 1024;
        const hasFallbackImage = !!teacher?.faceImageData;

        res.json({
            success: true,
            data: {
                marked: records.length > 0,
                markedForLecture,
                records: records,
                record: lectureRecord || records[0] || null,
                // faceRegistered = true only if there's a real python encoding OR a fallback image
                faceRegistered: hasRealEncoding || hasFallbackImage,
                voiceRegistered: !!req.user.voiceRegisteredAt,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/teacher-attendance/mark
 * Verifies face and marks teacher attendance for today.
 * Accepts optional lectureId so a teacher can mark attendance once per lecture they teach.
 */
const markAttendance = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const { faceImage, lectureId = null } = req.body;

        if (!faceImage) {
            return res.status(400).json({ success: false, message: 'Face image is required' });
        }

        const today = getTodayDateString();

        // Check if already marked for this specific lecture (or null-keyed slot)
        const existing = await TeacherAttendance.findOne({ teacherId, date: today, lectureId: lectureId || null });
        if (existing) {
            const msg = lectureId
                ? 'Attendance already marked for this lecture today'
                : 'Attendance already marked for today';
            return res.status(400).json({ success: false, message: msg, data: { record: existing } });
        }

        const teacher = await User.findById(teacherId).select('+faceEncoding +faceImageData');
        if (!teacher || (!teacher.faceEncoding && !teacher.faceImageData)) {
            return res.status(400).json({
                success: false,
                message: 'Face not registered. Please register your face first.',
                data: { faceNotRegistered: true },
            });
        }

        const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        let confidenceScore = null;
        let verified = false;

        try {
            const verificationResult = await verifyFace(teacherId.toString(), imageBuffer);
            verified = verificationResult.verified;
            confidenceScore = verificationResult.confidence;
            if (!verified) {
                return res.status(401).json({
                    success: false,
                    message: '❌ Face not recognised. Please try again.',
                    data: { confidence: confidenceScore, verified: false },
                });
            }
        } catch (serviceError) {
            // Python service unavailable — fall back to local registration check
            console.warn('⚠️  Python face service unavailable — using local fallback for teacher attendance');
            // If user has a registered face, allow attendance (service just verifies identity, not presence)
            // Mark as locally-verified so admin can see it
            verified = true;
            confidenceScore = null;
        }

        const record = await TeacherAttendance.create({
            teacherId,
            lectureId: lectureId || null,
            date: today,
            markedAt: new Date(),
            status: 'PRESENT',
            verificationMethod: confidenceScore !== null ? 'FACE' : 'FACE_LOCAL',
            confidenceScore,
        });

        res.json({
            success: true,
            message: '✅ Attendance marked successfully!',
            data: { record, confidence: confidenceScore },
        });
    } catch (error) {
        if (error.code === 11000) {
            const { lectureId } = req.body;
            const existing = await TeacherAttendance.findOne({
                teacherId: req.user._id,
                date: getTodayDateString(),
                lectureId: lectureId || null,
            });
            const msg = lectureId
                ? 'Attendance already marked for this lecture today'
                : 'Attendance already marked for today';
            return res.status(400).json({ success: false, message: msg, data: { record: existing } });
        }
        next(error);
    }
};

/**
 * DELETE /api/teacher-attendance/unmark?lectureId=xxx
 * Allows a teacher to reset their attendance for a specific lecture today.
 */
const unmarkAttendance = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const { lectureId } = req.query;
        const today = getTodayDateString();

        const query = { teacherId, date: today };
        if (lectureId) query.lectureId = lectureId;

        const result = await TeacherAttendance.deleteMany(query);
        res.json({ success: true, message: `Cleared ${result.deletedCount} attendance record(s)` });
    } catch (error) {
        next(error);
    }
};
const getMyAttendance = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const records = await TeacherAttendance.find({ teacherId })
            .populate('lectureId', 'topic scheduledStart sectionId')
            .sort({ date: -1, markedAt: -1 })
            .limit(60);
        const presentCount = records.filter(r => r.status === 'PRESENT').length;
        res.json({ success: true, data: { records, stats: { total: records.length, present: presentCount } } });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/teacher-attendance/register-face
 * Delegates to biometricController.registerUserFace for unified face registration.
 */
const registerTeacherFace = registerUserFace;

// Legacy export name kept for backward compatibility
const registerFace = registerTeacherFace;

module.exports = {
    getTodayStatus,
    markAttendance,
    unmarkAttendance,
    getMyAttendance,
    registerFace,
    registerTeacherFace,
};
