// Runtime constants for IBVAP system
export const IBVAP_SYSTEM_VERSION = '1.0.0-SIH';

export const SECTORS = ['Sector A', 'Sector B', 'Eastern Perimeter', 'Western Buffer', 'South Perimeter'] as const;

export type PageId = 
  | 'command-overview'
  | 'live-surveillance'
  | 'incidents'
  | 'sentinel-query'
  | 'enviro-vision'
  | 'edge-guard'
  | 'camera-management'
  | 'virtual-fence'
  | 'analytics'
  | 'settings'
  | 'system-verification'
  | 'ai-training-center'
  | 'face-recognition';

export type NetworkStatus = 'online' | 'limited' | 'offline' | 'syncing' | 'connecting';

export type EnvironmentCondition = 
  | 'normal' 
  | 'night' 
  | 'low_light' 
  | 'cloudy' 
  | 'fog' 
  | 'severe_fog' 
  | 'dust';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type ObjectType = 'human' | 'vehicle' | 'group' | 'animal' | 'unknown';

export interface ThreatFactor {
  category: string;
  scoreContribution: number;
  description: string;
}

export interface ThreatScore {
  score: number;
  level: Severity;
  factors: ThreatFactor[];
  explainableSentence: string;
  recommendedAction: string;
  positiveAdjustments: number;
  negativeAdjustments: number;
  environmentalPenalty: number;
}

export interface Incident {
  id: string;
  timestamp: string;
  sector: string;
  cameraName: string;
  cameraId: string;
  outpost: string;
  objectType: ObjectType;
  persistentId: string;
  threatScore: number;
  severity: Severity;
  threatFactors: ThreatFactor[];
  explainableReason: string;
  environmentalCondition: EnvironmentCondition;
  aiReliability: number;
  visibilityScore: number;
  status: 'active' | 'verified' | 'false_alarm' | 'investigating';
  snapshotUrl: string;
  zoneName: string;
  loiteringDurationSec?: number;
  speedKmh?: number;
  direction: string;
  smartAlertConfirmed: boolean;
  validationChecks?: any;
  syncedToCloud: boolean;
  syncedTimestamp?: string;
  person_name?: string;
  personName?: string;
  face_recognized?: boolean;
  faceRecognized?: boolean;
  face_confidence?: number;
  faceConfidence?: number;
  sourceVideoTimestampSec?: number;
  eventType?: string;
  trackId?: string;
}

export interface SuspiciousActivity {
  id: string;
  activity_id: string;
  camera_id: string;
  track_id: number;
  track_label: string;
  activity_type: string;
  severity: string;
  started_at: string;
  detected_at: string;
  duration_sec: number;
  zone_name?: string | null;
  description?: string | null;
  incident_id?: string | null;
  created_at: string;
}

export interface SuspiciousActivityStats {
  total_suspicious_activities: number;
  activity_type_breakdown: Record<string, number>;
  camera_breakdown: Record<string, number>;
  severity_breakdown: Record<string, number>;
}

export interface NightMovement {
  id: string;
  movement_id: string;
  camera_id: string;
  track_id: number;
  track_label: string;
  avg_luma: number;
  dark_pixel_ratio: number;
  displacement: number;
  path_length: number;
  samples_count: number;
  incident_id?: string | null;
  detected_at: string;
  created_at: string;
}

export interface NightMovementStats {
  total_night_movements: number;
  camera_breakdown: Record<string, number>;
}

export interface Camera {

  id: string;
  camera_id?: string;
  name: string;
  sector: string;
  outpost: string;
  protocol: 'RTSP' | 'IP_CCTV' | 'WEBCAM' | 'SIMULATED_FILE';
  streamUrl: string;
  fps: number;
  resolution: string;
  status: 'online' | 'degraded' | 'offline' | 'CONFIGURED' | 'CONNECTING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'ERROR';
  healthScore: number;
  visibilityScore: number; // 0-100%
  lightingLux: number; // e.g. 12 lux
  aiReliability: number; // 0-100%
  adaptiveProcessingMode: string;
  humanVerificationRequired: boolean;
  verificationRecommendation: string;
  activeZone: string;
  lastActivity: string;
  nightVisionMode: boolean;
  dehazeEnabled: boolean;
  autoStartInference?: boolean;
}

export function getFallbackCamera(targetId: string): Camera {
  return {
    id: targetId,
    camera_id: targetId,
    name: targetId === 'BORDER-CAM-07' ? 'Border Perimeter East' : `Camera ${targetId}`,
    sector: 'Sector A',
    outpost: 'Border Outpost North',
    protocol: 'WEBCAM',
    streamUrl: 'webcam',
    fps: 30,
    resolution: '1280x720 (720p)',
    status: 'OFFLINE',
    healthScore: 0,
    visibilityScore: 0,
    lightingLux: 0,
    aiReliability: 0,
    adaptiveProcessingMode: 'Offline / Reconnecting',
    humanVerificationRequired: false,
    verificationRecommendation: 'Camera temporarily offline or reconnecting.',
    activeZone: 'Restricted Zone',
    lastActivity: 'Reconnecting...',
    nightVisionMode: false,
    dehazeEnabled: false,
    autoStartInference: false,
  };
}

export function getCameraById(cameras: Camera[], targetId: string): Camera {
  if (!targetId) {
    return cameras[0] || getFallbackCamera('BORDER-CAM-07');
  }
  const match = cameras.find(c => c.id === targetId || c.camera_id === targetId);
  if (match) return match;
  return getFallbackCamera(targetId);
}

export interface VirtualZone {
  id: string;
  name: string;
  sector: string;
  type: 'restricted_fence' | 'buffer_zone' | 'outpost_perimeter';
  sensitivity: number; // 0-100
  minThreatThreshold: number;
  loiteringLimitSec: number;
  active: boolean;
  points: { x: number; y: number }[];
}

export interface SyncQueueItem {
  id: string;
  incidentId: string;
  timestamp: string;
  eventType: string;
  priority: 'P1_CRITICAL' | 'P2_HIGH' | 'P3_METADATA' | 'P4_SNAPSHOT' | 'P5_CLIP';
  payloadSizeKb: number;
  status: 'unsynced' | 'queued' | 'syncing' | 'synced' | 'failed';
  progressPct: number;
  attempts: number;
}

export type SyncJob = SyncQueueItem;

export interface SystemMetrics {
  totalCameras: number;
  activeCameras: number;
  degradedCameras: number;
  offlineCameras: number;
  activeAlerts: number;
  criticalAlerts: number;
  offlineQueueCount: number;
  storageUsedMb: number;
  storageLimitMb: number;
  falseAlarmReductionRate: number; // e.g. 84%
  edgeNodeId: string;
  edgeNodeLocation: string;
  processingFps: number;
  lastSyncTimestamp: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  cameraId: string;
  timestamp: string;
  frameIndex: number;
  objectType: ObjectType;
  confidence: number;
  boundingBox: BoundingBox;
  persistentTrackId?: string;
}

export interface Vector2D {
  x: number;
  y: number;
}

export interface Track {
  persistentId: string;
  cameraId: string;
  objectType: ObjectType;
  firstDetected: string;
  lastSeen: string;
  framesTracked: number;
  entryPoint: Vector2D;
  currentPosition: Vector2D;
  trajectory: Vector2D[];
  speedKmh: number;
  directionLabel: string;
  loiteringDurationSec: number;
  isActive: boolean;
}

export interface NaturalLanguageQuery {
  queryText: string;
  submittedAt: string;
}

export interface SearchFilters {
  rawQuery?: string;
  intentSummary?: string;
  extractedObject?: ObjectType;
  extractedCamera?: string;
  extractedSector?: string;
  extractedMinThreatScore?: number;
  extractedSeverity?: Severity;
  extractedTimeRange?: string;
  extractedEventType?: string;
  extractedEnvironment?: EnvironmentCondition;
  validated?: boolean;
  confidence?: number;
}

export interface FaceReference {
  id: string;
  person_id: string;
  personId?: string;
  image_path?: string;
  imagePath?: string;
  created_at: string;
  createdAt?: string;
}

export interface RegisteredPerson {
  id: string;
  person_id: string;
  personId?: string;
  name: string;
  identity_code?: string;
  identityCode?: string;
  is_active: boolean;
  isActive?: boolean;
  image_path?: string;
  imagePath?: string;
  references_count?: number;
  referencesCount?: number;
  references?: FaceReference[];
  created_at: string;
  createdAt?: string;
  updated_at: string;
  updatedAt?: string;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type IdentityStatus = 'KNOWN' | 'UNKNOWN' | 'FACE_UNAVAILABLE' | 'FACE_PROCESSING_ERROR';

export interface FaceRecognitionResult {
  person_id?: string | null;
  personId?: string | null;
  name?: string | null;
  identity_code?: string | null;
  identityCode?: string | null;
  recognized: boolean;
  confidence: number;
  recognition_confidence?: number;
  recognitionConfidence?: number;
  face_detection_confidence?: number;
  faceDetectionConfidence?: number;
  confidence_level?: ConfidenceLevel;
  confidenceLevel?: ConfidenceLevel;
  identity_status?: IdentityStatus;
  identityStatus?: IdentityStatus;
  matched_reference_id?: string | null;
  matchedReferenceId?: string | null;
  bounding_box?: [number, number, number, number] | null;
  boundingBox?: [number, number, number, number] | null;
}

export interface VehicleDetection {
  class: string;
  vehicle_class: string;
  object_type: 'vehicle';
  confidence: number;
  track_id: number;
  track_label: string;
  bounding_box: BoundingBox;
  bbox: { x: number; y: number; width: number; height: number };
  direction: 'stationary' | 'left' | 'right' | 'inbound' | 'outbound' | 'unknown';
  frames_seen: number;
  plate_text?: string | null;
  raw_ocr_text?: string | null;
  plate_confidence?: number;
  format_valid?: boolean;
  plate_stable?: boolean;
}

export interface VehicleStats {
  total: number;
  car: number;
  motorcycle: number;
  bus: number;
  truck: number;
  by_camera: Record<string, number>;
}

export interface ANPRObservation {
  id: string;
  anpr_id: string;
  camera_id: string;
  vehicle_track_id: number;
  vehicle_track_label: string;
  vehicle_class: string;
  plate_text: string;
  raw_ocr_text?: string | null;
  confidence: number;
  format_valid: boolean;
  direction: string;
  first_seen: string;
  last_seen: string;
}

export interface ANPRStats {
  total_reads: number;
  unique_plates: number;
  valid_format_count: number;
  by_camera: Record<string, number>;
}

export interface UnifiedSecurityEvent {
  id: string;
  event_id: string;
  camera_id: string;
  camera_name: string;
  subject_type: 'human' | 'vehicle';
  track_id: number;
  track_label: string;
  threat_level: Severity;
  threat_score: number;
  threat_reason: string;
  status: 'active' | 'resolved';
  contributing_signals: string[];
  related_incident_ids: string[];
  related_evidence_ids: string[];
  snapshot_url: string;
  face_info?: {
    identity_status: string;
    person_name?: string;
    confidence?: number;
    match_distance?: number;
  } | null;
  vehicle_info?: {
    vehicle_class?: string;
    plate_text?: string;
    format_valid?: boolean;
    confidence?: number;
    direction?: string;
  } | null;
  first_seen: string;
  last_seen: string;
  created_at: string;
  updated_at?: string | null;
}

export interface SecurityEventStats {
  total_events: number;
  active_events: number;
  resolved_events: number;
  threat_level_breakdown: Record<string, number>;
  camera_breakdown: Record<string, number>;
  contributing_signal_breakdown: Record<string, number>;
}

export interface C2Status {
  enabled: boolean;
  endpoint_configured: boolean;
  connected: boolean;
  last_delivery: string | null;
  delivered_count: number;
  failed_count: number;
}

export interface C2DeliveryRecord {
  id: string;
  security_event_id: string;
  event_type: string;
  status: 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'FAILED' | 'SKIPPED';
  attempt_count: number;
  last_attempt_at: string | null;
  acknowledged_at: string | null;
  response_status: number | null;
  error_message: string | null;
  payload?: any;
  created_at: string;
  updated_at: string;
}

export interface C2DeliveryResponse {
  total: number;
  limit: number;
  offset: number;
  deliveries: C2DeliveryRecord[];
}


