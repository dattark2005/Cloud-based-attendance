"""
live_camera_sync.py — True Zero-Lag Dual Camera Monitor
======================================================
This script handles TWO live camera streams (inside classroom & outside classroom)
for true real-time, zero-lag attendance monitoring.

When a student's face is detected entering the "inside" camera, it instantly hits
the Node.js backend POST /api/door/event to broadcast a WebSockets event to the UI.

Usage:
    python live_camera_sync.py --room 4006 --inside 0 --outside 1

Replace 0 and 1 with your actual IP Webcam URLs if testing with phones.
For example:
    python live_camera_sync.py --room 4006 --inside "http://192.168.1.10:8080/video" --outside "http://192.168.1.11:8080/video"
"""

import argparse
import os
import sys
import time
import logging
import threading
from pathlib import Path

import cv2
import numpy as np
import requests
from dotenv import load_dotenv

# ── Setup ──
# Load the backend env variables
load_dotenv(Path(__file__).parent / 'backend' / '.env')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('dual_monitor')

# ── Configurations ──
BACKEND_URL  = 'http://localhost:3001'
FACE_SVC_URL = os.getenv('FACE_SERVICE_URL', 'http://localhost:8000')
API_KEY      = os.getenv('DOOR_CAMERA_API_KEY', 'door-cam-secret-key-2026')

FRAME_INTERVAL_MS = 300    # Process a frame every 300ms for Zero Lag
CONFIDENCE_THRESH = 0.50
FRAME_WIDTH       = 640
COOLDOWN_SECS     = 10     # Deduplicate same-student entries

# Memory for cooldowns
last_event_time = {} # student_id -> (type, timestamp)

def post_event(student_id: str, student_name: str, event_type: str, room: str, confidence: float):
    """Instantly POSTs to the Node.js backend which fires a Socket.io event."""
    now = time.time()
    last = last_event_time.get(student_id)

    # Cooldown check
    if last and last[0] == event_type and now - last[1] < COOLDOWN_SECS:
        return

    last_event_time[student_id] = (event_type, now)
    
    icon = '🟢' if event_type == 'ENTRY' else '🔴'
    log.info(f'{icon}  {event_type}: {student_name} | conf={confidence:.2f}')

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

def identify_faces(frame_bgr: np.ndarray, expected_ids: list = None) -> list:
    """Send frame to the local FastAPI face recognition service."""
    try:
        ok, buf = cv2.imencode('.jpg', frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok: return []

        files = {'file': ('frame.jpg', buf.tobytes(), 'image/jpeg')}
        data  = {}
        if expected_ids:
            data['expected_user_ids'] = ','.join(expected_ids)

        resp = requests.post(
            f'{FACE_SVC_URL}/identify-group',
            files=files,
            data=data,
            timeout=5,
        )
        if resp.ok:
            return resp.json().get('matches', [])
    except Exception as e:
        log.warning(f'Face service error: {e}')
    return []

def process_camera_stream(camera_source, room: str, event_type: str, expected_ids: list):
    """Loop for a single camera (Runs in its own Thread)."""
    log.info(f'[{event_type}] Monitoring started on source: {camera_source}')
    
    cap = cv2.VideoCapture(camera_source)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    if not cap.isOpened():
        log.error(f'❌ Cannot open {event_type} camera: {camera_source}')
        return

    last_check = 0.0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(1)
                cap = cv2.VideoCapture(camera_source)
                continue

            now = time.time()
            if (now - last_check) * 1000 < FRAME_INTERVAL_MS:
                time.sleep(0.01)
                continue
            last_check = now

            # Resize
            h, w = frame.shape[:2]
            if w > FRAME_WIDTH:
                scale = FRAME_WIDTH / w
                frame = cv2.resize(frame, (0, 0), fx=scale, fy=scale)

            # Detect
            matches = identify_faces(frame, expected_ids)
            for m in matches:
                if m['confidence'] >= CONFIDENCE_THRESH:
                    post_event(
                        student_id=m['userId'],
                        student_name=m['userName'],
                        event_type=event_type,
                        room=room,
                        confidence=m['confidence']
                    )

    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        log.info(f'[{event_type}] Stream closed.')

def main():
    parser = argparse.ArgumentParser(description='Zero-Lag Dual Camera Monitor')
    parser.add_argument('--room', required=True, help='Room number (e.g. 4006)')
    parser.add_argument('--inside', required=True, help='Inside camera URL or index (0)')
    parser.add_argument('--outside', required=True, help='Outside camera URL or index (1)')
    args = parser.parse_args()

    # Pre-fetch students config for faster matching
    expected_ids = []
    try:
        # Check Face Service health
        requests.get(f'{FACE_SVC_URL}/health', timeout=3)
        
        # Pre-fetch students
        r = requests.get(f'{BACKEND_URL}/api/door/lecture/active?room={args.room}', headers={'Authorization': f'Bearer {API_KEY}'}, timeout=3)
        if r.ok:
            expected_ids = r.json().get('studentIds', [])
    except Exception as e:
        log.warning("Could not pre-fetch students or face service is down. Running blindly.")

    # Parse indexes if local webcams
    inside_src = int(args.inside) if args.inside.isdigit() else args.inside
    outside_src = int(args.outside) if args.outside.isdigit() else args.outside

    log.info(f"🚀 Starting True Real-Time Monitoring for Room {args.room}")
    
    t_inside = threading.Thread(target=process_camera_stream, args=(inside_src, args.room, 'ENTRY', expected_ids))
    t_outside = threading.Thread(target=process_camera_stream, args=(outside_src, args.room, 'EXIT', expected_ids))

    t_inside.daemon = True
    t_outside.daemon = True

    t_inside.start()
    t_outside.start()

    try:
        while True:
            time.sleep(1) # Keep main thread alive
    except KeyboardInterrupt:
        log.info("\n🛑 Shutting down dual cameras.")
        sys.exit(0)

if __name__ == '__main__':
    main()
