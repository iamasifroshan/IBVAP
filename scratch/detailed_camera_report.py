import os
import sqlite3
import cv2

conn = sqlite3.connect("backend/ibvap.db")
cur = conn.cursor()
cameras = cur.execute("SELECT camera_id, name, source_type, source_url, status FROM cameras").fetchall()
conn.close()

CAMERA_DEMO_FILES = {
    'BORDER-CAM-07': 'gettyimages-2215078536-640_adpp.mp4',
    'SECTOR-B-CAM-03': 'gettyimages-2213890215-640_adpp.mp4',
    'BOP-NORTH-02': '12522257-hd_1920_1080_24fps.mp4',
    'SOUTH-TRENCH-10': '17502678-hd_1080_1920_30fps.mp4',
}

base_dir = os.path.abspath("backend/storage/videos")
public_dir = os.path.abspath("public/videos")

print("=" * 80)
print("CAMERA SOURCE OF TRUTH INSPECTION REPORT")
print("=" * 80)

for cam in cameras:
    cam_id, name, source_type, source_url, status = cam
    print(f"\nCamera ID: {cam_id}")
    print(f"Camera Name: {name}")
    print(f"Protocol (source_type): {source_type}")
    print(f"Database Source URL/path: {source_url}")
    
    # Check resolved filesystem path
    # 1. As written in DB
    exists_exact = os.path.exists(source_url)
    resolved_path = source_url if exists_exact else None
    
    # 2. Check in backend/storage/videos by basename
    basename = os.path.basename(source_url)
    backend_file = os.path.join(base_dir, basename)
    public_file = os.path.join(public_dir, basename)
    demo_file_backend = os.path.join(base_dir, CAMERA_DEMO_FILES.get(cam_id, ''))
    demo_file_public = os.path.join(public_dir, CAMERA_DEMO_FILES.get(cam_id, ''))
    
    actual_file = None
    for cand in [source_url, backend_file, public_file, demo_file_backend, demo_file_public]:
        if cand and os.path.exists(cand) and os.path.isfile(cand):
            actual_file = cand
            break
            
    print(f"Resolved filesystem path: {actual_file or 'NOT FOUND'}")
    if actual_file:
        size = os.path.getsize(actual_file)
        _, ext = os.path.splitext(actual_file)
        print(f"File exists: True")
        print(f"File size: {size} bytes ({size / (1024*1024):.2f} MB)")
        print(f"File extension: {ext}")
        
        cap = cv2.VideoCapture(actual_file)
        if cap.isOpened():
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration = frames / fps if fps > 0 else 0
            fourcc_int = int(cap.get(cv2.CAP_PROP_FOURCC))
            fourcc = "".join([chr((fourcc_int >> 8 * i) & 0xFF) for i in range(4)])
            cap.release()
            print(f"Video resolution: {w}x{h}")
            print(f"Video FPS: {fps}")
            print(f"Video frames: {frames}")
            print(f"Video duration: {duration:.2f} seconds")
            print(f"Video codec (fourcc): {fourcc}")
        else:
            print(f"OpenCV cannot open file!")
    else:
        print(f"File exists: False")
        
    # HTTP URL returned to browser
    # Look at how getVideoUrlForCamera works:
    filename_for_url = CAMERA_DEMO_FILES.get(cam_id, basename)
    http_url = f"http://localhost:8000/videos/{filename_for_url}"
    print(f"HTTP URL returned to browser: {http_url}")
