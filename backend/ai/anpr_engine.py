"""
ANPR Engine — Automatic Number Plate Recognition Subsystem.
Integrates directly with IBVAP TrackRegistry (VTRK# vehicle tracks).

Architecture Pipeline:
  Vehicle Bbox ROI -> OpenCV Plate Localization -> Preprocessing ->
  Character Segmentation & OCR -> Normalization -> Indian RTO Format Validation ->
  Temporal Sliding-Window Stabilization -> VTRK# Association

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
    Lightweight, high-performance OpenCV ANPR Engine.
    Localized plate detection + OCR + Indian plate validation + temporal stabilization.
    """

    def __init__(self):
        self._character_templates = self._build_character_templates()

    # ── Character Template Generator (OpenCV Synthesis) ─────────────────────
    def _build_character_templates(self) -> Dict[str, np.ndarray]:
        """
        Synthesize standard 28x20 binary character templates for A-Z, 0-9.
        Enables deterministic character recognition without extra heavy OCR weight files.
        """
        chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        templates = {}
        for c in chars:
            img = np.zeros((32, 24), dtype=np.uint8)
            # Render character centered in white on black background
            cv2.putText(
                img, c, (4, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 255, 2, cv2.LINE_AA
            )
            # Crop non-zero box to normalize template size
            coords = cv2.findNonZero(img)
            if coords is not None:
                x, y, w, h = cv2.boundingRect(coords)
                cropped = img[y : y + h, x : x + w]
                resized = cv2.resize(cropped, (20, 28))
                templates[c] = resized
            else:
                templates[c] = cv2.resize(img, (20, 28))
        return templates

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

    # ── Plate Localization (OpenCV Morphological & Edge Analysis) ────────────
    def detect_plate_region(
        self, vehicle_crop: np.ndarray
    ) -> Optional[Tuple[np.ndarray, Tuple[int, int, int, int], float]]:
        """
        Locate the license plate candidate within the vehicle crop ROI.
        Plates are typically located in the lower portion of vehicles with 2.5:1 - 5.5:1 aspect ratios.
        Returns: (plate_crop, (px, py, pw, ph), confidence) or None
        """
        if vehicle_crop is None or vehicle_crop.size == 0:
            return None

        vh, vw = vehicle_crop.shape[:2]
        if vh < 30 or vw < 40:
            return None

        # Focus on lower 65% of vehicle crop where number plates are installed
        roi_top = int(vh * 0.35)
        roi = vehicle_crop[roi_top:vh, 0:vw]
        roi_h, roi_w = roi.shape[:2]

        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)

        # Sobel vertical edge detection (plates have high vertical edge density)
        sobel_x = cv2.Sobel(blur, cv2.CV_8U, 1, 0, ksize=3)
        _, thresh = cv2.threshold(sobel_x, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Morphological closing to connect horizontal plate region
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(
            closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        candidates = []
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            if h == 0 or w == 0:
                continue

            aspect_ratio = w / float(h)
            area = w * h
            roi_area = roi_w * roi_h

            # License plate aspect ratio check (typically 2.2 to 6.0)
            if 2.2 <= aspect_ratio <= 6.0 and (0.005 * roi_area <= area <= 0.25 * roi_area):
                # Calculate edge density inside bounding rect
                rect_roi = gray[y : y + h, x : x + w]
                if rect_roi.size > 0:
                    mean_val = float(np.mean(rect_roi))
                    std_val = float(np.std(rect_roi))
                    # Score based on contrast and aspect ratio fit
                    score = min(1.0, (std_val / 64.0) * 0.7 + (aspect_ratio / 4.5) * 0.3)
                    candidates.append((score, (x, y + roi_top, w, h)))

        if not candidates:
            return None

        # Pick candidate with highest score
        candidates.sort(key=lambda item: item[0], reverse=True)
        best_score, (px, py, pw, ph) = candidates[0]

        if best_score < settings.PLATE_CONFIDENCE_THRESHOLD:
            return None

        plate_crop = vehicle_crop[py : py + ph, px : px + pw]
        return plate_crop, (px, py, pw, ph), best_score

    # ── Character Segmentation & Template OCR ────────────────────────────────
    def run_ocr(
        self, plate_crop: np.ndarray
    ) -> Tuple[str, str, float]:
        """
        Segment characters from plate candidate crop and perform OCR matching.
        Returns: (raw_ocr_text, normalized_text, confidence)
        """
        if plate_crop is None or plate_crop.size == 0:
            return "", "", 0.0

        ph, pw = plate_crop.shape[:2]
        if ph < 12 or pw < 30:
            return "", "", 0.0

        gray = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (180, 50))
        h, w = gray.shape

        # Enhance contrast
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        # Otsu binarization
        _, binary = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # Find character contours
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        char_boxes = []
        for cnt in contours:
            cx, cy, cw, ch = cv2.boundingRect(cnt)
            # Character dimensions ratio check (height 40%-90% of plate, aspect ratio 0.15-0.9)
            if 0.35 * h <= ch <= 0.95 * h and 0.10 * w <= cw <= 0.35 * w:
                aspect = cw / float(ch)
                if 0.15 <= aspect <= 0.95:
                    char_boxes.append((cx, cy, cw, ch))

        # Sort characters left to right
        char_boxes.sort(key=lambda b: b[0])

        if len(char_boxes) < settings.OCR_MIN_CHARACTERS:
            return "", "", 0.0

        recognized_chars = []
        confidences = []

        for (cx, cy, cw, ch) in char_boxes:
            char_crop = binary[cy : cy + ch, cx : cx + cw]
            if char_crop.size == 0:
                continue
            char_resized = cv2.resize(char_crop, (20, 28))

            best_char = "?"
            best_sim = -1.0

            for char_label, template in self._character_templates.items():
                res = cv2.matchTemplate(char_resized, template, cv2.TM_CCOEFF_NORMED)
                _, max_val, _, _ = cv2.minMaxLoc(res)
                if max_val > best_sim:
                    best_sim = max_val
                    best_char = char_label

            if best_sim >= 0.35 and best_char != "?":
                recognized_chars.append(best_char)
                confidences.append(best_sim)

        raw_ocr = "".join(recognized_chars)
        normalized = self.normalize_plate(raw_ocr)
        avg_conf = float(np.mean(confidences)) if confidences else 0.0

        return raw_ocr, normalized, round(avg_conf, 3)

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
