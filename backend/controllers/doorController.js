const EntryExitLog = require('../models/EntryExitLog');
const Lecture = require('../models/Lecture');
const User = require('../models/User');
const AttendanceRecord = require('../models/AttendanceRecord');
const { broadcastToSection } = require('../utils/socket');
const { startCamera } = require('../utils/cameraManager');
const { LECTURE_STATUS, VERIFICATION_METHODS, ATTENDANCE_STATUS } = require('../config/constants');

// ─────────────────────────────────────────────────────────────
//  Helper: recalculate total SEEN time from presence log history
// ─────────────────────────────────────────────────────────────
async function calcPresentSeconds(lectureId, studentId) {
    const logs = await EntryExitLog.find({
        lectureId,
        userId: studentId,
        type: { $in: ['SEEN', 'ABSENT'] },
    }).sort({ timestamp: 1 }).lean();

    let totalMs = 0;
    let lastSeen = null;

    for (const log of logs) {
        if (log.type === 'SEEN') {
            // Each SEEN event counts for 1 scan interval (10 seconds)
            // If we had a previous SEEN segment start, close it
            if (lastSeen === null) lastSeen = new Date(log.timestamp);
            // Keep tracking — presence continues
        } else if (log.type === 'ABSENT') {
            // Absent event: close the SEEN segment if open
            if (lastSeen !== null) {
                totalMs += new Date(log.timestamp).getTime() - lastSeen.getTime();
                lastSeen = null;
            }
        }
    }

    // If still seen (no ABSENT at the end), count until now
    if (lastSeen !== null) {
        totalMs += Date.now() - lastSeen.getTime();
    }

    return Math.max(0, Math.round(totalMs / 1000));
}

// ─────────────────────────────────────────────────────────────
//  NEW: POST /api/door/frame  (camera script → backend)
//  Body: { frame: 'base64_string' }
// ─────────────────────────────────────────────────────────────
const logVideoFrame = async (req, res, next) => {
    try {
        const { frame } = req.body;
        if (!frame) return res.status(400).json({ success: false });

        // Find active lecture across the system
        const lecture = await Lecture.findOne({
            status: LECTURE_STATUS.ONGOING,
        }).populate('sectionId', '_id');

        if (!lecture || !lecture.sectionId) {
            console.log(`[DOOR CONTROLLER] Frame received but no ONGOING lecture found. Lecture doc:`, !!lecture);
            return res.json({ success: true, message: 'No active lecture' });
        }

        // Broadcast frame to the specific section connected on frontend
        // console.log(`[DOOR CONTROLLER] Broadcasting frame to section ${lecture.sectionId._id.toString()}`);

        // Broadcast frame to the specific section connected on frontend
        broadcastToSection(lecture.sectionId._id.toString(), 'camera:frame', frame);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
//  1. POST /api/door/presence  (camera script → backend)
//  Body: { roomNumber, studentId, status: 'SEEN'|'ABSENT', confidence }
// ─────────────────────────────────────────────────────────────
const logPresenceEvent = async (req, res, next) => {
    try {
        const { studentId, status, confidence } = req.body;

        if (!studentId || !status) {
            return res.status(400).json({
                success: false,
                message: 'studentId and status are required',
            });
        }
        if (!['SEEN', 'ABSENT'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'status must be SEEN or ABSENT',
            });
        }

        // Find active lecture across the system (single-camera setup)
        const lecture = await Lecture.findOne({
            status: LECTURE_STATUS.ONGOING,
        }).populate('sectionId', 'courseId students');

        if (!lecture) {
            // No active lecture — silently ignore
            return res.json({ success: true, message: 'No active lecture, event ignored' });
        }

        // Verify student exists
        const student = await User.findById(studentId).select('fullName prn email');
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        // ── Enrollment guard: only process events for students in this section ──
        // Fail-open if students array is empty (populate may not have returned it)
        const enrolledIds = (lecture.sectionId?.students || []).map(id => id.toString());
        if (enrolledIds.length > 0 && !enrolledIds.includes(studentId.toString())) {
            console.warn(`[DOOR] 🚫 Not enrolled: studentId=${studentId} (${student.fullName}) | section=${lecture.sectionId?._id} | enrolledIds=[${enrolledIds.join(',')}]`);
            return res.json({ success: true, message: 'Student not enrolled in active section, event ignored' });
        }
        if (enrolledIds.length === 0) {
            console.warn(`[DOOR] ⚠️  enrolledIds empty for section ${lecture.sectionId?._id} — skipping guard (fail-open). Check populate.`);
        } else {
            console.log(`[DOOR] ✅ Enrollment OK: studentId=${studentId} (${student.fullName})`);
        }

        // ── Only create a log on actual STATUS TRANSITIONS ──
        // null → SEEN   = first detected (ENTERED room)
        // ABSENT → SEEN = re-entered after leaving
        // SEEN → ABSENT = has been missing ≥ 1 min (LEFT room)
        // SEEN → SEEN   = still in frame → skip entirely
        const thirtySecsAgo = new Date(Date.now() - 30_000);
        const lastLog = await EntryExitLog.findOne(
            { lectureId: lecture._id, userId: studentId, type: { $in: ['SEEN', 'ABSENT'] } },
            null,
            { sort: { timestamp: -1 } }
        ).lean();
        const prevStatus = lastLog?.type || null;
        const isStatusChange = prevStatus !== status;

        // Race-condition dedup: two simultaneous requests (face WS + camera sync) can both
        // see prevStatus=null and both try to create the first SEEN log.
        // Fix: if a log of the SAME type already exists within the last 30s → it's a dup, skip.
        // Note: this is independent of isStatusChange (old logic had a logical contradiction).
        const recentSameLog = lastLog?.type === status && lastLog?.timestamp > thirtySecsAgo;

        let log = null;
        if (isStatusChange && !recentSameLog) {
            log = await EntryExitLog.create({
                userId: studentId,
                lectureId: lecture._id,
                type: status,
                timestamp: new Date(),
                confidence: confidence || null,
                roomNumber: lecture.roomNumber,
            });
        }

        // Always upsert the AttendanceRecord (updates presence time & currentlyPresent flag)
        // but only broadcast socket update on real status transitions to avoid UI log spam
        const totalPresentSeconds = await calcPresentSeconds(lecture._id, studentId);

        const lectureStartTime = lecture.actualStart ? new Date(lecture.actualStart).getTime() : new Date(lecture.scheduledStart).getTime();
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - lectureStartTime) / 1000));
        const attendancePercentage = Math.min(100, Math.round((totalPresentSeconds / elapsedSeconds) * 100));

        // Upsert AttendanceRecord
        await AttendanceRecord.findOneAndUpdate(
            { lectureId: lecture._id, studentId },
            {
                $set: {
                    status: (status === 'SEEN' || attendancePercentage > 0) ? ATTENDANCE_STATUS.PRESENT : ATTENDANCE_STATUS.ABSENT,
                    totalPresentMinutes: Math.round(totalPresentSeconds / 60),
                    attendancePercentage,
                    verificationMethod: VERIFICATION_METHODS.FACE,
                    markedAt: new Date(),
                    lastSeenAt: status === 'SEEN' ? new Date() : undefined,
                    currentlyPresent: status === 'SEEN',
                },
                $setOnInsert: { lectureId: lecture._id },
            },
            { upsert: true, new: true }
        );

        // ── Only broadcast on actual status transitions ──
        // Prevents the frontend activity log from seeing heartbeat SEEN events as new entries
        if (isStatusChange && !recentSameLog) {
            const payload = {
                lectureId: lecture._id,
                studentId,
                studentName: student.fullName,
                studentPrn: student.prn || student.email,
                status,
                hadPresence: attendancePercentage > 0 || status === 'SEEN',
                confidence: confidence || 0,
                timestamp: log?.timestamp || new Date(),
                totalPresentMinutes: Math.round(totalPresentSeconds / 60),
                attendancePercentage,
                currentlyPresent: status === 'SEEN',
                roomNumber: lecture.roomNumber,
                isStatusChange: true,
            };
            broadcastToSection(lecture.sectionId._id.toString(), 'presence:update', payload);
        }

        res.json({ success: true, message: `${status} logged`, isStatusChange, logCreated: !!(isStatusChange && !recentSameLog) });
    } catch (error) {
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
//  2. GET /api/door/presence/:lectureId  (teacher fetches current state)
// ─────────────────────────────────────────────────────────────
const getPresenceStatus = async (req, res, next) => {
    try {
        const { lectureId } = req.params;

        const lecture = await Lecture.findById(lectureId)
            .populate({ path: 'sectionId', populate: { path: 'students', select: 'fullName prn email faceImageUrl' } });

        if (!lecture) {
            return res.status(404).json({ success: false, message: 'Lecture not found' });
        }

        const allStudents = lecture.sectionId?.students || [];

        // Auto-start camera if the lecture is ONGOING and teacher is viewing the dashboard
        if (lecture.status === LECTURE_STATUS.ONGOING) {
            startCamera();
        }

        // Get the most recent presence log entry per student
        const recentLogs = await EntryExitLog.aggregate([
            {
                $match: {
                    lectureId: lecture._id,
                    type: { $in: ['SEEN', 'ABSENT'] },
                }
            },
            { $sort: { timestamp: -1 } },
            {
                $group: {
                    _id: '$userId',
                    lastStatus: { $first: '$type' },
                    lastTimestamp: { $first: '$timestamp' },
                    lastConfidence: { $first: '$confidence' },
                }
            }
        ]);

        const logMap = {};
        for (const l of recentLogs) {
            logMap[l._id.toString()] = l;
        }

        // Get attendance records for time data
        const records = await AttendanceRecord.find({ lectureId }).lean();
        const recordMap = {};
        for (const r of records) {
            recordMap[r.studentId.toString()] = r;
        }

        // Lecture duration
        let durationMins = 60;
        if (lecture.scheduledStart && lecture.scheduledEnd) {
            durationMins = Math.max(1, Math.round(
                (new Date(lecture.scheduledEnd) - new Date(lecture.scheduledStart)) / 60000
            ));
        }

        // Build per-student status array
        const studentStatuses = allStudents.map(student => {
            const sid = student._id.toString();
            const logEntry = logMap[sid];
            const record = recordMap[sid];

            return {
                student: {
                    _id: student._id,
                    fullName: student.fullName,
                    prn: student.prn || student.email,
                    faceImageUrl: student.faceImageUrl,
                },
                currentStatus: logEntry?.lastStatus || null,   // 'SEEN' | 'ABSENT' | null
                lastSeen: logEntry?.lastTimestamp || null,
                lastConfidence: logEntry?.lastConfidence || 0,
                totalPresentMinutes: record?.totalPresentMinutes || 0,
                attendancePercentage: record?.attendancePercentage || 0,
                currentlyPresent: logEntry?.lastStatus === 'SEEN',
            };
        });

        // Sort: currently present first, then absent, then undetected
        studentStatuses.sort((a, b) => {
            const order = { SEEN: 0, ABSENT: 1, null: 2 };
            return (order[a.currentStatus] ?? 2) - (order[b.currentStatus] ?? 2);
        });

        const presentCount = studentStatuses.filter(s => s.currentlyPresent).length;
        const absentCount = studentStatuses.filter(s => s.currentStatus === 'ABSENT').length;
        const unseenCount = studentStatuses.filter(s => !s.currentStatus).length;

        res.json({
            success: true,
            data: {
                lecture: {
                    _id: lecture._id,
                    status: lecture.status,
                    scheduledStart: lecture.scheduledStart,
                    scheduledEnd: lecture.scheduledEnd,
                    durationMins,
                    roomNumber: lecture.roomNumber,
                },
                stats: {
                    total: allStudents.length,
                    present: presentCount,
                    absent: absentCount,
                    unseen: unseenCount,
                },
                students: studentStatuses,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
//  3. GET /api/door/lecture/active  (camera script pre-fetch)
// ─────────────────────────────────────────────────────────────
const getActiveLectureStudents = async (req, res, next) => {
    try {
        const lecture = await Lecture.findOne({
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

// ─────────────────────────────────────────────────────────────
//  4. GET /api/door/lecture/:lectureId  (legacy log view)
// ─────────────────────────────────────────────────────────────
const getLectureLog = async (req, res, next) => {
    try {
        const { lectureId } = req.params;

        const logs = await EntryExitLog.find({ lectureId })
            .populate('userId', 'fullName prn email')
            .sort({ timestamp: 1 })
            .lean();

        // Group by student
        const studentMap = {};
        for (const log of logs) {
            const sid = log.userId._id.toString();
            if (!studentMap[sid]) {
                studentMap[sid] = { student: log.userId, events: [], totalMinutes: 0 };
            }
            studentMap[sid].events.push({ type: log.type, timestamp: log.timestamp });
        }

        // Compute total present minutes per student (SEEN/ABSENT segments)
        for (const sid of Object.keys(studentMap)) {
            const events = studentMap[sid].events;
            let totalMs = 0;
            let lastSeen = null;

            for (const ev of events) {
                if (ev.type === 'SEEN' || ev.type === 'ENTRY') {
                    if (lastSeen === null) lastSeen = new Date(ev.timestamp);
                } else if ((ev.type === 'ABSENT' || ev.type === 'EXIT') && lastSeen) {
                    totalMs += new Date(ev.timestamp) - lastSeen;
                    lastSeen = null;
                }
            }
            if (lastSeen) totalMs += Date.now() - lastSeen;
            studentMap[sid].totalMinutes = Math.round(totalMs / 60000);
        }

        res.json({
            success: true,
            data: { students: Object.values(studentMap), totalLogs: logs.length },
        });
    } catch (error) {
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
//  4b. GET /api/door/lecture/:lectureId/student/:studentId
//      Per-student entry/exit timeline for teacher
// ─────────────────────────────────────────────────────────────
const getStudentLog = async (req, res, next) => {
    try {
        const { lectureId, studentId } = req.params;

        const [logs, student, lecture] = await Promise.all([
            EntryExitLog.find({ lectureId, userId: studentId })
                .sort({ timestamp: 1 }).lean(),
            User.findById(studentId).select('fullName prn email').lean(),
            Lecture.findById(lectureId).select('scheduledStart scheduledEnd status roomNumber').lean(),
        ]);

        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        // Build timeline with duration per segment
        let totalMs = 0;
        let lastSeenTime = null;
        const timeline = [];

        for (const log of logs) {
            const ts = new Date(log.timestamp);
            if (log.type === 'SEEN' || log.type === 'ENTRY') {
                if (lastSeenTime === null) {
                    lastSeenTime = ts;
                    timeline.push({ type: 'ENTER', timestamp: ts, durationMs: null });
                }
            } else if ((log.type === 'ABSENT' || log.type === 'EXIT') && lastSeenTime !== null) {
                const durationMs = ts - lastSeenTime;
                totalMs += durationMs;
                // Patch the matching ENTER with duration
                const enterEntry = [...timeline].reverse().find(e => e.type === 'ENTER' && e.durationMs === null);
                if (enterEntry) enterEntry.durationMs = durationMs;
                timeline.push({ type: 'LEAVE', timestamp: ts, durationMs });
                lastSeenTime = null;
            }
        }
        // Still in room (no ABSENT yet)
        if (lastSeenTime !== null) {
            const durationMs = Date.now() - lastSeenTime;
            totalMs += durationMs;
            const enterEntry = [...timeline].reverse().find(e => e.type === 'ENTER' && e.durationMs === null);
            if (enterEntry) enterEntry.durationMs = durationMs;
        }

        res.json({
            success: true,
            data: {
                student,
                lecture,
                timeline,
                totalMinutes: Math.round(totalMs / 60000),
                totalMs,
            },
        });
    } catch (error) {
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
//  5. GET /api/door/my/:lectureId  (student's own log)
// ─────────────────────────────────────────────────────────────
const getMyLog = async (req, res, next) => {
    try {
        const { lectureId } = req.params;
        const studentId = req.user._id;

        const logs = await EntryExitLog.find({ lectureId, userId: studentId })
            .sort({ timestamp: 1 }).lean();

        let totalMs = 0;
        let lastSeen = null;
        const events = logs.map(log => {
            if (log.type === 'SEEN' || log.type === 'ENTRY') {
                if (lastSeen === null) lastSeen = new Date(log.timestamp);
            } else if ((log.type === 'ABSENT' || log.type === 'EXIT') && lastSeen) {
                totalMs += new Date(log.timestamp) - lastSeen;
                lastSeen = null;
            }
            return { type: log.type, timestamp: log.timestamp };
        });

        if (lastSeen) totalMs += Date.now() - lastSeen;

        res.json({
            success: true,
            data: { events, totalMinutes: Math.round(totalMs / 60000) },
        });
    } catch (error) {
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
//  Legacy: POST /api/door/event  (old ENTRY/EXIT from camera_monitor)
// ─────────────────────────────────────────────────────────────
const logDoorEvent = async (req, res, next) => {
    try {
        const { roomNumber, studentId, type, confidence } = req.body;

        if (!roomNumber || !studentId || !type) {
            return res.status(400).json({ success: false, message: 'roomNumber, studentId, and type are required' });
        }
        if (!['ENTRY', 'EXIT', 'SEEN', 'ABSENT'].includes(type)) {
            return res.status(400).json({ success: false, message: 'type must be ENTRY, EXIT, SEEN, or ABSENT' });
        }

        // Route SEEN/ABSENT to new handler
        if (type === 'SEEN' || type === 'ABSENT') {
            req.body.status = type;
            return logPresenceEvent(req, res, next);
        }

        const lecture = await Lecture.findOne({
            roomNumber,
            status: LECTURE_STATUS.ONGOING,
        }).populate('sectionId', 'courseId');

        if (!lecture) {
            return res.json({ success: true, message: 'No active lecture, event ignored' });
        }

        const student = await User.findById(studentId).select('fullName prn email');
        if (!student) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        const log = await EntryExitLog.create({
            userId: studentId, lectureId: lecture._id,
            type, timestamp: new Date(), confidence: confidence || null, roomNumber,
        });

        broadcastToSection(lecture.sectionId._id.toString(), 'door:event', {
            logId: log._id, lectureId: lecture._id, studentId,
            studentName: student.fullName, type, timestamp: log.timestamp, roomNumber,
        });

        res.json({ success: true, message: `${type} logged` });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    logPresenceEvent,
    getPresenceStatus,
    getActiveLectureStudents,
    getLectureLog,
    getStudentLog,
    getMyLog,
    logDoorEvent,
    logVideoFrame,
};

