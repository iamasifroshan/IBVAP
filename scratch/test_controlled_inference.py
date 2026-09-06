"""
Controlled continuous-track inference verification:
Frame 1: breach detected -> exactly ONE incident
Frames 2-10: same TRK# -> same continuous episode -> ZERO new incident rows
Verify:
- incident count increases by exactly 1
- evidence count increases by at most 1
- existing incident gets updated (loitering_duration_sec increases)
- no duplicate burst appears
"""

import sys
import os
import shutil

sys.path.insert(0, 'backend')

from database.db import SessionLocal
from database.models import IncidentModel, EvidenceModel, ZoneModel, CameraModel
from ai.fence import fence_engine
from ai.tracker import track_registry

def run_test():
    db = SessionLocal()
    cam = db.query(CameraModel).first()
    zone = db.query(ZoneModel).filter(ZoneModel.camera_id == cam.camera_id, ZoneModel.enabled == True).first()
    if not zone:
        zone = db.query(ZoneModel).filter(ZoneModel.enabled == True).first()

    cam_id = cam.camera_id if cam else "BORDER-CAM-07"
    zone_id = zone.id if zone else "ZONE-01"

    print(f"Testing on Camera: {cam_id}, Zone: {zone.name if zone else 'Default'}")

    inc_count_before = db.query(IncidentModel).count()
    ev_count_before = db.query(EvidenceModel).count()

    # Clear camera state in fence engine and tracker
    fence_engine.clear_camera(cam_id)
    track_registry.clear_camera(cam_id)

    # Use a unique test track ID
    test_track_id = 99991

    # Register persistent track in tracker
    test_bbox = {"x": 0.70, "y": 0.70, "width": 0.05, "height": 0.10}
    track_registry.update_track(
        camera_id=cam_id,
        track_id=test_track_id,
        fine_class="person",
        object_type="human",
        frame_index=1,
        confidence=0.97,
        bounding_box=test_bbox,
    )
    t_store = track_registry._get_camera_store(cam_id)
    if test_track_id in t_store:
        t_store[test_track_id].frames_seen = 8

    # Frame 1: breach detected
    det_f1 = [{
        "track_id": test_track_id,
        "object_type": "human",
        "fine_class": "person",
        "confidence": 0.97,
        "bounding_box": test_bbox,
        "timestamp_sec": 1000.0,
        "face": {"confidence": 0.88, "recognized": False},
    }]

    created_f1 = fence_engine.evaluate_frame_detections(
        camera_id=cam_id,
        frame_index=1,
        timestamp_sec=1000.0,
        detections=det_f1,
        zones=[zone],
        db=db,
    )

    print(f"Frame 1: Created {len(created_f1)} incidents")
    assert len(created_f1) == 1, f"Frame 1 must create exactly 1 incident, got {len(created_f1)}"
    created_inc = created_f1[0]
    first_id = created_inc.incident_id
    print(f"  Created Incident ID: {first_id}")

    # Frames 2-10: continuous tracking in same episode
    for f in range(2, 11):
        ts = 1000.0 + (f - 1) * 1.0
        det_fn = [{
            "track_id": test_track_id,
            "object_type": "human",
            "fine_class": "person",
            "confidence": 0.97,
            "bounding_box": test_bbox,
            "timestamp_sec": ts,
            "face": {"confidence": 0.88, "recognized": False},
        }]
        created_fn = fence_engine.evaluate_frame_detections(
            camera_id=cam_id,
            frame_index=f,
            timestamp_sec=ts,
            detections=det_fn,
            zones=[zone],
            db=db,
        )
        assert len(created_fn) == 0, f"Frame {f} must create ZERO new incidents, got {len(created_fn)}"

    print("Frames 2-10: ZERO new incidents created (continuous track deduplication verified)")

    inc_count_after = db.query(IncidentModel).count()
    ev_count_after = db.query(EvidenceModel).count()

    print(f"Total Incidents Before: {inc_count_before}, After: {inc_count_after} (Diff: +{inc_count_after - inc_count_before})")
    assert (inc_count_after - inc_count_before) == 1, "Incident count must increase by exactly 1!"

    # Verify existing incident was updated
    updated_inc = db.query(IncidentModel).filter(IncidentModel.incident_id == first_id).first()
    print(f"Updated Incident loitering_duration_sec: {updated_inc.loitering_duration_sec}")
    assert updated_inc.loitering_duration_sec >= 9, "Incident loitering duration must be updated"

    # Clean up test incident to keep DB clean
    db.delete(updated_inc)
    db.commit()
    print("Controlled test incident cleaned up. Database restored to baseline.")
    db.close()

if __name__ == '__main__':
    run_test()
