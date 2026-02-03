const mongoose = require('mongoose');
const { REQUEST_STATUS } = require('../config/constants');

const attendanceRequestSchema = new mongoose.Schema({
  lectureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: [true, 'Lecture is required'],
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Teacher is required'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: [true, 'Expiration time is required'],
  },
  status: {
    type: String,
    enum: Object.values(REQUEST_STATUS),
    default: REQUEST_STATUS.ACTIVE,
  },
  studentsMarked: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  durationMinutes: {
    type: Number,
    required: true,
    min: 1,
    max: 30,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
attendanceRequestSchema.index({ lectureId: 1 });
attendanceRequestSchema.index({ status: 1, expiresAt: 1 });

// Virtual for total students
attendanceRequestSchema.virtual('totalStudents', {
  ref: 'Section',
  localField: 'lectureId',
  foreignField: '_id',
  justOne: true,
});

// Method to check if expired
attendanceRequestSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt || this.status === REQUEST_STATUS.EXPIRED;
};

// Method to mark student attendance
attendanceRequestSchema.methods.markStudent = function(studentId) {
  if (this.isExpired()) {
    throw new Error('Attendance request has expired');
  }
  if (!this.studentsMarked.includes(studentId)) {
    this.studentsMarked.push(studentId);
  }
  return this.save();
};

// Auto-expire requests
attendanceRequestSchema.pre('save', function(next) {
  if (this.isExpired() && this.status === REQUEST_STATUS.ACTIVE) {
    this.status = REQUEST_STATUS.EXPIRED;
  }
  next();
});

module.exports = mongoose.model('AttendanceRequest', attendanceRequestSchema);
