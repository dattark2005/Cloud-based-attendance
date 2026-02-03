const Department = require('../models/Department');
const Course = require('../models/Course');
const Section = require('../models/Section');
const User = require('../models/User');
const { ROLES } = require('../config/constants');

// ==================== DEPARTMENTS ====================

/**
 * Get all departments
 * GET /api/admin/departments
 */
const getDepartments = async (req, res, next) => {
  try {
    const departments = await Department.find()
      .populate('headId', 'fullName email')
      .sort({ name: 1 });

    res.json({
      success: true,
      count: departments.length,
      data: { departments },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create department
 * POST /api/admin/departments
 */
const createDepartment = async (req, res, next) => {
  try {
    const department = await Department.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: { department },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update department
 * PUT /api/admin/departments/:id
 */
const updateDepartment = async (req, res, next) => {
  try {
    const department = await Department.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    res.json({
      success: true,
      message: 'Department updated successfully',
      data: { department },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete department
 * DELETE /api/admin/departments/:id
 */
const deleteDepartment = async (req, res, next) => {
  try {
    const department = await Department.findByIdAndDelete(req.params.id);

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found',
      });
    }

    res.json({
      success: true,
      message: 'Department deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// ==================== COURSES ====================

/**
 * Get all courses
 * GET /api/admin/courses
 */
const getCourses = async (req, res, next) => {
  try {
    const { departmentId } = req.query;
    const filter = departmentId ? { departmentId } : {};

    const courses = await Course.find(filter)
      .populate('departmentId', 'name code')
      .sort({ courseCode: 1 });

    res.json({
      success: true,
      count: courses.length,
      data: { courses },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create course
 * POST /api/admin/courses
 */
const createCourse = async (req, res, next) => {
  try {
    const course = await Course.create(req.body);
    await course.populate('departmentId', 'name code');

    res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data: { course },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update course
 * PUT /api/admin/courses/:id
 */
const updateCourse = async (req, res, next) => {
  try {
    const course = await Course.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('departmentId', 'name code');

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    res.json({
      success: true,
      message: 'Course updated successfully',
      data: { course },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete course
 * DELETE /api/admin/courses/:id
 */
const deleteCourse = async (req, res, next) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found',
      });
    }

    res.json({
      success: true,
      message: 'Course deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// ==================== SECTIONS ====================

/**
 * Get all sections
 * GET /api/admin/sections
 */
const getSections = async (req, res, next) => {
  try {
    const { courseId, teacherId } = req.query;
    const filter = {};
    if (courseId) filter.courseId = courseId;
    if (teacherId) filter.teacherId = teacherId;

    const sections = await Section.find(filter)
      .populate('courseId', 'courseCode courseName')
      .populate('teacherId', 'fullName email')
      .populate('students', 'fullName email studentId')
      .sort({ academicYear: -1, semester: 1 });

    res.json({
      success: true,
      count: sections.length,
      data: { sections },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create section
 * POST /api/admin/sections
 */
const createSection = async (req, res, next) => {
  try {
    const section = await Section.create(req.body);
    await section.populate([
      { path: 'courseId', select: 'courseCode courseName' },
      { path: 'teacherId', select: 'fullName email' },
    ]);

    res.status(201).json({
      success: true,
      message: 'Section created successfully',
      data: { section },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update section
 * PUT /api/admin/sections/:id
 */
const updateSection = async (req, res, next) => {
  try {
    const section = await Section.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate([
      { path: 'courseId', select: 'courseCode courseName' },
      { path: 'teacherId', select: 'fullName email' },
    ]);

    if (!section) {
      return res.status(404).json({
        success: false,
        message: 'Section not found',
      });
    }

    res.json({
      success: true,
      message: 'Section updated successfully',
      data: { section },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete section
 * DELETE /api/admin/sections/:id
 */
const deleteSection = async (req, res, next) => {
  try {
    const section = await Section.findByIdAndDelete(req.params.id);

    if (!section) {
      return res.status(404).json({
        success: false,
        message: 'Section not found',
      });
    }

    res.json({
      success: true,
      message: 'Section deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Enroll student in section
 * POST /api/admin/sections/:id/enroll
 */
const enrollStudent = async (req, res, next) => {
  try {
    const { studentId } = req.body;
    const section = await Section.findById(req.params.id);

    if (!section) {
      return res.status(404).json({
        success: false,
        message: 'Section not found',
      });
    }

    // Verify student exists and is a student
    const student = await User.findById(studentId);
    if (!student || student.role !== ROLES.STUDENT) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student ID',
      });
    }

    // Enroll student
    await section.enrollStudent(studentId);

    res.json({
      success: true,
      message: 'Student enrolled successfully',
      data: { section },
    });
  } catch (error) {
    next(error);
  }
};

// ==================== USERS ====================

/**
 * Get all users
 * GET /api/admin/users
 */
const getUsers = async (req, res, next) => {
  try {
    const { role, department } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (department) filter.department = department;

    const users = await User.find(filter)
      .populate('department', 'name code')
      .select('-faceEncoding -voiceEmbedding')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: users.length,
      data: { users },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create user
 * POST /api/admin/users
 */
const createUser = async (req, res, next) => {
  try {
    const user = await User.create(req.body);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update user
 * PUT /api/admin/users/:id
 */
const updateUser = async (req, res, next) => {
  try {
    // Don't allow password update through this endpoint
    delete req.body.password;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('department', 'name code');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete user
 * DELETE /api/admin/users/:id
 */
const deleteUser = async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  // Departments
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  // Courses
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  // Sections
  getSections,
  createSection,
  updateSection,
  deleteSection,
  enrollStudent,
  // Users
  getUsers,
  createUser,
  updateUser,
  deleteUser,
};
