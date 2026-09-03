import pytest
from ai.tracker import TrackRecord, TrackState

def test_ema_bbox_smoothing():
    initial_bbox = {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2}
    
    # Initialize a track
    track = TrackRecord(
        camera_id="CAM-1",
        track_id=1,
        fine_class="person",
        object_type="human",
        state=TrackState.NEW,
        confidence_max=0.9,
        confidence_last=0.9,
        bounding_box=initial_bbox,
        frame_first=0,
        frame_last=0,
        frames_seen=1,
        frames_since_last_seen=0,
        video_ts_first=0.0,
        video_ts_last=0.0
    )
    
    # Assert initial bbox matches exactly
    assert track.bounding_box == initial_bbox
    
    # Update with new YOLO bounding box (jittered slightly)
    # alpha = 0.4
    # new_val = 0.4 * 0.2 + 0.6 * 0.1 = 0.08 + 0.06 = 0.14
    new_bbox = {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.3}
    
    track.update(frame_index=1, confidence=0.95, bounding_box=new_bbox)
    
    # Check EMA values
    expected_x = round(0.4 * 0.2 + 0.6 * 0.1, 4)
    expected_y = round(0.4 * 0.2 + 0.6 * 0.1, 4)
    expected_w = round(0.4 * 0.3 + 0.6 * 0.2, 4)
    expected_h = round(0.4 * 0.3 + 0.6 * 0.2, 4)
    
    assert track.bounding_box["x"] == expected_x
    assert track.bounding_box["y"] == expected_y
    assert track.bounding_box["width"] == expected_w
    assert track.bounding_box["height"] == expected_h
    
    # Face update should NOT overwrite the main bounding_box
    face_meta = {
        "recognized": True,
        "person_id": "P-123",
        "name": "Asif",
        "confidence": 0.8,
        "bounding_box": [50, 50, 100, 100] # Random face coords
    }
    
    track.update_face_identity(face_meta, grace_limit=15)
    
    # The face meta should be stored separately
    assert track.face_info["name"] == "Asif"
    assert track.face_info["bounding_box"] == [50, 50, 100, 100]
    
    # The main track bbox must REMAIN the EMA smoothed YOLO coordinates
    assert track.bounding_box["x"] == expected_x
    assert track.bounding_box["y"] == expected_y
