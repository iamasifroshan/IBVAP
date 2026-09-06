import os
import sqlite3
import cv2

print("=== 1. DATABASE CAMERA RECORDS ===")
conn = sqlite3.connect("backend/ibvap.db")
cur = conn.cursor()
cameras = cur.execute("SELECT id, camera_id, name, sector, source_type, source_url, status FROM cameras").fetchall()
for cam in cameras:
    print(cam)
conn.close()

print("\n=== 2. FILESYSTEM VIDEOS IN BACKEND & PUBLIC ===")
dirs_to_check = [
    "backend/storage/videos",
    "public/videos",
    "public/cameras",
    "backend/storage"
]

for d in dirs_to_check:
    print(f"\nChecking directory: {d}")
    if os.path.exists(d):
        for root, dirs, files in os.walk(d):
            for f in files:
                fpath = os.path.join(root, f)
                size = os.path.getsize(fpath)
                print(f"  {fpath} ({size} bytes)")
    else:
        print(f"  Directory {d} does not exist")

print("\n=== 3. OPENCV VIDEO INTEGRITY CHECK ===")
for cam in cameras:
    cam_id, camera_id, name, sector, source_type, source_url, status = cam
    print(f"\nEvaluating Camera: {camera_id} ({name})")
    print(f"  source_url: {source_url}")
    print(f"  source_type: {source_type}")
    print(f"  exists as absolute: {os.path.exists(source_url)}")
    
    # Check relative to backend or workspace
    rel_path = source_url
    if not os.path.exists(rel_path):
        # try backend/storage/videos
        basename = os.path.basename(source_url)
        cand1 = os.path.join("backend", "storage", "videos", basename)
        cand2 = os.path.join("public", "videos", basename)
        print(f"  cand1 exists: {os.path.exists(cand1)} ({cand1})")
        print(f"  cand2 exists: {os.path.exists(cand2)} ({cand2})")
        target_file = cand1 if os.path.exists(cand1) else (cand2 if os.path.exists(cand2) else None)
    else:
        target_file = source_url
        
    if target_file and os.path.exists(target_file):
        cap = cv2.VideoCapture(target_file)
        opened = cap.isOpened()
        if opened:
            ret, frame = cap.read()
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            duration = count / fps if fps > 0 else 0
            cap.release()
            print(f"  OpenCV check: OPENED={opened}, FirstFrameDecoded={ret}, FrameShape={frame.shape if ret else 'NONE'}, {w}x{h}, FPS={fps}, Frames={count}, Duration={duration:.2f}s")
        else:
            print(f"  OpenCV check: FAILED TO OPEN")
    else:
        print(f"  Target file not found!")
