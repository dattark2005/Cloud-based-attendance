const Lecture = require('../models/Lecture');
const AttendanceRequest = require('../models/AttendanceRequest');
const AttendanceRecord = require('../models/AttendanceRecord');
const EntryExitLog = require('../models/EntryExitLog');
const User = require('../models/User');
const Section = require('../models/Section');
const { uploadToCloudinary } = require('../config/cloudinary');
const { verifyFace, identifyMultipleFaces } = require('../utils/apiClient');
const { broadcastToSection } = require('../utils/socket');
const { ATTENDANCE_STATUS, LECTURE_STATUS, REQUEST_STATUS, CLOUDINARY_FOLDERS, DEFAULTS } = require('../config/constants');

/**
 * Create attendance request
 * POST /api/attendance/request
 */
const createAttendanceRequest = async (req, res, next) => {
  try {
    const { lectureId, durationMinutes } = req.body;
    const teacherId = req.user._id;

    // Verify lecture exists and belongs to teacher
    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found',
      });
    }

    if (lecture.teacherId.toString() !== teacherId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to create attendance for this lecture',
      });
    }

    // Check if active request already exists
    const existingRequest = await AttendanceRequest.findOne({
      lectureId,
      status: REQUEST_STATUS.ACTIVE,
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'An active attendance request already exists for this lecture',
      });
    }

    // Calculate expiration time
    const duration = durationMinutes || DEFAULTS.ATTENDANCE_REQUEST_DURATION;
    const expiresAt = new Date(Date.now() + duration * 60 * 1000);

    // Create attendance request
    const attendanceRequest = await AttendanceRequest.create({
      lectureId,
      teacherId,
      expiresAt,
      durationMinutes: duration,
    });

    // Update lecture status
    if (lecture.status === LECTURE_STATUS.SCHEDULED) {
      lecture.status = LECTURE_STATUS.ONGOING;
      lecture.actualStart = new Date();
      await lecture.save();
    }

    res.status(201).json({
      success: true,
      message: 'Attendance request created successfully',
      data: { attendanceRequest },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark attendance
 * POST /api/attendance/mark
 * No longer requires a pre-created AttendanceRequest.
 * Instead, checks that the lecture is ONGOING or SCHEDULED (live session).
 */
const markAttendance = async (req, res, next) => {
  try {
    const { lectureId, faceImage, location } = req.body;
    const studentId = req.user._id;

    if (!lectureId) {
      return res.status(400).json({ success: false, message: 'lectureId is required' });
    }

    // Verify lecture exists and is part of a live session (ONGOING or SCHEDULED)
    const lecture = await Lecture.findById(lectureId).populate('sectionId');
    if (!lecture) {
      return res.status(404).json({ success: false, message: 'Lecture not found' });
    }

    if (lecture.status !== LECTURE_STATUS.ONGOING && lecture.status !== LECTURE_STATUS.SCHEDULED) {
      return res.status(400).json({
        success: false,
        message: `Cannot mark attendance — lecture is ${lecture.status}. Only ONGOING or SCHEDULED lectures accept attendance.`,
      });
    }

    // Check if student already marked attendance
    const existingRecord = await AttendanceRecord.findOne({
      lectureId,
      studentId,
    });

    if (existingRecord) {
      return res.status(400).json({
        success: false,
        message: 'Attendance already marked for this lecture',
      });
    }

    // Verify student is enrolled in the section
    if (!lecture.sectionId.students.includes(studentId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not enrolled in this section',
      });
    }

    // ── FACE VERIFICATION (MANDATORY) ──────────────────────────────────────────
    if (!faceImage) {
      return res.status(400).json({
        success: false,
        message: 'Face image is required to mark attendance.',
        data: { faceRequired: true },
      });
    }

    // Make sure the student has a registered face
    const studentUser = await User.findById(studentId).select('+faceEncoding +faceImageData');
    if (!studentUser || (!studentUser.faceEncoding && !studentUser.faceImageData)) {
      return res.status(400).json({
        success: false,
        message: 'You have not registered your face yet. Please go to your Profile and register your face first.',
        data: { faceNotRegistered: true },
      });
    }

    let faceImageUrl;
    let confidenceScore = 0;
    const verificationMethod = 'FACE';

    try {
      // Upload face image to Cloudinary
      const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const cloudinaryResult = await uploadToCloudinary(
        `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
        CLOUDINARY_FOLDERS.ATTENDANCE,
        'image'
      );
      faceImageUrl = cloudinaryResult.url;

      // Verify face against registered biometric — Python AI service only, no fallback
      let verified = false;
      try {
        const faceVerificationResult = await verifyFace(studentId.toString(), imageBuffer);
        confidenceScore = faceVerificationResult.confidence || 0;
        verified = faceVerificationResult.verified && confidenceScore >= DEFAULTS.MIN_CONFIDENCE_SCORE;
      } catch (serviceErr) {
        // Python service unavailable — hard fail, no local fallback allowed
        console.error('❌ Python face service unavailable for student attendance — no fallback allowed:', serviceErr.message);
        return res.status(503).json({
          success: false,
          message: '⚠️ Face recognition service is currently unavailable. Please ensure the Python AI service is running and try again.',
          data: { serviceUnavailable: true },
        });
      }

      if (!verified) {
        console.warn(
          `🚨 PROXY ATTEMPT: studentId=${studentId} | confidence=${(confidenceScore * 100).toFixed(1)}% | ip=${req.ip} | lectureId=${lectureId}`
        );
        return res.status(401).json({
          success: false,
          message: '🚫 Proxy attendance detected. The face in the camera does not match your registered profile. Attendance NOT marked.',
          data: { confidence: confidenceScore, verified: false, proxyAttempt: true },
        });
      }

      console.log(`✅ Student face verified: studentId=${studentId}, confidence=${(confidenceScore * 100).toFixed(1)}%`);
    } catch (error) {
      console.error('Face verification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Face verification service error. Please try again.',
      });
    }

    // Determine attendance status (present or late)
    const markedAt = new Date();
    const scheduledStart = lecture.scheduledStart;
    const minutesLate = (markedAt - scheduledStart) / (1000 * 60);
    const status = minutesLate > DEFAULTS.LATE_THRESHOLD_MINUTES
      ? ATTENDANCE_STATUS.LATE
      : ATTENDANCE_STATUS.PRESENT;

    // Create attendance record
    const attendanceRecord = await AttendanceRecord.create({
      lectureId,
      studentId,
      markedAt,
      status,
      confidenceScore,
      faceImageUrl,
      verificationMethod,
      location,
      deviceInfo: {
        userAgent: req.headers['user-agent'],
        platform: req.headers['sec-ch-ua-platform'],
      },
    });

    // If an AttendanceRequest exists, update it (optional — not required)
    const attendanceRequest = await AttendanceRequest.findOne({
      lectureId,
      status: REQUEST_STATUS.ACTIVE,
    });
    if (attendanceRequest) {
      try { await attendanceRequest.markStudent(studentId); } catch { /* non-critical */ }
    }

    // Auto-set lecture to ONGOING if it was SCHEDULED
    if (lecture.status === LECTURE_STATUS.SCHEDULED) {
      lecture.status = LECTURE_STATUS.ONGOING;
      lecture.actualStart = new Date();
      await lecture.save();
    }

    res.status(201).json({
      success: true,
      message: `Attendance marked successfully (${status})`,
      data: {
        attendanceRecord: {
          id: attendanceRecord._id,
          status: attendanceRecord.status,
          markedAt: attendanceRecord.markedAt,
          confidenceScore: attendanceRecord.confidenceScore,
          verificationMethod: attendanceRecord.verificationMethod,
        }
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get attendance history
 * GET /api/attendance/history
 */
const getAttendanceHistory = async (req, res, next) => {
  try {
    const { studentId, startDate, endDate, sectionId } = req.query;
    const userId = studentId || req.user._id;

    // Build filter
    const filter = { studentId: userId };

    if (startDate || endDate) {
      filter.markedAt = {};
      if (startDate) filter.markedAt.$gte = new Date(startDate);
      if (endDate) filter.markedAt.$lte = new Date(endDate);
    }

    // Get attendance records
    let records = await AttendanceRecord.find(filter)
      .populate({
        path: 'lectureId',
        populate: {
          path: 'sectionId',
          populate: {
            path: 'courseId',
            select: 'courseCode courseName',
          },
        },
      })
      .sort({ markedAt: -1 });

    // Filter by section if provided
    if (sectionId) {
      records = records.filter(r => r.lectureId.sectionId._id.toString() === sectionId);
    }

    // Calculate statistics
    const stats = {
      total: records.length,
      present: records.filter(r => r.status === ATTENDANCE_STATUS.PRESENT).length,
      late: records.filter(r => r.status === ATTENDANCE_STATUS.LATE).length,
      absent: 0, // Would need to calculate based on total lectures
    };

    stats.attendanceRate = stats.total > 0
      ? ((stats.present + stats.late) / stats.total * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      count: records.length,
      data: { records, stats },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get real-time attendance status for a lecture
 * GET /api/attendance/status/:lectureId
 */
const getAttendanceStatus = async (req, res, next) => {
  try {
    const { lectureId } = req.params;

    // Get lecture with section
    const lecture = await Lecture.findById(lectureId)
      .populate({
        path: 'sectionId',
        populate: [
          {
            path: 'students',
            select: 'fullName email studentId faceImageUrl',
          },
          {
            path: 'courseId',
            select: 'courseName courseCode'
          }
        ]
      });

    if (!lecture) {
      return res.status(404).json({
        success: false,
        message: 'Lecture not found',
      });
    }

    // Get attendance request
    const attendanceRequest = await AttendanceRequest.findOne({ lectureId })
      .sort({ createdAt: -1 });

    // Get attendance records
    const attendanceRecords = await AttendanceRecord.find({ lectureId })
      .populate('studentId', 'fullName email studentId faceImageUrl');

    // Calculate statistics
    const totalStudents = lecture.sectionId.students.length;
    const presentCount = attendanceRecords.filter(r => r.status === ATTENDANCE_STATUS.PRESENT).length;
    const lateCount = attendanceRecords.filter(r => r.status === ATTENDANCE_STATUS.LATE).length;
    const markedCount = attendanceRecords.length;
    const absentCount = totalStudents - markedCount;

    const stats = {
      totalStudents,
      present: presentCount,
      late: lateCount,
      marked: markedCount,
      absent: absentCount,
      attendanceRate: totalStudents > 0 ? ((markedCount / totalStudents) * 100).toFixed(2) : 0,
    };

    // Get list of students who haven't marked attendance
    const markedStudentIds = attendanceRecords.map(r => r.studentId._id.toString());
    const absentStudents = lecture.sectionId.students.filter(
      s => !markedStudentIds.includes(s._id.toString())
    );

    res.json({
      success: true,
      data: {
        lecture: {
          _id: lecture._id,
          id: lecture._id,
          status: lecture.status,
          scheduledStart: lecture.scheduledStart,
          scheduledEnd: lecture.scheduledEnd,
          // Include populated sectionId so frontend can access sectionId.courseId.courseName
          sectionId: lecture.sectionId,
        },
        attendanceRequest: attendanceRequest ? {
          status: attendanceRequest.status,
          expiresAt: attendanceRequest.expiresAt,
          isExpired: attendanceRequest.isExpired(),
        } : null,
        stats,
        attendanceRecords,
        absentStudents,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Log entry/exit activity (session tracking)
 * POST /api/attendance/activity
 */
const logActivity = async (req, res, next) => {
  try {
    const { userId, lectureId, type, confidence, faceImageUrl } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res.status(404).json({ success: false, message: 'Lecture not found' });
    }

    // Determine type automatically if not provided (Toggle)
    const eventType = type || (user.currentStatus === 'IN' ? 'EXIT' : 'ENTRY');

    // Create entry/exit log
    const log = await EntryExitLog.create({
      userId,
      lectureId,
      type: eventType,
      confidence,
      faceImageUrl
    });

    // Update user status
    user.currentStatus = eventType === 'ENTRY' ? 'IN' : 'OUT';
    user.lastStatusChange = new Date();
    await user.save();

    // Update AttendanceRecord
    let attendanceRecord = await AttendanceRecord.findOne({ lectureId, studentId: userId });

    if (!attendanceRecord && eventType === 'ENTRY') {
      // First time entry - create record
      attendanceRecord = await AttendanceRecord.create({
        lectureId,
        studentId: userId,
        status: ATTENDANCE_STATUS.PRESENT,
        lastEntryTime: new Date(),
        entryExitCount: 1,
        verificationMethod: confidence ? 'FACE' : 'MANUAL'
      });
    } else if (attendanceRecord) {
      if (eventType === 'ENTRY') {
        attendanceRecord.lastEntryTime = new Date();
        attendanceRecord.entryExitCount += 1;
      } else if (eventType === 'EXIT' && attendanceRecord.lastEntryTime) {
        const exitTime = new Date();
        const durationMs = exitTime - attendanceRecord.lastEntryTime;
        const durationMins = Math.round(durationMs / (1000 * 60));

        attendanceRecord.cumulativeDurationMinutes += durationMins;
        attendanceRecord.lastEntryTime = null; // Clear entry time on exit
      }
      await attendanceRecord.save();
    }

    res.json({
      success: true,
      message: `${eventType} logged for ${user.fullName}`,
      data: {
        log,
        currentStatus: user.currentStatus,
        cumulativeDurationMinutes: attendanceRecord ? attendanceRecord.cumulativeDurationMinutes : 0
      }
    });
  } catch (error) {
    next(error);
  }
};

const markClassroomAttendance = async (req, res, next) => {
  try {
    const { lectureId, faceImage } = req.body;
    const teacherId = req.user._id;

    if (!lectureId || !faceImage) {
      return res.status(400).json({ success: false, message: 'lectureId and faceImage are required' });
    }

    const lecture = await Lecture.findById(lectureId).populate('sectionId');
    if (!lecture) return res.status(404).json({ success: false, message: 'Lecture not found' });

    if (lecture.teacherId.toString() !== teacherId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized for this lecture' });
    }

    if (lecture.status !== LECTURE_STATUS.ONGOING && lecture.status !== LECTURE_STATUS.SCHEDULED) {
      return res.status(400).json({ success: false, message: 'Lecture is not active' });
    }

    // Get enrolled student IDs as plain strings
    const enrolledStudentIds = (lecture.sectionId.students || []).map(id => id.toString());
    console.log(`📸 Classroom photo upload | lectureId=${lectureId} | enrolled=${enrolledStudentIds.length} students`);
    console.log(`📋 Enrolled IDs: [${enrolledStudentIds.join(', ')}]`);

    const base64Data = faceImage.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Call Python — pass enrolled IDs so it only matches among them
    const result = await identifyMultipleFaces(imageBuffer, enrolledStudentIds);
    console.log(`🤖 Python identify-group result: totalDetected=${result.totalDetected}, matches=${JSON.stringify(result.matches?.map(m => ({ userId: m.userId, name: m.userName, conf: m.confidence?.toFixed(3) })))}`);

    if (result.reason === 'Service unavailable' || result.error) {
      const msg = result.error
        ? `Face recognition error: ${result.error}`
        : 'Face recognition service unavailable. Ensure the Python service is running.';
       console.error('⛔ Face service error:', msg);
       return res.status(503).json({ success: false, message: msg });
    }

    let markedCount = 0;
    const newlyMarked = [];

    if (result.matches && result.matches.length > 0) {
      for (const match of result.matches) {
        const studentId = match.userId;

        // Safety check: only allow enrolled students (should already be filtered by Python)
        if (!enrolledStudentIds.includes(studentId)) {
          console.warn(`⚠️  Matched userId ${studentId} is not in enrolled list — skipping`);
          continue;
        }

        const existingRecord = await AttendanceRecord.findOne({ lectureId, studentId });
        if (!existingRecord) {
           await AttendanceRecord.create({
             lectureId,
             studentId,
             markedAt: new Date(),
             status: ATTENDANCE_STATUS.PRESENT,
             confidenceScore: match.confidence,
             verificationMethod: 'FACE',
           });
           markedCount++;
           newlyMarked.push(studentId);
           console.log(`✅ Marked present: ${match.userName} (${studentId}), confidence=${(match.confidence * 100).toFixed(1)}%`);
        } else {
           console.log(`ℹ️  Already marked: ${match.userName} (${studentId})`);
        }
      }
    }

    console.log(`🏁 Done | marked ${markedCount} new students present`);

    res.json({
       success: true,
       message: `Successfully marked ${markedCount} student${markedCount !== 1 ? 's' : ''} present.`,
       data: {
          totalDetected: result.totalDetected || 0,
          markedCount,
          newlyMarked,
       }
    });
  } catch (error) {
     console.error('markClassroomAttendance error:', error);
     next(error);
  }
};

const updateStudentAttendance = async (req, res, next) => {
  try {
    const { studentId, lectureId } = req.params;
    const { status } = req.body; 

    const lecture = await Lecture.findById(lectureId);
    if (!lecture || lecture.teacherId.toString() !== req.user._id.toString()) {
       return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (status === 'ABSENT') {
       await AttendanceRecord.findOneAndDelete({ lectureId, studentId });
       // Real-time: notify all clients in this section
       broadcastToSection(lecture.sectionId.toString(), 'attendance:updated', { lectureId, studentId, status: 'ABSENT' });
       return res.json({ success: true, message: 'Student marked absent' });
    } else {
       let record = await AttendanceRecord.findOne({ lectureId, studentId });
       if (record) {
          record.status = status;
          record.verificationMethod = 'MANUAL';
          await record.save();
       } else {
          await AttendanceRecord.create({
             lectureId,
             studentId,
             markedAt: new Date(),
             status,
             verificationMethod: 'MANUAL'
          });
       }
       // Real-time: notify all clients in this section
       broadcastToSection(lecture.sectionId.toString(), 'attendance:updated', { lectureId, studentId, status });
       return res.json({ success: true, message: `Student marked ${status}` });
    }
  } catch (error) {
     next(error);
  }
};

module.exports = {
  createAttendanceRequest,
  markAttendance,
  getAttendanceHistory,
  getAttendanceStatus,
  logActivity,
  markClassroomAttendance,
  updateStudentAttendance,
};
