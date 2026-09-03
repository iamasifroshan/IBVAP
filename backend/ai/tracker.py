"""
TrackRegistry — In-memory lifecycle manager for ByteTrack track objects.
Manages state transitions: new → active → lost for each camera feed.

ByteTrack assigns IDs from a SHARED counter for all classes in one session.
A person and a car in the same frame CAN receive the same raw integer ID.

Solution: two separate stores inside TrackRegistry:
  _store         → person/human tracks   → labelled TRK#N
  _vehicle_store → vehicle tracks        → labelled VTRK#N

No integer offset is needed — the stores are logically isolated. The label
prefix makes display ambiguity impossible.
"""

import time
from collections import Counter
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
from config import settings


class TrackState(str, Enum):
    NEW = "new"
    ACTIVE = "active"
    LOST = "lost"


@dataclass
class TrackRecord:
    """
    Represents a single tracked object's complete lifecycle record.
    track_id is the real ByteTrack integer ID — never randomly generated.
    """
    camera_id: str
    track_id: int                          # Real ByteTrack integer ID
    fine_class: str                        # e.g. person, car, bus
    object_type: str                       # coarse: human / vehicle / animal

    # Lifecycle state
    state: TrackState = TrackState.NEW

    # Confidence
    confidence_max: float = 0.0
    confidence_last: float = 0.0

    # Bounding box (normalized 0..1)
    bounding_box: Dict[str, float] = field(default_factory=dict)
    bbox_history: List[Dict[str, float]] = field(default_factory=list)

    # Frame counters
    frame_first: int = 0
    frame_last: int = 0
    frames_seen: int = 0

    # Wall-clock timestamps
    timestamp_first: float = field(default_factory=time.time)
    timestamp_last: float = field(default_factory=time.time)

    # Track video timestamps (seconds into video)
    video_ts_first: float = 0.0
    video_ts_last: float = 0.0

    # Frames without detection before marking lost
    lost_threshold: int = 5
    frames_since_last_seen: int = 0

    # Face identity & temporal smoothing state (persons only)
    identity_person_id: Optional[str] = None
    identity_name: Optional[str] = None
    identity_code: Optional[str] = None
    identity_confidence: float = 0.0
    recognition_confidence: float = 0.0
    face_detection_confidence: float = 0.0
    identity_confidence_level: str = "UNKNOWN"
    identity_status: str = "FACE_UNAVAILABLE"
    identity_grace_counter: int = 0
    face_info: Optional[dict] = None

    # ── Vehicle-specific fields ───────────────────────────────────────────────
    # Smoothed vehicle class (majority vote over vehicle_class_history)
    vehicle_class: Optional[str] = None
    # Raw per-frame class observations for temporal smoothing
    vehicle_class_history: List[str] = field(default_factory=list)
    # Track centre history for direction computation [(cx, cy), ...]
    center_history: List[Tuple[float, float]] = field(default_factory=list)
    # Human-readable direction label
    direction: str = "unknown"

    # ── ANPR / License Plate fields ──────────────────────────────────────────
    plate_text: Optional[str] = None
    raw_ocr_text: Optional[str] = None
    plate_confidence: float = 0.0
    format_valid: bool = False
    plate_stable: bool = False
    ocr_history: List[Tuple[str, float]] = field(default_factory=list)

    def update(
        self,
        frame_index: int,
        confidence: float,
        bounding_box: Dict[str, float],
        video_ts: float = 0.0
    ):
        """Update track with a new detection hit."""
        self.frame_last = frame_index
        self.confidence_last = confidence
        self.confidence_max = max(self.confidence_max, confidence)
        
        # EMA Bounding Box Smoothing
        alpha = 0.4
        self.bounding_box = {
            "x": round(alpha * bounding_box["x"] + (1 - alpha) * self.bounding_box["x"], 4),
            "y": round(alpha * bounding_box["y"] + (1 - alpha) * self.bounding_box["y"], 4),
            "width": round(alpha * bounding_box["width"] + (1 - alpha) * self.bounding_box["width"], 4),
            "height": round(alpha * bounding_box["height"] + (1 - alpha) * self.bounding_box["height"], 4)
        }
        
        # Keep last 15 raw bboxes
        self.bbox_history.append(bounding_box.copy())
        if len(self.bbox_history) > 15:
            self.bbox_history.pop(0)
        
        # Track centre history for direction (vehicle)
        cx = round(bounding_box["x"] + bounding_box["width"] / 2, 4)
        cy = round(bounding_box["y"] + bounding_box["height"] / 2, 4)
        self.center_history.append((cx, cy))
        if len(self.center_history) > 15:
            self.center_history.pop(0)

        self.timestamp_last = time.time()
        self.video_ts_last = video_ts
        self.frames_seen += 1
        self.frames_since_last_seen = 0

        # Promote to active once seen more than once
        if self.state == TrackState.NEW and self.frames_seen > 1:
            self.state = TrackState.ACTIVE

    def update_vehicle_class(self, raw_class: str, window: int = 7):
        """
        Temporal class smoothing via majority vote.
        Prevents single noisy frames from changing the displayed vehicle type.
        Example: [car, car, car, truck, car] → car
        """
        self.vehicle_class_history.append(raw_class)
        if len(self.vehicle_class_history) > window:
            self.vehicle_class_history.pop(0)
        counts = Counter(self.vehicle_class_history)
        self.vehicle_class = counts.most_common(1)[0][0]

    def compute_direction(self) -> str:
        """
        Derive movement direction from recent centre history.
        Uses displacement over the last ~4 frames for stability.
        Does NOT claim km/h — no camera calibration exists.
        Returns: stationary | left | right | inbound | outbound | unknown
        """
        if len(self.center_history) < 4:
            return "unknown"
        oldest = self.center_history[-4]
        newest = self.center_history[-1]
        dx = newest[0] - oldest[0]
        dy = newest[1] - oldest[1]
        if abs(dx) < 0.008 and abs(dy) < 0.008:
            return "stationary"
        if abs(dx) >= abs(dy):
            return "left" if dx < 0 else "right"
        return "inbound" if dy > 0 else "outbound"

    def update_face_identity(self, face_dict: Optional[Dict[str, Any]], grace_limit: int):
        if face_dict and face_dict.get("recognized"):
            self.identity_person_id = face_dict.get("person_id")
            self.identity_name = face_dict.get("name")
            self.identity_code = face_dict.get("identity_code")
            self.identity_confidence = face_dict.get("recognition_confidence", face_dict.get("confidence", 0.0))
            self.recognition_confidence = self.identity_confidence
            self.face_detection_confidence = face_dict.get("face_detection_confidence", 0.0)
            self.identity_confidence_level = face_dict.get("confidence_level", "HIGH")
            self.identity_status = "KNOWN"
            self.identity_grace_counter = 0
            self.face_info = face_dict
        elif self.identity_person_id is not None:
            # We have a known identity, but this frame didn't recognize it. Use grace period.
            self.identity_grace_counter += 1
            if self.identity_grace_counter <= grace_limit:
                # Retain known identity during grace period
                self.face_info = {
                    "recognized": True,
                    "person_id": self.identity_person_id,
                    "name": self.identity_name,
                    "identity_code": self.identity_code,
                    "confidence": self.identity_confidence,
                    "recognition_confidence": self.identity_confidence,
                    "face_detection_confidence": face_dict.get("face_detection_confidence", 0.0) if face_dict else 0.0,
                    "confidence_level": self.identity_confidence_level,
                    "identity_status": "KNOWN",
                    "bounding_box": face_dict.get("bounding_box") if (face_dict and face_dict.get("bounding_box")) else (self.face_info.get("bounding_box") if self.face_info else None)
                }
            else:
                # Grace period expired — clear identity
                self.clear_identity()
                if face_dict is not None:
                    self.face_info = face_dict
                    self.identity_status = face_dict.get("identity_status", "UNKNOWN")
                else:
                    self.clear_identity()
        elif face_dict is not None:
            # New face observation provided (UNKNOWN or FACE_PROCESSING_ERROR)
            self.face_info = face_dict
            self.identity_status = face_dict.get("identity_status", "UNKNOWN" if not face_dict.get("recognized") else "KNOWN")
            self.identity_confidence = face_dict.get("recognition_confidence", face_dict.get("confidence", 0.0))
            self.recognition_confidence = self.identity_confidence
            self.face_detection_confidence = face_dict.get("face_detection_confidence", 0.0)
            self.identity_grace_counter = 0
        elif self.face_info is not None and self.identity_status == "UNKNOWN":
            # We had an UNKNOWN identity from a recent frame, use grace period
            self.identity_grace_counter += 1
            if self.identity_grace_counter <= grace_limit:
                # Retain UNKNOWN face_info during grace period
                pass
            else:
                self.clear_identity()
        else:
            # No face detected & no active identity
            self.clear_identity()

    def clear_identity(self):
        """Clears all face recognition identity state for this track."""
        self.identity_person_id = None
        self.identity_name = "UNKNOWN"
        self.identity_code = None
        self.identity_confidence = 0.0
        self.recognition_confidence = 0.0
        self.face_detection_confidence = 0.0
        self.identity_confidence_level = "UNKNOWN"
        self.identity_status = "FACE_UNAVAILABLE"
        self.identity_grace_counter = 0
        self.face_info = None

    def increment_miss(self):
        """Called each frame this track was NOT detected."""
        self.frames_since_last_seen += 1
        if self.frames_since_last_seen >= self.lost_threshold:
            self.state = TrackState.LOST
            self.clear_identity()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "camera_id": self.camera_id,
            "track_id": self.track_id,
            "fine_class": self.fine_class,
            "object_type": self.object_type,
            "state": self.state.value,
            "confidence_max": round(self.confidence_max, 3),
            "confidence_last": round(self.confidence_last, 3),
            "bounding_box": self.bounding_box,
            "frame_first": self.frame_first,
            "frame_last": self.frame_last,
            "frames_seen": self.frames_seen,
            "video_ts_first_sec": round(self.video_ts_first, 2),
            "video_ts_last_sec": round(self.video_ts_last, 2),
            "face": self.face_info,
        }

    def update_vehicle_plate(
        self,
        raw_ocr: str,
        normalized_text: str,
        confidence: float,
        format_valid: bool,
    ):
        """
        Update vehicle plate observation with temporal OCR stabilization.
        Appends observation to ocr_history and stabilizes plate reading.
        """
        if not normalized_text:
            return

        self.ocr_history.append((normalized_text, confidence))
        if len(self.ocr_history) > 10:
            self.ocr_history.pop(0)

        from ai.anpr_engine import anpr_engine
        stable_text, avg_conf, is_stable = anpr_engine.stabilize_ocr(
            self.ocr_history, window=settings.OCR_STABILITY_WINDOW
        )

        if stable_text:
            self.plate_text = stable_text
            self.raw_ocr_text = raw_ocr or stable_text
            self.plate_confidence = avg_conf
            self.format_valid = anpr_engine.validate_indian_plate_format(stable_text)
            self.plate_stable = is_stable

    def to_vehicle_dict(self) -> Dict[str, Any]:
        """Serialise a vehicle track for API responses."""
        self.direction = self.compute_direction()
        return {
            "camera_id": self.camera_id,
            "track_id": self.track_id,
            "track_label": f"VTRK#{self.track_id}",
            "fine_class": self.fine_class,
            "vehicle_class": self.vehicle_class or self.fine_class,
            "object_type": "vehicle",
            "state": self.state.value,
            "confidence_max": round(self.confidence_max, 3),
            "confidence_last": round(self.confidence_last, 3),
            "bounding_box": self.bounding_box,
            "frames_seen": self.frames_seen,
            "direction": self.direction,
            "timestamp_first": round(self.timestamp_first, 2),
            "timestamp_last": round(self.timestamp_last, 2),
            # ANPR fields
            "plate_text": self.plate_text,
            "raw_ocr_text": self.raw_ocr_text,
            "plate_confidence": self.plate_confidence,
            "format_valid": self.format_valid,
            "plate_stable": self.plate_stable,
        }


class TrackRegistry:
    """
    Per-camera in-memory track store.

    Architecture:
      _store         → { camera_id: { track_id: TrackRecord } }  — HUMAN/PERSON tracks
      _vehicle_store → { camera_id: { track_id: TrackRecord } }  — VEHICLE tracks

    ByteTrack uses a SHARED ID counter for all object classes in one session.
    A person and a vehicle CAN receive the same raw integer track_id.
    They are kept in entirely separate stores so there is NO integer collision.

    Label convention:
      Person  → TRK#N   (from _store)
      Vehicle → VTRK#N  (from _vehicle_store)
    """

    def __init__(self):
        # Human / person track store  →  TRK#N
        self._store: Dict[str, Dict[int, TrackRecord]] = {}
        # Vehicle track store         →  VTRK#N
        self._vehicle_store: Dict[str, Dict[int, TrackRecord]] = {}

    # ── Internal store helpers ────────────────────────────────────────────────

    def _get_camera_store(self, camera_id: str) -> Dict[int, TrackRecord]:
        """Return the PERSON store for a camera (creates if absent)."""
        if camera_id not in self._store:
            self._store[camera_id] = {}
        return self._store[camera_id]

    def _get_vehicle_camera_store(self, camera_id: str) -> Dict[int, TrackRecord]:
        """Return the VEHICLE store for a camera (creates if absent)."""
        if camera_id not in self._vehicle_store:
            self._vehicle_store[camera_id] = {}
        return self._vehicle_store[camera_id]

    # ── Camera lifecycle ──────────────────────────────────────────────────────

    def clear_camera(self, camera_id: str):
        """Reset ALL tracks (person + vehicle) for a camera before a new processing run."""
        self._store[camera_id] = {}
        self._vehicle_store[camera_id] = {}

    # ── Person / human track operations ──────────────────────────────────────

    def update_track(
        self,
        camera_id: str,
        track_id: int,
        fine_class: str,
        object_type: str,
        confidence: float,
        bounding_box: Dict[str, float],
        frame_index: int,
        video_ts: float = 0.0
    ):
        """
        Upsert a PERSON track with fresh detection data from ByteTrack.
        Creates a new TrackRecord if this track_id hasn't been seen before.
        """
        store = self._get_camera_store(camera_id)

        if track_id not in store:
            record = TrackRecord(
                camera_id=camera_id,
                track_id=track_id,
                fine_class=fine_class,
                object_type=object_type,
                state=TrackState.NEW,
                confidence_max=confidence,
                confidence_last=confidence,
                bounding_box=bounding_box,
                frame_first=frame_index,
                frame_last=frame_index,
                frames_seen=1,
                frames_since_last_seen=0,
                video_ts_first=video_ts,
                video_ts_last=video_ts,
            )
            store[track_id] = record
        else:
            store[track_id].update(frame_index, confidence, bounding_box, video_ts)

    def mark_lost(self, camera_id: str, active_track_ids_this_frame: List[int]):
        """
        For each PERSON track not seen in this frame, increment miss counter.
        Marks as LOST after lost_threshold consecutive misses.
        """
        store = self._get_camera_store(camera_id)
        active_set = set(active_track_ids_this_frame)
        for tid, record in store.items():
            if tid not in active_set and record.state != TrackState.LOST:
                record.increment_miss()

    def get_all_tracks(self, camera_id: str) -> List[Dict[str, Any]]:
        """Return all PERSON tracks (new, active, lost) for a camera."""
        store = self._get_camera_store(camera_id)
        return [r.to_dict() for r in store.values()]

    def get_active_tracks(self, camera_id: str) -> List[Dict[str, Any]]:
        """Return only new + active PERSON tracks for a camera."""
        store = self._get_camera_store(camera_id)
        return [
            r.to_dict() for r in store.values()
            if r.state in (TrackState.NEW, TrackState.ACTIVE)
        ]

    def get_track_count(self, camera_id: str) -> Dict[str, int]:
        store = self._get_camera_store(camera_id)
        new_count = sum(1 for r in store.values() if r.state == TrackState.NEW)
        active_count = sum(1 for r in store.values() if r.state == TrackState.ACTIVE)
        lost_count = sum(1 for r in store.values() if r.state == TrackState.LOST)
        return {
            "new": new_count,
            "active": active_count,
            "lost": lost_count,
            "total": len(store)
        }

    # ── Vehicle track operations ──────────────────────────────────────────────

    def update_vehicle_track(
        self,
        camera_id: str,
        track_id: int,
        fine_class: str,
        confidence: float,
        bounding_box: Dict[str, float],
        frame_index: int,
        video_ts: float = 0.0,
        smoothing_window: int = 7,
    ):
        """
        Upsert a VEHICLE track in the separate vehicle store.
        Applies temporal class smoothing and direction tracking.
        This method NEVER touches the person store.
        """
        store = self._get_vehicle_camera_store(camera_id)

        if track_id not in store:
            record = TrackRecord(
                camera_id=camera_id,
                track_id=track_id,
                fine_class=fine_class,
                object_type="vehicle",
                state=TrackState.NEW,
                confidence_max=confidence,
                confidence_last=confidence,
                bounding_box=bounding_box,
                frame_first=frame_index,
                frame_last=frame_index,
                frames_seen=1,
                frames_since_last_seen=0,
                vehicle_class=fine_class,
                video_ts_first=video_ts,
                video_ts_last=video_ts,
            )
            record.vehicle_class_history = [fine_class]
            record.center_history = [(
                round(bounding_box["x"] + bounding_box["width"] / 2, 4),
                round(bounding_box["y"] + bounding_box["height"] / 2, 4),
            )]
            store[track_id] = record
        else:
            rec = store[track_id]
            rec.update(frame_index, confidence, bounding_box, video_ts)
            rec.update_vehicle_class(fine_class, smoothing_window)
            rec.fine_class = rec.vehicle_class or fine_class  # keep fine_class in sync

    def mark_vehicle_lost(self, camera_id: str, active_vehicle_ids_this_frame: List[int]):
        """
        For each VEHICLE track not seen in this frame, increment miss counter.
        Completely separate from person track lifecycle.
        """
        store = self._get_vehicle_camera_store(camera_id)
        active_set = set(active_vehicle_ids_this_frame)
        for tid, record in store.items():
            if tid not in active_set and record.state != TrackState.LOST:
                record.increment_miss()

    def get_active_vehicle_tracks(self, camera_id: str) -> List[Dict[str, Any]]:
        """Return only new + active VEHICLE tracks for a camera as API dicts."""
        store = self._get_vehicle_camera_store(camera_id)
        return [
            r.to_vehicle_dict() for r in store.values()
            if r.state in (TrackState.NEW, TrackState.ACTIVE)
        ]

    def get_all_vehicle_tracks(self, camera_id: str) -> List[Dict[str, Any]]:
        """Return all VEHICLE tracks (new, active, lost) for a camera."""
        store = self._get_vehicle_camera_store(camera_id)
        return [r.to_vehicle_dict() for r in store.values()]

    def get_vehicle_stats_all_cameras(self) -> Dict[str, Any]:
        """
        Aggregate vehicle statistics across ALL cameras.
        Returns real counts from in-memory state — never hardcoded.
        """
        total = 0
        by_class: Dict[str, int] = {"car": 0, "motorcycle": 0, "bus": 0, "truck": 0}
        by_camera: Dict[str, int] = {}

        for camera_id, store in self._vehicle_store.items():
            active = [
                r for r in store.values()
                if r.state in (TrackState.NEW, TrackState.ACTIVE)
            ]
            count = len(active)
            total += count
            by_camera[camera_id] = count
            for r in active:
                cls = r.vehicle_class or r.fine_class or "unknown"
                if cls in by_class:
                    by_class[cls] += 1

        return {
            "total": total,
            "car": by_class["car"],
            "motorcycle": by_class["motorcycle"],
            "bus": by_class["bus"],
            "truck": by_class["truck"],
            "by_camera": by_camera,
        }


# Global singleton track registry
track_registry = TrackRegistry()
