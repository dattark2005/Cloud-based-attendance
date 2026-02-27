# Cloud-Based Attendance System — Project Status

> **Date:** 27 Feb 2026  
> **Author:** Dattatray Kshirsagar  
> **Semester:** VI — Deep Learning Project

---

## 1. Tech Stack

| Layer              | Technology                          | Purpose                                    |
|--------------------|-------------------------------------|--------------------------------------------|
| **Frontend**       | Next.js 14 (React + TypeScript)     | Teacher & Student dashboards, camera UI    |
| **Backend API**    | Node.js + Express.js                | REST API, auth, session management         |
| **Database**       | MongoDB Atlas (Mongoose ODM)        | Users, Sections, Lectures, Attendance      |
| **Face Recognition** | Python FastAPI + `face_recognition` lib | Face encoding, verification, liveness     |
| **Voice Recognition** | Python FastAPI + TensorFlow       | Voice embedding, teacher voice verification|
| **File Storage**   | Cloudinary                          | Face images, voice audio uploads           |
| **Real-time**      | Socket.io                           | Live session notifications, student detect |
| **Auth**           | JWT (access + refresh tokens)       | Role-based auth (Admin, Teacher, Student)  |
| **Security**       | Helmet, CORS, express-rate-limit    | API protection, rate limiting              |

---

## 2. Architecture Pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js :3000)                      │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐                 │
│  │  Login /     │  │  Teacher     │  │  Student    │                 │
│  │  Register    │  │  Dashboard   │  │  Dashboard  │                 │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘                 │
│         │                │                  │                        │
│         │    ┌───────────┴──────────────────┘                        │
│         │    │   Camera Capture Component (face image → base64)      │
│         │    │   Voice Recorder Component (audio → base64)           │
│         └────┴──────────────────┬────────────────────────────────────┘
│                                 │  HTTP (REST)
│                                 ▼
│  ┌──────────────────────────────────────────────────────────────────┐
│  │              BACKEND API (Node.js + Express  :3001)              │
│  │                                                                  │
│  │  Routes:                                                         │
│  │   /api/auth             → Login, Register, Profile               │
│  │   /api/admin            → Manage Departments, Courses, Users     │
│  │   /api/sections         → CRUD Sections, Start/End Sessions      │
│  │   /api/biometric        → Face/Voice Register & Verify           │
│  │   /api/attendance       → Student attendance records             │
│  │   /api/teacher-attendance → Teacher face-based attendance        │
│  │   /api/gps-attendance   → GPS + Photo based attendance           │
│  │                                                                  │
│  │  Middleware: JWT Auth → Role Guard → Rate Limit → Error Handler  │
│  └────────────┬─────────────────────────────┬───────────────────────┘
│               │                             │
│     HTTP :8000│                    HTTP :8001│
│               ▼                             ▼
│  ┌────────────────────────┐  ┌────────────────────────────┐
│  │  FACE RECOGNITION      │  │  VOICE RECOGNITION          │
│  │  (Python FastAPI)      │  │  (Python FastAPI)           │
│  │                        │  │                              │
│  │  • /register (encode)  │  │  • /register (embed)        │
│  │  • /verify  (compare)  │  │  • /verify  (compare)       │
│  │  • /identify (search)  │  │  • /health                  │
│  │  • Liveness detection  │  │                              │
│  │  • Stores encoding in  │  └──────────────────────────────┘
│  │    MongoDB directly    │
│  └────────────────────────┘
│
│  ┌──────────────────────────────────────────────────────────────────┐
│  │                  MONGODB ATLAS (Cloud Database)                   │
│  │                                                                  │
│  │  Collections:                                                    │
│  │   • users              — email, password, role, faceEncoding     │
│  │   • departments        — name, description                       │
│  │   • courses            — courseName, courseCode, departmentId     │
│  │   • sections           — courseId, teacherId, students[], schedule│
│  │   • lectures           — sectionId, teacherId, status, times     │
│  │   • attendancerecords  — lectureId, studentId, method, score     │
│  │   • teacherattendances — teacherId, lectureId, date, method      │
│  │   • attendancerequests — lectureId, studentId, reason            │
│  │   • entryexitlogs      — userId, lectureId, type, confidence     │
│  └──────────────────────────────────────────────────────────────────┘
│
│  ┌──────────────────────────────┐
│  │      CLOUDINARY (CDN)        │
│  │   Face images, Voice audio   │
│  └──────────────────────────────┘
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Current Working Status

### ✅ What is DONE and Working

| Feature                              | Status   | Details |
|--------------------------------------|----------|---------|
| User Registration & Login            | ✅ Done  | JWT auth with role-based access (Admin, Teacher, Student) |
| Admin Panel                          | ✅ Done  | Create departments, courses, sections, assign teachers |
| Section Management                   | ✅ Done  | Create sections, join codes, students enroll via code |
| Teacher Dashboard                    | ✅ Done  | View assigned classrooms, manage sections |
| Student Dashboard                    | ✅ Done  | View enrolled sections, attendance stats |
| Face Registration (Teacher)          | ✅ Done  | Teacher registers face via camera → encoding stored in DB |
| Face Verification (Teacher Attendance)| ✅ Done | Teacher marks attendance by verifying face against stored encoding |
| Per-Lecture Teacher Attendance       | ✅ Done  | Teacher can mark attendance per lecture (not just per day) |
| Live Session (Start/End)             | ✅ Done  | Teacher starts session → students get notified via Socket.io |
| Student Face Verification in Session | ✅ Done  | Student verifies face during live lecture → attendance marked |
| GPS + Photo Attendance               | ✅ Done  | Student marks attendance by location + live selfie |
| Liveness Detection                   | ✅ Done  | Python service checks for live face (anti-spoofing) |
| Cloudinary Image Storage             | ✅ Done  | Face images uploaded to Cloudinary |
| Local Fallback for Face Service      | ✅ Done  | If Python service is down, uses stored image for basic check |
| Socket.io Real-time Notifications    | ✅ Done  | Live session events broadcast to students and teachers |
| CameraCapture Component              | ✅ Done  | Reusable webcam component for face capture |

### ⚠️ Core Requirement: Teacher Face Attendance Per Session

**Current Flow (working):**
1. Teacher registers face once (via `/api/teacher-attendance/register-face` or `/api/biometric/face/register`)
2. For each new session/lecture, teacher opens the attendance panel
3. Teacher captures face image via camera
4. Backend verifies face against stored encoding (via Python service or local fallback)
5. If verified → `TeacherAttendance` record created with `lectureId` + `date`
6. One unique record per teacher per lecture per day (DB index enforces this)

**Models involved:**
- `TeacherAttendance` → `{ teacherId, lectureId, date, status, verificationMethod, confidenceScore }`
- `User` → stores `faceEncoding` (Buffer), `faceImageData` (Buffer), `faceRegisteredAt`
- `Lecture` → `{ sectionId, teacherId, status, actualStart, actualEnd, topic }`

### 🔴 Known Issues / Gaps

| Issue | Description |
|-------|-------------|
| Python Service Dependency | Face recognition service (`localhost:8000`) must be running; works only on machines with `dlib` + `face_recognition` installed |
| JWT Secret is hardcoded | `JWT_SECRET=secret` in `.env` — not production-safe |
| No schedule-aware enforcement | Teacher can mark attendance anytime, no check against section schedule |
| No teacher face verification at session start | When teacher starts a session (clicks "Start Session"), they are NOT forced to verify face — they only do it from a separate attendance panel |

---

## 4. Database Schema (Key Models)

```
User
├── email, password, fullName, role (ADMIN|TEACHER|STUDENT)
├── prn, rollNumber (students only)
├── department (ref → Department)
├── faceEncoding (Buffer — 128-dim numpy array serialized)
├── faceImageData (Buffer — raw image fallback)
├── faceRegisteredAt (Date)
├── voiceEmbedding (Buffer), voiceRegisteredAt
└── currentStatus (IN/OUT), isActive

Section
├── courseId (ref → Course), teacherId (ref → User)
├── sectionName, academicYear, semester, roomNumber
├── students[] (ref → User)
├── schedule[{ dayOfWeek, startTime, endTime }]
├── joinCode (auto-generated)
└── classroomLocation { lat, lng, radiusMeters }

Lecture
├── sectionId (ref → Section), teacherId (ref → User)
├── scheduledStart, scheduledEnd, actualStart, actualEnd
├── status (SCHEDULED | ONGOING | COMPLETED | CANCELLED)
├── topic, roomNumber, notes
└── virtuals: attendanceRecords, attendanceRequest

TeacherAttendance
├── teacherId (ref → User)
├── lectureId (ref → Lecture) ← nullable
├── date (YYYY-MM-DD)
├── markedAt, status (PRESENT)
├── verificationMethod (FACE | MANUAL | FACE_LOCAL)
└── confidenceScore (0-1)

AttendanceRecord (students)
├── lectureId (ref → Lecture), studentId (ref → User)
├── status (PRESENT | ABSENT | LATE | EXCUSED)
├── verificationMethod (FACE | MANUAL | GPS)
├── confidenceScore, faceImageUrl
├── location { lat, lng }, deviceInfo
└── gpsVerification { lat, lng, accuracy, distanceFromClassroom, photoUrl }
```

---

## 5. API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST   | `/api/auth/register` | Register new user |
| POST   | `/api/auth/login` | Login → JWT token |
| GET    | `/api/auth/me` | Get current user profile |
| POST   | `/api/biometric/face/register` | Register face encoding |
| POST   | `/api/biometric/face/verify` | Verify face against stored |
| POST   | `/api/teacher-attendance/register-face` | Register teacher face |
| POST   | `/api/teacher-attendance/mark` | Mark teacher attendance (face verify) |
| GET    | `/api/teacher-attendance/status` | Today's attendance records |
| GET    | `/api/teacher-attendance/my` | Teacher's attendance history |
| POST   | `/api/sections/:id/start-session` | Start live lecture |
| POST   | `/api/sections/:id/end-session` | End live lecture |
| GET    | `/api/sections/active` | Get active sessions |
| POST   | `/api/sections/session/:lectureId/verify` | Student face verify in session |
| POST   | `/api/gps-attendance/mark` | GPS + photo attendance |

---

## 6. How to Run (Quick Start)

```bash
# 1. Backend (Terminal 1)
cd backend
npm install
node server.js                    # Runs on :3001

# 2. Frontend (Terminal 2)
cd frontend
npm install
npm run dev                       # Runs on :3000

# 3. Face Recognition Service (Terminal 3) — OPTIONAL
cd .venv/Scripts/activate         # or source .venv/bin/activate (Linux)
pip install -r requirements_face.txt
python face_recognition_service.py  # Runs on :8000
```

---

## 7. Next Steps (To Be Decided)

> Awaiting further requirements from user. The system is ready for:
> - Enforcing teacher face verification at session start
> - Schedule-aware attendance (only allow marking during scheduled time)  
> - Admin analytics and reporting
> - Bulk student enrollment
> - Production deployment hardening
