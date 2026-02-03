const mongoose = require('mongoose');
const { LECTURE_STATUS } = require('../config/constants');

const lectureSchema = new mongoose.Schema({
  sectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Section',
    required: [true, 'Section is required'],
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Teacher is required'],
  },
  scheduledStart: {
    type: Date,
    required: [true, 'Scheduled start time is required'],
  },
  scheduledEnd: {
    type: Date,
    required: [true, 'Scheduled end time is required'],
  },
  actualStart: {
    type: Date,
  },
  actualEnd: {
    type: Date,
  },
  roomNumber: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: Object.values(LECTURE_STATUS),
    default: LECTURE_STATUS.SCHEDULED,
  },
  topic: {
    type: String,
    trim: true,
  },
  notes: {
    type: String,
    trim: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
lectureSchema.index({ sectionId: 1, scheduledStart: 1 });
lectureSchema.index({ teacherId: 1 });
lectureSchema.index({ status: 1 });

// Virtual for attendance records
lectureSchema.virtual('attendanceRecords', {
  ref: 'AttendanceRecord',
  localField: '_id',
  foreignField: 'lectureId',
});

// Virtual for attendance request
lectureSchema.virtual('attendanceRequest', {
  ref: 'AttendanceRequest',
  localField: '_id',
  foreignField: 'lectureId',
  justOne: true,
});

// Method to start lecture
lectureSchema.methods.start = function() {
  this.status = LECTURE_STATUS.ONGOING;
  this.actualStart = new Date();
  return this.save();
};

// Method to end lecture
lectureSchema.methods.end = function() {
  this.status = LECTURE_STATUS.COMPLETED;
  this.actualEnd = new Date();
  return this.save();
};

module.exports = mongoose.model('Lecture', lectureSchema);
