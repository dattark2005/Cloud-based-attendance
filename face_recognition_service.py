"""
Face Recognition Service — OpenCV Built-in (SFace + YuNet)
==========================================================
Zero external ML dependencies — uses OpenCV's built-in:
  • FaceDetectorYN (YuNet model) for face detection
  • FaceRecognizerSF (SFace model) for face embeddings + matching

Works on Python 3.14 + Windows. No tensorflow, no dlib, no deepface.
Models auto-download from OpenCV Zoo on first run (~37MB total).
"""

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from PIL import Image
import io
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
    """Convert raw image bytes to BGR numpy array (OpenCV format)."""
    img = Image.open(io.BytesIO(data))
    rgb = np.array(img.convert('RGB'))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


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
    Compare two embeddings using OpenCV's built-in matching.
    Returns cosine score and L2 distance + match decision.
    """
    e1 = emb1.astype(np.float32).reshape(1, -1)
    e2 = emb2.astype(np.float32).reshape(1, -1)

    cosine_score = face_recognizer.match(e1, e2, cv2.FaceRecognizerSF_FR_COSINE)
    l2_distance = face_recognizer.match(e1, e2, cv2.FaceRecognizerSF_FR_NORM_L2)

    is_match = cosine_score >= COSINE_THRESHOLD

    return {
        "cosine_score": float(cosine_score),
        "l2_distance": float(l2_distance),
        "is_match": is_match,
        "confidence": float(cosine_score),
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
