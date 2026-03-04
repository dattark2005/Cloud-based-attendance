# Voice Recognition Service - Complete Production Code
# voice_service/app.py
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

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
from typing import List, Optional
import speech_recognition as sr
from pathlib import Path

# ── Load .env (backend/.env relative to this file's location) ──
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent / 'backend' / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f'✅ Voice service loaded env from {env_path}')
    else:
        root_env = Path(__file__).parent / '.env'
        if root_env.exists():
            load_dotenv(root_env)
            print(f'✅ Voice service loaded env from {root_env}')
        else:
            print('⚠️  Voice service: no .env found')
except ImportError:
    print('⚠️  python-dotenv not installed')


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
    if not audio_bytes or len(audio_bytes) < 1000:
        return False, 0.0, "Audio recording is empty or corrupted"

    try:
        wav = preprocess_audio(audio_bytes)
    except Exception as e:
        return False, 0.0, f"Failed to process audio format: {str(e)}"
    
    # 1. Check duration (too short = suspicious)
    duration = len(wav) / 16000
    if duration < 1.0:
        return False, 0.3, "Audio too short (minimum 1 second)"
    
    if duration > 10.0:
        return False, 0.3, "Audio too long (maximum 10 seconds)"
    
    # 2. Check for background noise (real recordings have some noise)
    # Use standard deviation of the whole clip rather than just first 100ms (as digital silence from noise gates could trigger a false positive).
    noise_level = np.std(wav)
    
    if noise_level < 0.001:  # Reduced back, as digital playback or extreme noise-cancellation can create silence
        return False, 0.4, "Audio too clean (possible synthetic or playback detected)"
    
    # 3. Check spectral characteristics
    spectral_centroid = librosa.feature.spectral_centroid(y=wav, sr=16000)
    mean_centroid = np.mean(spectral_centroid)
    
    if mean_centroid < 80 or mean_centroid > 6000:
        return False, 0.5, f"Unusual frequency characteristics (Mean centroid: {mean_centroid:.2f})"
        
    # 3.5 Check for High-Frequency Compression (The "Phone Speaker" test)
    # Phone speakers and compressed recordings aggressively cut off high frequencies.
    # A real human voice in a room has more high-frequency energy (air/breath).
    # We check the 85th percentile spectral rolloff.
    rolloff = librosa.feature.spectral_rolloff(y=wav, sr=16000, roll_percent=0.85)
    mean_rolloff = np.mean(rolloff)
    
    if mean_rolloff < 2000:  # If 85% of the energy is below 2000Hz, it's heavily muffled/compressed
        return False, 0.5, f"Audio heavily compressed/muffled (Rolloff: {mean_rolloff:.2f}Hz) - Possible playback"
    
    # 4. Check for pitch variations
    pitches, magnitudes = librosa.piptrack(y=wav, sr=16000)
    pitch_variation = np.std(pitches[pitches > 0])
    
    # DEBUG: Log the metrics to a file so we can see the exact difference between live and phone playback
    import json
    with open("liveness_metrics.log", "a") as f:
        metrics = {
            "duration": float(duration),
            "noise_level": float(noise_level),
            "mean_centroid": float(mean_centroid),
            "mean_rolloff": float(mean_rolloff),
            "pitch_variation": float(pitch_variation)
        }
        f.write(json.dumps(metrics) + "\n")
    
    if pitch_variation < 8: # Reduced to 8 as short phrases like 'I am present' might not have much natural variation
        return False, 0.5, f"Unnatural pitch stability (Variation: {pitch_variation:.2f})"
    
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
    file: UploadFile = File(...),
    expected_text: Optional[str] = Form(None)
):
    """
    Verify if uploaded voice matches registered voice AND optionally matches expected text
    """
    try:
        # Read audio file
        audio_bytes = await file.read()
        
        # 0. Speech-to-Text (STT) Check for dynamic sentence verification
        recognized_text = ""
        text_match = True
        if expected_text:
            recognizer = sr.Recognizer()
            # Convert bytes to AudioFile
            audio_segment = AudioSegment.from_file(io.BytesIO(audio_bytes))
            wav_io = io.BytesIO()
            audio_segment.export(wav_io, format="wav")
            wav_io.seek(0)
            
            with sr.AudioFile(wav_io) as source:
                audio_data = recognizer.record(source)
                try:
                    recognized_text = recognizer.recognize_google(audio_data)
                    # Remove EVERYTHING except letters and numbers (spaces and punctuation gone)
                    clean_expected = "".join(c for c in expected_text if c.isalnum()).lower()
                    clean_recognized = "".join(c for c in recognized_text if c.isalnum()).lower()
                    
                    # Check if expected text is in recognized text 
                    text_match = clean_expected in clean_recognized
                except Exception as stt_error:
                    print(f"STT Error: {stt_error}")
                    text_match = False
                    recognized_text = "[Error recognizing speech]"

        # 1. Liveness detection
        is_live, liveness_confidence, reason = detect_voice_liveness(audio_bytes)
        if not is_live:
            return {
                "verified": False,
                "confidence": 0,
                "reason": f"Voice liveness check failed: {reason}"
            }
        
        if expected_text and not text_match:
            return {
                "verified": False,
                "confidence": 0,
                "reason": f"Sentence mismatch. Expected: '{expected_text}', heard: '{recognized_text}'",
                "recognizedText": recognized_text
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
        # Resemblyzer embeddings of different humans still share baseline similarity (~0.5 - 0.7)
        # So a threshold of 0.75 (which is similarity 0.5) is far too low.
        VERIFICATION_THRESHOLD = 0.85
        
        is_match = confidence > VERIFICATION_THRESHOLD
        
        with open("liveness_metrics.log", "a") as f:
            f.write(f"Speaker Match Debug - Similarity: {similarity:.3f}, Confidence: {confidence:.3f}, Match: {is_match}\n")
        
        if not is_match:
            return {
                "verified": False,
                "confidence": float(confidence),
                "reason": f"Speaker Voice Match failed (Confidence {confidence:.2f} < {VERIFICATION_THRESHOLD}) - Not the registered user."
            }
        
        # Upload verification audio to Cloudinary (temporary)
        else:
            verification_audio_url = None
        
        return {
            "verified": bool(is_match),
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
    uvicorn.run(app, host="0.0.0.0", port=8001)
