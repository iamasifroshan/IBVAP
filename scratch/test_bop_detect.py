import cv2
import urllib.request
import json

cap = cv2.VideoCapture('backend/storage/videos/bop_north_02.mp4')
ret, frame = cap.read()
cap.release()
print("Frame read success:", ret)

_, buf = cv2.imencode('.jpg', frame)
boundary = "----WebKitFormBoundaryBOPTest"
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="frame.jpg"\r\n'
    f"Content-Type: image/jpeg\r\n\r\n"
).encode("latin-1") + buf.tobytes() + f"\r\n--{boundary}--\r\n".encode("latin-1")

req = urllib.request.Request(
    "http://localhost:8000/api/v1/cameras/BOP-NORTH-02/detect-frame?conf_threshold=0.25",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    method="POST"
)

with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode())
    print("Status:", resp.status)
    print("Detections count:", len(data.get("detections", [])))
    print("Tracks count:", len(data.get("tracks", [])))
    print("Threat level:", data.get("threat_level"))
    print("Inference time (ms):", data.get("inference_time_ms"))
    for d in data.get("detections", []):
        print(f"  Detected: {d.get('class_name')} conf={d.get('confidence'):.2f} bbox={d.get('bbox')}")
