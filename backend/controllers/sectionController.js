const Section = require('../models/Section');
const Course = require('../models/Course');
const User = require('../models/User');
const { ROLES } = require('../config/constants');

/**
 * Teacher creates a new classroom (Section)
 * POST /api/sections/create
 */
const createClassroom = async (req, res, next) => {
    try {
        const { courseName, courseCode, sectionName, academicYear, semester } = req.body;
        const teacherId = req.user._id;

        // 1. Find or Create Course
        // If no course code provided or we want to force unique random codes for ad-hoc classes:
        const generatedCode = 'CRS-' + Math.random().toString(36).substr(2, 6).toUpperCase();
        const finalCourseCode = courseCode ? courseCode.toUpperCase() : generatedCode;

        let course = await Course.findOne({ courseCode: finalCourseCode });

        if (!course) {
            course = await Course.create({
                courseCode: finalCourseCode,
                courseName,
                departmentId: req.user.department || undefined, // Optional
                credits: 3
            });
        }

        // 2. Create Section
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

        // 1. Find section by code
        const section = await Section.findOne({ joinCode: joinCode.toUpperCase(), isActive: true });
        if (!section) {
            return res.status(404).json({
                success: false,
                message: 'Invalid or inactive classroom code'
            });
        }

        // 2. Check if already joined
        if (section.students.includes(studentId)) {
            return res.status(400).json({
                success: false,
                message: 'You are already enrolled in this classroom'
            });
        }

        // 3. Enroll
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

module.exports = {
    createClassroom,
    joinClassroom,
    getTeacherClassrooms,
    getStudentClassrooms
};
