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
 * GET /api/teacher-attendance/status
 * Returns ALL attendance records for today (one per lecture).
 */
const getTodayStatus = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const today = getTodayDateString();

        // Return all of today's records (one per lecture conducted)
        const records = await TeacherAttendance.find({ teacherId, date: today })
            .populate('lectureId', 'topic scheduledStart sectionId')
            .sort({ markedAt: 1 });

        res.json({
            success: true,
            data: {
                marked: records.length > 0,
                records: records,
                // Legacy compat — first record or null
                record: records[0] || null,
                faceRegistered: !!req.user.faceRegisteredAt,
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
            // Python service unavailable — hard fail, no local fallback allowed
            console.error('❌ Python face service unavailable for teacher daily attendance — no fallback:', serviceError.message);
            return res.status(503).json({
                success: false,
                message: '⚠️ Face recognition service is currently unavailable. Please ensure the Python AI service is running and try again.',
                data: { verified: false, serviceUnavailable: true },
            });
        }

        const record = await TeacherAttendance.create({
            teacherId,
            lectureId: lectureId || null,
            date: today,
            markedAt: new Date(),
            status: 'PRESENT',
            verificationMethod: 'FACE',
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
 * GET /api/teacher-attendance/my
 */
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
    getMyAttendance,
    registerFace,
    registerTeacherFace,
};
