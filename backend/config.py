import os

class Settings:
    PROJECT_NAME: str = "IBVAP Backend"
    VERSION: str = "1.0.0-SIH"
    API_V1_STR: str = "/api/v1"
    _base_dir = os.path.dirname(os.path.abspath(__file__))
    _db_path = os.path.join(_base_dir, 'ibvap.db').replace('\\', '/')
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{_db_path}")
    STORAGE_DIR: str = os.getenv("STORAGE_DIR", os.path.normpath(os.path.join(_base_dir, "storage")))
    
    # Face Recognition Configurations
    FACE_RECOGNITION_THRESHOLD: float = float(os.getenv("FACE_RECOGNITION_THRESHOLD", "0.363"))
    FACE_RECOGNITION_HIGH_CONFIDENCE: float = float(os.getenv("FACE_RECOGNITION_HIGH_CONFIDENCE", "0.60"))
    FACE_RECOGNITION_MEDIUM_CONFIDENCE: float = float(os.getenv("FACE_RECOGNITION_MEDIUM_CONFIDENCE", "0.45"))
    FACE_RECOGNITION_GRACE_PERIOD_FRAMES: int = int(os.getenv("FACE_RECOGNITION_GRACE_PERIOD_FRAMES", "15"))
    FACE_STORAGE_DIR: str = os.getenv("FACE_STORAGE_DIR", os.path.normpath(os.path.join(STORAGE_DIR, "faces")))
    FACE_DETECTOR_MODEL_URL: str = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
    FACE_RECOGNIZER_MODEL_URL: str = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
    FACE_RECOGNITION_INTERVAL: int = int(os.getenv("FACE_RECOGNITION_INTERVAL", "5"))

    # Camera Reconnect Configurations
    CAMERA_RECONNECT_ENABLED: bool = os.getenv("CAMERA_RECONNECT_ENABLED", "True").lower() in ("true", "1", "yes")
    CAMERA_RECONNECT_MAX_RETRIES: int = int(os.getenv("CAMERA_RECONNECT_MAX_RETRIES", "5"))
    CAMERA_RECONNECT_DELAY_SECONDS: float = float(os.getenv("CAMERA_RECONNECT_DELAY_SECONDS", "2.0"))

    # SmartAlert Configurations
    SMART_ALERT_MIN_CONF: float = float(os.getenv("SMART_ALERT_MIN_CONF", "0.35"))
    # Minimum frames a track must be seen before an incident is confirmed (3 was too low)
    SMART_ALERT_MIN_FRAMES: int = int(os.getenv("SMART_ALERT_MIN_FRAMES", "5"))
    # Duplicate suppression window in seconds (300 = 5 min, protects across server restarts)
    SMART_ALERT_DUPLICATE_WINDOW: float = float(os.getenv("SMART_ALERT_DUPLICATE_WINDOW", "300.0"))
    # Minimum YuNet face-detection confidence to classify a person as UNKNOWN.
    # Below this threshold, the detection is FACE_UNAVAILABLE (prevents cloud textures
    # from being misidentified as faces and triggering UNKNOWN → incident).
    FACE_MIN_DETECTION_CONF_FOR_UNKNOWN: float = float(os.getenv("FACE_MIN_DETECTION_CONF_FOR_UNKNOWN", "0.65"))

    
    # BorderThreat Engine Configurations
    THREAT_HUMAN_WEIGHT: int = int(os.getenv("THREAT_HUMAN_WEIGHT", "20"))
    THREAT_VEHICLE_WEIGHT: int = int(os.getenv("THREAT_VEHICLE_WEIGHT", "30"))
    THREAT_GROUP_WEIGHT: int = int(os.getenv("THREAT_GROUP_WEIGHT", "35"))
    THREAT_ZONE_BREACH_WEIGHT: int = int(os.getenv("THREAT_ZONE_BREACH_WEIGHT", "40"))
    THREAT_NIGHT_WEIGHT: int = int(os.getenv("THREAT_NIGHT_WEIGHT", "15"))
    THREAT_PERSISTENT_TRACK_WEIGHT: int = int(os.getenv("THREAT_PERSISTENT_TRACK_WEIGHT", "10"))
    THREAT_REPEATED_APPROACH_WEIGHT: int = int(os.getenv("THREAT_REPEATED_APPROACH_WEIGHT", "5"))
    
    # ── Vehicle Detection Configurations ─────────────────────────────────────
    # Minimum confidence to accept a vehicle detection
    VEHICLE_CONFIDENCE_THRESHOLD: float = float(os.getenv("VEHICLE_CONFIDENCE_THRESHOLD", "0.45"))
    # Fine-grained YOLO class names that count as motor vehicles
    VEHICLE_CLASSES: set = {"car", "motorcycle", "bus", "truck"}
    # Minimum consecutive frames seen before a vehicle track is reported
    VEHICLE_MIN_FRAMES: int = int(os.getenv("VEHICLE_MIN_FRAMES", "3"))
    # Temporal class-smoothing window (majority vote over last N classifications)
    VEHICLE_CLASS_SMOOTHING_WINDOW: int = int(os.getenv("VEHICLE_CLASS_SMOOTHING_WINDOW", "7"))
    # Maximum single-frame centre displacement (normalised) to pass stability check
    # Vehicles can move faster than pedestrians; looser threshold than human 0.25
    VEHICLE_MAX_SINGLE_STEP: float = float(os.getenv("VEHICLE_MAX_SINGLE_STEP", "0.40"))
    # Minimum normalised bbox area (w*h) to accept a vehicle detection
    # Smaller than human minimum — distant vehicles may still be relevant
    VEHICLE_MIN_BBOX_AREA: float = float(os.getenv("VEHICLE_MIN_BBOX_AREA", "0.0008"))
    VEHICLE_MIN_ASPECT_RATIO: float = float(os.getenv("VEHICLE_MIN_ASPECT_RATIO", "0.15"))
    # ── ANPR / License Plate Recognition Configurations ──────────────────────
    ANPR_ENABLED: bool = os.getenv("ANPR_ENABLED", "True").lower() in ("true", "1", "yes")
    # Minimum confidence to accept a plate bounding box detection
    PLATE_CONFIDENCE_THRESHOLD: float = float(os.getenv("PLATE_CONFIDENCE_THRESHOLD", "0.50"))
    # Minimum normalized bbox area for plate ROI relative to frame (w*h)
    PLATE_MIN_BBOX_AREA: float = float(os.getenv("PLATE_MIN_BBOX_AREA", "0.0002"))
    # Minimum OCR confidence to consider a character read valid
    OCR_CONFIDENCE_THRESHOLD: float = float(os.getenv("OCR_CONFIDENCE_THRESHOLD", "0.45"))
    # Character length constraints for license plates
    OCR_MIN_CHARACTERS: int = int(os.getenv("OCR_MIN_CHARACTERS", "6"))
    OCR_MAX_CHARACTERS: int = int(os.getenv("OCR_MAX_CHARACTERS", "12"))
    # Temporal OCR stability window (majority vote over last N frames per VTRK#)
    OCR_STABILITY_WINDOW: int = int(os.getenv("OCR_STABILITY_WINDOW", "5"))
    # Minimum IoU threshold to associate plate ROI with vehicle ROI
    PLATE_ASSOCIATION_IOU_THRESHOLD: float = float(os.getenv("PLATE_ASSOCIATION_IOU_THRESHOLD", "0.30"))
    # Time-to-live for plate result cache in seconds
    PLATE_RESULT_TTL: int = int(os.getenv("PLATE_RESULT_TTL", "300"))

    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "*"
    ]

settings = Settings()

