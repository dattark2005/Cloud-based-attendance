# Face Recognition Service - Complete Production Code
# face_service/app.py

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
import face_recognition
import numpy as np
from PIL import Image
import io
import cloudinary
import cloudinary.uploader
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import base64
import cv2
from typing import List
import time

app = FastAPI(title="Face Recognition Service")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cloudinary config
cloudinary.config(
    cloud_name=os.getenv('CLOUDINARY_CLOUD_NAME'),
    api_key=os.getenv('CLOUDINARY_API_KEY'),
    api_secret=os.getenv('CLOUDINARY_API_SECRET')
)

# MongoDB connection
mongo_client = AsyncIOMotorClient(os.getenv('MONGODB_URI'))
db = mongo_client.attendance

# ==================== LIVENESS DETECTION ====================

def detect_liveness(image_array):
    """
    Detect if the image is from a live person or a photo/screen
    Returns: (is_live: bool, confidence: float, reason: str)
    """
    # Convert to grayscale
    gray = cv2.cvtColor(image_array, cv2.COLOR_RGB2GRAY)
    
    # 1. Check image quality (photos are usually too perfect)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    # 2. Check for screen moiré patterns
    # Real faces have natural texture, screens have pixel patterns
    
    # 3. Detect eye blinks (would need video stream)
    # For now, we'll use quality checks
    
    if laplacian_var < 50:
        return False, 0.3, "Image too blurry or low quality"
    
    if laplacian_var > 1000:
        return False, 0.4, "Image too sharp (possible printed photo)"
    
    # Check for face landmarks to ensure 3D structure
    face_landmarks_list = face_recognition.face_landmarks(image_array)
    
    if not face_landmarks_list:
        return False, 0.2, "No face landmarks detected"
    
    # If we have good landmarks, it's likely a real face
    return True, 0.85, "Live face detected"

# ==================== FACE REGISTRATION ====================

@app.post("/register-face")
async def register_face(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Register a user's face by creating and storing face encoding
    """
    try:
        # Read image
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        image_array = np.array(image.convert('RGB'))
        
        # Liveness detection
        is_live, confidence, reason = detect_liveness(image_array)
        if not is_live:
            raise HTTPException(
                status_code=400, 
                detail=f"Liveness check failed: {reason}"
            )
        
        # Detect faces
        face_locations = face_recognition.face_locations(image_array, model="hog")
        
        if len(face_locations) == 0:
            raise HTTPException(status_code=400, detail="No face detected in image")
        
        if len(face_locations) > 1:
            raise HTTPException(status_code=400, detail="Multiple faces detected. Please ensure only one person in frame")
        
        # Generate face encoding (128-dimensional vector)
        face_encodings = face_recognition.face_encodings(image_array, face_locations)
        face_encoding = face_encodings[0]
        
        # Upload original image to Cloudinary
        upload_result = cloudinary.uploader.upload(
            image_data,
            folder="attendance/faces",
            public_id=f"user_{user_id}_{int(time.time())}",
            transformation=[
                {'width': 800, 'height': 800, 'crop': 'limit'},
                {'quality': 'auto:good'}
            ]
        )
        
        # Store encoding in MongoDB (as binary)
        encoding_bytes = face_encoding.tobytes()
        
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "faceEncoding": encoding_bytes,
                    "faceImageUrl": upload_result['secure_url'],
                    "faceRegisteredAt": time.time()
                }
            }
        )
        
        return {
            "success": True,
            "message": "Face registered successfully",
            "imageUrl": upload_result['secure_url'],
            "livenessConfidence": confidence
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@app.post("/batch-register-face")
async def batch_register_face(
    user_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """
    Register multiple face samples (different angles) for better accuracy
    """
    try:
        if not files or len(files) < 2:
            raise HTTPException(status_code=400, detail="Minimum 2 face samples required for batch registration")

        all_encodings = []
        primary_image_url = None

        for idx, file in enumerate(files):
            # Read image
            image_data = await file.read()
            image = Image.open(io.BytesIO(image_data))
            
            # Convert to RGB if needed
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            image_array = np.array(image)
            
            # Perform liveness detection on the first image only
            if idx == 0:
                liveness_valid, confidence, reason = perform_liveness_detection(image_array)
                if not liveness_valid:
                    raise HTTPException(status_code=400, detail=f"Liveness check failed: {reason}")
            
            # Detect faces
            face_locations = face_recognition.face_locations(image_array, model="hog")
            
            if len(face_locations) == 0:
                continue # Skip images with no face detected
            
            # Generate encoding
            face_encodings = face_recognition.face_encodings(image_array, face_locations)
            if face_encodings:
                all_encodings.append(face_encodings[0])
            
            # Upload the first (front) image as the display profile
            if idx == 0:
                upload_result = cloudinary.uploader.upload(
                    image_data,
                    folder="attendance/faces",
                    public_id=f"user_{user_id}_profile",
                    transformation=[
                        {'width': 400, 'height': 400, 'crop': 'fill', 'gravity': 'face'},
                        {'quality': 'auto:good'}
                    ]
                )
                primary_image_url = upload_result['secure_url']

        if not all_encodings:
            raise HTTPException(status_code=400, detail="Could not detect face in any of the provided samples")

        # Average all encodings for higher robustness
        mean_encoding = np.mean(all_encodings, axis=0)
        encoding_bytes = mean_encoding.tobytes()

        # Update MongoDB
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "faceEncoding": encoding_bytes,
                    "faceImageUrl": primary_image_url,
                    "faceRegisteredAt": time.time(),
                    "encodingSampleCount": len(all_encodings)
                }
            }
        )

        return {
            "success": True,
            "message": f"Successfully registered face with {len(all_encodings)} samples",
            "imageUrl": primary_image_url,
            "samplesProcessed": len(all_encodings)
        }

    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))

# ==================== FACE VERIFICATION ====================

@app.post("/verify-face")
async def verify_face(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Verify if uploaded face matches registered face
    """
    try:
        # Read image
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        image_array = np.array(image.convert('RGB'))
        
        # Liveness detection
        is_live, liveness_confidence, reason = detect_liveness(image_array)
        if not is_live:
            return {
                "verified": False,
                "confidence": 0,
                "reason": f"Liveness check failed: {reason}"
            }
        
        # Get user's stored encoding
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        
        if not user or not user.get('faceEncoding'):
            raise HTTPException(status_code=404, detail="User face not registered")
        
        # Convert stored encoding back to numpy array
        stored_encoding = np.frombuffer(user['faceEncoding'], dtype=np.float64)
        
        # Detect face in uploaded image
        face_locations = face_recognition.face_locations(image_array, model="hog")
        
        if len(face_locations) == 0:
            return {
                "verified": False,
                "confidence": 0,
                "reason": "No face detected in image"
            }
        
        # Generate encoding for uploaded image
        current_encodings = face_recognition.face_encodings(image_array, face_locations)
        current_encoding = current_encodings[0]
        
        # Compare faces using euclidean distance
        face_distance = face_recognition.face_distance([stored_encoding], current_encoding)[0]
        
        # Convert distance to confidence (0-1)
        # Lower distance = higher confidence
        confidence = 1 - face_distance
        
        # Threshold for verification (adjustable)
        VERIFICATION_THRESHOLD = 0.6
        
        is_match = face_distance < (1 - VERIFICATION_THRESHOLD)
        
        # Upload verification image to Cloudinary (temporary)
        if is_match:
            upload_result = cloudinary.uploader.upload(
                image_data,
                folder="attendance/verifications",
                public_id=f"verify_{user_id}_{int(time.time())}",
                # Auto-delete after 7 days
                expires_at=int(time.time()) + (7 * 24 * 60 * 60)
            )
            verification_image_url = upload_result['secure_url']
        else:
            verification_image_url = None
        
        return {
            "verified": is_match,
            "confidence": float(confidence),
            "faceDistance": float(face_distance),
            "livenessConfidence": liveness_confidence,
            "verificationImageUrl": verification_image_url,
            "reason": "Face matched" if is_match else "Face did not match"
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

# ==================== BULK FACE IDENTIFICATION ====================

@app.post("/identify-face")
async def identify_face(file: UploadFile = File(...)):
    """
    Identify a person from uploaded image by comparing with all registered faces
    Used by door cameras
    """
    try:
        # Read image
        image_data = await file.read()
        image = Image.open(io.BytesIO(image_data))
        image_array = np.array(image.convert('RGB'))
        
        # Detect faces
        face_locations = face_recognition.face_locations(image_array, model="hog")
        
        if len(face_locations) == 0:
            return {"identified": False, "userId": None, "confidence": 0}
        
        # Generate encoding for detected face
        current_encodings = face_recognition.face_encodings(image_array, face_locations)
        current_encoding = current_encodings[0]
        
        # Get all registered users with face encodings
        users = await db.users.find({"faceEncoding": {"$exists": True}}).to_list(length=1000)
        
        best_match = None
        best_confidence = 0
        
        # Compare with all registered faces
        for user in users:
            stored_encoding = np.frombuffer(user['faceEncoding'], dtype=np.float64)
            
            # Calculate distance
            face_distance = face_recognition.face_distance([stored_encoding], current_encoding)[0]
            confidence = 1 - face_distance
            
            if confidence > best_confidence and confidence > 0.6:
                best_confidence = confidence
                best_match = user
        
        if best_match:
            return {
                "identified": True,
                "userId": str(best_match['_id']),
                "userName": best_match.get('fullName'),
                "confidence": float(best_confidence)
            }
        else:
            return {
                "identified": False,
                "userId": None,
                "confidence": 0,
                "reason": "No matching face found"
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

# ==================== BATCH REGISTRATION ====================

@app.post("/batch-register")
async def batch_register(
    user_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """
    Register multiple images of same person for better accuracy
    Recommended: 5-10 images from different angles
    """
    try:
        if len(files) < 3:
            raise HTTPException(status_code=400, detail="Please upload at least 3 images")
        
        if len(files) > 15:
            raise HTTPException(status_code=400, detail="Maximum 15 images allowed")
        
        all_encodings = []
        uploaded_urls = []
        
        for idx, file in enumerate(files):
            # Read image
            image_data = await file.read()
            image = Image.open(io.BytesIO(image_data))
            image_array = np.array(image.convert('RGB'))
            
            # Detect face
            face_locations = face_recognition.face_locations(image_array, model="hog")
            
            if len(face_locations) != 1:
                continue  # Skip images without exactly one face
            
            # Generate encoding
            face_encodings = face_recognition.face_encodings(image_array, face_locations)
            all_encodings.append(face_encodings[0])
            
            # Upload to Cloudinary
            upload_result = cloudinary.uploader.upload(
                image_data,
                folder=f"attendance/faces/{user_id}",
                public_id=f"face_{idx}_{int(time.time())}"
            )
            uploaded_urls.append(upload_result['secure_url'])
        
        if len(all_encodings) < 3:
            raise HTTPException(
                status_code=400, 
                detail=f"Only {len(all_encodings)} valid faces detected. Need at least 3"
            )
        
        # Average all encodings for robustness
        avg_encoding = np.mean(all_encodings, axis=0)
        encoding_bytes = avg_encoding.tobytes()
        
        # Store in MongoDB
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "faceEncoding": encoding_bytes,
                    "faceImageUrl": uploaded_urls[0],  # Primary image
                    "allFaceImages": uploaded_urls,
                    "faceRegisteredAt": time.time(),
                    "encodingCount": len(all_encodings)
                }
            }
        )
        
        return {
            "success": True,
            "message": f"Registered {len(all_encodings)} face encodings",
            "imagesProcessed": len(all_encodings),
            "imageUrls": uploaded_urls
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

# ==================== HEALTH CHECK ====================

@app.get("/health")
def health_check():
    return {
        "status": "OK",
        "service": "Face Recognition",
        "timestamp": time.time()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
