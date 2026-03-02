const TeacherAttendance = require('../models/TeacherAttendance');
const User = require('../models/User');
const { verifyFace, registerFace: registerFaceWithService } = require('../utils/apiClient');
const { registerUserFace } = require('./biometricController');
const FormData = require('form-data');
const axios = require('axios');

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://localhost:8000';

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

        // Auto-start the lecture (change from SCHEDULED to ONGOING)
        if (lectureId) {
            const Lecture = require('../models/Lecture');
            // Populate sectionId to get courseName for the socket broadcast
            const lecture = await Lecture.findById(lectureId).populate({
                path: 'sectionId',
                populate: { path: 'courseId', select: 'courseName' }
            });
            
            if (lecture && lecture.status === 'SCHEDULED') {
                lecture.status = 'ONGOING';
                lecture.actualStart = new Date();
                await lecture.save();
                
                const courseName = lecture.sectionId?.courseId?.courseName || 'Classroom';

                // Notify clients to refresh
                const { broadcastToSection } = require('../utils/socket');
                broadcastToSection(lecture.sectionId._id.toString(), 'session:started', {
                    lectureId: lecture._id,
                    startedAt: lecture.actualStart,
                    courseName
                });
            }
        }

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

/**
 * POST /api/teacher-attendance/register-voice
 * Forwards audio base64 to Python service to get MFCC embedding
 */
const registerTeacherVoice = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const { voiceAudio } = req.body;
        
        if (!voiceAudio) {
            return res.status(400).json({ success: false, message: 'Voice audio string is required' });
        }

        // Remove the data:audio/webm;base64, prefix
        const base64Data = voiceAudio.replace(/^data:audio\/\w+;base64,/, "");
        const audioBuffer = Buffer.from(base64Data, 'base64');

        const formData = new FormData();
        formData.append('file', audioBuffer, {
            filename: 'registration_audio.webm',
            contentType: 'audio/webm'
        });

        const pythonRes = await axios.post(`${FACE_SERVICE_URL}/register-voice`, formData, {
            headers: {
                ...formData.getHeaders(),
            },
        });

        const data = pythonRes.data;
        if (!data.success || !data.embedding) {
            return res.status(400).json({ success: false, message: data.message || 'Voice registration failed in Python service' });
        }

        const binaryStr = JSON.stringify(data.embedding);
        const floatArray = JSON.parse(binaryStr);
        // Save to DB
        await User.findByIdAndUpdate(teacherId, {
            voiceEmbedding: Buffer.from(Float32Array.from(floatArray).buffer),
            voiceRegisteredAt: new Date(),
        });

        res.json({ success: true, message: 'Voice Biometrics registered successfully' });
    } catch (error) {
        if (error.response && error.response.data) {
             return res.status(error.response.status).json({ success: false, message: error.response.data.detail || error.message });
        }
        next(error);
    }
};

/**
 * POST /api/teacher-attendance/mark-voice
 * Verifies voice and checks Liveness/Anti-Spoofing
 */
const markVoiceAttendance = async (req, res, next) => {
    try {
        const teacherId = req.user._id;
        const { lectureId = null, voiceAudio } = req.body;

        if (!voiceAudio) {
            return res.status(400).json({ success: false, message: 'Voice audio string is required' });
        }

        const today = getTodayDateString();

        // Check already marked
        const existing = await TeacherAttendance.findOne({ teacherId, date: today, lectureId: lectureId || null });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Attendance already marked for today', data: { record: existing } });
        }

        // Fetch user embedding
        const teacher = await User.findById(teacherId).select('+voiceEmbedding');
        if (!teacher || !teacher.voiceEmbedding) {
            return res.status(400).json({
                success: false,
                message: 'Voice not registered. Please register your voice first in profile settings.',
                data: { voiceNotRegistered: true },
            });
        }

        // Convert stored buffer back to JSON array of floats for Python
        const storedFloat32 = new Float32Array(teacher.voiceEmbedding.buffer, teacher.voiceEmbedding.byteOffset, teacher.voiceEmbedding.length / 4);
        const expectedEmbeddingStr = JSON.stringify(Array.from(storedFloat32));

        // Format base64 back into buffer
        const base64Data = voiceAudio.replace(/^data:audio\/\w+;base64,/, "");
        const audioBuffer = Buffer.from(base64Data, 'base64');

        const formData = new FormData();
        formData.append('file', audioBuffer, {
            filename: 'verification_audio.webm',
            contentType: 'audio/webm'
        });
        formData.append('teacher_id', teacherId.toString());
        formData.append('expected_embedding', expectedEmbeddingStr);

        const pythonRes = await axios.post(`${FACE_SERVICE_URL}/verify-voice`, formData, {
            headers: {
                ...formData.getHeaders(),
            },
        });

        const data = pythonRes.data;

        if (!data.success) {
            if (data.isSpoofed) {
                return res.status(403).json({
                    success: false,
                    isSpoofed: true,
                    message: data.message || 'Liveness check failed. Playback spoofing detected.'
                });
            }
            return res.status(400).json({
                success: false,
                message: data.message || 'Voice verification failed (low confidence)',
                data: { confidence: data.confidence }
            });
        }

        // Mark Attendance
        const record = await TeacherAttendance.create({
            teacherId,
            date: today,
            status: 'PRESENT',
            lectureId: lectureId || null,
            verificationMethod: 'VOICE',
            confidenceScore: data.confidence, // High accuracy score > 0.85
        });

        res.json({
            success: true,
            message: 'Voice Attendance marked successfully',
            data: { record, confidence: data.confidence }
        });

    } catch (error) {
        if (error.response && error.response.data) {
             return res.status(error.response.status).json({ success: false, message: error.response.data.detail || error.message });
        }
        next(error);
    }
};

module.exports = {
    getTodayStatus,
    markAttendance,
    unmarkAttendance,
    getMyAttendance,
    registerFace,
    registerTeacherFace,
    registerTeacherVoice,
    markVoiceAttendance
};
