const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const { markGpsAttendance, setClassroomLocation } = require('../controllers/gpsAttendanceController');

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/gps-attendance/mark
 * ONLY the specific teacher conducting that lecture can mark GPS attendance.
 * Body: { lectureId, lat, lng, accuracy, timestamp, clientTime, livePhoto, faceImage }
 */
router.post('/mark', authorize(ROLES.TEACHER), markGpsAttendance);

/**
 * PATCH /api/gps-attendance/set-location/:sectionId
 * Teacher OR admin saves classroom GPS coordinates for a section.
 * Body: { lat, lng, radiusMeters? }
 */
router.patch('/set-location/:sectionId', authorize(ROLES.TEACHER, ROLES.ADMIN), setClassroomLocation);

module.exports = router;
