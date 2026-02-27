const mongoose = require('mongoose');

const teacherAttendanceSchema = new mongoose.Schema(
    {
        teacherId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Teacher is required'],
        },
        // Optional: link to the specific lecture/session for that day.
        // Allows teachers to mark attendance for each lecture they conduct
        // (e.g. 3 separate classes in one day → 3 records).
        lectureId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Lecture',
            default: null,
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
            enum: ['FACE', 'MANUAL', 'FACE_LOCAL'],
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

// One record per teacher per lecture per day.
// If lectureId is null (legacy / no lecture chosen) we allow one record per day.
teacherAttendanceSchema.index({ teacherId: 1, date: 1, lectureId: 1 }, { unique: true });

module.exports = mongoose.model('TeacherAttendance', teacherAttendanceSchema);
