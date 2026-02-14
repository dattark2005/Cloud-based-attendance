const { Server } = require('socket.io');

let io;

const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL || 'http://localhost:3000',
            methods: ['GET', 'POST'],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        console.log('New client connected:', socket.id);

        // Join a specific section room
        socket.on('join_section', (sectionId) => {
            socket.join(sectionId);
            console.log(`Socket ${socket.id} joined section room: ${sectionId}`);
        });

        // Join teacher specific updates
        socket.on('join_teacher', (teacherId) => {
            socket.join(`teacher_${teacherId}`);
            console.log(`Teacher ${teacherId} connected to their dashboard room`);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });

    return io;
};

const getIo = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};

// Helper to broadcast to a section (students + teacher)
const broadcastToSection = (sectionId, event, data) => {
    if (io) {
        io.to(sectionId).emit(event, data);
    }
};

// Helper to broadcast specifically to the teacher
const broadcastToTeacher = (teacherId, event, data) => {
    if (io) {
        io.to(`teacher_${teacherId}`).emit(event, data);
    }
};

module.exports = {
    initSocket,
    getIo,
    broadcastToSection,
    broadcastToTeacher
};
