const EntryExitLog = require('../models/EntryExitLog');
const Lecture = require('../models/Lecture');
const User = require('../models/User');
const { broadcastToSection } = require('../utils/socket');
const { LECTURE_STATUS } = require('../config/constants');

/**
 * Camera script POSTs here when a face is detected at a door.
 * Authenticated via DOOR_CAMERA_API_KEY (not JWT — cameras don't log in).
 * POST /api/door/event
 * Body: { roomNumber, studentId, type: 'ENTRY'|'EXIT', confidence }
 */
const logDoorEvent = async (req, res, next) => {
    try {
        const { roomNumber, studentId, type, confidence } = req.body;

        if (!roomNumber || !studentId || !type) {
            return res.status(400).json({ success: false, message: 'roomNumber, studentId, and type are required' });
        }
        if (!['ENTRY', 'EXIT'].includes(type)) {
            return res.status(400).json({ success: false, message: 'type must be ENTRY or EXIT' });
        }

        // Find the currently active lecture in this room
        const lecture = await Lecture.findOne({
            roomNumber,
            status: LECTURE_STATUS.ONGOING,
        }).populate('sectionId', 'courseId');

        if (!lecture) {
            // No active lecture in this room right now — ignore silently
            return res.json({ success: true, message: 'No active lecture in this room, event ignored' });
        }

        // Verify the student exists
        const student = await User.findById(studentId).select('fullName prn email');
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        // Save the log
        const log = await EntryExitLog.create({
            userId: studentId,
            lectureId: lecture._id,
            type,
            timestamp: new Date(),
            confidence: confidence || null,
            roomNumber,
        });

        // Build the socket payload
        const payload = {
            logId: log._id,
            lectureId: lecture._id,
            studentId,
            studentName: student.fullName,
            studentPrn: student.prn || student.email,
            type,           // 'ENTRY' | 'EXIT'
            timestamp: log.timestamp,
            roomNumber,
        };

        // Broadcast to ALL clients in this section (teacher + student) — instantly
        broadcastToSection(lecture.sectionId._id.toString(), 'door:event', payload);

        res.json({ success: true, message: `${type} logged`, data: { log: payload } });
    } catch (error) {
        next(error);
    }
};

/**
 * Get ALL entry/exit logs for a lecture (teacher view).
 * Also computes total time-in-class per student.
 * GET /api/door/lecture/:lectureId
 */
const getLectureLog = async (req, res, next) => {
    try {
        const { lectureId } = req.params;

        const logs = await EntryExitLog.find({ lectureId })
            .populate('userId', 'fullName prn email')
            .sort({ timestamp: 1 })
            .lean();

        // Group by student and compute total time in class
        const studentMap = {};
        for (const log of logs) {
            const sid = log.userId._id.toString();
            if (!studentMap[sid]) {
                studentMap[sid] = {
                    student: log.userId,
                    events: [],
                    totalMinutes: 0,
                };
            }
            studentMap[sid].events.push({
                type: log.type,
                timestamp: log.timestamp,
                logId: log._id,
            });
        }

        // Calculate total in-class time per student
        for (const sid of Object.keys(studentMap)) {
            const events = studentMap[sid].events;
            let totalMs = 0;
            let lastEntry = null;

            for (const ev of events) {
                if (ev.type === 'ENTRY') {
                    lastEntry = new Date(ev.timestamp);
                } else if (ev.type === 'EXIT' && lastEntry) {
                    totalMs += new Date(ev.timestamp) - lastEntry;
                    lastEntry = null;
                }
            }

            // If still inside (no exit yet), count until now
            if (lastEntry) {
                totalMs += Date.now() - lastEntry;
            }

            studentMap[sid].totalMinutes = Math.round(totalMs / 60000);
        }

        res.json({
            success: true,
            data: {
                students: Object.values(studentMap),
                totalLogs: logs.length,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get a student's own entry/exit log for a lecture.
 * GET /api/door/my/:lectureId
 */
const getMyLog = async (req, res, next) => {
    try {
        const { lectureId } = req.params;
        const studentId = req.user._id;

        const logs = await EntryExitLog.find({ lectureId, userId: studentId })
            .sort({ timestamp: 1 })
            .lean();

        // Compute total time in class
        let totalMs = 0;
        let lastEntry = null;
        const events = logs.map(log => {
            if (log.type === 'ENTRY') lastEntry = new Date(log.timestamp);
            else if (log.type === 'EXIT' && lastEntry) {
                totalMs += new Date(log.timestamp) - lastEntry;
                lastEntry = null;
            }
            return { type: log.type, timestamp: log.timestamp };
        });

        if (lastEntry) totalMs += Date.now() - lastEntry;

        res.json({
            success: true,
            data: {
                events,
                totalMinutes: Math.round(totalMs / 60000),
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get active lecture for a room and return enrolled student IDs.
 * Used by camera_monitor.py to pre-fetch IDs so the Python face service
 * only searches against enrolled students (much faster and no timeouts).
 * GET /api/door/lecture/active?room=:roomNumber
 */
const getActiveLectureStudents = async (req, res, next) => {
    try {
        const { room } = req.query;
        if (!room) return res.status(400).json({ success: false, message: 'room query param required' });

        const lecture = await Lecture.findOne({
            roomNumber: room,
            status: LECTURE_STATUS.ONGOING,
        }).populate('sectionId', 'students');

        if (!lecture || !lecture.sectionId) {
            return res.json({ success: true, studentIds: [] });
        }

        const studentIds = (lecture.sectionId.students || []).map(id => id.toString());
        res.json({ success: true, studentIds });
    } catch (error) {
        next(error);
    }
};

module.exports = { logDoorEvent, getLectureLog, getMyLog, getActiveLectureStudents };
