"""
live_camera_sync.py — Classroom Presence Monitor (WebSocket Mode)
=================================================================
Architecture:
  • Browser opens camera directly via getUserMedia() — instant native video, zero lag
  • Browser sends a JPEG snapshot via WebSocket every ~400ms for face recognition
  • Python returns JSON {boxes: [{x,y,w,h,name,conf}]} via WebSocket
  • Canvas overlay in browser draws the boxes on top of the live <video> element
  • Presence SEEN/ABSENT events are still posted to the Node.js backend as before

Usage:
    python live_camera_sync.py
"""

import asyncio
import json
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
import websockets
from websockets.server import WebSocketServerProtocol

# ── Setup ──
load_dotenv(Path(__file__).parent / 'backend' / '.env')
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
)
log = logging.getLogger('presence_monitor')

# ── Config ──
BACKEND_URL      = 'http://localhost:3001'
FACE_SVC_URL     = os.getenv('FACE_SERVICE_URL', 'http://localhost:8082')
API_KEY          = os.getenv('DOOR_CAMERA_API_KEY', 'door-cam-secret-key-2026')

SCAN_INTERVAL_SEC = 0.4   # Min seconds between face-service calls per client
ABSENT_THRESHOLD  = 180   # Seconds missing before firing ABSENT event
FRAME_WIDTH       = 640   # Downscale snapshot before ML inference
FACE_SVC_TIMEOUT  = 4     # Face service HTTP timeout
POST_COOLDOWN_SEC = 5     # Dedup same-status events per student
SCAN_JPEG_QUALITY = 75    # JPEG quality for face service inference
WS_PORT           = 5000  # WebSocket port (browser connects here)

# ════════════════════════════════════════════════════════════
#  Shared state
# ════════════════════════════════════════════════════════════

last_seen: dict[str, float]  = {}  # studentId → last detected timestamp
student_status: dict[str, str] = {}  # studentId → 'SEEN' | 'ABSENT'
last_posted: dict[str, tuple]  = {}  # studentId → (status, timestamp)
expected_student_ids: list[str] = []

# Latest detected boxes — updated by ws_handler, kept as persistent cache
# Format: [{box: [x,y,w,h], name: str, conf: float}]
name_cache: list      = []
name_cache_lock       = threading.Lock()

# ════════════════════════════════════════════════════════════
#  Face service call
# ════════════════════════════════════════════════════════════

def identify_faces(frame_bgr: np.ndarray) -> list:
    """
    POST a JPEG frame to /identify-group on the Python face service.
    Returns list of {userId, userName, confidence, box}.
    Called from asyncio executor so it never blocks the event loop.
    """
    try:
        ok, buf = cv2.imencode('.jpg', frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, SCAN_JPEG_QUALITY])
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
            return resp.json().get('matches', [])
    except Exception as e:
        log.debug(f'Face service error: {e}')
    return []


# ════════════════════════════════════════════════════════════
#  Presence event posting to Node.js backend
# ════════════════════════════════════════════════════════════

def post_presence(student_id: str, status: str, confidence: float = 0.0):
    """POST a SEEN or ABSENT event. Enforces per-student cooldown."""
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
                    'status': status,
                    'confidence': round(confidence, 3),
                },
                headers={'Authorization': f'Bearer {API_KEY}'},
                timeout=5,
            )
            if not resp.ok:
                log.warning(f'Backend rejected presence: {resp.status_code} {resp.text[:100]}')
        except Exception as e:
            log.error(f'Failed to post presence event: {e}')

    threading.Thread(target=_post, daemon=True).start()


# ════════════════════════════════════════════════════════════
#  Scan result processing — updates SEEN/ABSENT state
# ════════════════════════════════════════════════════════════

def process_scan_from_matches(matches: list):
    """
    Called in a background thread after each face-recognition call.
    Updates last_seen + student_status, fires SEEN events.
    ABSENT events are fired by the absence_checker_loop separately.
    """
    now = time.time()
    seen_ids: set[str] = set()

    for m in matches:
        if m.get('confidence', 0) >= 0.35 and 'userId' in m:
            sid = m['userId']
            seen_ids.add(sid)
            was_absent = student_status.get(sid) == 'ABSENT'
            last_seen[sid] = now
            student_status[sid] = 'SEEN'
            if was_absent:
                log.info(f'✅ Recovery: studentId={sid} is back in frame')
            post_presence(sid, 'SEEN', m.get('confidence', 0))

    log.info(f'📸 Scan | detected={len(seen_ids)} of {len(expected_student_ids)} enrolled')


# ════════════════════════════════════════════════════════════
#  WebSocket server — browser sends frames, we return face boxes
# ════════════════════════════════════════════════════════════

connected_clients: set = set()
clients_lock = threading.Lock()


async def ws_handler(ws: WebSocketServerProtocol):
    """
    One connection per browser tab.

    Protocol (binary):
      → browser sends: raw JPEG bytes (canvas.toBlob('image/jpeg', 0.8))
      ← server sends:  JSON text — {"boxes":[{x,y,w,h,name,conf},...]}

    Browser renders video natively via getUserMedia() <video> element.
    Only a small JPEG snapshot (not the full video stream) comes here for ML.
    """
    with clients_lock:
        connected_clients.add(ws)
    log.info(f'🌐 Client connected ({len(connected_clients)} total)')

    last_scan_time = 0.0

    try:
        async for message in ws:
            if not isinstance(message, bytes) or len(message) < 100:
                continue

            now = time.time()

            # Throttle: reply immediately with cached boxes (may be empty if last scan found no faces)
            # This ensures boxes disappear immediately without waiting for next ML scan
            if now - last_scan_time < SCAN_INTERVAL_SEC:
                with name_cache_lock:
                    cached = list(name_cache)  # will be [] if last scan found no faces
                await ws.send(json.dumps({'boxes': _format_boxes(cached)}))
                continue

            last_scan_time = now

            # Decode JPEG bytes sent from browser canvas
            arr   = np.frombuffer(message, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            # Downscale for faster inference
            h, w = frame.shape[:2]
            if w > FRAME_WIDTH:
                scale      = FRAME_WIDTH / w
                scan_frame = cv2.resize(frame, (FRAME_WIDTH, int(h * scale)))
            else:
                scale      = 1.0
                scan_frame = frame

            # Run face recognition off the event loop
            loop    = asyncio.get_event_loop()
            matches = await loop.run_in_executor(None, identify_faces, scan_frame)

            # Build new boxes (scale coords back to browser frame size)
            new_boxes = []
            for m in matches:
                conf = m.get('confidence', 0)
                user_name = m.get('userName', m.get('userId', '?'))[:18]
                if conf >= 0.35 or user_name == 'Unknown':
                    box = m.get('box')
                    if box:
                        orig_box = [
                            box[0] / scale, box[1] / scale,
                            box[2] / scale, box[3] / scale,
                        ]
                        new_boxes.append({
                            'box':  orig_box,
                            'name': user_name,
                            'conf': conf,
                        })

            if new_boxes:
                with name_cache_lock:
                    name_cache[:] = sorted(new_boxes, key=lambda b: b['box'][0])
            else:
                # No faces detected in this scan — clear the cache immediately
                # so stale boxes don't linger on screen
                with name_cache_lock:
                    name_cache.clear()

            # Fire SEEN/ABSENT logic in background thread
            threading.Thread(
                target=process_scan_from_matches, args=(matches,), daemon=True
            ).start()

            # Send boxes back to browser (empty list if none found)
            with name_cache_lock:
                cached = list(name_cache)
            await ws.send(json.dumps({'boxes': _format_boxes(cached)}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        with clients_lock:
            connected_clients.discard(ws)
        log.info(f'🌐 Client disconnected ({len(connected_clients)} remaining)')


def _format_boxes(boxes: list) -> list:
    return [
        {
            'x': int(b['box'][0]), 'y': int(b['box'][1]),
            'w': int(b['box'][2]), 'h': int(b['box'][3]),
            'name': b['name'],     'conf': round(b['conf'], 3),
        }
        for b in boxes
    ]


def _ws_thread():
    """Daemon thread that runs the asyncio WebSocket server."""
    async def _main():
        async with websockets.serve(
            ws_handler, '0.0.0.0', WS_PORT,
            max_size=10 * 1024 * 1024,   # 10 MB — enough for any JPEG snapshot
        ):
            log.info(f'🔌 WebSocket server live on ws://localhost:{WS_PORT}')
            await asyncio.Future()        # run forever

    asyncio.run(_main())


# ════════════════════════════════════════════════════════════
#  Enrolled student list management
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
                log.info(f'✅ Fetched {len(ids)} enrolled student IDs')
            return ids
    except Exception as e:
        log.warning(f'Could not fetch student list: {e}')
    return []


# ════════════════════════════════════════════════════════════
#  Absence checker — background thread, fires ABSENT events
# ════════════════════════════════════════════════════════════

def absence_checker_loop(refresh_every_mins: int = 5):
    """
    Checks every 10 s if any enrolled student has been missing
    for longer than ABSENT_THRESHOLD seconds.
    """
    global expected_student_ids
    last_refresh = time.time()

    while True:
        time.sleep(10)
        now = time.time()

        # Periodically re-fetch enrolled list
        if now - last_refresh > refresh_every_mins * 60:
            new_ids = fetch_enrolled_students()
            if new_ids:
                expected_student_ids = new_ids
            last_refresh = now

        for sid in expected_student_ids:
            last = last_seen.get(sid)
            if last is None:
                continue  # Never seen — don't flag yet

            absent_secs = now - last
            if absent_secs >= ABSENT_THRESHOLD:
                prev = student_status.get(sid)
                student_status[sid] = 'ABSENT'
                if prev != 'ABSENT':
                    mins = int(absent_secs // 60)
                    secs = int(absent_secs % 60)
                    log.warning(f'⚠️  ABSENT: {sid} | missing {mins}m {secs}s')
                    last_posted.pop(sid, None)
                post_presence(sid, 'ABSENT', 0.0)


# ════════════════════════════════════════════════════════════
#  Entry point
# ════════════════════════════════════════════════════════════

def main():
    global expected_student_ids

    log.info('🚀 Presence Monitor (WebSocket mode) starting...')

    # Wait for face service to be ready
    for attempt in range(10):
        try:
            r = requests.get(f'{FACE_SVC_URL}/health', timeout=3)
            if r.ok:
                log.info(f'✅ Face service ready at {FACE_SVC_URL}')
                break
        except Exception:
            pass
        log.warning(f'⏳ Waiting for face service... ({attempt + 1}/10)')
        time.sleep(3)
    else:
        log.error(f'❌ Face service not reachable at {FACE_SVC_URL}. Start it first.')
        sys.exit(1)

    expected_student_ids = fetch_enrolled_students()

    # Start absence checker
    threading.Thread(target=absence_checker_loop, daemon=True).start()
    log.info('⏱  Absence checker active (flags after 3 min missing)')

    # Start WebSocket server
    threading.Thread(target=_ws_thread, daemon=True).start()

    log.info(f'✅ Ready. Open http://localhost:3000 — browser will use your camera directly')
    log.info('   Press Ctrl+C to stop\n')

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info('🛑 Stopped.')


if __name__ == '__main__':
    main()
