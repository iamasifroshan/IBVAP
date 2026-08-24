"""
TrackRegistry — In-memory lifecycle manager for ByteTrack track objects.
Manages state transitions: new → active → lost for each camera feed.
"""

import time
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from enum import Enum


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
        self.bounding_box = bounding_box
        self.timestamp_last = time.time()
        self.video_ts_last = video_ts
        self.frames_seen += 1
        self.frames_since_last_seen = 0

        # Promote to active once seen more than once
        if self.state == TrackState.NEW and self.frames_seen > 1:
            self.state = TrackState.ACTIVE

    def increment_miss(self):
        """Called each frame this track was NOT detected."""
        self.frames_since_last_seen += 1
        if self.frames_since_last_seen >= self.lost_threshold:
            self.state = TrackState.LOST

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
        }


class TrackRegistry:
    """
    Per-camera in-memory track store.
    Manages all TrackRecord objects for each camera by their real ByteTrack ID.
    Thread-safe for single-process single-thread FastAPI usage.
    """

    def __init__(self):
        # { camera_id: { track_id: TrackRecord } }
        self._store: Dict[str, Dict[int, TrackRecord]] = {}

    def _get_camera_store(self, camera_id: str) -> Dict[int, TrackRecord]:
        if camera_id not in self._store:
            self._store[camera_id] = {}
        return self._store[camera_id]

    def clear_camera(self, camera_id: str):
        """Reset all tracks for a camera before a new processing run."""
        self._store[camera_id] = {}

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
        Upsert a track with fresh detection data from ByteTrack.
        Creates a new TrackRecord if this track_id hasn't been seen before.
        """
        store = self._get_camera_store(camera_id)

        if track_id not in store:
            # Brand new track
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
        For each existing track not seen in this frame, increment miss counter.
        Marks as LOST after lost_threshold consecutive misses.
        """
        store = self._get_camera_store(camera_id)
        active_set = set(active_track_ids_this_frame)
        for tid, record in store.items():
            if tid not in active_set and record.state != TrackState.LOST:
                record.increment_miss()

    def get_all_tracks(self, camera_id: str) -> List[Dict[str, Any]]:
        """Return all tracks (new, active, lost) for a camera."""
        store = self._get_camera_store(camera_id)
        return [r.to_dict() for r in store.values()]

    def get_active_tracks(self, camera_id: str) -> List[Dict[str, Any]]:
        """Return only new + active tracks for a camera."""
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


# Global singleton track registry
track_registry = TrackRegistry()
