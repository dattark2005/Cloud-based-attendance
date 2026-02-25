const express = require('express');
const router = express.Router();
const {
    createClassroom,
    joinClassroom,
    getTeacherClassrooms,
    getStudentClassrooms,
    getClassroomDetail,
    getSectionLectures,
    getClassroomLectures,
    scheduleLecture,
    cancelLecture,
} = require('../controllers/sectionController');
const {
    startSession,
    endSession,
    getActiveSessions,
    verifySessionFace
} = require('../controllers/sessionController');
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

// All routes are protected
router.use(authenticate);

// Session Management
router.get('/active', getActiveSessions);
router.post('/:sectionId/start-session', authorize(ROLES.TEACHER), startSession);
router.post('/:sectionId/end-session', authorize(ROLES.TEACHER), endSession);
router.post('/session/:lectureId/verify', authorize(ROLES.STUDENT), verifySessionFace);

// Teacher specific routes
router.post('/create', authorize(ROLES.TEACHER, ROLES.ADMIN), createClassroom);
router.get('/teacher', authorize(ROLES.TEACHER, ROLES.ADMIN), getTeacherClassrooms);

// Student specific routes
router.post('/join', authorize(ROLES.STUDENT), joinClassroom);
router.get('/student', authorize(ROLES.STUDENT), getStudentClassrooms);

// Classroom Detail (teacher or enrolled student)
router.get('/:sectionId', getClassroomDetail);

// Lecture routes — both GET names work (getSectionLectures = getClassroomLectures)
router.get('/:sectionId/lectures', getSectionLectures);
router.post('/:sectionId/lectures', authorize(ROLES.TEACHER, ROLES.ADMIN), scheduleLecture);
router.delete('/:sectionId/lectures/:lectureId', authorize(ROLES.TEACHER, ROLES.ADMIN), cancelLecture);

module.exports = router;
