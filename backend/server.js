require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const attendanceRoutes = require('./routes/attendance');
const biometricRoutes = require('./routes/biometric');
const sectionRoutes = require('./routes/section');
const teacherAttendanceRoutes = require('./routes/teacherAttendance');
const gpsAttendanceRoutes = require('./routes/gpsAttendance');
const { initSocket } = require('./utils/socket');

// Initialize express app
const app = express();

// Connect to MongoDB
connectDB();

// ==================== MIDDLEWARE ====================

// Security headers
app.use(helmet());

// Enable CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// ==================== ROUTES ====================

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/biometric', biometricRoutes);
app.use('/api/sections', sectionRoutes);
app.use('/api/teacher-attendance', teacherAttendanceRoutes);
app.use('/api/gps-attendance', gpsAttendanceRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Attendance System API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      admin: '/api/admin',
      attendance: '/api/attendance',
      biometric: '/api/biometric',
      sections: '/api/sections',
      socket: 'ws://localhost:${PORT}',
    },
  });
});

// ==================== DEV UTILS (REMOVE IN PRODUCTION) ====================
if (process.env.NODE_ENV === 'development') {
  const bcrypt = require('bcryptjs');
  const User = require('./models/User');

  // GET /dev/users — list all users
  app.get('/dev/users', async (req, res) => {
    const users = await User.find({}).select('email fullName role isActive createdAt');
    res.json({ count: users.length, users });
  });

  // POST /dev/reset-password — reset a user's password
  // Body: { "email": "...", "newPassword": "..." }
  app.post('/dev/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);
    const user = await User.findOneAndUpdate({ email }, { password: hashed }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: `Password reset for ${user.email} (${user.role})` });
  });

  // GET /dev/face-check?email=... — check face encoding state
  app.get('/dev/face-check', async (req, res) => {
    const { email } = req.query;
    const user = await User.findOne({ email }).select('+faceEncoding +faceImageData');
    if (!user) return res.status(404).json({ message: 'User not found' });
    const TeacherAttendance = require('./models/TeacherAttendance');
    const today = new Date().toISOString().slice(0, 10);
    const records = await TeacherAttendance.find({ teacherId: user._id, date: today });
    res.json({
      email: user.email,
      role: user.role,
      faceRegisteredAt: user.faceRegisteredAt,
      faceEncodingBytes: user.faceEncoding?.length ?? null,
      faceEncodingIsValid1024: user.faceEncoding?.length === 1024,
      hasFaceImageData: !!user.faceImageData,
      faceImageDataBytes: user.faceImageData?.length ?? null,
      todayAttendanceRecords: records.length,
      today,
    });
  });
}

// ==================== ERROR HANDLING ====================

// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3001;
const httpServer = http.createServer(app);

// Initialize Socket.io
initSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎓 Attendance System API Server                        ║
║                                                           ║
║   ✅ Server running on port ${PORT}                         ║
║   ✅ Environment: ${process.env.NODE_ENV || 'development'}                        ║
║   ✅ MongoDB: Connected                                   ║
║                                                           ║
║   📡 API Endpoints:                                       ║
║   • http://localhost:${PORT}/health                        ║
║   • http://localhost:${PORT}/api/auth                      ║
║   • http://localhost:${PORT}/api/admin                     ║
║   • http://localhost:${PORT}/api/attendance                ║
║   • http://localhost:${PORT}/api/biometric                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  // Close server & exit process
  httpServer.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});

module.exports = app;
