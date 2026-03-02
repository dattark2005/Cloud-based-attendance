const mongoose = require('mongoose');

const entryExitLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    lectureId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lecture',
        required: true,
    },
    type: {
        type: String,
        enum: ['ENTRY', 'EXIT'],
        required: true,
    },
    timestamp: {
        type: Date,
        default: Date.now,
    },
    confidence: {
        type: Number,
    },
    roomNumber: {
        type: String,
        index: true,
    },
    faceImageUrl: {
        type: String,
    }
}, {
    timestamps: true,
});

entryExitLogSchema.index({ userId: 1, timestamp: -1 });
entryExitLogSchema.index({ lectureId: 1 });

module.exports = mongoose.model('EntryExitLog', entryExitLogSchema);
