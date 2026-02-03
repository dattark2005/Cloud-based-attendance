# Backend API

Complete Node.js + Express backend for the Attendance System.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Configure environment variables
# Edit .env file with your MongoDB and Cloudinary credentials

# Start development server
npm run dev

# Start production server
npm start
```

## 📋 Prerequisites

1. **MongoDB Atlas Account**
   - Create cluster at https://www.mongodb.com/cloud/atlas
   - Get connection string
   - Update `MONGODB_URI` in `.env`

2. **Cloudinary Account**
   - Sign up at https://cloudinary.com
   - Get cloud name, API key, and API secret
   - Update Cloudinary credentials in `.env`

3. **Python ML Services**
   - Face recognition service running on port 8000
   - Voice recognition service running on port 8001

## 🔧 Environment Variables

Copy `.env` and update with your credentials:

```bash
# MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/attendance

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# JWT
JWT_SECRET=your_secret_key
```

## 📡 API Endpoints

### Authentication (`/api/auth`)
- `POST /register` - Register new user
- `POST /login` - Login user
- `GET /me` - Get current user
- `POST /logout` - Logout user
- `POST /refresh` - Refresh token

### Admin (`/api/admin`)
**Departments:**
- `GET /departments` - List all departments
- `POST /departments` - Create department
- `PUT /departments/:id` - Update department
- `DELETE /departments/:id` - Delete department

**Courses:**
- `GET /courses` - List all courses
- `POST /courses` - Create course
- `PUT /courses/:id` - Update course
- `DELETE /courses/:id` - Delete course

**Sections:**
- `GET /sections` - List all sections
- `POST /sections` - Create section
- `PUT /sections/:id` - Update section
- `DELETE /sections/:id` - Delete section
- `POST /sections/:id/enroll` - Enroll student

**Users:**
- `GET /users` - List all users
- `POST /users` - Create user
- `PUT /users/:id` - Update user
- `DELETE /users/:id` - Delete user

### Attendance (`/api/attendance`)
- `POST /request` - Create attendance request (teachers)
- `POST /mark` - Mark attendance (students)
- `GET /history` - Get attendance history
- `GET /status/:lectureId` - Get real-time status (teachers)

### Biometric (`/api/biometric`)
- `POST /face/register` - Register face
- `POST /face/verify` - Verify face
- `POST /voice/register` - Register voice (teachers)
- `POST /voice/verify` - Verify voice

## 🗂️ Project Structure

```
backend/
├── config/
│   ├── database.js          # MongoDB connection
│   ├── cloudinary.js        # Cloudinary config
│   └── constants.js         # App constants
├── models/
│   ├── User.js              # User model
│   ├── Department.js        # Department model
│   ├── Course.js            # Course model
│   ├── Section.js           # Section model
│   ├── Lecture.js           # Lecture model
│   ├── AttendanceRequest.js # Attendance request model
│   └── AttendanceRecord.js  # Attendance record model
├── controllers/
│   ├── authController.js    # Auth logic
│   ├── adminController.js   # Admin CRUD
│   ├── attendanceController.js # Attendance logic
│   └── biometricController.js # Biometric logic
├── routes/
│   ├── auth.js              # Auth routes
│   ├── admin.js             # Admin routes
│   ├── attendance.js        # Attendance routes
│   └── biometric.js         # Biometric routes
├── middleware/
│   ├── auth.js              # JWT authentication
│   ├── validate.js          # Request validation
│   └── errorHandler.js      # Error handling
├── utils/
│   ├── jwt.js               # JWT utilities
│   ├── upload.js            # File upload
│   └── apiClient.js         # Python service client
├── server.js                # Main server file
├── package.json             # Dependencies
└── .env                     # Environment variables
```

## 🧪 Testing

```bash
# Run tests
npm test

# Test with curl
curl http://localhost:3001/health
```

## 🔒 Security Features

- ✅ JWT authentication
- ✅ Password hashing with bcrypt
- ✅ Role-based access control
- ✅ Rate limiting
- ✅ Helmet security headers
- ✅ CORS configuration
- ✅ Input validation
- ✅ Error handling

## 📦 Dependencies

- **express** - Web framework
- **mongoose** - MongoDB ODM
- **cloudinary** - Media storage
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT authentication
- **express-validator** - Input validation
- **multer** - File upload
- **cors** - CORS middleware
- **helmet** - Security headers
- **morgan** - HTTP logging

## 🚀 Deployment

Ready to deploy to:
- Oracle Cloud Free Tier
- Heroku
- AWS
- DigitalOcean
- Any Node.js hosting

## 📝 Notes

- All biometric data is stored securely in MongoDB
- Images and audio files are stored in Cloudinary
- Face/voice verification is handled by Python ML services
- JWT tokens expire after 7 days (configurable)
- Rate limit: 100 requests per 15 minutes per IP

## ✅ Status

Backend is **100% complete** and ready to use!
