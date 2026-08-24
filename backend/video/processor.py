import cv2
import os
import time
from typing import Dict, Any

class VideoProcessor:
    @staticmethod
    def inspect_and_process_video(file_path: str) -> Dict[str, Any]:
        """
        Opens an MP4 video file using OpenCV and extracts real frame metadata:
        - frame_number / total_frames
        - fps
        - width
        - height
        - duration_sec
        - sampled_frames_read
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Video file not found at path: {file_path}")

        # Open video capture with OpenCV
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            raise ValueError(f"OpenCV failed to open video file '{file_path}'. File may be invalid, corrupted, or unsupported.")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration_sec = round(total_frames / fps, 2) if fps > 0 else 0.0

        if total_frames <= 0 or width <= 0 or height <= 0:
            cap.release()
            raise ValueError("OpenCV extracted invalid video dimensions or zero frames. Unsupported or empty video file.")

        # Read frames sequentially to verify readability
        frames_read = 0
        max_sample_frames = min(50, total_frames)
        last_timestamp_ms = 0.0

        while cap.isOpened() and frames_read < max_sample_frames:
            ret, frame = cap.read()
            if not ret or frame is None:
                break
            frames_read += 1
            last_timestamp_ms = cap.get(cv2.CAP_PROP_POS_MSEC)

        cap.release()

        # Run EnviroVision Image Quality & Environmental Analysis
        from ai.enviro_vision import enviro_vision
        enviro_meta = enviro_vision.analyze_video_sample(file_path)

        return {
            "fps": round(fps, 2),
            "width": width,
            "height": height,
            "total_frames": total_frames,
            "duration_sec": duration_sec,
            "sampled_frames_read": frames_read,
            "last_timestamp_ms": round(last_timestamp_ms, 2),
            "status": "processed",
            "resolution": f"{width}x{height}",
            "environment": enviro_meta
        }
