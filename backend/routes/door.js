const express = require('express');
const router = express.Router();
const { authenticate, isTeacher } = require('../middleware/auth');
const {
    logPresenceEvent,
    logDoorEvent,
    getPresenceStatus,
    getLectureLog,
    getStudentLog,
    getMyLog,
    getActiveLectureStudents,
    logVideoFrame,
} = require('../controllers/doorController');

/**
 * Camera API Key middleware.
 * Camera scripts pass: Authorization: Bearer <DOOR_CAMERA_API_KEY>
 */
const validateCameraKey = (req, res, next) => {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    const validKey = process.env.DOOR_CAMERA_API_KEY;

    if (!validKey) {
        if (process.env.NODE_ENV === 'development') return next();
        return res.status(500).json({ success: false, message: 'DOOR_CAMERA_API_KEY not configured' });
    }

    if (token !== validKey) {
        return res.status(401).json({ success: false, message: 'Invalid camera API key' });
    }
    next();
};

// ── Camera script routes (API-key protected, no JWT) ──────────────────────────

// NEW: Continuous presence events (SEEN / ABSENT)
router.post('/presence', validateCameraKey, logPresenceEvent);

// NEW: Live video frame streaming from python script
router.post('/frame', validateCameraKey, logVideoFrame);

// LEGACY: Entry/Exit door events (kept for backward compatibility)
router.post('/event', validateCameraKey, logDoorEvent);

// Camera pre-fetches enrolled student IDs for targeted face search
router.get('/lecture/active', validateCameraKey, getActiveLectureStudents);


// ── Authenticated teacher/student routes ──────────────────────────────────────
router.use(authenticate);

// Teacher: real-time presence status for a lecture
router.get('/presence/:lectureId', isTeacher, getPresenceStatus);

// Teacher: full log (all events) for a lecture
router.get('/lecture/:lectureId', isTeacher, getLectureLog);

// Teacher: per-student entry/exit timeline for a lecture
router.get('/lecture/:lectureId/student/:studentId', isTeacher, getStudentLog);

// Student: own presence log for a lecture
router.get('/my/:lectureId', getMyLog);

module.exports = router;
