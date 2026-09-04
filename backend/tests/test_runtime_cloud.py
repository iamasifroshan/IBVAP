import pytest
from fastapi.testclient import TestClient
from main import app
from database.db import get_db, Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import cv2
import numpy as np

engine = create_engine("sqlite:///ibvap_test_runtime.db", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
# Always start from a fresh schema — prevents stale-column failures after migrations
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    """Override the app's DB dependency for all runtime cloud tests, then restore it after."""
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)

@pytest.fixture(scope="module")
def client_fixture():
    return TestClient(app)

def test_cloud_runtime(client_fixture):
    client = client_fixture
    # Insert camera & zone
    db = TestingSessionLocal()
    from database.models import CameraModel, ZoneModel, IncidentModel, EvidenceModel
    import uuid
    db.query(IncidentModel).delete()
    db.query(EvidenceModel).delete()
    db.query(ZoneModel).delete()
    db.query(CameraModel).delete()
    cam = CameraModel(id="cam-cloud", camera_id="CAM-CLOUD", name="Cloud Cam", source_url="webcam", source_type="WEBCAM", status="ONLINE", sector="Sector A")
    db.add(cam)
    zone = ZoneModel(id=str(uuid.uuid4()), name="Zone A", camera_id="CAM-CLOUD", sector="Sector A", zone_type="restricted_fence", polygon_coordinates=[{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}], enabled=True, human_detection=True)
    db.add(zone)
    db.commit()
    db.close()
    
    img = np.zeros((320, 320, 3), dtype=np.uint8)
    _, img_encoded = cv2.imencode('.jpg', img)

    from unittest.mock import patch
    with patch('ai.detector.YoloDetector.track_frame') as mock_track, patch('services.face_recognition.face_recognition_service.recognize_faces') as mock_recognize:
        
        # We need to hit 15 frames for the strict body limit, because Face=UNKNOWN requires body strict limit if face is absent!
        # Wait, if face_metadata is completely missing, it falls back to strict body (15 frames).
        # Let's mock 15 frames of the cloud bounding box fluctuating in shape/position
        import random
        for i in range(1, 17):
            w = random.uniform(0.1, 0.4)
            h = random.uniform(0.1, 0.4)
            x = random.uniform(0.2, 0.8)
            y = random.uniform(0.2, 0.8)
            mock_track.return_value = [{"track_id": 2, "fine_class": "person", "object_type": "human", "confidence": 0.86, "bounding_box": {"x": x, "y": y, "width": w, "height": h}, "bbox_pixels": {"x1": 100, "y1": 100, "x2": 150, "y2": 150}}]
            mock_recognize.return_value = [{"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.0, "bounding_box": [0,0,0,0]}]
            client.post("/api/v1/cameras/CAM-CLOUD/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        
    db = TestingSessionLocal()
    count = db.query(IncidentModel).count()
    print(f"TEST RESULT (CLOUD): Incidents Created = {count}")
    assert count == 0

def test_genuine_human_runtime(client_fixture):
    client = client_fixture
    # Insert camera & zone
    db = TestingSessionLocal()
    from database.models import CameraModel, ZoneModel, IncidentModel, EvidenceModel
    import uuid
    db.query(IncidentModel).delete()
    db.query(EvidenceModel).delete()
    db.query(ZoneModel).delete()
    db.query(CameraModel).delete()
    cam = CameraModel(id="cam-human", camera_id="CAM-HUMAN", name="Human Cam", source_url="webcam", source_type="WEBCAM", status="ONLINE", sector="Sector A")
    db.add(cam)
    zone = ZoneModel(id=str(uuid.uuid4()), name="Zone A", camera_id="CAM-HUMAN", sector="Sector A", zone_type="restricted_fence", polygon_coordinates=[{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}], enabled=True, human_detection=True)
    db.add(zone)
    db.commit()
    db.close()
    
    img = np.zeros((320, 320, 3), dtype=np.uint8)
    _, img_encoded = cv2.imencode('.jpg', img)

    from unittest.mock import patch
    with patch('ai.detector.YoloDetector.track_frame') as mock_track, patch('services.face_recognition.face_recognition_service.recognize_faces') as mock_recognize:
        
        # Genuine human moving smoothly
        x = 0.5
        for i in range(1, 17):
            w = 0.15 # stable width
            h = 0.40 # stable height
            x += 0.01 # smooth movement
            y = 0.5 # stable
            mock_track.return_value = [{"track_id": 3, "fine_class": "person", "object_type": "human", "confidence": 0.90, "bounding_box": {"x": x, "y": y, "width": w, "height": h}, "bbox_pixels": {"x1": 100, "y1": 100, "x2": 150, "y2": 150}}]
            mock_recognize.return_value = [{"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.88, "recognition_confidence": 0.88, "face_detection_confidence": 0.90, "identity_status": "UNKNOWN", "bounding_box": [int(x*320) + 10, int(y*320) + 10, 20, 20]}]
            client.post("/api/v1/cameras/CAM-HUMAN/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        
    db = TestingSessionLocal()
    count = db.query(IncidentModel).count()
    print(f"TEST RESULT (HUMAN): Incidents Created = {count}")
    assert count == 1

if __name__ == "__main__":
    test_cloud_runtime()
    test_genuine_human_runtime()
