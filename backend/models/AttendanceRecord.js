const mongoose = require('mongoose');
const { ATTENDANCE_STATUS, VERIFICATION_METHODS } = require('../config/constants');

const attendanceRecordSchema = new mongoose.Schema({
  lectureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: [true, 'Lecture is required'],
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Student is required'],
  },
  markedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: Object.values(ATTENDANCE_STATUS),
    default: ATTENDANCE_STATUS.PRESENT,
  },
  cumulativeDurationMinutes: {
    type: Number,
    default: 0,
  },
  entryExitCount: {
    type: Number,
    default: 0,
  },
  lastEntryTime: {
    type: Date,
  },
  verificationMethod: {
    type: String,
    enum: Object.values(VERIFICATION_METHODS),
    default: VERIFICATION_METHODS.FACE,
  },
  confidenceScore: {
    type: Number,
    min: 0,
    max: 1,
  },
  faceImageUrl: {
    type: String, // Cloudinary URL of captured face
  },
  location: {
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
  },
  deviceInfo: {
    userAgent: String,
    platform: String,
  },
  notes: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

// Indexes
attendanceRecordSchema.index({ lectureId: 1, studentId: 1 }, { unique: true });
attendanceRecordSchema.index({ studentId: 1, markedAt: -1 });
attendanceRecordSchema.index({ lectureId: 1 });

// Static method to get attendance statistics
attendanceRecordSchema.statics.getStudentStats = async function (studentId, startDate, endDate) {
  const stats = await this.aggregate([
    {
      $match: {
        studentId: mongoose.Types.ObjectId(studentId),
        markedAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  return stats.reduce((acc, curr) => {
    acc[curr._id] = curr.count;
    return acc;
  }, {});
};

// Static method to get section attendance rate
attendanceRecordSchema.statics.getSectionAttendanceRate = async function (lectureId) {
  const lecture = await mongoose.model('Lecture').findById(lectureId).populate('sectionId');
  if (!lecture) return 0;

  const totalStudents = lecture.sectionId.students.length;
  const presentCount = await this.countDocuments({
    lectureId,
    status: ATTENDANCE_STATUS.PRESENT,
  });

  return totalStudents > 0 ? (presentCount / totalStudents) * 100 : 0;
};

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
