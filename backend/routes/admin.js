const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, isAdmin } = require('../middleware/auth');
const {
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
} = require('../controllers/adminController');

// All routes require authentication and admin role
router.use(authenticate, isAdmin);

// ==================== DEPARTMENT ROUTES ====================
router.route('/departments')
  .get(getDepartments)
  .post([
    body('name').notEmpty().withMessage('Department name is required'),
    body('code').notEmpty().withMessage('Department code is required'),
  ], validate, createDepartment);

router.route('/departments/:id')
  .put(updateDepartment)
  .delete(deleteDepartment);

// ==================== COURSE ROUTES ====================
router.route('/courses')
  .get(getCourses)
  .post([
    body('courseCode').notEmpty().withMessage('Course code is required'),
    body('courseName').notEmpty().withMessage('Course name is required'),
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('credits').isInt({ min: 1, max: 6 }).withMessage('Credits must be between 1 and 6'),
  ], validate, createCourse);

router.route('/courses/:id')
  .put(updateCourse)
  .delete(deleteCourse);

// ==================== SECTION ROUTES ====================
router.route('/sections')
  .get(getSections)
  .post([
    body('courseId').notEmpty().withMessage('Course is required'),
    body('sectionName').notEmpty().withMessage('Section name is required'),
    body('academicYear').notEmpty().withMessage('Academic year is required'),
    body('semester').isIn(['Fall', 'Spring', 'Summer']).withMessage('Invalid semester'),
    body('teacherId').notEmpty().withMessage('Teacher is required'),
  ], validate, createSection);

router.route('/sections/:id')
  .put(updateSection)
  .delete(deleteSection);

router.post('/sections/:id/enroll', [
  body('studentId').notEmpty().withMessage('Student ID is required'),
], validate, enrollStudent);

// ==================== USER ROUTES ====================
router.route('/users')
  .get(getUsers)
  .post([
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('role').isIn(['STUDENT', 'TEACHER', 'ADMIN']).withMessage('Invalid role'),
  ], validate, createUser);

router.route('/users/:id')
  .put(updateUser)
  .delete(deleteUser);

module.exports = router;
