import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, Boolean, Text, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from database.db import Base

def _utcnow():
    """Return current UTC time as a timezone-aware datetime (replaces deprecated datetime.utcnow)."""
    return datetime.now(timezone.utc)

class CameraModel(Base):
    __tablename__ = "cameras"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    camera_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    sector = Column(String, nullable=False, default="Sector B")
    outpost = Column(String, default="Border Outpost North")
    source_type = Column(String, default="RTSP")
    source_url = Column(String, nullable=False)
    fps = Column(Integer, default=30)
    resolution = Column(String, default="1920x1080 (1080p)")
    status = Column(String, default="online")
    health_score = Column(Integer, default=100)
    visibility_score = Column(Integer, default=90)
    lighting_lux = Column(Integer, default=100)
    ai_reliability = Column(Integer, default=95)
    adaptive_processing_mode = Column(String, default="Standard AI Inference")
    human_verification_required = Column(Boolean, default=False)
    verification_recommendation = Column(Text, default="Nominal operational status.")
    active_zone = Column(String, default="Restricted Area")
    last_activity = Column(String, default="Just now")
    night_vision_mode = Column(Boolean, default=False)
    dehaze_enabled = Column(Boolean, default=False)
    auto_start_inference = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)

class VideoModel(Base):
    __tablename__ = "videos"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_size_bytes = Column(Integer, default=0)
    camera_id = Column(String, nullable=True, index=True)
    fps = Column(Float, default=0.0)
    width = Column(Integer, default=0)
    height = Column(Integer, default=0)
    total_frames = Column(Integer, default=0)
    duration_sec = Column(Float, default=0.0)
    status = Column(String, default="uploaded")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

class DetectionModel(Base):
    __tablename__ = "detections"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    camera_id = Column(String, nullable=False, index=True)
    object_type = Column(String, nullable=False, default="human")
    fine_class = Column(String, nullable=True)           # e.g. person, car, bus
    confidence = Column(Float, default=0.0)
    track_id = Column(String, nullable=True)             # real ByteTrack int as string
    frame_index = Column(Integer, nullable=True)         # video frame number
    timestamp_sec = Column(Float, nullable=True)         # seconds into video
    bounding_box = Column(JSON, default=dict)
    face = Column(JSON, nullable=True)  # Associated face recognition metadata
    timestamp = Column(DateTime, default=_utcnow)

class TrackModel(Base):
    """
    Persists real ByteTrack track records per camera.
    track_id is the real integer assigned by ByteTrack — never randomly generated.
    """
    __tablename__ = "tracks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    camera_id = Column(String, nullable=False, index=True)
    track_id = Column(Integer, nullable=False, index=True)   # ByteTrack integer ID
    fine_class = Column(String, nullable=False)              # person / car / bus / truck
    object_type = Column(String, nullable=False)             # human / vehicle / animal
    state = Column(String, default="new")                    # new / active / lost
    confidence_max = Column(Float, default=0.0)
    confidence_last = Column(Float, default=0.0)
    bounding_box = Column(JSON, default=dict)                # last-seen normalized bbox
    frame_first = Column(Integer, default=0)
    frame_last = Column(Integer, default=0)
    frames_seen = Column(Integer, default=1)
    video_ts_first_sec = Column(Float, default=0.0)
    video_ts_last_sec = Column(Float, default=0.0)
    face = Column(JSON, nullable=True)  # Last seen face recognition metadata
    created_at = Column(DateTime, default=_utcnow)


class ZoneModel(Base):
    __tablename__ = "zones"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    camera_id = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    sector = Column(String, default="Sector B")
    zone_type = Column(String, default="restricted_fence")
    polygon_coordinates = Column(JSON, default=list)
    severity = Column(String, default="high")
    sensitivity = Column(Integer, default=90)
    min_threat_threshold = Column(Integer, default=60)
    loitering_limit_sec = Column(Integer, default=15)
    enabled = Column(Boolean, default=True)
    human_detection = Column(Boolean, default=True)
    vehicle_detection = Column(Boolean, default=False)
    animal_detection = Column(Boolean, default=False)
    person_threshold = Column(Integer, default=1)
    created_at = Column(DateTime, default=_utcnow)

class IncidentModel(Base):
    __tablename__ = "incidents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    incident_id = Column(String, unique=True, index=True, nullable=False)
    camera_id = Column(String, nullable=False, index=True)
    camera_name = Column(String, default="BORDER-CAM-07")
    sector = Column(String, default="Sector B")
    outpost = Column(String, default="Border Outpost North")
    object_type = Column(String, default="human")
    track_id = Column(String, default="TRACK-8000")
    event_type = Column(String, default="RESTRICTED_ZONE_BREACH")
    threat_score = Column(Integer, default=50)
    threat_level = Column(String, default="medium")
    threat_factors = Column(JSON, default=list)
    explainable_reason = Column(Text, default="Automated detection event.")
    environment = Column(String, default="normal")
    ai_reliability = Column(Integer, default=90)
    visibility_score = Column(Integer, default=90)
    status = Column(String, default="active")
    sync_status = Column(String, default="unsynced")
    snapshot_url = Column(String, default="")
    zone_name = Column(String, default="Default Zone")
    loitering_duration_sec = Column(Integer, default=0)
    speed_kmh = Column(Float, default=0.0)
    direction = Column(String, default="Inward Perimeter")
    smart_alert_confirmed = Column(Boolean, default=True)
    validation_checks = Column(JSON, default=dict)
    synced_to_cloud = Column(Boolean, default=False)
    synced_timestamp = Column(String, nullable=True)
    person_name = Column(String, nullable=True, default="UNKNOWN")
    face_recognized = Column(Boolean, nullable=True, default=False)
    face_confidence = Column(Float, nullable=True, default=0.0)
    timestamp = Column(DateTime, default=_utcnow)
    # Video source timestamp: seconds into the video file when incident was detected.
    # None/null for live webcam sources.
    source_video_timestamp_sec = Column(Float, nullable=True, default=None)


class EvidenceModel(Base):
    __tablename__ = "evidence"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    incident_id = Column(String, nullable=False, index=True)
    evidence_type = Column(String, default="snapshot")
    file_path = Column(String, nullable=False)
    sha256_hash = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

class SyncJobModel(Base):
    __tablename__ = "sync_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    incident_id = Column(String, nullable=False, index=True)
    status = Column(String, default="queued")
    retry_count = Column(Integer, default=0)
    payload_size_kb = Column(Integer, default=256)
    created_at = Column(DateTime, default=_utcnow)
    synced_at = Column(DateTime, nullable=True)

class DatasetModel(Base):
    __tablename__ = "datasets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    images_count = Column(Integer, default=0)
    annotated_count = Column(Integer, default=0)
    classes = Column(JSON, default=list)
    split_train = Column(Integer, default=70)
    split_val = Column(Integer, default=20)
    split_test = Column(Integer, default=10)
    status = Column(String, default="DRAFT") # DRAFT, VALIDATED, FAILED
    validation_errors = Column(JSON, default=list)
    storage_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

class TrainingJobModel(Base):
    __tablename__ = "training_jobs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    dataset_id = Column(String, index=True, nullable=False)
    base_model = Column(String, default="yolov8n.pt")
    epochs = Column(Integer, default=50)
    batch_size = Column(Integer, default=16)
    img_size = Column(Integer, default=640)
    status = Column(String, default="QUEUED") # QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED
    progress = Column(Float, default=0.0)
    current_epoch = Column(Integer, default=0)
    metrics_history = Column(JSON, default=dict)
    final_metrics = Column(JSON, default=dict)
    model_output_path = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

class ModelRegistryModel(Base):
    __tablename__ = "model_registry"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    version = Column(String, nullable=False)
    base_model = Column(String, nullable=False)
    dataset_id = Column(String, nullable=True)
    job_id = Column(String, nullable=True)
    status = Column(String, default="TESTING") # TESTING, ACTIVE, ARCHIVED, FAILED
    precision = Column(Float, default=0.0)
    recall = Column(Float, default=0.0)
    map50 = Column(Float, default=0.0)
    map50_95 = Column(Float, default=0.0)
    model_path = Column(String, nullable=False)
    created_at = Column(DateTime, default=_utcnow)


class RegisteredPersonModel(Base):
    __tablename__ = "registered_people"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    person_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    identity_code = Column(String, unique=True, index=True, nullable=True)
    face_embedding = Column(JSON, nullable=False)  # stored as list of floats
    image_path = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    references = relationship("FaceReferenceModel", back_populates="person", cascade="all, delete-orphan")


class FaceReferenceModel(Base):
    __tablename__ = "face_references"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    person_id = Column(String, ForeignKey("registered_people.person_id"), index=True, nullable=False)
    face_embedding = Column(JSON, nullable=False)  # stored as list of floats
    image_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    person = relationship("RegisteredPersonModel", back_populates="references")


class ANPRObservationModel(Base):
    __tablename__ = "anpr_observations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    anpr_id = Column(String, unique=True, index=True, nullable=False)
    camera_id = Column(String, nullable=False, index=True)
    vehicle_track_id = Column(Integer, nullable=False, index=True)
    vehicle_track_label = Column(String, nullable=False)
    vehicle_class = Column(String, nullable=False, default="car")
    plate_text = Column(String, nullable=False, index=True)
    raw_ocr_text = Column(String, nullable=True)
    confidence = Column(Float, default=0.0)
    format_valid = Column(Boolean, default=False)
    direction = Column(String, default="unknown")
    first_seen = Column(DateTime, default=_utcnow)
    last_seen = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    created_at = Column(DateTime, default=_utcnow)

