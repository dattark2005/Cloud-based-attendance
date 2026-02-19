const mongoose = require('mongoose');

const teacherAttendanceSchema = new mongoose.Schema(
    {
        teacherId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Teacher is required'],
        },
        date: {
            type: String, // Stored as YYYY-MM-DD for easy daily deduplication
            required: true,
        },
        markedAt: {
            type: Date,
            default: Date.now,
        },
        status: {
            type: String,
            enum: ['PRESENT'],
            default: 'PRESENT',
        },
        verificationMethod: {
            type: String,
            enum: ['FACE', 'MANUAL'],
            default: 'FACE',
        },
        confidenceScore: {
            type: Number,
            min: 0,
            max: 1,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// One record per teacher per day
teacherAttendanceSchema.index({ teacherId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('TeacherAttendance', teacherAttendanceSchema);
