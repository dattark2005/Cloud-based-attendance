"""
Face Recognition Accuracy Test — OpenCV SFace
==============================================
Tests face registration + verification using your webcam.
No server needed. Uses same OpenCV SFace model as the service.

Usage:
    python test_face_accuracy.py

What it does:
    1. Opens webcam, captures 3 photos for "registration"
    2. Computes average SFace embedding
    3. Captures 3 more photos for "verification"
    4. Compares each using OpenCV's built-in matching
    5. Prints similarity scores and pass/fail results
"""

import cv2
import numpy as np
import sys
import os
from pathlib import Path
import urllib.request

print("=" * 60)
print(" SFace Accuracy Test (OpenCV Built-in)")
print("=" * 60)

# ── Setup Models ──
MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
YUNET_PATH = str(MODELS_DIR / "face_detection_yunet_2023mar.onnx")
SFACE_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
SFACE_PATH = str(MODELS_DIR / "face_recognition_sface_2021dec.onnx")

for url, path, name in [(YUNET_URL, YUNET_PATH, "YuNet"), (SFACE_URL, SFACE_PATH, "SFace")]:
    if not os.path.exists(path):
        print(f"🔄 Downloading {name}...")
        urllib.request.urlretrieve(url, path)
        print(f"✅ Downloaded {name} ({os.path.getsize(path)/1024/1024:.1f}MB)")
    else:
        print(f"✅ {name} ready ({os.path.getsize(path)/1024/1024:.1f}MB)")

# Load models
detector = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320), 0.7, 0.3, 5000)
recognizer = cv2.FaceRecognizerSF.create(SFACE_PATH, "")
COSINE_THRESHOLD = 0.363
print(f"✅ Models loaded (cosine threshold: {COSINE_THRESHOLD})\n")


def detect_face(frame_bgr):
    h, w = frame_bgr.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(frame_bgr)
    if faces is None or len(faces) == 0:
        return None
    return faces[np.argmax(faces[:, -1])]


def get_embedding(frame_bgr):
    face = detect_face(frame_bgr)
    if face is None:
        raise ValueError("No face detected")
    aligned = recognizer.alignCrop(frame_bgr, face)
    return recognizer.feature(aligned).flatten().astype(np.float64)


def compare(emb1, emb2):
    e1 = emb1.astype(np.float32).reshape(1, -1)
    e2 = emb2.astype(np.float32).reshape(1, -1)
    cos = recognizer.match(e1, e2, cv2.FaceRecognizerSF_FR_COSINE)
    l2 = recognizer.match(e1, e2, cv2.FaceRecognizerSF_FR_NORM_L2)
    return float(cos), float(l2), cos >= COSINE_THRESHOLD


def capture_photos(cap, count, label):
    photos = []
    print(f"\n📷 Will capture {count} photos for {label}")
    print(f"   Press ENTER to capture each photo.\n")

    for i in range(count):
        input(f"   Press ENTER to capture photo {i+1}/{count}...")
        for _ in range(5):
            ret, frame = cap.read()
        if not ret:
            print(f"   ❌ Capture failed")
            continue
        display = frame.copy()
        cv2.putText(display, f"{label} {i+1}/{count}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        cv2.imshow("Capture", display)
        cv2.waitKey(500)
        photos.append(frame.copy())
        print(f"   ✅ Captured photo {i+1}")
    return photos


def main():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("❌ Cannot open webcam")
        sys.exit(1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    print("✅ Webcam opened\n")

    try:
        # ── Registration ──
        print("=" * 50)
        print("  PHASE 1: REGISTRATION (3 photos)")
        print("=" * 50)
        reg_photos = capture_photos(cap, 3, "REGISTER")

        reg_embeddings = []
        for i, p in enumerate(reg_photos):
            try:
                emb = get_embedding(p)
                reg_embeddings.append(emb)
                print(f"   ✅ Photo {i+1}: embedding ok")
            except ValueError as e:
                print(f"   ⚠️  Photo {i+1}: {e}")

        if not reg_embeddings:
            print("❌ No faces detected. Check lighting.")
            return

        registered = np.mean(reg_embeddings, axis=0)
        print(f"\n✅ Registered with {len(reg_embeddings)} samples")

        # ── Verification ──
        print("\n" + "=" * 50)
        print("  PHASE 2: VERIFICATION (3 photos)")
        print("  Same person — should all PASS")
        print("=" * 50)
        ver_photos = capture_photos(cap, 3, "VERIFY")

        results = []
        for i, p in enumerate(ver_photos):
            try:
                emb = get_embedding(p)
                cos, l2, match = compare(registered, emb)
                results.append({"cos": cos, "l2": l2, "match": match})
                status = "✅ PASS" if match else "❌ FAIL"
                print(f"   Photo {i+1}: cosine={cos:.4f}, L2={l2:.4f} → {status}")
            except ValueError as e:
                print(f"   ⚠️  Photo {i+1}: {e}")
                results.append({"cos": 0, "l2": 99, "match": False})

        # ── Summary ──
        print("\n" + "=" * 50)
        print("  RESULTS")
        print("=" * 50)
        valid = [r for r in results if r["cos"] > 0]
        if valid:
            passes = sum(1 for r in valid if r["match"])
            acc = (passes / len(valid)) * 100
            scores = [r["cos"] for r in valid]
            print(f"\n  Accuracy:     {acc:.0f}% ({passes}/{len(valid)})")
            print(f"  Avg Cosine:   {np.mean(scores):.4f}")
            print(f"  Min Cosine:   {np.min(scores):.4f}")
            print(f"  Max Cosine:   {np.max(scores):.4f}")
            print(f"  Threshold:    {COSINE_THRESHOLD}")
            if acc == 100:
                print("\n  🎉 PERFECT!")
            elif acc >= 66:
                print("\n  ✅ Good.")
            else:
                print("\n  ⚠️  Low accuracy. Try better lighting.")

        # ── Cross-person test ──
        print("\n" + "-" * 50)
        cross = input("  Test with DIFFERENT person? (y/n): ").strip().lower()
        if cross == 'y':
            print("\n" + "=" * 50)
            print("  PHASE 3: DIFFERENT PERSON (should FAIL)")
            print("=" * 50)
            diff = capture_photos(cap, 2, "DIFFERENT")
            for i, p in enumerate(diff):
                try:
                    emb = get_embedding(p)
                    cos, l2, match = compare(registered, emb)
                    s = "❌ FALSE ACCEPT!" if match else "✅ CORRECTLY REJECTED"
                    print(f"   Photo {i+1}: cosine={cos:.4f} → {s}")
                except ValueError as e:
                    print(f"   ⚠️  {e}")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("\n📹 Done!")


if __name__ == "__main__":
    main()
