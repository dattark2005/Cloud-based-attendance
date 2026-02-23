const TeacherAttendance = require('../models/TeacherAttendance');
const User = require('../models/User');
const { verifyFace } = require('../utils/apiClient');
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
 * Returns whether the authenticated teacher is already marked present today
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
 * Body: { faceImage: string } — base64 image
 */
const markAttendance = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const { faceImage } = req.body;

        if (!faceImage) {
            return res.status(400).json({
                success: false,
                message: 'Face image is required',
            });
        }

        const today = getTodayDateString();

        // Check if already marked today
        const existing = await TeacherAttendance.findOne({ teacherId, date: today });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Attendance already marked for today',
                data: { record: existing },
            });
        }

        // Check if teacher has a registered face
        const teacher = await User.findById(teacherId).select('+faceEncoding +faceImageData');
        if (!teacher || (!teacher.faceEncoding && !teacher.faceImageData)) {
            return res.status(400).json({
                success: false,
                message: 'Face not registered. Please register your face first.',
            });
        }

        const imageBuffer = Buffer.from(
            faceImage.replace(/^data:image\/\w+;base64,/, ''),
            'base64'
        );

        let confidenceScore = null;
        let verified = false;

        try {
            // Try real Python face verification service
            const verificationResult = await verifyFace(teacherId.toString(), imageBuffer);
            verified = verificationResult.verified;
            confidenceScore = verificationResult.confidence;

            if (!verified) {
                return res.status(401).json({
                    success: false,
                    message: '❌ Invalid face – face not recognised. Please try again.',
                    data: { confidence: confidenceScore, verified: false },
                });
            }
        } catch (serviceError) {
            // Python service unavailable — use local image comparison
            console.warn('⚠️  Python face service unavailable. Using local comparison for teacher attendance.');

            if (!teacher.faceImageData || teacher.faceImageData.length === 0) {
                // No local reference image — cannot verify safely
                return res.status(503).json({
                    success: false,
                    message: 'Face recognition service is unavailable. Please try again later.',
                    data: { verified: false },
                });
            }

            const result = compareFaceImages(teacher.faceImageData, imageBuffer);
            verified = result.matched;
            confidenceScore = result.confidence;

            if (!verified) {
                return res.status(401).json({
                    success: false,
                    message: '❌ Invalid face – face not recognised. Please try again.',
                    data: { confidence: confidenceScore, verified: false, method: 'local_comparison' },
                });
            }
        }

        // Create attendance record
        const record = await TeacherAttendance.create({
            teacherId,
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
        // Handle duplicate key error (race condition)
        if (error.code === 11000) {
            const existing = await TeacherAttendance.findOne({
                teacherId: req.user._id,
                date: getTodayDateString(),
            });
            return res.status(400).json({
                success: false,
                message: 'Attendance already marked for today',
                data: { record: existing },
            });
        }
        next(error);
    }
};

/**
 * GET /api/teacher-attendance/my
 * Returns the last 30 days of attendance records for the authenticated teacher
 */
const getMyAttendance = async (req, res, next) => {
    try {
        const teacherId = req.user._id;

        const records = await TeacherAttendance.find({ teacherId })
            .sort({ date: -1 })
            .limit(30);

        const presentCount = records.filter((r) => r.status === 'PRESENT').length;

        res.json({
            success: true,
            data: {
                records,
                stats: {
                    total: records.length,
                    present: presentCount,
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTodayStatus,
    markAttendance,
    getMyAttendance,
    // Re-export face registration so the route can use it
    registerTeacherFace: registerUserFace,
};
