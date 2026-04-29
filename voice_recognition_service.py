# Voice Recognition Service
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import asyncio
import concurrent.futures
import io
import json
import os
import time
from pathlib import Path
from typing import List, Optional

import cloudinary
import cloudinary.uploader
import librosa
import numpy as np
import soundfile as sf
import speech_recognition as sr
from bson import ObjectId
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydub import AudioSegment
from resemblyzer import VoiceEncoder, preprocess_wav
from sklearn.metrics.pairwise import cosine_similarity

# ── Load .env ──
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cloudinary.config(
    cloud_name=os.getenv('CLOUDINARY_CLOUD_NAME'),
    api_key=os.getenv('CLOUDINARY_API_KEY'),
    api_secret=os.getenv('CLOUDINARY_API_SECRET')
)

mongo_client = AsyncIOMotorClient(os.getenv('MONGODB_URI'))
db = mongo_client.attendance

# Initialize voice encoder at startup (blocking, but only once)
encoder = VoiceEncoder()
print("✅ Resemblyzer VoiceEncoder loaded")

# ── Thread pool for blocking ML/audio calls ──
# Keeps FastAPI's async event loop unblocked during heavy CPU work
_voice_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=2, thread_name_prefix="voice_ml"
)


# ==================== AUDIO PREPROCESSING ====================

def preprocess_audio(audio_bytes: bytes) -> np.ndarray:
    """
    Convert raw audio bytes → mono 16kHz float32 numpy array.
    Handles any format pydub supports (webm, wav, ogg, mp4, etc.)
    Returns the wav array ready for Resemblyzer.
    """
    audio = AudioSegment.from_file(io.BytesIO(audio_bytes))
    if audio.channels > 1:
        audio = audio.set_channels(1)
    audio = audio.set_frame_rate(16000).normalize()

    wav_io = io.BytesIO()
    audio.export(wav_io, format='wav')
    wav_io.seek(0)

    wav, _ = librosa.load(wav_io, sr=16000)
    return wav


def _check_liveness(wav: np.ndarray) -> tuple[bool, float, str]:
    """
    Given a preprocessed wav array, check liveness heuristics.
    Returns (is_live, confidence, reason).
    Does NOT do any I/O or network calls.
    """
    duration = len(wav) / 16000

    if duration < 1.0:
        return False, 0.3, "Audio too short (minimum 1 second)"
    if duration > 10.0:
        return False, 0.3, "Audio too long (maximum 10 seconds)"

    # Background noise check (synthetic/playback audio is often digitally silent)
    if np.std(wav) < 0.001:
        return False, 0.4, "Audio too clean (possible synthetic or playback detected)"

    # Spectral centroid
    centroid = librosa.feature.spectral_centroid(y=wav, sr=16000)
    mean_centroid = float(np.mean(centroid))
    if mean_centroid < 80 or mean_centroid > 6000:
        return False, 0.5, f"Unusual frequency characteristics (centroid: {mean_centroid:.0f}Hz)"

    # Spectral rolloff — catches heavily compressed/phone-speaker audio
    rolloff = librosa.feature.spectral_rolloff(y=wav, sr=16000, roll_percent=0.85)
    mean_rolloff = float(np.mean(rolloff))
    if mean_rolloff < 2000:
        return False, 0.5, f"Audio heavily compressed/muffled (rolloff: {mean_rolloff:.0f}Hz)"

    # Pitch variation — TTS/recordings tend to be unnaturally stable
    pitches, _ = librosa.piptrack(y=wav, sr=16000)
    pitch_variation = float(np.std(pitches[pitches > 0]))
    if pitch_variation < 8:
        return False, 0.5, f"Unnatural pitch stability (variation: {pitch_variation:.2f})"

    return True, 0.85, "Live voice detected"


def _build_embedding(wav: np.ndarray) -> np.ndarray:
    """Run Resemblyzer embedding (CPU-heavy). Called in thread pool."""
    wav_preprocessed = preprocess_wav(wav)
    return encoder.embed_utterance(wav_preprocessed)


# ==================== VOICE REGISTRATION ====================

@app.post("/register-voice")
async def register_voice(
    user_id: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Register a user's voice by creating and storing a voice embedding.
    """
    try:
        audio_bytes = await file.read()
        if not audio_bytes or len(audio_bytes) < 1000:
            raise HTTPException(status_code=400, detail="Audio file is empty or too small")

        loop = asyncio.get_running_loop()

        # 1. Preprocess once, run in thread
        wav = await loop.run_in_executor(_voice_executor, preprocess_audio, audio_bytes)

        # 2. Liveness check (fast, no I/O)
        is_live, confidence, reason = _check_liveness(wav)
        if not is_live:
            raise HTTPException(status_code=400, detail=f"Voice liveness check failed: {reason}")

        # 3. Generate embedding in thread pool (blocking CPU call)
        embedding = await loop.run_in_executor(_voice_executor, _build_embedding, wav)

        # 4. Upload audio to Cloudinary (network I/O — run in thread)
        def _upload():
            return cloudinary.uploader.upload(
                audio_bytes,
                folder="attendance/voices",
                public_id=f"voice_{user_id}_{int(time.time())}",
                resource_type="video"
            )
        upload_result = await loop.run_in_executor(_voice_executor, _upload)

        # 5. Persist embedding to MongoDB
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {
                "voiceEmbedding": embedding.tobytes(),
                "voiceAudioUrl": upload_result['secure_url'],
                "voiceRegisteredAt": time.time()
            }}
        )

        return {
            "success": True,
            "message": "Voice registered successfully",
            "audioUrl": upload_result['secure_url'],
            "livenessConfidence": confidence,
            "duration": len(wav) / 16000
        }

    except HTTPException:
        raise
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
    Verify if uploaded voice matches registered voice and optionally matches expected text.
    Order: preprocess → liveness → STT → speaker match
    """
    try:
        audio_bytes = await file.read()
        if not audio_bytes or len(audio_bytes) < 1000:
            raise HTTPException(status_code=400, detail="Audio file is empty or too small")

        loop = asyncio.get_running_loop()

        # 1. Preprocess ONCE — reused for liveness, STT, and embedding
        wav = await loop.run_in_executor(_voice_executor, preprocess_audio, audio_bytes)

        # 2. Liveness check first (no network cost) — reject bad audio early
        is_live, liveness_confidence, reason = _check_liveness(wav)
        if not is_live:
            return {"verified": False, "confidence": 0, "reason": f"Liveness check failed: {reason}"}

        # 3. STT check — only if expected_text provided (costs a Google API call)
        recognized_text = ""
        if expected_text:
            def _run_stt():
                recognizer = sr.Recognizer()
                wav_io = io.BytesIO()
                AudioSegment(
                    (wav * 32767).astype(np.int16).tobytes(),
                    frame_rate=16000, sample_width=2, channels=1
                ).export(wav_io, format='wav')
                wav_io.seek(0)
                with sr.AudioFile(wav_io) as source:
                    audio_data = recognizer.record(source)
                try:
                    return recognizer.recognize_google(audio_data)
                except Exception:
                    return ""

            recognized_text = await loop.run_in_executor(_voice_executor, _run_stt)

            clean_expected   = "".join(c for c in expected_text   if c.isalnum()).lower()
            clean_recognized = "".join(c for c in recognized_text if c.isalnum()).lower()
            if clean_expected and clean_expected not in clean_recognized:
                return {
                    "verified": False,
                    "confidence": 0,
                    "reason": f"Sentence mismatch. Expected: '{expected_text}', heard: '{recognized_text}'",
                    "recognizedText": recognized_text
                }

        # 4. Fetch stored embedding from DB
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        if not user or not user.get('voiceEmbedding'):
            raise HTTPException(status_code=404, detail="User voice not registered")

        stored_embedding = np.frombuffer(user['voiceEmbedding'], dtype=np.float32)

        # 5. Generate current embedding (CPU-heavy) in thread pool
        current_embedding = await loop.run_in_executor(_voice_executor, _build_embedding, wav)

        # 6. Cosine similarity
        similarity = float(cosine_similarity([current_embedding], [stored_embedding])[0][0])
        confidence = (similarity + 1) / 2

        # Resemblyzer baseline similarity is high (0.6-0.75 for same gender).
        # We need a strict threshold. User reported getting ~0.89 while brother gets 0.88.
        VERIFICATION_THRESHOLD = 0.885
        is_match = confidence > VERIFICATION_THRESHOLD

        return {
            "verified": bool(is_match),
            "confidence": float(confidence),
            "similarity": float(similarity),
            "livenessConfidence": liveness_confidence,
            "recognizedText": recognized_text,
            "reason": "Voice matched" if is_match else (
                f"Speaker match failed (confidence {confidence:.2f} < {VERIFICATION_THRESHOLD})"
            )
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


# ==================== BATCH VOICE REGISTRATION ====================

@app.post("/batch-register-voice")
async def batch_register_voice(
    user_id: str = Form(...),
    files: List[UploadFile] = File(...)
):
    """
    Register multiple voice samples (3–15) for better accuracy.
    Averages embeddings across all samples.
    """
    try:
        if len(files) < 3:
            raise HTTPException(status_code=400, detail="Please upload at least 3 voice samples")
        if len(files) > 15:
            raise HTTPException(status_code=400, detail="Maximum 15 samples allowed")

        loop = asyncio.get_running_loop()
        all_embeddings = []
        uploaded_urls = []

        for idx, file in enumerate(files):
            audio_bytes = await file.read()
            if not audio_bytes or len(audio_bytes) < 1000:
                continue

            # Preprocess + liveness check each sample
            wav = await loop.run_in_executor(_voice_executor, preprocess_audio, audio_bytes)
            is_live, _, _ = _check_liveness(wav)
            if not is_live:
                continue  # skip bad samples silently

            embedding = await loop.run_in_executor(_voice_executor, _build_embedding, wav)
            all_embeddings.append(embedding)

            def _upload(ab=audio_bytes, i=idx):
                return cloudinary.uploader.upload(
                    ab,
                    folder=f"attendance/voices/{user_id}",
                    public_id=f"voice_{i}_{int(time.time())}",
                    resource_type="video"
                )
            upload_result = await loop.run_in_executor(_voice_executor, _upload)
            uploaded_urls.append(upload_result['secure_url'])

        if len(all_embeddings) < 2:
            raise HTTPException(status_code=400, detail="Too few valid voice samples passed liveness check")

        avg_embedding = np.mean(all_embeddings, axis=0)

        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {
                "voiceEmbedding": avg_embedding.tobytes(),
                "voiceAudioUrl": uploaded_urls[0] if uploaded_urls else "",
                "allVoiceAudios": uploaded_urls,
                "voiceRegisteredAt": time.time(),
                "embeddingCount": len(all_embeddings)
            }}
        )

        return {
            "success": True,
            "message": f"Registered {len(all_embeddings)} voice embeddings",
            "samplesProcessed": len(all_embeddings),
            "audioUrls": uploaded_urls
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


# ==================== HEALTH CHECK ====================

@app.get("/health")
def health_check():
    return {"status": "OK", "service": "Voice Recognition", "timestamp": time.time()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
