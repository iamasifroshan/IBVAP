import os
import cv2
import time
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("ibvap.ai")


class YoloDetector:
    """
    YOLOv8 Object Detector + ByteTrack Multi-Object Tracker for IBVAP.
    Uses 'yolov8n.pt' (Nano model) for CPU inference on laptops.
    Tracking uses Ultralytics built-in ByteTrack via model.track().
    """

    def __init__(self, model_name: str = "yolov8n.pt", default_conf: float = 0.35):
        self.model_name = model_name
        self.default_conf = default_conf
        self.model = None
        self._is_loaded = False

    def load_model(self):
        if self._is_loaded and self.model is not None:
            return
        try:
            from ultralytics import YOLO
            logger.info(f"Loading YOLO model '{self.model_name}'...")
            self.model = YOLO(self.model_name)
            self._is_loaded = True
            logger.info("YOLO model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            raise RuntimeError(f"YOLO initialization error: {e}")

    # COCO coarse class mapping (person, vehicle, animal)
    COCO_MAP = {
        0: "human",       # person
        1: "vehicle",     # bicycle
        2: "vehicle",     # car
        3: "vehicle",     # motorcycle
        5: "vehicle",     # bus
        7: "vehicle",     # truck
        15: "animal",     # cat
        16: "animal",     # dog
        17: "animal",     # horse
        18: "animal",     # sheep
        19: "animal",     # cow
    }

    # Fine-grained COCO class names
    FINE_CLASS_NAMES = {
        0: "person",
        1: "bicycle",
        2: "car",
        3: "motorcycle",
        5: "bus",
        7: "truck",
        15: "cat",
        16: "dog",
        17: "horse",
        18: "sheep",
        19: "cow",
    }

    def _resolve_path(self, file_path: str) -> str:
        """Resolve relative paths to absolute, with fallback to storage dir."""
        resolved = file_path
        if not os.path.isabs(resolved):
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            resolved = os.path.normpath(os.path.join(base_dir, file_path))

        if not os.path.exists(resolved):
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            alt = os.path.normpath(
                os.path.join(base_dir, "storage", "videos", os.path.basename(file_path))
            )
            if os.path.exists(alt):
                return alt
            raise FileNotFoundError(
                f"Video file not found at: '{file_path}' or '{resolved}'"
            )
        return resolved

    # ─────────────────────────────────────────────────────────────────────────
    # Legacy: single-frame detection (no tracking)
    # ─────────────────────────────────────────────────────────────────────────

    def detect_frame(
        self, frame: Any, conf_threshold: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """
        Runs real YOLO inference on a single BGR image frame (no tracking).
        Returns detection dicts without track IDs.
        """
        self.load_model()
        conf = conf_threshold if conf_threshold is not None else self.default_conf
        h, w = frame.shape[:2]

        results = self.model.predict(frame, conf=conf, verbose=False)
        detections = []
        if not results or len(results) == 0:
            return detections

        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return detections

        for box in boxes:
            cls_id = int(box.cls[0].item())
            if cls_id not in self.FINE_CLASS_NAMES:
                continue
            confidence = float(box.conf[0].item())
            fine_name = self.FINE_CLASS_NAMES[cls_id]
            coarse_type = self.COCO_MAP.get(cls_id, "unknown")
            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = xyxy
            norm_x = round(max(0.0, min(1.0, x1 / w)), 4)
            norm_y = round(max(0.0, min(1.0, y1 / h)), 4)
            norm_w = round(max(0.0, min(1.0, (x2 - x1) / w)), 4)
            norm_h = round(max(0.0, min(1.0, (y2 - y1) / h)), 4)
            detections.append({
                "fine_class": fine_name,
                "object_type": coarse_type,
                "confidence": round(confidence, 3),
                "bounding_box": {"x": norm_x, "y": norm_y, "width": norm_w, "height": norm_h},
                "bbox_pixels": {"x1": round(x1, 1), "y1": round(y1, 1), "x2": round(x2, 1), "y2": round(y2, 1)},
            })
        return detections

    # ─────────────────────────────────────────────────────────────────────────
    # NEW: Per-frame tracking (ByteTrack) — extracts real track IDs
    # ─────────────────────────────────────────────────────────────────────────

    def track_frame(
        self, frame: Any, conf_threshold: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """
        Runs YOLO + ByteTrack on a single frame.
        Returns detection dicts WITH real integer track_id from ByteTrack.
        model.track(persist=True) maintains tracker state across consecutive calls.
        """
        self.load_model()
        conf = conf_threshold if conf_threshold is not None else self.default_conf
        h, w = frame.shape[:2]

        # persist=True keeps ByteTrack state between consecutive frame calls
        results = self.model.track(
            frame,
            conf=conf,
            persist=True,
            tracker="bytetrack.yaml",
            verbose=False
        )
        detections = []
        if not results or len(results) == 0:
            return detections

        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return detections

        for box in boxes:
            cls_id = int(box.cls[0].item())
            if cls_id not in self.FINE_CLASS_NAMES:
                continue

            confidence = float(box.conf[0].item())
            fine_name = self.FINE_CLASS_NAMES[cls_id]
            coarse_type = self.COCO_MAP.get(cls_id, "unknown")

            # Real ByteTrack integer ID — None if tracker hasn't assigned one yet
            track_id: Optional[int] = None
            if box.id is not None and len(box.id) > 0:
                track_id = int(box.id[0].item())

            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = xyxy
            norm_x = round(max(0.0, min(1.0, x1 / w)), 4)
            norm_y = round(max(0.0, min(1.0, y1 / h)), 4)
            norm_w = round(max(0.0, min(1.0, (x2 - x1) / w)), 4)
            norm_h = round(max(0.0, min(1.0, (y2 - y1) / h)), 4)

            detections.append({
                "track_id": track_id,
                "fine_class": fine_name,
                "object_type": coarse_type,
                "confidence": round(confidence, 3),
                "bounding_box": {"x": norm_x, "y": norm_y, "width": norm_w, "height": norm_h},
                "bbox_pixels": {"x1": round(x1, 1), "y1": round(y1, 1), "x2": round(x2, 1), "y2": round(y2, 1)},
            })

        return detections

    # ─────────────────────────────────────────────────────────────────────────
    # MAIN: Full video processing with ByteTrack tracking
    # ─────────────────────────────────────────────────────────────────────────

    def process_video_with_tracking(
        self,
        file_path: str,
        camera_id: str,
        conf_threshold: float = 0.35,
        frame_stride: int = 2,
        max_frames: int = 150,
    ) -> Dict[str, Any]:
        """
        Process an MP4 video file with real ByteTrack multi-object tracking.

        Pipeline:
          OpenCV VideoCapture
          → frame-by-frame
          → YOLO + ByteTrack (persist=True)
          → real integer Track IDs assigned
          → TrackRegistry updated (new / active / lost)
          → all detections + track summaries returned

        Returns:
          detections: raw per-frame detections with track_id
          tracks: summarised track records with lifecycle state
        """
        from ai.tracker import track_registry, TrackState

        resolved_path = self._resolve_path(file_path)

        cap = cv2.VideoCapture(resolved_path)
        if not cap.isOpened():
            raise ValueError(f"OpenCV failed to open video: '{resolved_path}'")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Reset tracker state for this camera run
        self.load_model()
        self.model.predictor = None  # force tracker re-init so IDs start fresh
        track_registry.clear_camera(camera_id)

        all_detections: List[Dict[str, Any]] = []
        processed_count = 0
        frame_index = 0
        start_time = time.time()

        while cap.isOpened() and frame_index < total_frames and processed_count < max_frames:
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            if frame_index % frame_stride == 0:
                timestamp_sec = round(frame_index / fps, 2)
                frame_dets = self.track_frame(frame, conf_threshold=conf_threshold)

                active_ids_this_frame: List[int] = []

                for det in frame_dets:
                    tid = det["track_id"]
                    if tid is not None:
                        active_ids_this_frame.append(tid)
                        track_registry.update_track(
                            camera_id=camera_id,
                            track_id=tid,
                            fine_class=det["fine_class"],
                            object_type=det["object_type"],
                            confidence=det["confidence"],
                            bounding_box=det["bounding_box"],
                            frame_index=frame_index,
                            video_ts=timestamp_sec,
                        )

                    all_detections.append({
                        "camera_id": camera_id,
                        "frame_index": frame_index,
                        "timestamp_sec": timestamp_sec,
                        "track_id": tid,
                        "fine_class": det["fine_class"],
                        "object_type": det["object_type"],
                        "confidence": det["confidence"],
                        "bounding_box": det["bounding_box"],
                        "bbox_pixels": det["bbox_pixels"],
                    })

                # Update lifecycle for tracks NOT seen this frame
                track_registry.mark_lost(camera_id, active_ids_this_frame)
                processed_count += 1

            frame_index += 1

        cap.release()
        elapsed_sec = round(time.time() - start_time, 2)

        tracks = track_registry.get_all_tracks(camera_id)
        track_counts = track_registry.get_track_count(camera_id)

        return {
            "camera_id": camera_id,
            "video_path": file_path,
            "total_video_frames": total_frames,
            "frames_analyzed": processed_count,
            "stride_used": frame_stride,
            "elapsed_sec": elapsed_sec,
            "detections_count": len(all_detections),
            "detections": all_detections,
            "tracks": tracks,
            "track_counts": track_counts,
        }

    # Legacy method kept for backward compatibility
    def process_video(
        self,
        file_path: str,
        camera_id: str,
        conf_threshold: float = 0.35,
        frame_stride: int = 2,
        max_frames: int = 150,
    ) -> Dict[str, Any]:
        """
        Backward-compatible wrapper — now delegates to process_video_with_tracking.
        """
        return self.process_video_with_tracking(
            file_path=file_path,
            camera_id=camera_id,
            conf_threshold=conf_threshold,
            frame_stride=frame_stride,
            max_frames=max_frames,
        )

    def process_frames_with_tracking(
        self,
        frames_with_indices: list,
        camera_id: str,
        conf_threshold: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Run YOLO + ByteTrack on pre-captured list of (frame_index, frame_bgr) tuples.
        Used by WEBCAM and RTSP sources where frames were already extracted by StreamSourceManager.
        Returns same format as process_video_with_tracking.
        """
        from ai.tracker import track_registry
        self.load_model()
        conf = conf_threshold or self.default_conf

        all_detections = []
        fps_approx = 30.0

        # Clear previous tracks for this camera before processing
        track_registry.clear_camera(camera_id)

        for frame_index, frame in frames_with_indices:
            if frame is None:
                continue
            timestamp_sec = round(frame_index / fps_approx, 3)

            frame_dets = self.track_frame(frame, conf_threshold=conf)
            active_ids = []
            for det in frame_dets:
                det["frame_index"] = frame_index
                det["timestamp_sec"] = timestamp_sec
                det["camera_id"] = camera_id
                all_detections.append(det)

                tid = det.get("track_id")
                if tid is not None:
                    active_ids.append(tid)
                    track_registry.update_track(
                        camera_id=camera_id,
                        track_id=tid,
                        fine_class=det["fine_class"],
                        object_type=det["object_type"],
                        confidence=det["confidence"],
                        bounding_box=det["bounding_box"],
                        frame_index=frame_index,
                        video_ts=timestamp_sec,
                    )
            track_registry.mark_lost(camera_id, active_ids)

        tracks = track_registry.get_all_tracks(camera_id)

        return {
            "detections": all_detections,
            "tracks": tracks,
            "fps": fps_approx,
            "total_frames_processed": len(frames_with_indices),
            "source": "live_frames"
        }


# Global singleton detector instance
detector_instance = YoloDetector()
