"""
camera_monitor.py — Door Camera Monitor (Face Service Edition)
==============================================================
Uses the already-running face recognition service (localhost:8000)
to identify students at the door. No dlib or face_recognition library needed.

Usage:
    python camera_monitor.py --room 4006

Requirements (all already installed):
    pip install opencv-python requests python-dotenv

Setup:
    1. Install "IP Webcam" app on Android phone → Start Server
    2. Note the URL (e.g. http://10.x.x.x:8080)
    3. Edit camera_config.json:
       { "rooms": { "4006": "http://10.x.x.x:8080/video" } }
    4. Run: python camera_monitor.py --room 4006
"""

import argparse
import json
import os
import sys
import time
import logging
import threading
from pathlib import Path
from collections import defaultdict, deque

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
log = logging.getLogger('door_monitor')

# ── Config ──
CONFIG_FILE  = Path(__file__).parent / 'camera_config.json'
BACKEND_URL  = 'http://localhost:3001'
FACE_SVC_URL = os.getenv('FACE_SERVICE_URL', 'http://localhost:8000')
API_KEY      = os.getenv('DOOR_CAMERA_API_KEY', 'door-cam-secret-key-2026')

# Tuning
FRAME_INTERVAL_MS = 400    # Check every 400ms (~2.5 FPS detection rate)
CONFIDENCE_THRESH = 0.50   # Match threshold
DIRECTION_FRAMES  = 3      # Positions to track for direction
COOLDOWN_SECS     = 10     # Min seconds between same event for same student
FRAME_WIDTH       = 640    # Resize for speed
FACE_SVC_TIMEOUT  = 10     # Seconds to wait for face service (it can be slow)


# ════════════════════════════════════════════════════════════
#  Face identification via the running face service
# ════════════════════════════════════════════════════════════

def identify_faces_in_frame(frame_bgr: np.ndarray, expected_ids: list = None) -> list:
    """
    POST a JPEG frame to the face service /identify-group endpoint.
    Returns a list of:
      { userId, userName, confidence, box: [x, y, w, h] }
    Returns [] if no matches or service is unavailable.
    Pass expected_ids to limit DB search to specific students (much faster).
    """
    try:
        # Encode frame as JPEG in memory
        ok, buf = cv2.imencode('.jpg', frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return []

        files = {'file': ('frame.jpg', buf.tobytes(), 'image/jpeg')}
        data  = {}
        if expected_ids:
            data['expected_user_ids'] = ','.join(expected_ids)

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
#  Direction detection
# ════════════════════════════════════════════════════════════

class DirectionTracker:
    """
    Tracks horizontal face center movement.
    Face moving left→right = ENTRY (walking into classroom).
    Face moving right→left = EXIT  (walking out).
    Use --flip if your camera faces the other way.
    """
    def __init__(self, flip: bool = False):
        self.positions: dict[str, deque] = defaultdict(lambda: deque(maxlen=DIRECTION_FRAMES))
        self.flip = flip

    def update(self, student_id: str, face_center_x: float, frame_width: int):
        """Returns 'ENTRY', 'EXIT', or None."""
        normalized = face_center_x / frame_width
        self.positions[student_id].append(normalized)

        if len(self.positions[student_id]) < DIRECTION_FRAMES:
            return None

        positions = list(self.positions[student_id])
        delta = positions[-1] - positions[0]

        if abs(delta) < 0.12:   # not enough horizontal movement
            return None

        self.positions[student_id].clear()

        moving_right = delta > 0
        if self.flip:
            moving_right = not moving_right
        return 'ENTRY' if moving_right else 'EXIT'


# ════════════════════════════════════════════════════════════
#  Event posting
# ════════════════════════════════════════════════════════════

last_event_time: dict[str, tuple] = {}   # studentId → (type, timestamp)

def post_event(student_id: str, student_name: str, event_type: str, room: str, confidence: float):
    """Post a door event to the Node backend (non-blocking)."""
    now = time.time()
    last = last_event_time.get(student_id)

    # Cooldown: skip duplicate events within COOLDOWN_SECS
    if last and last[0] == event_type and now - last[1] < COOLDOWN_SECS:
        return

    last_event_time[student_id] = (event_type, now)

    icon = '🟢' if event_type == 'ENTRY' else '🔴'
    log.info(f'{icon}  {event_type}: {student_name} | Room {room} | conf={confidence:.2f}')

    def _post():
        try:
            resp = requests.post(
                f'{BACKEND_URL}/api/door/event',
                json={
                    'roomNumber': room,
                    'studentId': student_id,
                    'type': event_type,
                    'confidence': round(confidence, 3),
                },
                headers={'Authorization': f'Bearer {API_KEY}'},
                timeout=5,
            )
            if not resp.ok:
                log.warning(f'Backend rejected event: {resp.status_code} {resp.text[:100]}')
        except Exception as e:
            log.error(f'Failed to post event: {e}')

    threading.Thread(target=_post, daemon=True).start()


# ════════════════════════════════════════════════════════════
#  Main monitoring loop
# ════════════════════════════════════════════════════════════

def monitor(room: str, camera_source, flip_direction: bool = False):
    log.info(f'📷 Door Monitor starting | Room: {room} | Camera: {camera_source}')

    # Verify face service is running
    try:
        r = requests.get(f'{FACE_SVC_URL}/health', timeout=5)
        if r.ok:
            log.info(f'✅ Face service connected at {FACE_SVC_URL}')
        else:
            log.warning(f'⚠️  Face service responded with {r.status_code} — continuing anyway')
    except Exception:
        log.error(f'❌ Face service not reachable at {FACE_SVC_URL}. Make sure uvicorn is running.')
        sys.exit(1)

    # Pre-fetch active lecture's student list so face service can do a targeted search (faster)
    expected_student_ids: list = []
    try:
        resp = requests.get(
            f'{BACKEND_URL}/api/door/lecture/active?room={room}',
            headers={'Authorization': f'Bearer {API_KEY}'},
            timeout=5,
        )
        if resp.ok:
            data = resp.json()
            expected_student_ids = data.get('studentIds', [])
            if expected_student_ids:
                log.info(f'✅ Pre-fetched {len(expected_student_ids)} enrolled student IDs for faster matching')
    except Exception:
        log.info('ℹ️  Could not pre-fetch student list — will search all enrolled students')

    tracker = DirectionTracker(flip=flip_direction)

    # Open camera stream
    cap = cv2.VideoCapture(camera_source)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)   # minimize buffering lag

    if not cap.isOpened():
        log.error(f'❌ Cannot open camera: {camera_source}')
        log.error('   Phone: make sure IP Webcam app shows "Server started" and both devices are on same WiFi')
        log.error('   Test: open the URL in your laptop browser first')
        sys.exit(1)

    log.info(f'✅ Camera opened. Monitoring room {room} — press Ctrl+C to stop')
    last_check = 0.0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                log.warning('Frame read failed — reconnecting in 2s...')
                time.sleep(2)
                cap.release()
                cap = cv2.VideoCapture(camera_source)
                continue

            now = time.time()
            if (now - last_check) * 1000 < FRAME_INTERVAL_MS:
                time.sleep(0.05)
                continue
            last_check = now

            # Resize frame for speed (face service will still detect well at 640px wide)
            h, w = frame.shape[:2]
            if w > FRAME_WIDTH:
                scale = FRAME_WIDTH / w
                frame = cv2.resize(frame, (0, 0), fx=scale, fy=scale)
                w = FRAME_WIDTH

            # Send to face service (pass expected_ids to limit DB search)
            matches = identify_faces_in_frame(frame, expected_ids=expected_student_ids or None)
            if not matches:
                continue

            for m in matches:
                if m['confidence'] < CONFIDENCE_THRESH:
                    continue

                student_id   = m['userId']
                student_name = m['userName']
                box          = m['box']       # [x, y, width, height]

                # Horizontal center of the bounding box
                center_x = box[0] + box[2] / 2

                direction = tracker.update(student_id, center_x, w)
                if direction:
                    post_event(student_id, student_name, direction, room, m['confidence'])

    except KeyboardInterrupt:
        log.info('🛑 Monitoring stopped.')
    finally:
        cap.release()


# ════════════════════════════════════════════════════════════
#  Entry point
# ════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Door Camera Monitor')
    parser.add_argument('--room',   required=True, help='Room number (e.g. 4006)')
    parser.add_argument('--flip',   action='store_true', help='Flip ENTRY/EXIT direction')
    parser.add_argument('--camera', default=None,  help='Override camera URL or index')
    args = parser.parse_args()

    # Resolve camera source
    if args.camera is not None:
        source = args.camera
        try: source = int(source)
        except (ValueError, TypeError): pass
    else:
        if not CONFIG_FILE.exists():
            log.error(f'camera_config.json not found at {CONFIG_FILE}')
            sys.exit(1)
        config = json.loads(CONFIG_FILE.read_text())
        rooms  = config.get('rooms', {})
        if args.room not in rooms:
            log.error(f'Room "{args.room}" not in camera_config.json. Available: {list(rooms.keys())}')
            sys.exit(1)
        source = rooms[args.room]
        try: source = int(source)
        except (ValueError, TypeError): pass

    monitor(args.room, source, flip_direction=args.flip)


if __name__ == '__main__':
    main()
