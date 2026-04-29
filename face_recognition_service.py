"""
Face Recognition Service — OpenCV Built-in (SFace + YuNet)
==========================================================
Zero external ML dependencies — uses OpenCV's built-in:
  • FaceDetectorYN (YuNet model) for face detection
  • FaceRecognizerSF (SFace model) for face embeddings + matching

Works on Python 3.14 + Windows. No tensorflow, no dlib, no deepface.
Models auto-download from OpenCV Zoo on first run (~37MB total).
"""

import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

from fastapi import FastAPI, File, UploadFile, HTTPException, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from PIL import Image
import io
import asyncio
import cloudinary
import cloudinary.uploader
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import time
import logging
import cv2
from typing import List
from pathlib import Path
import urllib.request
import math
try:
    import librosa
    import soundfile as sf
except ImportError:
    print("⚠️  librosa not installed. Voice detection disabled. Run: pip install librosa soundfile")
    librosa = None

# ── Load .env ──
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent / 'backend' / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f'✅ Loaded env from {env_path}')
    else:
        root_env = Path(__file__).parent / '.env'
        if root_env.exists():
            load_dotenv(root_env)
            print(f'✅ Loaded env from {root_env}')
        else:
            print(f'⚠️  No .env found')
except ImportError:
    print('⚠️  python-dotenv not installed')

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("face_service")

# ==================== MODEL SETUP ====================

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

# YuNet face detector — tiny (0.2 MB)
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
YUNET_PATH = str(MODELS_DIR / "face_detection_yunet_2023mar.onnx")

# SFace face recognizer — medium (37 MB)
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
SFACE_PATH = str(MODELS_DIR / "face_recognition_sface_2021dec.onnx")


def download_if_missing(url: str, path: str, name: str):
    if os.path.exists(path):
        size_mb = os.path.getsize(path) / 1024 / 1024
        print(f"✅ {name} ready ({size_mb:.1f} MB)")
        return
    print(f"🔄 Downloading {name}...")
    urllib.request.urlretrieve(url, path)
    size_mb = os.path.getsize(path) / 1024 / 1024
    print(f"✅ Downloaded {name} ({size_mb:.1f} MB)")


print("🔄 Setting up face models...")
download_if_missing(YUNET_URL, YUNET_PATH, "YuNet face detector")
download_if_missing(SFACE_URL, SFACE_PATH, "SFace recognizer")

# ── Initialize OpenCV face modules ──
face_detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320), 0.7, 0.3, 5000)
face_recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")

print("✅ OpenCV FaceDetectorYN + FaceRecognizerSF loaded")

# ── Thread pool for ML inference (2 workers = overlap I/O with compute) ──
import concurrent.futures
import threading
_ml_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="face_ml")
_detector_lock = threading.Lock()   # YuNet is NOT thread-safe; serialize calls
_last_input_size = (0, 0)           # cache to skip redundant setInputSize calls

# ==================== CONFIGURATION ====================

EMBEDDING_DIM = 128          # SFace outputs 128-dim vector
ENCODING_BYTES = EMBEDDING_DIM * 8  # 1024 bytes (float64)
COSINE_THRESHOLD = 0.363     # OpenCV's default cosine threshold for SFace
L2_THRESHOLD = 1.128         # OpenCV's default L2 threshold for SFace

# ==================== FASTAPI APP ====================

app = FastAPI(title="Face Recognition Service (OpenCV SFace)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Cloudinary ──
cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME')
api_key = os.getenv('CLOUDINARY_API_KEY')
api_secret_raw = os.getenv('CLOUDINARY_API_SECRET', '')

if api_secret_raw.startswith('cloudinary://'):
    try:
        api_secret = api_secret_raw.split(':')[2].split('@')[0]
    except (IndexError, ValueError):
        api_secret = api_secret_raw
else:
    api_secret = api_secret_raw

cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret)
print(f'☁️  Cloudinary: cloud_name={cloud_name}')

# ── MongoDB ──
mongo_client = AsyncIOMotorClient(os.getenv('MONGODB_URI'))
db = mongo_client.attendance


# ==================== HELPERS ====================

def image_bytes_to_bgr(data: bytes) -> np.ndarray:
    """Convert raw image bytes to BGR numpy array (OpenCV format) natively in C++ for maximum speed."""
    arr = np.frombuffer(data, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("Could not decode image bytes")
    return bgr


def detect_face(image_bgr: np.ndarray):
    """
    Detect faces using YuNet. Returns the best face or None.
    Each face is [x, y, w, h, ...landmarks...] array.
    """
    h, w = image_bgr.shape[:2]
    face_detector.setInputSize((w, h))
    _, faces = face_detector.detect(image_bgr)
    if faces is None or len(faces) == 0:
        return None
    # Return highest-confidence face (last column is confidence)
    best_idx = np.argmax(faces[:, -1])
    return faces[best_idx]


def detect_all_faces(image_bgr: np.ndarray):
    """
    Detect all faces using YuNet. Returns a list of all detected faces.
    Uses a lock because YuNet is not thread-safe.
    Caches the last input size to skip redundant setInputSize calls.
    """
    global _last_input_size
    h, w = image_bgr.shape[:2]
    with _detector_lock:
        if (w, h) != _last_input_size:
            face_detector.setInputSize((w, h))
            _last_input_size = (w, h)
        _, faces = face_detector.detect(image_bgr)
    if faces is None or len(faces) == 0:
        return []
    return faces


def get_embedding(image_bgr: np.ndarray) -> np.ndarray:
    """
    Full pipeline: detect face → align → extract SFace embedding.
    Returns: 128-dim float64 numpy array.
    """
    face = detect_face(image_bgr)
    if face is None:
        raise ValueError("No face detected in image")

    # Align face using detected landmarks
    aligned = face_recognizer.alignCrop(image_bgr, face)

    # Extract 128-dim feature embedding
    embedding = face_recognizer.feature(aligned)
    return embedding.flatten().astype(np.float64)


def match_score(emb1: np.ndarray, emb2: np.ndarray) -> dict:
    """
    Compare two SFace embeddings using cosine similarity.
    Uses pure numpy (not cv2.FaceRecognizerSF.match) so the result
    is always a plain Python float — no numpy-array truth-value ambiguity.
    """
    # Flatten to 1-D float32
    v1 = emb1.astype(np.float32).flatten()
    v2 = emb2.astype(np.float32).flatten()

    # L2-normalise
    n1 = float(np.linalg.norm(v1))
    n2 = float(np.linalg.norm(v2))
    if n1 == 0 or n2 == 0:
        return {"cosine_score": 0.0, "l2_distance": 99.0, "is_match": False, "confidence": 0.0}

    cosine_score = float(np.dot(v1 / n1, v2 / n2))   # guaranteed Python float in [-1, 1]

    # L2 distance (for reference / logging only)
    l2_distance = float(np.linalg.norm(v1 - v2))

    is_match = cosine_score >= COSINE_THRESHOLD         # Python bool

    return {
        "cosine_score": cosine_score,
        "l2_distance": l2_distance,
        "is_match": is_match,
        "confidence": cosine_score,
    }


def detect_liveness(image_bgr: np.ndarray):
    """Basic liveness: blur check + face presence check."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()

    if lap_var < 30:
        return False, 0.3, "Image too blurry"
    if lap_var > 8000:
        return False, 0.4, "Image too sharp (printed photo?)"

    face = detect_face(image_bgr)
    if face is None:
        return False, 0.2, "No face detected"

    confidence = float(face[-1])  # YuNet confidence
    if confidence < 0.7:
        return False, confidence, "Low face detection confidence"

    return True, max(0.85, confidence), "Live face detected"


# ==================== API ENDPOINTS ====================

@app.post("/register-face")
async def register_face_endpoint(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """Register face — stores SFace 128-dim embedding."""
    try:
        image_data = await file.read()
        image_bgr = image_bytes_to_bgr(image_data)

        # Liveness
        is_live, conf, reason = detect_liveness(image_bgr)
        if not is_live:
            raise HTTPException(400, detail=f"Liveness check failed: {reason}")

        # Get embedding
        try:
            embedding = get_embedding(image_bgr)
        except ValueError as ve:
            raise HTTPException(400, detail=str(ve))

        logger.info(f"Registration: embedding shape={embedding.shape}, norm={np.linalg.norm(embedding):.4f}")

        # Upload to Cloudinary
        upload_result = cloudinary.uploader.upload(
            image_data,
            folder="attendance/faces",
            public_id=f"user_{user_id}_{int(time.time())}",
            transformation=[{'width': 800, 'height': 800, 'crop': 'limit'}, {'quality': 'auto:good'}]
        )

        # Store in MongoDB (128 * 8 = 1024 bytes)
        encoding_bytes = embedding.tobytes()
        logger.info(f"Saving encoding: {len(encoding_bytes)} bytes")

        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {
                "faceEncoding": encoding_bytes,
                "faceImageUrl": upload_result['secure_url'],
                "faceImageData": image_data,
                "faceRegisteredAt": time.time()
            }}
        )

        return {
            "success": True,
            "message": "Face registered successfully (OpenCV SFace)",
            "imageUrl": upload_result['secure_url'],
            "livenessConfidence": conf,
            "embeddingDim": len(embedding),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}", exc_info=True)
        raise HTTPException(500, detail=f"Error: {str(e)}")


@app.post("/batch-register-face")
async def batch_register_face_endpoint(
    user_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """Register multiple face samples — averages embeddings."""
    try:
        if not files or len(files) < 2:
            raise HTTPException(400, detail="Minimum 2 face samples required")

        all_embeddings = []
        primary_url = None

        for idx, f in enumerate(files):
            data = await f.read()
            bgr = image_bytes_to_bgr(data)

            if idx == 0:
                is_live, _, reason = detect_liveness(bgr)
                if not is_live:
                    raise HTTPException(400, detail=f"Liveness failed: {reason}")

            try:
                emb = get_embedding(bgr)
                all_embeddings.append(emb)
            except ValueError:
                continue

            if idx == 0:
                res = cloudinary.uploader.upload(
                    data, folder="attendance/faces",
                    public_id=f"user_{user_id}_profile",
                    transformation=[{'width': 400, 'height': 400, 'crop': 'fill', 'gravity': 'face'}]
                )
                primary_url = res['secure_url']

        if not all_embeddings:
            raise HTTPException(400, detail="No face detected in any sample")

        mean_emb = np.mean(all_embeddings, axis=0)
        norm = np.linalg.norm(mean_emb)
        if norm > 0:
            mean_emb = mean_emb / norm

        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {
                "faceEncoding": mean_emb.tobytes(),
                "faceImageUrl": primary_url,
                "faceRegisteredAt": time.time(),
                "encodingSampleCount": len(all_embeddings)
            }}
        )

        return {
            "success": True,
            "message": f"Registered with {len(all_embeddings)} samples (OpenCV SFace)",
            "imageUrl": primary_url,
            "samplesProcessed": len(all_embeddings)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Batch registration error: {e}", exc_info=True)
        raise HTTPException(500, detail=str(e))


@app.post("/verify-face")
async def verify_face_endpoint(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """Verify face against stored embedding."""
    try:
        image_data = await file.read()
        try:
            image_bgr = image_bytes_to_bgr(image_data)
        except Exception as e:
            return {"verified": False, "confidence": 0, "reason": f"Invalid image: {e}"}

        # Liveness
        is_live, liveness_conf, reason = detect_liveness(image_bgr)
        if not is_live:
            return {"verified": False, "confidence": 0, "reason": f"Liveness failed: {reason}"}

        # Fetch stored embedding
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        if not user or not user.get('faceEncoding'):
            raise HTTPException(404, detail="User face not registered")

        raw = user['faceEncoding']
        if hasattr(raw, 'read'):
            raw = raw.read()
        elif not isinstance(raw, (bytes, bytearray)):
            raw = bytes(raw)

        logger.info(f"Stored encoding: {len(raw)} bytes")

        # SFace encoding = 128 floats × 8 bytes = 1024 bytes
        if len(raw) != 1024:
            raise HTTPException(400, detail=f"Encoding size mismatch ({len(raw)} bytes, expected 1024). Please re-register your face.")

        stored = np.frombuffer(raw, dtype=np.float64)

        # Current face embedding
        try:
            current = get_embedding(image_bgr)
        except ValueError:
            return {"verified": False, "confidence": 0, "reason": "No face detected"}

        # Compare using OpenCV's built-in matching
        result = match_score(stored, current)

        logger.info(f"Verify: cosine={result['cosine_score']:.4f}, l2={result['l2_distance']:.4f}, match={result['is_match']}")

        # Upload verification image on success
        verify_url = None
        if result['is_match']:
            try:
                r = cloudinary.uploader.upload(
                    image_data, folder="attendance/verifications",
                    public_id=f"verify_{user_id}_{int(time.time())}"
                )
                verify_url = r['secure_url']
            except Exception:
                pass

        return {
            "verified": result['is_match'],
            "confidence": result['confidence'],
            "faceDistance": result['l2_distance'],
            "livenessConfidence": liveness_conf,
            "verificationImageUrl": verify_url,
            "reason": "Face matched" if result['is_match'] else "Face did not match"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Verify error: {e}", exc_info=True)
        raise HTTPException(500, detail=f"Error: {str(e)}")


@app.post("/identify-face")
async def identify_face_endpoint(file: UploadFile = File(...)):
    """Identify person from all registered faces."""
    try:
        data = await file.read()
        bgr = image_bytes_to_bgr(data)

        try:
            current = get_embedding(bgr)
        except ValueError:
            return {"identified": False, "userId": None, "confidence": 0}

        users = await db.users.find({"faceEncoding": {"$exists": True}}).to_list(1000)

        best = None
        best_score = 0

        for u in users:
            raw = u['faceEncoding']
            if hasattr(raw, 'read'):
                raw = raw.read()
            elif not isinstance(raw, (bytes, bytearray)):
                raw = bytes(raw)
            if len(raw) != 1024:
                continue

            stored = np.frombuffer(raw, dtype=np.float64)
            result = match_score(stored, current)

            if result['is_match'] and result['cosine_score'] > best_score:
                best_score = result['cosine_score']
                best = u

        if best:
            return {
                "identified": True,
                "userId": str(best['_id']),
                "userName": best.get('fullName'),
                "confidence": float(best_score)
            }
        return {"identified": False, "userId": None, "confidence": 0, "reason": "No match"}

    except Exception as e:
        logger.error(f"Identify error: {e}", exc_info=True)
        raise HTTPException(500, detail=str(e))


@app.post("/identify-multiple-faces")
async def identify_multiple_faces_endpoint(
    file: UploadFile = File(...),
    expected_user_ids: str = Form(None)
):
    """Identify multiple persons from a group photo.
    Optional: expected_user_ids = comma-separated MongoDB user IDs to restrict search.
    """
    try:
        data = await file.read()
        bgr = image_bytes_to_bgr(data)

        faces = detect_all_faces(bgr)
        if len(faces) == 0:
            return {"identified": False, "matches": [], "totalDetected": 0, "reason": "No faces detected"}

        # Filter users by expected IDs if provided
        query = {"faceEncoding": {"$exists": True}}
        if expected_user_ids:
            ids_list = []
            for uid in expected_user_ids.split(","):
                uid = uid.strip()
                if uid:
                    try:
                        ids_list.append(ObjectId(uid))
                    except Exception:
                        pass
            if ids_list:
                query["_id"] = {"$in": ids_list}
                logger.info(f"Restricting search to {len(ids_list)} enrolled users")

        users = await db.users.find(query).to_list(1000)
        logger.info(f"identify-multiple-faces: {len(faces)} faces detected, {len(users)} users in DB pool")

        # Pre-parse DB embeddings once
        db_embeddings = []
        for u in users:
            raw = u['faceEncoding']
            if hasattr(raw, 'read'):
                raw = raw.read()
            elif not isinstance(raw, (bytes, bytearray)):
                raw = bytes(raw)
            if len(raw) == 1024:
                stored = np.frombuffer(raw, dtype=np.float64)
                db_embeddings.append({"user_id": str(u["_id"]), "name": u.get("fullName"), "embedding": stored})

        matches = []
        for face in faces:
            try:
                aligned = face_recognizer.alignCrop(bgr, face)
                current_emb = face_recognizer.feature(aligned).flatten().astype(np.float64)

                best_user = None
                best_score = 0

                for db_user in db_embeddings:
                    result = match_score(db_user["embedding"], current_emb)
                    if result['is_match'] and result['cosine_score'] > best_score:
                        best_score = result['cosine_score']
                        best_user = db_user

                if best_user:
                    x, y, w, h = face[:4]
                    matches.append({
                        "userId": best_user["user_id"],
                        "userName": best_user["name"],
                        "confidence": float(best_score),
                        "box": [float(x), float(y), float(w), float(h)]
                    })
                    logger.info(f"  ✅ Matched: {best_user['name']} ({best_user['user_id']}), conf={best_score:.3f}")
                else:
                    logger.info(f"  ❌ Face not matched to any enrolled user")
            except Exception as e:
                logger.warning(f"Error processing a face: {e}")
                continue

        return {
            "identified": len(matches) > 0,
            "matches": matches,
            "totalDetected": len(faces)
        }

    except Exception as e:
        logger.error(f"Identify multiple error: {e}", exc_info=True)
        raise HTTPException(500, detail=str(e))


# Global cache for database embeddings to avoid querying MongoDB on every frame
_group_cache = []
_group_cache_ts = 0.0

@app.post("/identify-group")
async def identify_group_endpoint(
    file: UploadFile = File(...),
    expected_user_ids: str = Form(None)
):
    """Identify multiple persons in a group photo. Optionally restrict to expected_user_ids."""
    global _group_cache, _group_cache_ts
    try:
        data = await file.read()
        bgr = image_bytes_to_bgr(data)

        faces = detect_all_faces(bgr)
        if len(faces) == 0:
            return {"identifiedCount": 0, "matches": [], "totalFaces": 0}

        now = time.time()
        if expected_user_ids:
            # If expected_user_ids is provided, query DB directly (usually small)
            ids_list = []
            for uid in expected_user_ids.split(","):
                uid = uid.strip()
                if uid:
                    try: ids_list.append(ObjectId(uid))
                    except Exception: pass
            
            query = {"faceEncoding": {"$exists": True}, "_id": {"$in": ids_list}}
            users = await db.users.find(query).to_list(1000)
            
            db_embeddings = []
            for u in users:
                raw = u.get('faceEncoding')
                if raw is None: continue
                if hasattr(raw, 'read'): raw = raw.read()
                elif not isinstance(raw, (bytes, bytearray)): raw = bytes(raw)
                if len(raw) == 1024:
                    db_embeddings.append({
                        "user_id": str(u["_id"]),
                        "name": u.get("fullName", "Unknown"),
                        "embedding": np.frombuffer(raw, dtype=np.float64).copy()
                    })
        else:
            # Full pool search: use 10-second cache to prevent MongoDB spam on every frame!
            if now - _group_cache_ts > 10:
                users = await db.users.find({"faceEncoding": {"$exists": True}}).to_list(1000)
                new_cache = []
                for u in users:
                    raw = u.get('faceEncoding')
                    if raw is None: continue
                    if hasattr(raw, 'read'): raw = raw.read()
                    elif not isinstance(raw, (bytes, bytearray)): raw = bytes(raw)
                    if len(raw) == 1024:
                        new_cache.append({
                            "user_id": str(u["_id"]),
                            "name": u.get("fullName", "Unknown"),
                            "embedding": np.frombuffer(raw, dtype=np.float64).copy()
                        })
                _group_cache = new_cache
                _group_cache_ts = now
                logger.info(f"Updated group DB cache: {len(_group_cache)} users loaded.")
            
            db_embeddings = _group_cache

        if not db_embeddings:
            logger.warning("  No valid embeddings found in DB pool")
            return {"identifiedCount": 0, "matches": [], "totalFaces": len(faces)}

        matches = []
        for face in faces:
            try:
                aligned = face_recognizer.alignCrop(bgr, face)
                emb = face_recognizer.feature(aligned).flatten().astype(np.float64)
                best_match = None
                best_score = 0
                for db_user in db_embeddings:
                    result = match_score(db_user["embedding"], emb)
                    if result['is_match'] and result['cosine_score'] > best_score:
                        best_score = result['cosine_score']
                        best_match = db_user
                if best_match:
                    box = [float(face[0]), float(face[1]), float(face[2]), float(face[3])]
                    matches.append({
                        "userId": best_match["user_id"],
                        "userName": best_match["name"],
                        "confidence": float(best_score),
                        "box": box,
                    })
                    logger.info(f"  ✅ Match: {best_match['name']} ({best_match['user_id']}) conf={best_score:.3f}")
                else:
                    box = [float(face[0]), float(face[1]), float(face[2]), float(face[3])]
                    matches.append({
                        "userId": "unknown",
                        "userName": "Unknown",
                        "confidence": 0.0,
                        "box": box,
                    })
                    logger.info(f"  ❌ No match for detected face")
            except Exception as face_err:
                logger.warning(f"  Face processing error: {face_err}", exc_info=True)
                continue

        return {"identifiedCount": len(matches), "matches": matches, "totalFaces": len(faces)}

    except Exception as e:
        logger.error(f"Group identify error: {e}", exc_info=True)
        raise HTTPException(500, detail=str(e))


@app.get("/health")
def health_check():
    return {
        "status": "OK",
        "service": "Face Recognition (OpenCV SFace)",
        "opencvVersion": cv2.__version__,
        "embeddingDim": EMBEDDING_DIM,
        "cosineThreshold": COSINE_THRESHOLD,
        "timestamp": time.time()
    }


# ==================== WEBSOCKET LIVE DETECTION ====================
# Direct WebSocket endpoint — browser connects here instead of going
# through the live_camera_sync.py HTTP middleman. Eliminates one full
# HTTP round-trip per frame, matching the architecture of the old project.

# DB embedding cache shared across all WS connections
_ws_user_cache: list = []
_ws_user_cache_ts: float = 0.0
_ws_cache_refreshing: bool = False


@app.websocket("/ws/live-detect")
async def ws_live_detect(websocket: WebSocket):
    """
    Real-time face detection + recognition over WebSocket.
    Client sends: raw JPEG bytes (~15 fps with back-pressure)
    Server returns JSON: {"boxes": [{"x","y","w","h","name","conf"}, ...]}
    """
    global _ws_user_cache, _ws_user_cache_ts, _ws_cache_refreshing

    await websocket.accept()
    logger.info("WS /ws/live-detect client connected")

    # Stricter thresholds for live detection to avoid false positives
    WS_COSINE_THRESHOLD = 0.42   # higher than HTTP default (0.363)
    WS_MIN_MARGIN       = 0.06   # must beat 2nd-best by this margin

    # ── Sticky identity cache (per-connection) ──
    # Stores {face_region_key: {"name": str, "conf": float, "miss_count": int}}
    # When a face is identified, we hold that label for up to STICKY_FRAMES
    # consecutive "Unknown" frames before actually showing Unknown.
    # This eliminates single-frame flicker from angle/lighting variation.
    STICKY_FRAMES = 6   # ~400ms at 15fps before Unknown is shown
    sticky: dict = {}   # key = "cx_cy" bucket → {name, conf, miss_count}

    def _region_key(fx, fy, fw, fh) -> str:
        """Coarse bucket key for a face region — tolerates small position jitter."""
        cx = round(float(fx + fw / 2) / 50)   # bucket to nearest 50px
        cy = round(float(fy + fh / 2) / 50)
        return f"{cx}_{cy}"

    try:
        while True:
            try:
                raw_bytes = await websocket.receive_bytes()
            except WebSocketDisconnect:
                break

            if not raw_bytes or len(raw_bytes) < 100:
                await websocket.send_json({"boxes": []})
                continue

            # ── 1. Refresh DB embedding cache (async, before heavy ML work) ──
            now = time.time()
            if now - _ws_user_cache_ts > 10 and not _ws_cache_refreshing:
                _ws_cache_refreshing = True
                try:
                    users = await db.users.find({"faceEncoding": {"$exists": True}}).to_list(1000)
                    new_cache = []
                    for u in users:
                        raw = u.get("faceEncoding")
                        if raw is None: continue
                        if hasattr(raw, "read"): raw = raw.read()
                        elif not isinstance(raw, (bytes, bytearray)): raw = bytes(raw)
                        if len(raw) == 1024:
                            new_cache.append({
                                "user_id": str(u["_id"]),
                                "name": u.get("fullName", "Unknown"),
                                "embedding": np.frombuffer(raw, dtype=np.float64).copy()
                            })
                    _ws_user_cache = new_cache
                    _ws_user_cache_ts = now
                    logger.info(f"WS cache refreshed: {len(_ws_user_cache)} users")
                finally:
                    _ws_cache_refreshing = False

            # Snapshot cache for this frame so the thread doesn't touch the global
            frame_cache = list(_ws_user_cache)

            # ── 2. Run ML inference in dedicated thread pool ──
            def process_frame():
                arr = np.frombuffer(raw_bytes, dtype=np.uint8)
                bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if bgr is None:
                    return []

                faces = detect_all_faces(bgr)
                if len(faces) == 0:
                    return []

                # Score every face against every DB user
                result_grid = []
                for face in faces:
                    try:
                        aligned = face_recognizer.alignCrop(bgr, face)
                        cur_emb = face_recognizer.feature(aligned).flatten().astype(np.float64)
                        scores = []
                        for db_user in frame_cache:
                            r = match_score(db_user["embedding"], cur_emb)
                            scores.append((r["cosine_score"], db_user))
                        scores.sort(key=lambda t: t[0], reverse=True)
                        result_grid.append((face, scores))
                    except Exception as ex:
                        logger.debug(f"WS per-face embed error: {ex}")
                        result_grid.append((face, []))

                # Greedy dedup: each DB user assigned to exactly ONE face
                assigned_users: dict = {}
                for face_idx, (face, scores) in enumerate(result_grid):
                    if not scores:
                        continue
                    top_score, top_user = scores[0]
                    second_score = scores[1][0] if len(scores) > 1 else 0.0
                    margin = top_score - second_score

                    if top_score < WS_COSINE_THRESHOLD:
                        continue
                    if margin < WS_MIN_MARGIN and second_score > (WS_COSINE_THRESHOLD - 0.05):
                        continue

                    uid = top_user["user_id"]
                    if uid not in assigned_users or top_score > result_grid[assigned_users[uid]][1][0][0]:
                        assigned_users[uid] = face_idx

                # Build raw box list (before sticky smoothing)
                boxes = []
                for face_idx, (face, scores) in enumerate(result_grid):
                    fx, fy, fw, fh = face[0], face[1], face[2], face[3]
                    matched_name = "Unknown"
                    matched_conf = 0.0
                    for uid, winner_idx in assigned_users.items():
                        if winner_idx == face_idx:
                            for sc, db_user in scores:
                                if db_user["user_id"] == uid:
                                    matched_name = db_user["name"]
                                    matched_conf = sc
                                    break
                            break
                    boxes.append({
                        "x":    float(fx),
                        "y":    float(fy),
                        "w":    float(fw),
                        "h":    float(fh),
                        "name": matched_name,
                        "conf": round(float(matched_conf), 3),
                    })
                return boxes

            loop = asyncio.get_running_loop()
            raw_boxes = await loop.run_in_executor(_ml_executor, process_frame)

            # ── 3. Apply sticky smoothing ──
            # Track which sticky keys were seen this frame
            seen_keys = set()
            smoothed_boxes = []

            for b in raw_boxes:
                key = _region_key(b["x"], b["y"], b["w"], b["h"])
                seen_keys.add(key)

                if b["name"] != "Unknown":
                    # Identified → update sticky, reset miss counter
                    sticky[key] = {"name": b["name"], "conf": b["conf"], "miss_count": 0}
                    smoothed_boxes.append(b)
                else:
                    # Unknown — use last known identity if within STICKY_FRAMES
                    if key in sticky and sticky[key]["miss_count"] < STICKY_FRAMES:
                        sticky[key]["miss_count"] += 1
                        # Show the held identity at slightly reduced conf
                        held = sticky[key]
                        smoothed_boxes.append({**b, "name": held["name"], "conf": held["conf"] * 0.9})
                    else:
                        # Sticky expired — genuinely Unknown
                        sticky.pop(key, None)
                        smoothed_boxes.append(b)

            # Age out sticky entries for faces that have left frame
            for key in list(sticky.keys()):
                if key not in seen_keys:
                    sticky[key]["miss_count"] += 1
                    if sticky[key]["miss_count"] > STICKY_FRAMES * 2:
                        del sticky[key]

            await websocket.send_json({"boxes": smoothed_boxes})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS live-detect error: {e}", exc_info=True)
    finally:
        logger.info("WS /ws/live-detect client disconnected")







import json
from fastapi import UploadFile, File

def process_video_file(video_path: str, all_encodings, event_type: str, skip_frames=30):
    """
    Reads a video file, detects faces every `skip_frames` frames.
    Returns a list of dicts: [{'studentId': 'abc', 'type': 'ENTRY'|'EXIT', 'time_sec': 12.5}]
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return []

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0: fps = 30 # fallback
    
    events = []
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret: break
        
        # Process every Nth frame to save time (e.g., 1 frame per second)
        if frame_count % int(fps) == 0:
            time_sec = frame_count / fps
            
            # Detect faces
            faces = detect_all_faces(frame)
            if len(faces) > 0:
                for face in faces:
                    try:
                        aligned = face_recognizer.alignCrop(frame, face)
                        embedding = face_recognizer.feature(aligned)
                        emb_flat = embedding.flatten().astype(np.float64)
                        
                        best_match_id = None
                        best_score = 0
                        
                        for student_id, student_emb in all_encodings.items():
                            score = match_score(student_emb, emb_flat)['score']
                            if score > 0.45 and score > best_score:  # basic threshold
                                best_score = score
                                best_match_id = student_id
                                
                        if best_match_id:
                            events.append({
                                'studentId': best_match_id,
                                'type': event_type,
                                'time_sec': time_sec,
                                'confidence': float(best_score)
                            })
                    except Exception as e:
                        print(f"Face extraction err frame {frame_count}: {e}")

        frame_count += 1
        
    cap.release()
    return events


@app.post("/process-dual-video")
async def process_dual_video(
    lecture_id: str = Form(...),
    inside_video: UploadFile = File(...),
    outside_video: UploadFile = File(...),
    enrolled_students: str = Form(...) # JSON list of object IDs to limit search
):
    """
    Accepts two video files (inside camera, outside camera).
    Calculates precise entry/exit timeline and returns Attendance percentages per student.
    """
    try:
        # 1. Parse enrolled students 
        try:
            enrolled_ids = json.loads(enrolled_students)
        except:
            enrolled_ids = []

        # 2. Fetch all encodings from DB, filter by enrolled if possible
        coll = get_db_collection()
        all_docs = list(coll.find({}))
        
        valid_encodings = {}
        for doc in all_docs:
            uid = doc.get("userId", "")
            if len(enrolled_ids) > 0 and uid not in enrolled_ids:
                continue # Skip students not in this lecture
                
            enc = doc.get("embedding")
            if enc and isinstance(enc, list) and len(enc) == 128:
                valid_encodings[uid] = np.array(enc, dtype=np.float64)

        if not valid_encodings:
            return {"success": False, "message": "No valid encodings found for enrolled students"}
            
        print(f"[DUAL-CAM] Processing videos for {len(valid_encodings)} enrolled students...")

        # 3. Save uploaded videos temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as in_tmp:
            in_content = await inside_video.read()
            in_tmp.write(in_content)
            inside_path = in_tmp.name
            
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as out_tmp:
            out_content = await outside_video.read()
            out_tmp.write(out_content)
            outside_path = out_tmp.name

        # 4. Process both videos to extract chronological events
        print("[DUAL-CAM] Scanning inside video (ENTRY events)...")
        in_events = process_video_file(inside_path, valid_encodings, "ENTRY")
        
        print("[DUAL-CAM] Scanning outside video (EXIT events)...")
        out_events = process_video_file(outside_path, valid_encodings, "EXIT")
        
        import os
        os.remove(inside_path)
        os.remove(outside_path)

        # 5. Combine, sort, and calculate lengths
        all_events = in_events + out_events
        all_events = sorted(all_events, key=lambda x: x['time_sec'])
        
        # Calculate maximum possible duration based on total video length
        # Assuming both videos ran for roughly the same total duration of the lecture
        max_duration = 0
        if len(all_events) > 0:
            max_duration = max([e['time_sec'] for e in all_events])
            
        if max_duration < 1: 
            max_duration = 1  # prevent div by zero
            
        # 6. Compute logic per student
        student_timelines = {}
        for ev in all_events:
            sid = ev['studentId']
            if sid not in student_timelines:
                 student_timelines[sid] = {'events': [], 'total_present_sec': 0, 'currently_in': False, 'last_entry': 0}
                 
            st = student_timelines[sid]
            
            if ev['type'] == 'ENTRY':
                if not st['currently_in']:
                    st['currently_in'] = True
                    st['last_entry'] = ev['time_sec']
            elif ev['type'] == 'EXIT':
                if st['currently_in']:
                    st['currently_in'] = False
                    duration = ev['time_sec'] - st['last_entry']
                    st['total_present_sec'] += duration
                    
        # Conclude any students left "inside" at end of video
        results = []
        for sid, st in student_timelines.items():
            if st['currently_in']:
                 duration = max_duration - st['last_entry']
                 st['total_present_sec'] += duration
                 
            total_min = round(st['total_present_sec'] / 60, 2)
            max_min = max_duration / 60
            pct = round((st['total_present_sec'] / max_duration) * 100, 2)
            if pct > 100: pct = 100
            
            results.append({
                "studentId": sid,
                "totalPresentMinutes": total_min,
                "attendancePercentage": pct
            })

        print(f"[DUAL-CAM] Processing complete. Identified presence for {len(results)} students.")
        return {
            "success": True, 
            "results": results
        }

    except Exception as e:
        print(f"Error in dual video processing: {e}")
        return JSONResponse(status_code=500, content={"success": False, "message": str(e)})


# ==================== VOICE BIOMETRICS & ANTI-SPOOFING ====================
from fastapi.responses import JSONResponse

def compute_voice_embedding(y, sr):
    """
    Computes a 1D averaged MFCC embedding from Librosa Audio.
    MFCCs (Mel-frequency cepstral coefficients) capture the vocal tract shape.
    """
    # Extract 40 MFCCs
    mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=40)
    # Extract Spectral Contrast
    contrast = librosa.feature.spectral_contrast(y=y, sr=sr)
    
    # Average them across time frames to get a stable 1D vector (fingerprint)
    mfccs_mean = np.mean(mfccs.T, axis=0)
    contrast_mean = np.mean(contrast.T, axis=0)
    
    embedding = np.hstack([mfccs_mean, contrast_mean])
    return embedding / np.linalg.norm(embedding) # Normalize

def check_liveness_antispoof(y, sr):
    """
    Anti-Spoofing: Differentiates LIVE human speech from PHONE/SPEAKER PLAYBACK.
    Method:
      - Phones and speakers severely attenuate high frequencies (>8000Hz)
      - Live human speech directly into a mic contains high-frequency breath pops 
        and high-level Spectral Flux (rapid freq shifts).
      - Returns: (is_live: bool, confidence: float, reason: str)
    """
    # 1. High Frequency Content (HFC)
    S = np.abs(librosa.stft(y))
    freqs = librosa.fft_frequencies(sr=sr)
    
    # Filter only freq bands > 4000 Hz
    high_freq_idx = np.where(freqs > 4000)[0]
    high_energy = float(np.sum(S[high_freq_idx, :]) / (np.sum(S) + 1e-10))
    
    # 2. Spectral Flux (How fast does the frequency spectrum change?)
    # Playbacks often sound 'muffled' or flatter in spectral change
    flux = librosa.onset.onset_strength(y=y, sr=sr)
    mean_flux = float(np.mean(flux))

    logger.info(f"Liveness Check -> HighFreqRatio: {high_energy:.4f}, Mean Flux: {mean_flux:.4f}")
    
    # Optimal Thresholds calculated from live analytics:
    # Live Human baseline is approximately HFC: 0.14 - 0.30, Flux: 1.4 - 2.0+
    # High-fidelity playback drops HFC closer to ~0.05 and Flux ~0.5.
    if high_energy < 0.10 or mean_flux < 1.25:
        return False, 0.99, "Failed Liveness Check: Detected Playback/Speaker Spoofing"
    
    return True, 1.0, "Live Human Confirmed"

@app.post("/register-voice")
async def register_voice(file: UploadFile = File(...)):
    """
    Accepts a .wav/.webm file from the frontend, extracts MFCC embeddings,
    and returns the numpy array to be stored in MongoDB.
    """
    if not librosa:
        raise HTTPException(500, detail="Voice librosa not installed on server.")
        
    try:
        # Save temp audio file
        temp_audio = f"temp_reg_{int(time.time())}_{file.filename}"
        with open(temp_audio, "wb") as f:
            f.write(await file.read())
            
        # Load audio
        y, sr = librosa.load(temp_audio, sr=16000, mono=True)
        # Trim leading/trailing silence
        y, _ = librosa.effects.trim(y, top_db=20)
        
        # Check Length
        duration = librosa.get_duration(y=y, sr=sr)
        if duration < 0.5:
            os.remove(temp_audio)
            raise HTTPException(400, "Audio too short. Please speak clearly into the microphone.")
            
        embedding = compute_voice_embedding(y, sr)
        os.remove(temp_audio)
        
        return JSONResponse(content={
            "success": True,
            "embedding": embedding.tolist()
        })
    except Exception as e:
        logger.error(f"Voice Registration Failed: {e}")
        return JSONResponse(status_code=500, content={"success": False, "message": str(e)})

@app.post("/verify-voice")
async def verify_voice(
    file: UploadFile = File(...),
    teacher_id: str = Form(...),
    expected_embedding: str = Form(...) 
):
    """
    1) Anti-Spoof check on audio file
    2) Extract target MFCC
    3) Cosine match against the expected_embedding string
    """
    if not librosa:
        return JSONResponse(status_code=500, content={"success": False, "message": "Voice modules missing."})
        
    try:
        import json
        # Since Node passes stringified JSON in the Form, load it, then convert to Float32 array
        target_list = json.loads(expected_embedding)
        
        # If the Node backend passes it as a dict string like {'0': 0.123, '1': 0.45}, parse the values 
        if isinstance(target_list, dict):
             target_list = list(target_list.values())
             
        target_vec = np.array(target_list, dtype=np.float32)
        
        temp_audio = f"temp_ver_{int(time.time())}_{file.filename}"
        with open(temp_audio, "wb") as f:
            f.write(await file.read())
            
        y, sr = librosa.load(temp_audio, sr=16000, mono=True)
        y, _ = librosa.effects.trim(y, top_db=20)
        os.remove(temp_audio)
        
        # 1. Anti Spoof
        is_live, conf, reason = check_liveness_antispoof(y, sr)
        if not is_live:
            return JSONResponse(content={
                "success": False,
                "isSpoofed": True,
                "message": f"Anti-Spoofing Activated: {reason}"
            })
            
        # 2. Extract and Compare
        incoming_vec = compute_voice_embedding(y, sr)
        
        # Check alignment (legacy embeddings might have different dimensions)
        if target_vec.shape != incoming_vec.shape:
            return JSONResponse(content={
                "success": False,
                "isSpoofed": False,
                "match": False,
                "message": "Outdated voice print version. Please re-register your voice in your profile.",
                "confidence": 0.0
            })
            
        # Cosine similarity
        similarity = np.dot(target_vec, incoming_vec)
        logger.info(f"Voice Cosine Similarity: {similarity:.4f}")
        
        # Threshold: > 0.82 indicates strongly similar vocal tract
        if similarity >= 0.82:
            return JSONResponse(content={
                "success": True,
                "isSpoofed": False,
                "match": True,
                "confidence": float(similarity)
            })
        else:
            return JSONResponse(content={
                "success": False,
                "isSpoofed": False,
                "match": False,
                "message": "Voice Print did not match teacher database.",
                "confidence": float(similarity)
            })
            
    except Exception as e:
        logger.error(f"Voice Verification Failed: {e}")
        return JSONResponse(status_code=500, content={"success": False, "message": str(e)})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
