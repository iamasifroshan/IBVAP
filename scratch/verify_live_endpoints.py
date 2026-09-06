import urllib.request
import cv2
import numpy as np

urls = [
    'http://localhost:8000/storage/evidence/webcam_evidence_0f217afc.jpg',
    'http://localhost:8000/storage/evidence/webcam_evidence_eade6610.jpg',
    'http://localhost:8000/storage/evidence/INC-NM-5679FC1E_snapshot.jpg',
    'http://localhost:8000/storage/evidence/INC-SUSP-763B7D09_snapshot.jpg',
    'http://localhost:8000/storage/evidence/INC-NM-8AD37703_snapshot.jpg'
]

print("Direct Live Backend Image Endpoint Tests:")
all_pass = True
for url in urls:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        status = resp.status
        content_type = resp.headers.get('Content-Type')
        content_length = resp.headers.get('Content-Length')
        data = resp.read()
        is_jpeg = data[:2] == b'\xff\xd8'
        img_arr = np.frombuffer(data, dtype=np.uint8)
        decoded = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        valid = decoded is not None and decoded.shape[0] > 0
        if status != 200 or not is_jpeg or not valid:
            all_pass = False
        fname = url.split('/')[-1]
        dims = f"{decoded.shape[1]}x{decoded.shape[0]}" if valid else "INVALID"
        print(f"  {fname}: Status={status}, Content-Type={content_type}, Content-Length={content_length} bytes, MagicBytes={is_jpeg}, Dimensions={dims}")

print(f"Overall Result: {'PASS' if all_pass else 'FAIL'}")
