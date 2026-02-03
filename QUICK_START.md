# 🚀 Quick Start Guide

## Prerequisites

Before you begin, make sure you have:

1. **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
2. **MongoDB Atlas Account** - [Sign up free](https://www.mongodb.com/cloud/atlas/register)
3. **Cloudinary Account** - [Sign up free](https://cloudinary.com/users/register/free)
4. **Python 3.8+** (for ML services)

---

## Step 1: Get Your Credentials

### MongoDB Atlas
1. Go to https://www.mongodb.com/cloud/atlas/register
2. Create a free cluster
3. Click "Connect" → "Connect your application"
4. Copy the connection string (looks like: `mongodb+srv://username:password@cluster.mongodb.net/`)

### Cloudinary
1. Go to https://cloudinary.com/users/register/free
2. Sign up for a free account
3. Go to Dashboard
4. Copy these values:
   - Cloud Name
   - API Key
   - API Secret

---

## Step 2: Configure Backend

```bash
# Navigate to backend folder
cd backend

# Open .env file and update these values:
```

**Edit `backend/.env`:**
```bash
# MongoDB - Replace with your connection string
MONGODB_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@cluster.mongodb.net/attendance?retryWrites=true&w=majority

# Cloudinary - Replace with your credentials
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# JWT Secret - Change this to a random string
JWT_SECRET=your_super_secret_key_change_this_now
JWT_REFRESH_SECRET=your_refresh_token_secret_change_this_too

# Keep these as is for local development
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
FACE_SERVICE_URL=http://localhost:8000
VOICE_SERVICE_URL=http://localhost:8001
```

---

## Step 3: Configure Frontend

**Edit `frontend/.env.local`:**
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

---

## Step 4: Start the Services

### Terminal 1: Backend Server
```bash
cd backend
npm run dev
```

You should see:
```
╔═══════════════════════════════════════════════════════════╗
║   🎓 Attendance System API Server                        ║
║   ✅ Server running on port 3001                         ║
║   ✅ MongoDB: Connected                                   ║
╚═══════════════════════════════════════════════════════════╝
```

### Terminal 2: Frontend Server
```bash
cd frontend
npm run dev
```

You should see:
```
▲ Next.js 16.1.6 (Turbopack)
- Local:         http://localhost:3000
✓ Ready in 1.2s
```

---

## Step 5: Test the System

### 1. Check Backend Health
Open browser: http://localhost:3001/health

You should see:
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2026-02-03T...",
  "environment": "development"
}
```

### 2. Check Frontend
Open browser: http://localhost:3000

You should see the beautiful landing page!

### 3. Test Registration
1. Go to http://localhost:3000/login
2. Click "Register" (if you add that button) or use API:

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.com",
    "password": "password123",
    "fullName": "Admin User",
    "role": "ADMIN"
  }'
```

### 4. Test Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.com",
    "password": "password123"
  }'
```

You'll get a response with `accessToken` - save this!

---

## Step 6: Create Sample Data

Use the admin APIs to create departments, courses, and sections:

### Create Department
```bash
curl -X POST http://localhost:3001/api/admin/departments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "name": "Computer Science",
    "code": "CS"
  }'
```

### Create Course
```bash
curl -X POST http://localhost:3001/api/admin/courses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "courseCode": "CS101",
    "courseName": "Introduction to Programming",
    "departmentId": "DEPARTMENT_ID_FROM_ABOVE",
    "credits": 3
  }'
```

---

## Step 7: (Optional) Start Python ML Services

If you have the Python face/voice recognition services:

### Terminal 3: Face Recognition
```bash
cd python_services/face_recognition
python app.py
```

### Terminal 4: Voice Recognition
```bash
cd python_services/voice_recognition
python app.py
```

---

## 🎉 You're All Set!

Your attendance system is now running with:
- ✅ Backend API on http://localhost:3001
- ✅ Frontend UI on http://localhost:3000
- ✅ MongoDB connected
- ✅ Cloudinary configured
- ✅ (Optional) ML services running

---

## Common Issues & Solutions

### Issue: MongoDB connection error
**Solution**: Make sure you:
1. Whitelisted your IP address in MongoDB Atlas
2. Replaced `<password>` in connection string with actual password
3. URL-encoded special characters in password

### Issue: Cloudinary upload fails
**Solution**: Double-check your credentials in `.env`

### Issue: CORS error
**Solution**: Make sure `FRONTEND_URL` in backend `.env` matches your frontend URL

### Issue: Port already in use
**Solution**: 
```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:3001 | xargs kill
```

---

## Next Steps

1. **Create an admin account** using the registration API
2. **Add departments and courses** through admin dashboard
3. **Create student accounts** and enroll them in sections
4. **Test attendance flow**:
   - Teacher creates attendance request
   - Student marks attendance with face
   - View real-time status

---

## Need Help?

- Check `IMPLEMENTATION_SUMMARY.md` for detailed documentation
- Check `backend/README.md` for API documentation
- Check console logs for error messages

Happy coding! 🚀
