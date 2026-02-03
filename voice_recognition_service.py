# Voice Recognition Service - Complete Production Code
# voice_service/app.py

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from resemblyzer import VoiceEncoder, preprocess_wav
import numpy as np
import librosa
import soundfile as sf
import io
import cloudinary
import cloudinary.uploader
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import time
from pydub import AudioSegment
from sklearn.metrics.pairwise import cosine_similarity
from typing import List

app = FastAPI(title="Voice Recognition Service")

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

# Initialize voice encoder
encoder = VoiceEncoder()

# ==================== AUDIO PREPROCESSING ====================

def preprocess_audio(audio_bytes):
    """
    Preprocess audio for voice recognition
    """
    # Convert to AudioSegment
    audio = AudioSegment.from_file(io.BytesIO(audio_bytes))
    
    # Convert to mono if stereo
    if audio.channels > 1:
        audio = audio.set_channels(1)
    
    # Set sample rate to 16kHz (standard for speech)
    audio = audio.set_frame_rate(16000)
    
    # Normalize audio
    audio = audio.normalize()
    
    # Export as WAV
    wav_io = io.BytesIO()
    audio.export(wav_io, format='wav')
    wav_io.seek(0)
    
    # Load with librosa
    wav, sr = librosa.load(wav_io, sr=16000)
    
    return wav

def detect_voice_liveness(audio_bytes):
    """
    Detect if audio is from live person or recording/TTS
    Returns: (is_live: bool, confidence: float, reason: str)
    """
    wav = preprocess_audio(audio_bytes)
    
    # 1. Check duration (too short = suspicious)
    duration = len(wav) / 16000
    if duration < 1.0:
        return False, 0.3, "Audio too short (minimum 1 second)"
    
    if duration > 10.0:
        return False, 0.3, "Audio too long (maximum 10 seconds)"
    
    # 2. Check for background noise (real recordings have some noise)
    # Completely clean audio might be synthetic
    noise_level = np.std(wav[:int(0.1 * len(wav))])  # First 100ms
    
    if noise_level < 0.001:
        return False, 0.4, "Audio too clean (possible synthetic)"
    
    # 3. Check spectral characteristics
    spectral_centroid = librosa.feature.spectral_centroid(y=wav, sr=16000)
    mean_centroid = np.mean(spectral_centroid)
    
    # Human voice typically 85-255 Hz for males, 165-255 Hz for females
    if mean_centroid < 50 or mean_centroid > 8000:
        return False, 0.5, "Unusual frequency characteristics"
    
    # 4. Check for pitch variations (humans have natural variations)
    pitches, magnitudes = librosa.piptrack(y=wav, sr=16000)
    pitch_variation = np.std(pitches[pitches > 0])
    
    if pitch_variation < 10:
        return False, 0.5, "Unnatural pitch stability (possible TTS)"
    
    return True, 0.85, "Live voice detected"

# ==================== VOICE REGISTRATION ====================

@app.post("/register-voice")
async def register_voice(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Register a user's voice by creating and storing voice embedding
    """
    try:
        # Read audio file
        audio_bytes = await file.read()
        
        # Liveness detection
        is_live, confidence, reason = detect_voice_liveness(audio_bytes)
        if not is_live:
            raise HTTPException(
                status_code=400,
                detail=f"Voice liveness check failed: {reason}"
            )
        
        # Preprocess audio
        wav = preprocess_audio(audio_bytes)
        
        # Preprocess for Resemblyzer
        wav_preprocessed = preprocess_wav(wav)
        
        # Generate voice embedding (256-dimensional vector)
        embedding = encoder.embed_utterance(wav_preprocessed)
        
        # Upload audio to Cloudinary
        upload_result = cloudinary.uploader.upload(
            audio_bytes,
            folder="attendance/voices",
            public_id=f"voice_{user_id}_{int(time.time())}",
            resource_type="video"  # Cloudinary treats audio as video
        )
        
        # Store embedding in MongoDB
        embedding_bytes = embedding.tobytes()
        
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "voiceEmbedding": embedding_bytes,
                    "voiceAudioUrl": upload_result['secure_url'],
                    "voiceRegisteredAt": time.time()
                }
            }
        )
        
        return {
            "success": True,
            "message": "Voice registered successfully",
            "audioUrl": upload_result['secure_url'],
            "livenessConfidence": confidence,
            "duration": len(wav) / 16000
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

# ==================== VOICE VERIFICATION ====================

@app.post("/verify-voice")
async def verify_voice(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Verify if uploaded voice matches registered voice
    """
    try:
        # Read audio file
        audio_bytes = await file.read()
        
        # Liveness detection
        is_live, liveness_confidence, reason = detect_voice_liveness(audio_bytes)
        if not is_live:
            return {
                "verified": False,
                "confidence": 0,
                "reason": f"Voice liveness check failed: {reason}"
            }
        
        # Get user's stored embedding
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        
        if not user or not user.get('voiceEmbedding'):
            raise HTTPException(status_code=404, detail="User voice not registered")
        
        # Convert stored embedding back to numpy array
        stored_embedding = np.frombuffer(user['voiceEmbedding'], dtype=np.float32)
        
        # Preprocess uploaded audio
        wav = preprocess_audio(audio_bytes)
        wav_preprocessed = preprocess_wav(wav)
        
        # Generate embedding for uploaded audio
        current_embedding = encoder.embed_utterance(wav_preprocessed)
        
        # Calculate cosine similarity
        similarity = cosine_similarity(
            [current_embedding],
            [stored_embedding]
        )[0][0]
        
        # Convert to confidence (0-1)
        confidence = (similarity + 1) / 2
        
        # Threshold for verification
        VERIFICATION_THRESHOLD = 0.75
        
        is_match = confidence > VERIFICATION_THRESHOLD
        
        # Upload verification audio to Cloudinary (temporary)
        if is_match:
            upload_result = cloudinary.uploader.upload(
                audio_bytes,
                folder="attendance/voice_verifications",
                public_id=f"verify_{user_id}_{int(time.time())}",
                resource_type="video",
                # Auto-delete after 7 days
                expires_at=int(time.time()) + (7 * 24 * 60 * 60)
            )
            verification_audio_url = upload_result['secure_url']
        else:
            verification_audio_url = None
        
        return {
            "verified": is_match,
            "confidence": float(confidence),
            "similarity": float(similarity),
            "livenessConfidence": liveness_confidence,
            "verificationAudioUrl": verification_audio_url,
            "reason": "Voice matched" if is_match else "Voice did not match"
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

# ==================== BATCH VOICE REGISTRATION ====================

@app.post("/batch-register-voice")
async def batch_register_voice(
    user_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """
    Register multiple voice samples for better accuracy
    Recommended: 5-10 samples with different phrases
    """
    try:
        if len(files) < 3:
            raise HTTPException(status_code=400, detail="Please upload at least 3 voice samples")
        
        if len(files) > 15:
            raise HTTPException(status_code=400, detail="Maximum 15 samples allowed")
        
        all_embeddings = []
        uploaded_urls = []
        
        for idx, file in enumerate(files):
            # Read audio
            audio_bytes = await file.read()
            
            # Preprocess
            wav = preprocess_audio(audio_bytes)
            wav_preprocessed = preprocess_wav(wav)
            
            # Generate embedding
            embedding = encoder.embed_utterance(wav_preprocessed)
            all_embeddings.append(embedding)
            
            # Upload to Cloudinary
            upload_result = cloudinary.uploader.upload(
                audio_bytes,
                folder=f"attendance/voices/{user_id}",
                public_id=f"voice_{idx}_{int(time.time())}",
                resource_type="video"
            )
            uploaded_urls.append(upload_result['secure_url'])
        
        # Average all embeddings
        avg_embedding = np.mean(all_embeddings, axis=0)
        embedding_bytes = avg_embedding.tobytes()
        
        # Store in MongoDB
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "voiceEmbedding": embedding_bytes,
                    "voiceAudioUrl": uploaded_urls[0],
                    "allVoiceAudios": uploaded_urls,
                    "voiceRegisteredAt": time.time(),
                    "embeddingCount": len(all_embeddings)
                }
            }
        )
        
        return {
            "success": True,
            "message": f"Registered {len(all_embeddings)} voice embeddings",
            "samplesProcessed": len(all_embeddings),
            "audioUrls": uploaded_urls
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
        "service": "Voice Recognition",
        "timestamp": time.time()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
