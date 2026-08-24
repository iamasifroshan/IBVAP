from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class ThreatFactorSchema(BaseModel):
    category: str
    scoreContribution: int
    description: str

    class Config:
        from_attributes = True

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

class CameraResponse(CameraBase):
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

    class Config:
        from_attributes = True

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

class DetectionCreate(DetectionBase):
    pass

class DetectionResponse(DetectionBase):
    id: str
    timestamp: datetime

    class Config:
        from_attributes = True

# Track Schemas
class TrackResponse(BaseModel):
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
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

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

class ZoneCreate(ZoneBase):
    pass

class ZoneResponse(ZoneBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True

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

class IncidentCreate(IncidentBase):
    pass

class IncidentStatusUpdate(BaseModel):
    status: str

class IncidentResponse(IncidentBase):
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

    class Config:
        from_attributes = True

# Evidence Schemas
class EvidenceCreate(BaseModel):
    incident_id: str
    evidence_type: str = "snapshot"
    file_path: str
    sha256_hash: Optional[str] = None

class EvidenceResponse(EvidenceCreate):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True

# SyncJob Schemas
class SyncJobResponse(BaseModel):
    id: str
    incident_id: str
    status: str
    retry_count: int
    created_at: datetime
    synced_at: Optional[datetime] = None

    class Config:
        from_attributes = True

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
