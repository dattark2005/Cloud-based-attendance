const Lecture = require('../models/Lecture');
const AttendanceRequest = require('../models/AttendanceRequest');
const AttendanceRecord = require('../models/AttendanceRecord');
const EntryExitLog = require('../models/EntryExitLog');
const User = require('../models/User');
const Section = require('../models/Section');
const { uploadToCloudinary } = require('../config/cloudinary');
const { verifyFace } = require('../utils/apiClient');
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
 */
const markAttendance = async (req, res, next) => {
  try {
    const { lectureId, faceImage, location } = req.body;
    const studentId = req.user._id;

    // Find active attendance request
    const attendanceRequest = await AttendanceRequest.findOne({
      lectureId,
      status: REQUEST_STATUS.ACTIVE,
    });

    if (!attendanceRequest) {
      return res.status(404).json({
        success: false,
        message: 'No active attendance request found for this lecture',
      });
    }

    // Check if request has expired
    if (attendanceRequest.isExpired()) {
      attendanceRequest.status = REQUEST_STATUS.EXPIRED;
      await attendanceRequest.save();

      return res.status(400).json({
        success: false,
        message: 'Attendance request has expired',
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
    const lecture = await Lecture.findById(lectureId).populate('sectionId');
    if (!lecture.sectionId.students.includes(studentId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not enrolled in this section',
      });
    }

    // Verify face with Python service (optional if no image provided)
    let faceImageUrl;
    let confidenceScore = 0;
    let verificationMethod = 'MANUAL';

    if (faceImage) {
      verificationMethod = 'FACE';
      try {
        // Upload face image to Cloudinary
        const imageBuffer = Buffer.from(faceImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const cloudinaryResult = await uploadToCloudinary(
          `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
          CLOUDINARY_FOLDERS.ATTENDANCE,
          'image'
        );
        faceImageUrl = cloudinaryResult.url;

        // Verify face
        const faceVerificationResult = await verifyFace(studentId.toString(), imageBuffer);
        confidenceScore = faceVerificationResult.confidence || 0;

        if (!faceVerificationResult.verified || confidenceScore < DEFAULTS.MIN_CONFIDENCE_SCORE) {
          return res.status(401).json({
            success: false,
            message: 'Face verification failed. Please try again.',
            confidence: confidenceScore,
          });
        }
      } catch (error) {
        console.error('Face verification error:', error);
        return res.status(500).json({
          success: false,
          message: 'Face verification service error',
        });
      }
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

    // Add student to marked list
    await attendanceRequest.markStudent(studentId);

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

module.exports = {
  createAttendanceRequest,
  markAttendance,
  getAttendanceHistory,
  getAttendanceStatus,
  logActivity,
};
