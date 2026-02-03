const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { authenticate, isTeacher, isStudent } = require('../middleware/auth');
const {
  createAttendanceRequest,
  markAttendance,
  getAttendanceHistory,
  getAttendanceStatus,
} = require('../controllers/attendanceController');

// All routes require authentication
router.use(authenticate);

// Create attendance request (teachers only)
router.post('/request', isTeacher, [
  body('lectureId').notEmpty().withMessage('Lecture ID is required'),
  body('durationMinutes').optional().isInt({ min: 1, max: 30 }).withMessage('Duration must be between 1 and 30 minutes'),
], validate, createAttendanceRequest);

// Mark attendance (students only)
router.post('/mark', isStudent, [
  body('lectureId').notEmpty().withMessage('Lecture ID is required'),
  body('faceImage').notEmpty().withMessage('Face image is required'),
], validate, markAttendance);

// Get attendance history (all authenticated users)
router.get('/history', getAttendanceHistory);

// Get real-time attendance status (teachers only)
router.get('/status/:lectureId', isTeacher, getAttendanceStatus);

module.exports = router;
