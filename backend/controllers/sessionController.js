const Lecture = require('../models/Lecture');
const Section = require('../models/Section');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const EntryExitLog = require('../models/EntryExitLog');
const { LECTURE_STATUS, ATTENDANCE_STATUS, CLOUDINARY_FOLDERS } = require('../config/constants');
const { broadcastToSection, broadcastToTeacher } = require('../utils/socket');
const { uploadToCloudinary } = require('../config/cloudinary');
const { verifyFace } = require('../utils/apiClient');

/**
 * Start a live session (Lecture)
 * POST /api/sections/:sectionId/start-session
 */
const startSession = async (req, res, next) => {
    try {
        const { sectionId } = req.params;
        const teacherId = req.user._id;
        const { topic, roomNumber } = req.body;

        // 1. Verify section and ownership
        const section = await Section.findById(sectionId).populate('courseId', 'courseName');
        if (!section) {
            return res.status(404).json({ success: false, message: 'Section not found' });
        }

        if (section.teacherId.toString() !== teacherId.toString()) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        // 2. Allow multiple sessions per day per section — no duplicate guard.
        //    (A teacher may conduct multiple lecture slots in the same classroom in one day.)

        // 3. Create and start lecture
        const lecture = await Lecture.create({
            sectionId,
            teacherId,
            status: LECTURE_STATUS.ONGOING,
            actualStart: new Date(),
            scheduledStart: new Date(),
            scheduledEnd: new Date(Date.now() + 60 * 60 * 1000), // Default 1 hour
            topic: topic || undefined,
            roomNumber: roomNumber || section.roomNumber,
        });

        // 4. Notify everyone in the section via Socket.io
        broadcastToSection(sectionId, 'session:started', {
            lectureId: lecture._id,
            courseName: section.courseId?.courseName,
            teacherName: req.user.fullName,
        });

        res.json({
            success: true,
            message: 'Session started successfully',
            data: { lecture },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * End a live session
 * POST /api/sections/:sectionId/end-session
 */
const endSession = async (req, res, next) => {
    try {
        const { sectionId } = req.params;

        const lecture = await Lecture.findOne({ sectionId, status: LECTURE_STATUS.ONGOING });
        if (!lecture) {
            return res.status(404).json({ success: false, message: 'No active session found' });
        }

        lecture.status = LECTURE_STATUS.COMPLETED;
        lecture.actualEnd = new Date();
        await lecture.save();

        // Notify students
        broadcastToSection(sectionId, 'session:ended', {
            lectureId: lecture._id
        });

        res.json({
            success: true,
            message: 'Session ended successfully'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get current active session for a student or teacher
 * GET /api/sections/active
 */
const getActiveSessions = async (req, res, next) => {
    try {
        const userId = req.user._id;
        let query = { status: LECTURE_STATUS.ONGOING };

        if (req.user.role === 'STUDENT') {
            const enrolledSections = await Section.find({ students: userId }).select('_id');
            const sectionIds = enrolledSections.map(s => s._id);
            query.sectionId = { $in: sectionIds };
        } else {
            query.teacherId = userId;
        }

        const sessions = await Lecture.find(query)
            .populate('sectionId')
            .populate({
                path: 'sectionId',
                populate: { path: 'courseId' }
            });

        res.json({
            success: true,
            data: { sessions }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Verify student's face during a live session
 * POST /api/sections/session/:lectureId/verify
 */
const verifySessionFace = async (req, res, next) => {
    try {
        const { lectureId } = req.params;
        const { image } = req.body;
        const studentId = req.user._id;

        if (!image) {
            return res.status(400).json({ success: false, message: 'Image is required' });
        }

        // 1. Verify lecture is ongoing
        const lecture = await Lecture.findById(lectureId).populate('sectionId');
        if (!lecture || lecture.status !== LECTURE_STATUS.ONGOING) {
            return res.status(400).json({ success: false, message: 'Lecture is not live' });
        }

        // 2. Perform AI Face Verification
        const imageBuffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const verifyResult = await verifyFace(studentId.toString(), imageBuffer);

        if (!verifyResult.verified) {
            return res.status(401).json({
                success: false,
                message: 'Face verification failed',
                confidence: verifyResult.confidence
            });
        }

        // 3. Mark Attendance / Update Log
        let record = await AttendanceRecord.findOne({ lectureId, studentId });
        if (!record) {
            record = await AttendanceRecord.create({
                lectureId,
                studentId,
                status: ATTENDANCE_STATUS.PRESENT,
                markedAt: new Date(),
                verificationMethod: 'FACE',
                confidenceScore: verifyResult.confidence
            });
        }

        // Log the entry
        const log = await EntryExitLog.create({
            userId: studentId,
            lectureId,
            type: 'ENTRY',
            confidence: verifyResult.confidence,
            timestamp: new Date()
        });

        // 4. Notify Teacher (Live monitor)
        broadcastToTeacher(lecture.teacherId, 'student:detected', {
            studentName: req.user.fullName,
            studentId: req.user._id,
            lectureId,
            confidence: verifyResult.confidence,
            timestamp: log.timestamp
        });

        res.json({
            success: true,
            message: 'Verified successfully',
            data: { confidence: verifyResult.confidence }
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    startSession,
    endSession,
    getActiveSessions,
    verifySessionFace
};
