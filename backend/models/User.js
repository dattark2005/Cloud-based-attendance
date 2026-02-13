const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false, // Don't include password in queries by default
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
  },
  prn: {
    type: String,
    required: function () { return this.role === ROLES.STUDENT; },
    unique: true,
    sparse: true,
  },
  rollNumber: {
    type: String,
    required: function () { return this.role === ROLES.STUDENT; },
  },
  role: {
    type: String,
    enum: Object.values(ROLES),
    required: [true, 'Role is required'],
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
  },
  // Entry/Exit Status
  currentStatus: {
    type: String,
    enum: ['IN', 'OUT'],
    default: 'OUT',
  },
  lastStatusChange: {
    type: Date,
  },
  // Face Recognition Data
  faceEncoding: {
    type: Buffer, // Serialized numpy array from Python service
  },
  faceImageUrl: {
    type: String, // Cloudinary URL
  },
  faceRegisteredAt: {
    type: Date,
  },
  // Voice Recognition Data (for teachers only)
  voiceEmbedding: {
    type: Buffer, // Serialized voice embedding
  },
  voiceAudioUrl: {
    type: String, // Cloudinary URL
  },
  voiceRegisteredAt: {
    type: Date,
  },
  // Account Status
  isActive: {
    type: Boolean,
    default: true,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  lastLogin: {
    type: Date,
  },
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
userSchema.index({ prn: 1 });
userSchema.index({ role: 1 });
userSchema.index({ department: 1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Virtual for face registration status
userSchema.virtual('faceRegistered').get(function () {
  return !!this.faceEncoding;
});

// Virtual for voice registration status
userSchema.virtual('voiceRegistered').get(function () {
  return !!this.voiceEmbedding;
});

// Virtual for sections (if student)
userSchema.virtual('sections', {
  ref: 'Section',
  localField: '_id',
  foreignField: 'students',
});

// Virtual for teaching sections (if teacher)
userSchema.virtual('teachingSections', {
  ref: 'Section',
  localField: '_id',
  foreignField: 'teacherId',
});

// Remove sensitive data from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.faceEncoding;
  delete obj.voiceEmbedding;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
