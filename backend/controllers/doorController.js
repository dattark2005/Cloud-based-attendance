const EntryExitLog = require('../models/EntryExitLog');
const Lecture = require('../models/Lecture');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const { broadcastToSection } = require('../utils/socket');
const { LECTURE_STATUS, VERIFICATION_METHODS } = require('../config/constants');

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

        // If it's an EXIT, or if we just want to ensure AttendanceRecord is updated in real-time
        if (type === 'ENTRY' || type === 'EXIT') {
            // Re-calculate their total present time so far
            const userLogs = await EntryExitLog.find({ lectureId: lecture._id, userId: studentId }).sort({ timestamp: 1 });
            let totalMs = 0;
            let lastEntry = null;

            for (const ev of userLogs) {
                if (ev.type === 'ENTRY') {
                    lastEntry = new Date(ev.timestamp);
                } else if (ev.type === 'EXIT' && lastEntry) {
                    totalMs += new Date(ev.timestamp).getTime() - lastEntry.getTime();
                    lastEntry = null;
                }
            }

            // If still inside, count until now
            if (lastEntry) {
                totalMs += Date.now() - lastEntry.getTime();
            }

            const totalMins = Math.round(totalMs / 60000);
            
            // Calculate Percentage based on Lecture length
            let durationMins = 60; // default
            if (lecture.scheduledStart && lecture.scheduledEnd) {
                durationMins = Math.round((new Date(lecture.scheduledEnd).getTime() - new Date(lecture.scheduledStart).getTime()) / 60000);
                if (durationMins <= 0) durationMins = 60;
            }
            
            let percentage = Math.round((totalMins / durationMins) * 100);
            if (percentage > 100) percentage = 100;
            if (percentage < 0) percentage = 0;

            // Upsert Attendance Record instantly
            await AttendanceRecord.findOneAndUpdate(
                { lectureId: lecture._id, studentId: studentId },
                {
                    $set: {
                        status: 'PRESENT', // Mark present if they were seen
                        totalPresentMinutes: totalMins,
                        attendancePercentage: percentage,
                        verificationMethod: VERIFICATION_METHODS.FACE,
                        markedAt: new Date()
                    }
                },
                { upsert: true, new: true }
            );

            // Inform the client of their updated percentage
            payload.totalPresentMinutes = totalMins;
            payload.attendancePercentage = percentage;
            
            // Trigger frontend attendance grid to refresh instantly
            broadcastToSection(lecture.sectionId._id.toString(), 'attendance:updated', {
                lectureId: lecture._id,
                studentId: studentId
            });
        }

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

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

/**
 * Process uploaded inside/outside videos to calculate attendance percentage
 * POST /api/door/process-videos/:lectureId
 */
const processVideos = async (req, res, next) => {
    try {
        const { lectureId } = req.params;
        const insideFile = req.files?.insideVideo?.[0];
        const outsideFile = req.files?.outsideVideo?.[0];

        if (!insideFile || !outsideFile) {
            return res.status(400).json({ success: false, message: 'Both insideVideo and outsideVideo files are required' });
        }

        const lecture = await Lecture.findById(lectureId).populate('sectionId', 'students');
        if (!lecture) return res.status(404).json({ success: false, message: 'Lecture not found' });

        // Build a list of enrolled student encodings to limit search
        const enrolledStudents = lecture.sectionId.students || [];

        // Forward to python service (FastAPI)
        const formData = new FormData();
        formData.append('inside_video', fs.createReadStream(insideFile.path));
        formData.append('outside_video', fs.createReadStream(outsideFile.path));
        formData.append('lecture_id', lectureId);
        
        // Pass enrolled students list to restrict matching pool
        formData.append('enrolled_students', JSON.stringify(enrolledStudents));
        
        // Let's assume the Python face service is running at 8000
        const pythonServiceUrl = process.env.FACE_SERVICE_URL || 'http://localhost:8000';
        
        const response = await axios.post(`${pythonServiceUrl}/process-dual-video`, formData, {
            headers: formData.getHeaders(),
            timeout: 5 * 60 * 1000 // 5 minutes timeout for heavy video processing
        });

        const { success, results } = response.data;
        if (!success || !results) {
             throw new Error('Python processor failed to analyze videos');
        }

        // Processing results updating MongoDB
        const updatePromises = results.map(async (studentLog) => {
            const { studentId, totalPresentMinutes, attendancePercentage } = studentLog;

            return AttendanceRecord.findOneAndUpdate(
                { lectureId, studentId },
                { 
                    status: attendancePercentage > 0 ? ATTENDANCE_STATUS.PRESENT : ATTENDANCE_STATUS.ABSENT,
                    totalPresentMinutes,
                    attendancePercentage,
                    markedAt: new Date()
                },
                { upsert: true, new: true }
            );
        });

        await Promise.all(updatePromises);
        
        // Cleanup temp files
        fs.unlinkSync(insideFile.path);
        fs.unlinkSync(outsideFile.path);

        res.json({ success: true, message: 'Videos processed perfectly', data: results });
    } catch (error) {
        // Cleanup temp files on error
        if (req.files?.insideVideo?.[0]) fs.unlinkSync(req.files.insideVideo[0].path).catch(()=>{});
        if (req.files?.outsideVideo?.[0]) fs.unlinkSync(req.files.outsideVideo[0].path).catch(()=>{});
        
        next(error);
    }
};

module.exports = { logDoorEvent, getLectureLog, getMyLog, getActiveLectureStudents, processVideos };
