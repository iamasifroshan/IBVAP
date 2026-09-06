"""
ANPR Engine — Automatic Number Plate Recognition Subsystem.
Integrates directly with IBVAP TrackRegistry (VTRK# vehicle tracks).

Architecture Pipeline:
  Vehicle Bbox ROI -> EasyOCR Plate Localization (CRAFT) & OCR -> Normalization ->
  Indian RTO Format Validation -> Temporal Sliding-Window Stabilization -> VTRK# Association

Zero Incident Safety:
  ANPR observations generate security intelligence ONLY.
  NEVER creates IncidentModel or EvidenceModel records.
"""

import re
import cv2
import numpy as np
import logging
from collections import Counter
from typing import Dict, List, Optional, Tuple, Any

from config import settings

logger = logging.getLogger(__name__)

# ── Indian Registration Plate Regular Expressions ──────────────────────────
# Standard RTO format: KA01AB1234, DL3C1234, MH12DE5678, HR26DQ5551, UP14ET8899
INDIAN_RTO_REGEX = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$")
# Bharat (BH) series format: 22BH1234AB
BH_SERIES_REGEX = re.compile(r"^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$")
# Military plate format: 22D123456A
MILITARY_REGEX = re.compile(r"^[0-9]{2}[A-Z][0-9]{5,6}[A-Z]$")


class ANPREngine:
    """
    High-performance ANPR Engine using EasyOCR.
    Localized plate detection + OCR + Indian plate validation + temporal stabilization.
    """

    def __init__(self):
        self.reader = None
        try:
            import easyocr
            # Initialize once in CPU mode
            self.reader = easyocr.Reader(['en'], gpu=False)
            logger.info("EasyOCR initialized successfully for ANPR Engine.")
        except ImportError:
            logger.error("EasyOCR package not found. ANPR functionality will be disabled.")
        except Exception as e:
            logger.error(f"Failed to initialize EasyOCR: {e}")

    # ── Plate Text Normalization ─────────────────────────────────────────────
    def normalize_plate(self, raw_text: str) -> str:
        """
        Standardize raw OCR output by uppercasing and stripping spaces, hyphens, and noise.
        Example: "KA-01 AB 1234" -> "KA01AB1234"
        Does NOT alter uncertain character identities.
        """
        if not raw_text:
            return ""
        cleaned = re.sub(r"[^A-Za-z0-9]", "", raw_text.strip().upper())
        return cleaned

    # ── Indian Registration Format Validation ────────────────────────────────
    def validate_indian_plate_format(self, plate_text: str) -> bool:
        """
        Validate whether normalized plate text matches valid Indian registration syntax.
        Matches:
          - Standard RTO: KA01AB1234, DL3C1234, MH12DE5678
          - Bharat Series: 22BH1234AB
          - Military Series: 22D123456A
        Returns boolean without mutating the plate text.
        """
        if not plate_text or len(plate_text) < settings.OCR_MIN_CHARACTERS:
            return False
        if len(plate_text) > settings.OCR_MAX_CHARACTERS:
            return False

        if INDIAN_RTO_REGEX.match(plate_text):
            return True
        if BH_SERIES_REGEX.match(plate_text):
            return True
        if MILITARY_REGEX.match(plate_text):
            return True

        return False

    # ── Process Vehicle Crop (Localization & OCR in one pass) ─────────────────
    def process_vehicle_crop(
        self, vehicle_crop: np.ndarray
    ) -> Optional[Tuple[Tuple[int, int, int, int], str, str, float]]:
        """
        Process the vehicle crop to locate the license plate and recognize text.
        Uses EasyOCR's text detection (CRAFT) and recognition.
        Returns: ((px, py, pw, ph), raw_ocr_text, normalized_text, confidence)
        """
        if self.reader is None:
            return None

        if vehicle_crop is None or vehicle_crop.size == 0:
            return None

        vh, vw = vehicle_crop.shape[:2]
        if vh < 30 or vw < 40:
            return None

        # Focus on lower 65% of vehicle crop where number plates are installed
        roi_top = int(vh * 0.35)
        roi = vehicle_crop[roi_top:vh, 0:vw]

        # Use EasyOCR to find all text in the ROI
        # detail=1 returns list of (bbox, text, prob)
        results = self.reader.readtext(roi, detail=1)

        if not results:
            return None

        candidates = []
        for bbox, text, prob in results:
            if not text:
                continue

            normalized = self.normalize_plate(text)
            if len(normalized) < settings.OCR_MIN_CHARACTERS:
                continue

            # Calculate box parameters
            # bbox is format: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
            pts = np.array(bbox, dtype=np.int32)
            bx, by, bw, bh = cv2.boundingRect(pts)
            
            # Filter by typical license plate aspect ratios
            aspect_ratio = bw / max(float(bh), 1.0)
            
            score = prob
            # Bonus if it matches Indian Plate format exactly
            if self.validate_indian_plate_format(normalized):
                score += 0.5 

            # Must have reasonable confidence and aspect ratio
            if prob >= 0.2 and 1.5 <= aspect_ratio <= 10.0:
                 # Map coordinates back to the full vehicle crop
                 candidates.append((score, (bx, by + roi_top, bw, bh), text, normalized, prob))

        if not candidates:
            return None

        # Pick candidate with highest score
        candidates.sort(key=lambda item: item[0], reverse=True)
        best_candidate = candidates[0]
        
        _, (px, py, pw, ph), raw_text, norm_text, confidence = best_candidate
        
        return ((px, py, pw, ph), raw_text, norm_text, round(float(confidence), 3))

    # ── Temporal OCR Stabilization (Sliding Window Majority Vote) ────────────
    def stabilize_ocr(
        self,
        ocr_history: List[Tuple[str, float]],
        window: int = 5
    ) -> Tuple[str, float, bool]:
        """
        Sliding-window temporal stabilization for per-track OCR observations.
        Prevents single noisy OCR frames from corrupting a stable plate reading.
        Returns: (stable_plate_text, average_confidence, is_stable)
        """
        if not ocr_history:
            return "", 0.0, False

        recent = ocr_history[-window:]
        valid_reads = [text for text, conf in recent if len(text) >= settings.OCR_MIN_CHARACTERS]

        if not valid_reads:
            return "", 0.0, False

        counts = Counter(valid_reads)
        most_common_text, freq = counts.most_common(1)[0]

        # Calculate average confidence for the most common reading
        confs = [conf for text, conf in recent if text == most_common_text]
        avg_conf = float(np.mean(confs)) if confs else 0.0

        # Stable if avg confidence passes threshold AND seen at least 2 times in window (or high confidence single read)
        is_stable = (avg_conf >= settings.OCR_CONFIDENCE_THRESHOLD) and (freq >= 2 or (freq == 1 and avg_conf >= 0.75 and len(most_common_text) >= 8))

        return most_common_text, round(avg_conf, 3), is_stable

    # ── Vehicle ↔ Plate Spatial Association ─────────────────────────────────
    def associate_plate_with_vehicle(
        self,
        vehicle_bbox: Dict[str, float],
        plate_bbox: Dict[str, float],
        min_iou: float = 0.30
    ) -> bool:
        """
        Verify spatial containment / overlap of plate bbox within vehicle bbox.
        Ensures plate reading is strictly bound to the correct vehicle track.
        """
        vx, vy, vw, vh = vehicle_bbox["x"], vehicle_bbox["y"], vehicle_bbox["width"], vehicle_bbox["height"]
        px, py, pw, ph = plate_bbox["x"], plate_bbox["y"], plate_bbox["width"], plate_bbox["height"]

        # Plate center must fall inside vehicle bounding box
        pcx = px + pw / 2.0
        pcy = py + ph / 2.0

        in_bounds = (vx <= pcx <= vx + vw) and (vy <= pcy <= vy + vh)
        return in_bounds


# Global singleton ANPR Engine
anpr_engine = ANPREngine()
