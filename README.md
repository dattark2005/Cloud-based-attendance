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

# Python services (from project root)
cd ..
pip install -r requirements.txt
```

> **Windows / Python 3.12 note:** `webrtcvad` (required by Resemblyzer) cannot compile from source.
> Install the pre-built wheel first, then Resemblyzer without its own deps:
> ```bash
> pip install webrtcvad-wheels
> pip install resemblyzer --no-deps
> ```

### 2. Environment variables

Copy `backend/.env.example` → `backend/.env` and fill in:

```env
MONGODB_URI=mongodb+srv://...
JWT_SECRET=your_secret
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
FACE_SERVICE_URL=http://localhost:8000
VOICE_SERVICE_URL=http://localhost:8081
```

---

## Running the Project

### Option A — All-in-one (recommended)

Open **2 terminals**:

```bash
# Terminal 1 — Backend + Face Service + Voice Service (all at once)
cd backend
npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend
npm run dev
```

The `npm run dev` in the backend uses **concurrently** to launch:
| Label | Service | Port |
|---|---|---|
| `[NODE]` | Express API (nodemon) | 3001 |
| `[FACE]` | Face Recognition (FastAPI) | 8000 |
| `[VOICE]` | Voice Recognition (FastAPI) | 8081 |

### Option B — With Live Camera Monitor

If you have a classroom camera (webcam or Android IP Webcam app):

```bash
# Terminal 1 — Backend + Face + Voice + Live Camera
cd backend
npm run dev:camera

# Terminal 2 — Frontend
cd frontend
npm run dev
```

For the live camera, edit `camera_config.json` in the project root:
```json
{ "default_camera": 0 }
```
Use `0` for your laptop webcam, or a URL like `http://10.x.x.x:8080/video` for an IP Webcam app.

Open **http://localhost:3000**

---

## Services Overview

| File | Role |
|---|---|
| `face_recognition_service.py` | FastAPI service — registers & verifies faces using OpenCV SFace/YuNet |
| `voice_recognition_service.py` | FastAPI service — registers & verifies voice using Resemblyzer embeddings |
| `live_camera_sync.py` | Standalone daemon — continuously monitors the classroom camera, detects student presence every 10s, flags absences after 3 min, streams live preview to teacher dashboard |

---

## How It Works

1. **Teacher** opens a lecture → marks own attendance via **face scan** or **voice verification**
2. **Teacher** uploads/captures a classroom photo → face recognition identifies enrolled students → marks them present
3. **Live camera** (optional) continuously monitors the room — students missing for >3 min are flagged absent automatically
4. Teacher can manually edit any student's attendance record
