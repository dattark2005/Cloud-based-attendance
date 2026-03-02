const express = require('express');
const router = express.Router();
const { authenticate, isTeacher } = require('../middleware/auth');
const { logDoorEvent, getLectureLog, getMyLog } = require('../controllers/doorController');

/**
 * Middleware: validate Door Camera API Key.
 * Camera scripts pass this key in the Authorization header:
 *   Authorization: Bearer <DOOR_CAMERA_API_KEY>
 * Set DOOR_CAMERA_API_KEY in your .env file.
 */
const validateCameraKey = (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    const validKey = process.env.DOOR_CAMERA_API_KEY;

    if (!validKey) {
        // If no key configured, allow in development only
        if (process.env.NODE_ENV === 'development') return next();
        return res.status(500).json({ success: false, message: 'DOOR_CAMERA_API_KEY not configured on server' });
    }

    if (token !== validKey) {
        return res.status(401).json({ success: false, message: 'Invalid camera API key' });
    }
    next();
};

// ── Camera posts door events here (API-key protected, not JWT) ──
router.post('/event', validateCameraKey, logDoorEvent);

// ── Camera gets active lecture enrolled students here (API-key protected) ──
const { getActiveLectureStudents } = require('../controllers/doorController');
router.get('/lecture/active', validateCameraKey, getActiveLectureStudents);

// ── Authenticated user routes ──
router.use(authenticate);

// Teacher: full log for a lecture with computed time-in-class per student
router.get('/lecture/:lectureId', isTeacher, getLectureLog);

// Student: own log for a lecture
router.get('/my/:lectureId', getMyLog);

module.exports = router;
