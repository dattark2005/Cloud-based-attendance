const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const {
    getTodayStatus,
    markAttendance,
    getMyAttendance,
    registerFace,
    registerTeacherFace,
} = require('../controllers/teacherAttendanceController');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');

// All routes require authentication and TEACHER or ADMIN role
router.use(authenticate);
router.use(authorize(ROLES.TEACHER, ROLES.ADMIN));

// GET /api/teacher-attendance/status
router.get('/status', getTodayStatus);

// GET /api/teacher-attendance/my
router.get('/my', getMyAttendance);

// POST /api/teacher-attendance/mark
router.post(
    '/mark',
    [body('faceImage').notEmpty().withMessage('Face image is required')],
    validate,
    markAttendance
);

// POST /api/teacher-attendance/register-face
router.post(
    '/register-face',
    [body('faceImage').notEmpty().withMessage('Face image is required')],
    validate,
    registerTeacherFace || registerFace
);

module.exports = router;
