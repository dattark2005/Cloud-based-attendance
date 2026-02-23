const Section = require('../models/Section');
const Course = require('../models/Course');
const User = require('../models/User');
const Lecture = require('../models/Lecture');
const { ROLES, LECTURE_STATUS } = require('../config/constants');

/**
 * Teacher creates a new classroom (Section)
 * POST /api/sections/create
 */
const createClassroom = async (req, res, next) => {
    try {
        const { courseName, courseCode, sectionName, academicYear, semester } = req.body;
        const teacherId = req.user._id;

        const generatedCode = 'CRS-' + Math.random().toString(36).substr(2, 6).toUpperCase();
        const finalCourseCode = courseCode ? courseCode.toUpperCase() : generatedCode;

        let course = await Course.findOne({ courseCode: finalCourseCode });

        if (!course) {
            course = await Course.create({
                courseCode: finalCourseCode,
                courseName,
                departmentId: req.user.department || undefined,
                credits: 3
            });
        }

        const section = await Section.create({
            courseId: course._id,
            sectionName,
            academicYear,
            semester,
            teacherId,
        });

        res.status(201).json({
            success: true,
            message: 'Classroom created successfully',
            data: {
                section,
                joinCode: section.joinCode
            }
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'A section with these details already exists'
            });
        }
        next(error);
    }
};

/**
 * Student joins a classroom via code
 * POST /api/sections/join
 */
const joinClassroom = async (req, res, next) => {
    try {
        const { joinCode } = req.body;
        const studentId = req.user._id;

        if (req.user.role !== ROLES.STUDENT) {
            return res.status(403).json({
                success: false,
                message: 'Only students can join classrooms'
            });
        }

        const section = await Section.findOne({ joinCode: joinCode.toUpperCase(), isActive: true });
        if (!section) {
            return res.status(404).json({
                success: false,
                message: 'Invalid or inactive classroom code'
            });
        }

        if (section.students.includes(studentId)) {
            return res.status(400).json({
                success: false,
                message: 'You are already enrolled in this classroom'
            });
        }

        section.students.push(studentId);
        await section.save();

        res.json({
            success: true,
            message: 'Successfully joined classroom',
            data: { section }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get sections for logged in teacher
 * GET /api/sections/teacher
 */
const getTeacherClassrooms = async (req, res, next) => {
    try {
        const sections = await Section.find({ teacherId: req.user._id })
            .populate('courseId', 'courseCode courseName')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: { sections }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get a single classroom detail (teacher or enrolled student)
 * GET /api/sections/:sectionId
 */
const getClassroomDetail = async (req, res, next) => {
    try {
        const { sectionId } = req.params;
        const section = await Section.findById(sectionId)
            .populate('courseId', 'courseCode courseName credits')
            .populate('teacherId', 'fullName email')
            .populate('students', 'fullName email prn rollNumber');

        if (!section) {
            return res.status(404).json({ success: false, message: 'Classroom not found' });
        }

        // Allow teacher who owns it, or any enrolled student
        const isTeacher = section.teacherId._id.toString() === req.user._id.toString();
        const isStudent = section.students.some(s => s._id.toString() === req.user._id.toString());

        if (!isTeacher && !isStudent) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        res.json({ success: true, data: { section } });
    } catch (error) {
        next(error);
    }
};

/**
 * Get sections for logged in student
 * GET /api/sections/student
 */
const getStudentClassrooms = async (req, res, next) => {
    try {
        const sections = await Section.find({ students: req.user._id })
            .populate('courseId', 'courseCode courseName')
            .populate('teacherId', 'fullName email')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: { sections }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get upcoming/all lectures for a classroom
 * GET /api/sections/:sectionId/lectures
 */
const getClassroomLectures = async (req, res, next) => {
    try {
        const { sectionId } = req.params;
        const lectures = await Lecture.find({ sectionId })
            .sort({ scheduledStart: 1 });

        res.json({
            success: true,
            data: { lectures }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Teacher schedules a new lecture for a classroom
 * POST /api/sections/:sectionId/lectures
 * Body: { topic, scheduledStart, scheduledEnd, roomNumber, notes }
 */
const scheduleLecture = async (req, res, next) => {
    try {
        const { sectionId } = req.params;
        const { topic, scheduledStart, scheduledEnd, roomNumber, notes } = req.body;

        const section = await Section.findById(sectionId);
        if (!section) {
            return res.status(404).json({ success: false, message: 'Classroom not found' });
        }

        if (section.teacherId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Only the classroom teacher can schedule lectures' });
        }

        if (!scheduledStart || !scheduledEnd) {
            return res.status(400).json({ success: false, message: 'Start and end time are required' });
        }

        if (new Date(scheduledStart) >= new Date(scheduledEnd)) {
            return res.status(400).json({ success: false, message: 'End time must be after start time' });
        }

        const lecture = await Lecture.create({
            sectionId,
            teacherId: req.user._id,
            scheduledStart: new Date(scheduledStart),
            scheduledEnd: new Date(scheduledEnd),
            roomNumber: roomNumber || section.roomNumber,
            topic: topic || 'General Lecture',
            notes,
            status: LECTURE_STATUS.SCHEDULED,
        });

        res.status(201).json({
            success: true,
            message: 'Lecture scheduled successfully',
            data: { lecture }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Cancel a scheduled lecture
 * DELETE /api/sections/:sectionId/lectures/:lectureId
 */
const cancelLecture = async (req, res, next) => {
    try {
        const { sectionId, lectureId } = req.params;

        const lecture = await Lecture.findOne({ _id: lectureId, sectionId });
        if (!lecture) {
            return res.status(404).json({ success: false, message: 'Lecture not found' });
        }

        if (lecture.teacherId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Only the teacher can cancel this lecture' });
        }

        lecture.status = LECTURE_STATUS.CANCELLED;
        await lecture.save();

        res.json({ success: true, message: 'Lecture cancelled successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createClassroom,
    joinClassroom,
    getTeacherClassrooms,
    getStudentClassrooms,
    getClassroomDetail,
    getClassroomLectures,
    scheduleLecture,
    cancelLecture,
};
