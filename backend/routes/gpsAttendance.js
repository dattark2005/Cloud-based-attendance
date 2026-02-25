const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const { markGpsAttendance, setClassroomLocation } = require('../controllers/gpsAttendanceController');

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/gps-attendance/mark
 * Teacher marks attendance using GPS + live photo.
 * Body: { lectureId, lat, lng, accuracy, timestamp, clientTime, livePhoto }
 */
router.post('/mark', authorize(ROLES.TEACHER, ROLES.ADMIN), markGpsAttendance);

/**
 * PATCH /api/gps-attendance/set-location/:sectionId
 * Teacher saves classroom GPS coordinates for a section.
 * Body: { lat, lng, radiusMeters? }
 */
router.patch('/set-location/:sectionId', authorize(ROLES.TEACHER, ROLES.ADMIN), setClassroomLocation);

module.exports = router;
