const mongoose = require('mongoose');
const { SEMESTERS } = require('../config/constants');

const sectionSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: [true, 'Course is required'],
  },
  sectionName: {
    type: String,
    required: [true, 'Section name is required'],
    trim: true,
  },
  academicYear: {
    type: String,
    required: [true, 'Academic year is required'],
  },
  semester: {
    type: String,
    enum: Object.values(SEMESTERS),
    required: [true, 'Semester is required'],
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Teacher is required'],
  },
  maxCapacity: {
    type: Number,
    default: 60,
    min: [1, 'Capacity must be at least 1'],
  },
  roomNumber: {
    type: String,
    trim: true,
  },
  schedule: [{
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
  }],
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  isActive: {
    type: Boolean,
    default: true,
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
sectionSchema.index({ courseId: 1, sectionName: 1, academicYear: 1, semester: 1 }, { unique: true });
sectionSchema.index({ teacherId: 1 });
sectionSchema.index({ students: 1 });

// Virtual for enrollment count
sectionSchema.virtual('enrollmentCount').get(function() {
  return this.students ? this.students.length : 0;
});

// Virtual for lectures
sectionSchema.virtual('lectures', {
  ref: 'Lecture',
  localField: '_id',
  foreignField: 'sectionId',
});

// Method to check if section is full
sectionSchema.methods.isFull = function() {
  return this.students.length >= this.maxCapacity;
};

// Method to enroll student
sectionSchema.methods.enrollStudent = function(studentId) {
  if (this.isFull()) {
    throw new Error('Section is full');
  }
  if (this.students.includes(studentId)) {
    throw new Error('Student already enrolled');
  }
  this.students.push(studentId);
  return this.save();
};

module.exports = mongoose.model('Section', sectionSchema);
