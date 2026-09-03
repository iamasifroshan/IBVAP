import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ai.smart_alert import smart_alert_service

is_confirmed, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
    camera_id="CAM-PIPE-TEST",
    track_id=10,
    fine_class="person",
    object_type="human",
    confidence=0.95,
    frames_seen=4,
    is_inside_zone=True,
    zone_name="Webcam Global Zone",
    is_first_entry=True,
    db=None,
    bbox={"x": 0.5, "y": 0.5, "width": 0.2, "height": 0.4},
    face_metadata={"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.8, "bounding_box": [110, 110, 20, 20]}
)

print("IS_CONFIRMED:", is_confirmed)
print("REASON:", reason)
for k, v in checks.items():
    print(k, "->", v)
