"""
live_camera_sync.py — Single-Camera Continuous Presence Monitor
==============================================================
One camera inside the classroom, scanning every 10 seconds.
If a student is NOT detected for > 3 minutes → flagged ABSENT + alert raised.
When detected again → back to SEEN (presence resumes).

Usage:
    python live_camera_sync.py

Setup:
    1. Install "IP Webcam" app on Android → Start Server
    2. Edit camera_config.json:
       { "rooms": { "4006": "http://10.x.x.x:8080/video" } }
    3. Run: python live_camera_sync.py

    Or use local webcam:
       python live_camera_sync.py --camera 0
"""

import argparse
import json
import os
import sys
import time
import logging
import threading
import base64
from pathlib import Path
from collections import defaultdict

import cv2
import numpy as np
import requests
from dotenv import load_dotenv

# ── Setup ──
load_dotenv(Path(__file__).parent / 'backend' / '.env')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('presence_monitor')

# ── Config ──
CONFIG_FILE      = Path(__file__).parent / 'camera_config.json'
BACKEND_URL      = 'http://localhost:3001'
FACE_SVC_URL     = os.getenv('FACE_SERVICE_URL', 'http://localhost:8000')
API_KEY          = os.getenv('DOOR_CAMERA_API_KEY', 'door-cam-secret-key-2026')

# Tuning
SCAN_INTERVAL_SEC  = 10      # Scan a frame every 10 seconds
ABSENT_THRESHOLD   = 180     # 3 minutes (in seconds) → flag as ABSENT
FRAME_WIDTH        = 640     # Resize for speed
FACE_SVC_TIMEOUT   = 12      # Seconds to wait for face service
POST_COOLDOWN_SEC  = 9       # Min seconds between same-status posts for same student
                              # (slightly less than SCAN_INTERVAL so every scan can post if needed)
STREAM_INTERVAL_SEC = 0.5    # Live dashboard preview frame rate (2 FPS)


# ════════════════════════════════════════════════════════════
#  State tracking
# ════════════════════════════════════════════════════════════

# last_seen[studentId]   = timestamp when last detected in frame
last_seen: dict[str, float] = {}

# student_status[studentId] = 'SEEN' | 'ABSENT' | None (unknown)
student_status: dict[str, str] = {}

# last_posted[studentId] = (status, timestamp) of last successful POST
last_posted: dict[str, tuple] = {}

# All enrolled student IDs for this room's active lecture (fetched at startup)
expected_student_ids: list[str] = []


# ════════════════════════════════════════════════════════════
#  Face service call
# ════════════════════════════════════════════════════════════

def identify_faces(frame_bgr: np.ndarray) -> list:
    """
    Send one JPEG frame to /identify-group on the face service.
    Returns list of: { userId, userName, confidence, box }
    """
    try:
        ok, buf = cv2.imencode('.jpg', frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return []

        files = {'file': ('frame.jpg', buf.tobytes(), 'image/jpeg')}
        data  = {}
        if expected_student_ids:
            data['expected_user_ids'] = ','.join(expected_student_ids)

        resp = requests.post(
            f'{FACE_SVC_URL}/identify-group',
            files=files,
            data=data,
            timeout=FACE_SVC_TIMEOUT,
        )
        if resp.ok:
            result = resp.json()
            return result.get('matches', [])
    except Exception as e:
        log.warning(f'Face service error: {e}')
    return []


# ════════════════════════════════════════════════════════════
#  Backend event posting
# ════════════════════════════════════════════════════════════

def post_presence(student_id: str, status: str, confidence: float = 0.0):
    """
    POST a SEEN or ABSENT event to Node.js backend.
    Runs in a daemon thread so it never blocks the scan loop.
    Enforces per-student cooldown to avoid flooding the backend.
    """
    now = time.time()
    last = last_posted.get(student_id)
    if last and last[0] == status and (now - last[1]) < POST_COOLDOWN_SEC:
        return  # Deduplicate

    last_posted[student_id] = (status, now)
    icon = '🟢' if status == 'SEEN' else '🔴'
    log.info(f'{icon} {status}: studentId={student_id} | conf={confidence:.2f}')

    def _post():
        try:
            resp = requests.post(
                f'{BACKEND_URL}/api/door/presence',
                json={
                    'studentId': student_id,
                    'status': status,        # 'SEEN' or 'ABSENT'
                    'confidence': round(confidence, 3),
                },
                headers={'Authorization': f'Bearer {API_KEY}'},
                timeout=5,
            )
            if not resp.ok:
                log.warning(f'Backend rejected presence: {resp.status_code} {resp.text[:120]}')
        except Exception as e:
            log.error(f'Failed to post presence event: {e}')

    threading.Thread(target=_post, daemon=True).start()

def post_video_frame(frame_bgr: np.ndarray):
    """
    Downscales a frame, converts it to base64 JPEG, and POSTs to the backend
    to be displayed as the Live Preview on the Teacher Dashboard.
    Runs in a daemon thread to prevent lagging the camera.
    """
    def _post():
        try:
            # Resize very small for fast WebSocket transmission (320x240)
            h, w = frame_bgr.shape[:2]
            scale = 320 / w if w > 320 else 1.0
            small_frame = cv2.resize(frame_bgr, (0, 0), fx=scale, fy=scale)

            # Compress as JPEG (quality 60)
            ok, buf = cv2.imencode('.jpg', small_frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
            if not ok: return
            
            # Convert to base64
            b64_str = base64.b64encode(buf).decode('utf-8')

            # Fire and forget POST
            requests.post(
                f'{BACKEND_URL}/api/door/frame',
                json={'frame': b64_str},
                headers={'Authorization': f'Bearer {API_KEY}'},
                timeout=2,
            )
        except Exception:
            pass # Ignore streaming errors (too noisy)

    threading.Thread(target=_post, daemon=True).start()

# ════════════════════════════════════════════════════════════
#  Core scan logic
# ════════════════════════════════════════════════════════════

def process_scan(frame_bgr: np.ndarray):
    """
    Run one presence scan on a captured frame.
    Updates last_seen, student_status and fires events as needed.
    """
    now = time.time()
    matches = identify_faces(frame_bgr)

    # Build set of IDs detected in this frame (confidence > 0.50)
    seen_this_scan: set[str] = set()
    for m in matches:
        if m.get('confidence', 0) >= 0.50:
            seen_this_scan.add(m['userId'])

    log.info(f'📸 Scan | detected={(len(seen_this_scan))} of {len(expected_student_ids)} enrolled')

    # ── For each known enrolled student ──
    for sid in expected_student_ids:
        if sid in seen_this_scan:
            # ── Student SEEN in this scan ──
            was_absent = student_status.get(sid) == 'ABSENT'
            last_seen[sid] = now
            student_status[sid] = 'SEEN'

            # Confidence for this student
            conf = next((m['confidence'] for m in matches if m['userId'] == sid), 0.0)

            # Post SEEN — always on first detection, or on recovery from ABSENT
            if was_absent:
                log.info(f'✅ Recovery: studentId={sid} is back in frame')
            post_presence(sid, 'SEEN', conf)

        else:
            # ── Student NOT detected in this scan ──
            last = last_seen.get(sid)

            if last is None:
                # Never seen yet — don't flag yet, could still be arriving
                continue

            absent_duration = now - last

            if absent_duration >= ABSENT_THRESHOLD:
                # Been missing > 3 minutes → flag ABSENT
                prev_status = student_status.get(sid)
                student_status[sid] = 'ABSENT'

                if prev_status != 'ABSENT':
                    # First time crossing the threshold — always post
                    mins = int(absent_duration // 60)
                    log.warning(f'⚠️  ABSENT: studentId={sid} | missing for {mins}m {int(absent_duration%60)}s')
                    last_posted.pop(sid, None)   # Force post even if cooldown not expired

                post_presence(sid, 'ABSENT', 0.0)


# ════════════════════════════════════════════════════════════
#  Pre-fetch student IDs for active lecture
# ════════════════════════════════════════════════════════════

def fetch_enrolled_students() -> list[str]:
    try:
        resp = requests.get(
            f'{BACKEND_URL}/api/door/lecture/active',
            headers={'Authorization': f'Bearer {API_KEY}'},
            timeout=5,
        )
        if resp.ok:
            ids = resp.json().get('studentIds', [])
            if ids:
                log.info(f'✅ Pre-fetched {len(ids)} enrolled student IDs')
            return ids
    except Exception as e:
        log.warning(f'Could not pre-fetch student list: {e}')
    return []


# ════════════════════════════════════════════════════════════
#  Main monitoring loop
# ════════════════════════════════════════════════════════════

def monitor(camera_source, refresh_enrolled_mins: int = 5):
    global expected_student_ids

    log.info(f'📷 Presence Monitor starting | Camera: {camera_source}')
    log.info(f'⏱  Scan interval: {SCAN_INTERVAL_SEC}s | Absent threshold: {ABSENT_THRESHOLD//60}min')

    # ── Verify face service ──
    try:
        r = requests.get(f'{FACE_SVC_URL}/health', timeout=5)
        if r.ok:
            log.info(f'✅ Face service connected at {FACE_SVC_URL}')
        else:
            log.warning(f'⚠️  Face service responded {r.status_code} — continuing anyway')
    except Exception:
        log.error(f'❌ Face service not reachable at {FACE_SVC_URL}')
        log.error('   Run: py face_recognition_service.py')
        sys.exit(1)

    # ── Pre-fetch enrolled students ──
    expected_student_ids = fetch_enrolled_students()
    last_enroll_refresh  = time.time()

    # ── Open camera ──
    cap = cv2.VideoCapture(camera_source)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if not cap.isOpened():
        log.error(f'❌ Cannot open camera: {camera_source}')
        log.error('   If using phone: ensure IP Webcam is running and devices are on same WiFi')
        sys.exit(1)

    log.info(f'✅ Camera opened. Monitoring active lecture — press Ctrl+C to stop')
    last_scan = 0.0
    last_stream = 0.0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                log.warning('Frame read failed — reconnecting in 3s...')
                time.sleep(3)
                cap.release()
                cap = cv2.VideoCapture(camera_source)
                continue

            now = time.time()

            # ── Periodic re-fetch of enrolled students (in case new students join) ──
            if now - last_enroll_refresh > refresh_enrolled_mins * 60:
                new_ids = fetch_enrolled_students()
                if new_ids:
                    expected_student_ids = new_ids
                last_enroll_refresh = now

            # ── Stream Video Frame (2 FPS) ──
            if now - last_stream > STREAM_INTERVAL_SEC:
                post_video_frame(frame)
                last_stream = now

            # ── Run face scan every SCAN_INTERVAL_SEC ──
            if now - last_scan < SCAN_INTERVAL_SEC:
                time.sleep(0.05)
                continue
            last_scan = now

            # Resize for speed
            h, w = frame.shape[:2]
            if w > FRAME_WIDTH:
                scale = FRAME_WIDTH / w
                frame = cv2.resize(frame, (0, 0), fx=scale, fy=scale)

            process_scan(frame)

    except KeyboardInterrupt:
        log.info('🛑 Presence monitoring stopped.')
    finally:
        cap.release()
        log.info('Camera released.')


# ════════════════════════════════════════════════════════════
#  Entry point
# ════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Single-Camera Continuous Presence Monitor')
    parser.add_argument('--camera', default=None,  help='Override camera URL or device index (0, 1, ...)')
    args = parser.parse_args()

    # Resolve camera source
    if args.camera is not None:
        source = args.camera
        try:
            source = int(source)
        except (ValueError, TypeError):
            pass
    else:
        if not CONFIG_FILE.exists():
            log.error(f'camera_config.json not found. Create it or use --camera flag.')
            sys.exit(1)
        config = json.loads(CONFIG_FILE.read_text())
        source = config.get('default_camera')
        if source is None:
            log.error(f'"default_camera" not in camera_config.json. Use --camera 0')
            sys.exit(1)
        try:
            source = int(source)
        except (ValueError, TypeError):
            pass

    monitor(source)


if __name__ == '__main__':
    main()
