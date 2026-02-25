const TeacherAttendance = require('../models/TeacherAttendance');
const User = require('../models/User');
const { verifyFace, registerFace: registerFaceWithService } = require('../utils/apiClient');
const { registerUserFace } = require('./biometricController');
const { compareFaceImages } = require('../utils/faceComparison');

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
 */
const getTodayStatus = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const today = getTodayDateString();
        const record = await TeacherAttendance.findOne({ teacherId, date: today });
        res.json({
            success: true,
            data: {
                marked: !!record,
                record: record || null,
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
 * Verifies face and marks teacher attendance for today
 */
const markAttendance = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const { faceImage } = req.body;

        if (!faceImage) {
            return res.status(400).json({ success: false, message: 'Face image is required' });
        }

        const today = getTodayDateString();
        const existing = await TeacherAttendance.findOne({ teacherId, date: today });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Attendance already marked for today', data: { record: existing } });
        }

        const teacher = await User.findById(teacherId).select('+faceEncoding +faceImageData');
        if (!teacher || (!teacher.faceEncoding && !teacher.faceImageData)) {
            return res.status(400).json({ success: false, message: 'Face not registered. Please register your face first.' });
        }

        const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        let confidenceScore = null;
        let verified = false;

        try {
            const verificationResult = await verifyFace(teacherId.toString(), imageBuffer);
            verified = verificationResult.verified;
            confidenceScore = verificationResult.confidence;
            if (!verified) {
                return res.status(401).json({ success: false, message: '❌ Face not recognised. Please try again.', data: { confidence: confidenceScore, verified: false } });
            }
        } catch (serviceError) {
            console.warn('⚠️  Python face service unavailable. Using local comparison.');
            if (!teacher.faceImageData || teacher.faceImageData.length === 0) {
                return res.status(503).json({ success: false, message: 'Face recognition service is unavailable. Please try again later.', data: { verified: false } });
            }
            const result = compareFaceImages(teacher.faceImageData, imageBuffer);
            verified = result.matched;
            confidenceScore = result.confidence;
            if (!verified) {
                return res.status(401).json({ success: false, message: '❌ Face not recognised. Please try again.', data: { confidence: confidenceScore, verified: false, method: 'local_comparison' } });
            }
        }

        const record = await TeacherAttendance.create({
            teacherId, date: today, markedAt: new Date(),
            status: 'PRESENT', verificationMethod: 'FACE', confidenceScore,
        });

        res.json({ success: true, message: '✅ Attendance marked successfully!', data: { record, confidence: confidenceScore } });
    } catch (error) {
        if (error.code === 11000) {
            const existing = await TeacherAttendance.findOne({ teacherId: req.user._id, date: getTodayDateString() });
            return res.status(400).json({ success: false, message: 'Attendance already marked for today', data: { record: existing } });
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
        const records = await TeacherAttendance.find({ teacherId }).sort({ date: -1 }).limit(30);
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
