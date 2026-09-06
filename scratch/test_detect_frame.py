import cv2
import urllib.request
import json
import os

def test_camera_detection(camera_id, video_path):
    cap = cv2.VideoCapture(video_path)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        print(f"Failed to read frame from {video_path}")
        return False
        
    _, buffer = cv2.imencode('.jpg', frame)
    image_bytes = buffer.tobytes()
    
    boundary = "----WebKitFormBoundaryIBVAPDetection"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="frame.jpg"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode("latin-1") + image_bytes + f"\r\n--{boundary}--\r\n".encode("latin-1")
    
    url = f"http://localhost:8000/api/v1/cameras/{camera_id}/detect-frame?conf_threshold=0.25"
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}"
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            print(f"[{camera_id}] Detection Success!")
            print(f"  Status code: {resp.status}")
            print(f"  Detections count: {len(data.get('detections', []))}")
            print(f"  Tracks count: {len(data.get('tracks', []))}")
            print(f"  Alert count: {len(data.get('alerts', []))}")
            print(f"  Threat level: {data.get('threat_level')}")
            print(f"  Inference time: {data.get('inference_time_ms', 0):.1f} ms")
            return True
    except Exception as e:
        print(f"[{camera_id}] Detection Error: {e}")
        return False

if __name__ == "__main__":
    test_camera_detection("BORDER-CAM-07", "backend/storage/videos/gettyimages-2215078536-640_adpp.mp4")
    test_camera_detection("SECTOR-B-CAM-03", "backend/storage/videos/gettyimages-2213890215-640_adpp.mp4")
