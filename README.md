# Cloud-Based Attendance System

A smart attendance system using **face recognition** and **voice biometrics** built with Next.js, Node.js, Python (FastAPI), and MongoDB.

---

## Stack
| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (TypeScript) |
| Backend API | Node.js + Express |
| Face Service | Python + FastAPI + OpenCV (YuNet/SFace) |
| Voice Service | Python + FastAPI + Resemblyzer |
| Database | MongoDB Atlas |
| Storage | Cloudinary |

---

## Prerequisites
- **Node.js** ≥ 18
- **Python** ≥ 3.10
- **MongoDB Atlas** URI
- **Cloudinary** account

---

## Setup

### 1. Clone & install

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install

# Python services
cd ..
pip install -r requirements.txt
```

### 2. Environment variables

Copy `backend/.env.example` → `backend/.env` and fill in:

```env
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_secret
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
FACE_SERVICE_URL=http://localhost:8000
VOICE_SERVICE_URL=http://localhost:8001
```

---

## Run (3 terminals)

```bash
# Terminal 1 — Backend API (port 3001)
cd backend && npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend && npm run dev

# Terminal 3 — Face Recognition Service (port 8000)
python -m uvicorn face_recognition_service:app --host 0.0.0.0 --port 8000 --reload

# Terminal 4 — Voice Service (port 8001) [optional]
python -m uvicorn voice_recognition_service:app --host 0.0.0.0 --port 8001 --reload
```

Open **http://localhost:3000**

---

## How it works

1. **Teacher** opens a lecture → marks own attendance via face scan
2. **Teacher** uploads/captures a classroom photo
3. Face recognition identifies enrolled students in the photo → marks them present
4. Teacher can manually edit any student's attendance

