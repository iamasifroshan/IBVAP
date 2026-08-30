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
  | 'ai-training-center';

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
}

export interface Camera {
  id: string;
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
  autoStartInference: boolean;
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
