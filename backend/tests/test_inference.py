import cv2
import requests
import time
import sys

videos = {
    'A (previously working)': r'E:\IBVAP\backend\storage\videos\test_sample.mp4',
    'B (previously failing)': r'E:\IBVAP\backend\storage\videos\gettyimages-2213890215-640_adpp(1).mp4',
    'C (another unseen)': r'E:\IBVAP\backend\storage\videos\12522257-hd_1920_1080_24fps.mp4',
    'D (multi-vehicle)': r'E:\IBVAP\backend\storage\videos\bus_test.mp4',
    'E (multi-person)': r'E:\IBVAP\backend\storage\videos\people_test.mp4'
}

url = 'http://localhost:8000/api/v1/cameras/SECTOR-B-CAM-03/detect-frame?conf_threshold=0.25'

for name, path in videos.items():
    print(f"Testing {name}: {path}")
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(f"Failed to open {path}\n")
        continue

    # grab one frame
    ret, frame = cap.read()
    if not ret:
        print(f"Failed to read frame from {path}\n")
        continue

    # encode to jpeg
    ret, jpeg = cv2.imencode('.jpg', frame)
    if not ret:
        print("Failed to encode frame\n")
        continue

    blob = jpeg.tobytes()
    files = {'file': ('frame.jpg', blob, 'image/jpeg')}
    
    start = time.time()
    try:
        res = requests.post(url, files=files)
        latency = (time.time() - start) * 1000
        data = res.json()
        print(f"PERSONS: {data.get('person_count', 0)}")
        print(f"VEHICLES: {data.get('vehicle_count', 0)}")
        print(f"TRACKS: {len(data.get('detections', [])) + len(data.get('vehicle_detections', []))}")
        print(f"LATENCY: {latency:.0f} ms")
        fps = 1000 / latency if latency > 0 else 0
        print(f"FPS: {fps:.1f}\n")
    except Exception as e:
        print(f"API failed: {e}\n")

    cap.release()
