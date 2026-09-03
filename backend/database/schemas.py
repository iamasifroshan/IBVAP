from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict
from datetime import datetime

class ThreatFactorSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category: str
    scoreContribution: int
    description: str

# Camera Schemas
class CameraBase(BaseModel):
    camera_id: str
    name: str
    sector: str = "Sector B"
    outpost: str = "Border Outpost North"
    source_type: str = "RTSP"
    source_url: str
    status: str = "online"
    health_score: int = 100
    visibility_score: int = 90
    lighting_lux: int = 100
    ai_reliability: int = 95
    adaptive_processing_mode: str = "Standard AI Inference"
    human_verification_required: bool = False
    verification_recommendation: str = "Nominal operational status."
    active_zone: str = "Restricted Area"
    last_activity: str = "Just now"
    night_vision_mode: bool = False
    dehaze_enabled: bool = False
    auto_start_inference: bool = False

class CameraCreate(BaseModel):
    id: Optional[str] = None
    camera_id: str
    name: str
    sector: str = "Sector B"
    outpost: str = "Border Outpost North"
    source_type: str = "RTSP"
    source_url: str
    status: str = "online"
    health_score: int = 100
    visibility_score: int = 90
    lighting_lux: int = 100
    ai_reliability: int = 95
    adaptive_processing_mode: str = "Standard AI Inference"
    human_verification_required: bool = False
    verification_recommendation: str = "Nominal operational status."
    active_zone: str = "Restricted Area"
    last_activity: str = "Just now"
    night_vision_mode: bool = False
    dehaze_enabled: bool = False
    auto_start_inference: bool = False

class CameraResponse(CameraBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: Optional[datetime] = None

    # Frontend camelCase aliases for seamless compatibility
    protocol: Optional[str] = None
    streamUrl: Optional[str] = None
    healthScore: Optional[int] = None
    visibilityScore: Optional[int] = None
    lightingLux: Optional[int] = None
    aiReliability: Optional[int] = None
    adaptiveProcessingMode: Optional[str] = None
    humanVerificationRequired: Optional[bool] = None
    verificationRecommendation: Optional[str] = None
    activeZone: Optional[str] = None
    lastActivity: Optional[str] = None
    nightVisionMode: Optional[bool] = None
    dehazeEnabled: Optional[bool] = None
    autoStartInference: Optional[bool] = None

# Detection Schemas
class DetectionBase(BaseModel):
    camera_id: str
    object_type: str = "human"
    fine_class: Optional[str] = None
    confidence: float = 0.95
    track_id: Optional[str] = None
    frame_index: Optional[int] = None
    timestamp_sec: Optional[float] = None
    bounding_box: dict = Field(default_factory=dict)
    face: Optional[dict] = None


class DetectionCreate(DetectionBase):
    pass

class DetectionResponse(DetectionBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    timestamp: datetime

# Track Schemas
class TrackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    camera_id: str
    track_id: int                    # Real ByteTrack integer ID
    fine_class: str
    object_type: str
    state: str                       # new / active / lost
    confidence_max: float
    confidence_last: float
    bounding_box: dict
    frame_first: int
    frame_last: int
    frames_seen: int
    video_ts_first_sec: float
    video_ts_last_sec: float
    face: Optional[dict] = None
    created_at: Optional[datetime] = None

# Zone Schemas
class PointSchema(BaseModel):
    x: float
    y: float

class ZoneBase(BaseModel):
    name: str
    camera_id: Optional[str] = None
    sector: str = "Sector B"
    zone_type: str = "restricted_fence"
    polygon_coordinates: List[PointSchema] = Field(default_factory=list)
    severity: str = "high"
    sensitivity: int = 90
    min_threat_threshold: int = 60
    loitering_limit_sec: int = 15
    enabled: bool = True
    human_detection: bool = True
    vehicle_detection: bool = False
    animal_detection: bool = False
    person_threshold: int = 1

class ZoneCreate(ZoneBase):
    pass

class ZoneResponse(ZoneBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime

# Incident Schemas
class IncidentBase(BaseModel):
    incident_id: str
    camera_id: str
    camera_name: Optional[str] = "BORDER-CAM-07"
    sector: str = "Sector B"
    outpost: str = "Border Outpost North"
    object_type: str = "human"
    track_id: Optional[str] = "TRACK-8000"
    event_type: str = "RESTRICTED_ZONE_BREACH"
    threat_score: int = 75
    threat_level: str = "high"
    threat_factors: List[ThreatFactorSchema] = Field(default_factory=list)
    explainable_reason: str = "Target breached restricted perimeter boundary."
    environment: str = "normal"
    ai_reliability: int = 90
    visibility_score: int = 90
    status: str = "active"
    sync_status: str = "unsynced"
    snapshot_url: str = ""
    zone_name: str = "Sector B Restricted Zone"
    loitering_duration_sec: int = 0
    speed_kmh: float = 0.0
    direction: str = "Inward Perimeter"
    smart_alert_confirmed: bool = True
    validation_checks: dict = Field(default_factory=dict)
    person_name: Optional[str] = "UNKNOWN"
    face_recognized: Optional[bool] = False
    face_confidence: Optional[float] = 0.0

class IncidentCreate(IncidentBase):
    pass

class IncidentStatusUpdate(BaseModel):
    status: str

class IncidentResponse(IncidentBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    timestamp: datetime

    # Frontend camelCase aliases
    cameraName: Optional[str] = None
    cameraId: Optional[str] = None
    objectType: Optional[str] = None
    persistentId: Optional[str] = None
    threatScore: Optional[int] = None
    threatFactors: List[ThreatFactorSchema] = Field(default_factory=list)
    explainableReason: Optional[str] = None
    environmentalCondition: Optional[str] = None
    aiReliability: Optional[int] = None
    visibilityScore: Optional[int] = None
    snapshotUrl: Optional[str] = None
    zoneName: Optional[str] = None
    loiteringDurationSec: Optional[int] = None
    speedKmh: Optional[float] = None
    smartAlertConfirmed: Optional[bool] = True
    validationChecks: dict = Field(default_factory=dict)
    syncedToCloud: Optional[bool] = False
    personName: Optional[str] = None
    faceRecognized: Optional[bool] = None
    faceConfidence: Optional[float] = None

# Evidence Schemas
class EvidenceCreate(BaseModel):
    incident_id: str
    evidence_type: str = "snapshot"
    file_path: str
    sha256_hash: Optional[str] = None

class EvidenceResponse(EvidenceCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime

# SyncJob Schemas
class SyncJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    incident_id: str
    status: str
    retry_count: int
    created_at: datetime
    synced_at: Optional[datetime] = None

# System Metrics & Status Schemas
class SystemMetricsSchema(BaseModel):
    totalCameras: int = 12
    activeCameras: int = 10
    degradedCameras: int = 1
    offlineCameras: int = 1
    activeAlerts: int = 7
    criticalAlerts: int = 2
    offlineQueueCount: int = 14
    storageUsedMb: int = 1420
    storageLimitMb: int = 8192
    falseAlarmReductionRate: float = 84.6
    edgeNodeId: str = "BOP-NORTH-EDGE-01"
    edgeNodeLocation: str = "Border Outpost North (Sector B)"
    processingFps: int = 30
    lastSyncTimestamp: str = "2026-08-23 22:50:00 UTC"

class SystemStatusResponse(BaseModel):
    status: str = "operational"
    node_id: str = "BOP-NORTH-EDGE-01"
    version: str = "1.0.0-SIH"
    storage_healthy: bool = True
    ai_engine_active: bool = True

class SearchQueryRequest(BaseModel):
    query: str

class SearchQueryResponse(BaseModel):
    filters: dict
    results: List[IncidentResponse]


# Face Recognition Schemas
class FaceReferenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    person_id: str
    image_path: Optional[str] = None
    created_at: datetime

class RegisteredPersonBase(BaseModel):
    person_id: str
    name: str
    identity_code: Optional[str] = None
    is_active: bool = True

class RegisteredPersonCreate(BaseModel):
    name: str = Field(..., min_length=1)
    identity_code: Optional[str] = None

class RegisteredPersonUpdate(BaseModel):
    name: Optional[str] = None
    identity_code: Optional[str] = None
    is_active: Optional[bool] = None

class RegisteredPersonResponse(RegisteredPersonBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    image_path: Optional[str] = None
    references_count: int = 1
    references: Optional[List[FaceReferenceResponse]] = None
    created_at: datetime
    updated_at: datetime

class FaceRecognitionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    person_id: Optional[str] = None
    name: Optional[str] = None
    identity_code: Optional[str] = None
    recognized: bool
    confidence: float
    recognition_confidence: Optional[float] = 0.0
    face_detection_confidence: Optional[float] = 0.0
    confidence_level: str = "UNKNOWN"
    identity_status: str = "FACE_UNAVAILABLE"
    matched_reference_id: Optional[str] = None
    bounding_box: Optional[List[int]] = None  # [x, y, w, h] of face box
    error: Optional[str] = None


class ANPRObservationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    anpr_id: str
    camera_id: str
    vehicle_track_id: int
    vehicle_track_label: str
    vehicle_class: str
    plate_text: str
    raw_ocr_text: Optional[str] = None
    confidence: float
    format_valid: bool
    direction: str = "unknown"
    first_seen: datetime
    last_seen: datetime


class ANPRStatsResponse(BaseModel):
    total_reads: int
    unique_plates: int
    valid_format_count: int
    by_camera: Dict[str, int]
