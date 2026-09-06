import os
import sys
import cv2
import json

# Add backend to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from database.db import SessionLocal
from database.models import CameraModel
from video.stream_manager import StreamSourceManager

def main():
    db = SessionLocal()
    cameras = db.query(CameraModel).all()
    print(f"Total cameras in DB: {len(cameras)}")
    
    results = []
    base_storage = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend", "storage", "videos"))
    
    for cam in cameras:
        # Determine protocol / source type
        protocol = cam.source_type
        source_url = cam.source_url
        resolved_path = StreamSourceManager.resolve_video_path(source_url)
        file_exists = os.path.exists(resolved_path) if resolved_path else False
        
        file_size = os.path.getsize(resolved_path) if file_exists else 0
        file_ext = os.path.splitext(resolved_path)[1] if resolved_path else ""
        
        duration = 0.0
        codec = "N/A"
        width = 0
        height = 0
        fps = 0.0
        frame_count = 0
        can_decode = False
        
        if file_exists:
            cap = cv2.VideoCapture(resolved_path)
            if cap.isOpened():
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                fps = float(cap.get(cv2.CAP_PROP_FPS))
                frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                if fps > 0 and frame_count > 0:
                    duration = frame_count / fps
                fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
                codec = "".join([chr((fourcc >> 8 * i) & 0xFF) for i in range(4)])
                
                ret, frame = cap.read()
                can_decode = ret and frame is not None and frame.size > 0
                cap.release()
        
        filename = os.path.basename(resolved_path) if resolved_path else (os.path.basename(source_url) if source_url else "")
        http_url = f"http://localhost:8000/videos/{filename}" if filename else "N/A"
        
        cam_info = {
            "camera_id": cam.camera_id,
            "camera_name": cam.name,
            "protocol": protocol,
            "source_url": source_url,
            "resolved_path": resolved_path,
            "file_exists": file_exists,
            "file_size_bytes": file_size,
            "file_extension": file_ext,
            "duration_sec": round(duration, 2),
            "codec": codec,
            "width": width,
            "height": height,
            "fps": fps,
            "frame_count": frame_count,
            "can_decode_frame": can_decode,
            "http_url": http_url
        }
        results.append(cam_info)
        
    db.close()
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
