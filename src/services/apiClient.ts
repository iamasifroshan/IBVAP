/**
 * IBVAP REST API Client
 * ─────────────────────────────────────────────────────────────
 * Each method follows the same pattern:
 *
 *   1. If USE_MOCK is true  → return mock data immediately
 *   2. If USE_MOCK is false → call FastAPI; on any error, fall back
 *      to mock data and log a warning so the UI never breaks.
 *
 * To wire a method to the real backend, flip VITE_USE_MOCK=false in .env.
 * No other code changes are required.
 *
 * FastAPI contract:  http://localhost:8000/api/v1
 */

import type {
  Camera,
  Incident,
  VirtualZone,
  SyncJob,
  SystemMetrics,
  SearchFilters,
  RegisteredPerson,
  FaceRecognitionResult,
  VehicleDetection,
  VehicleStats,
  ANPRObservation,
  ANPRStats,
  SuspiciousActivity,
  SuspiciousActivityStats,
  NightMovement,
  NightMovementStats,
  UnifiedSecurityEvent,
  SecurityEventStats,
  C2Status,
  C2DeliveryRecord,
  C2DeliveryResponse,
} from '../types';

import type { StructuredSearchFilters } from './sentinelQueryEngine';

import {
  MOCK_CAMERAS,
  MOCK_INCIDENTS,
  MOCK_ZONES,
  MOCK_SYNC_QUEUE,
  INITIAL_METRICS,
} from '../mock/data';

import { parseSentinelQuery, searchIncidentVault } from './sentinelQueryEngine';
import { USE_MOCK, API_ROUTES, apiFetch, API_BASE_URL } from './apiConfig';

// ─────────────────────────────────────────────────────────────
// Helper: try real API, fall back to mock on any failure
// ─────────────────────────────────────────────────────────────
async function tryLive<T>(
  fetcher: () => Promise<T>,
  mockValue: T,
  label: string
): Promise<T> {
  if (USE_MOCK) return mockValue;
  try {
    return await fetcher();
  } catch (err) {
    console.error(
      `[IBVAP] FastAPI unreachable for "${label}". Propagating error to UI.`,
      err
    );
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// REGISTERED PEOPLE MOCK STATE
// ─────────────────────────────────────────────────────────────
const MOCK_REGISTERED_PEOPLE: RegisteredPerson[] = [
  {
    id: "uuid-david",
    person_id: "person_david",
    personId: "person_david",
    name: "David",
    identity_code: "EMP-492",
    identityCode: "EMP-492",
    is_active: true,
    isActive: true,
    image_path: "",
    imagePath: "",
    created_at: "2026-08-25T10:00:00Z",
    createdAt: "2026-08-25T10:00:00Z",
    updated_at: "2026-08-25T10:00:00Z",
    updatedAt: "2026-08-25T10:00:00Z"
  },
  {
    id: "uuid-jane",
    person_id: "person_jane",
    personId: "person_jane",
    name: "Jane Doe",
    identity_code: "EMP-102",
    identityCode: "EMP-102",
    is_active: true,
    isActive: true,
    image_path: "",
    imagePath: "",
    created_at: "2026-08-26T14:30:00Z",
    createdAt: "2026-08-26T14:30:00Z",
    updated_at: "2026-08-26T14:30:00Z",
    updatedAt: "2026-08-26T14:30:00Z"
  }
];

let mockRegisteredPeople = [...MOCK_REGISTERED_PEOPLE];

// ─────────────────────────────────────────────────────────────
// Public API surface
// ─────────────────────────────────────────────────────────────
// Helper to normalize camera properties for UI consistency
function normalizeCamera(cam: any): Camera {
  if (!cam) return cam;
  return {
    ...cam,
    status: (cam.status?.toLowerCase() || 'offline') as any,
    protocol: (cam.protocol === 'MP4_FILE' ? 'SIMULATED_FILE' : (cam.protocol || 'SIMULATED_FILE')) as any,
    healthScore: typeof cam.healthScore === 'number' ? cam.healthScore : (cam.health_score || 0),
    streamUrl: cam.streamUrl || cam.stream_url || cam.source_url || '',
    autoStartInference: cam.autoStartInference ?? cam.auto_start_inference ?? false,
  };
}

export const ibvapApi = {

  // ── GET /api/cameras ──────────────────────────────────────
  async getCameras(): Promise<Camera[]> {
    const list = await tryLive(
      () => apiFetch<Camera[]>(API_ROUTES.cameras),
      MOCK_CAMERAS,
      'GET /cameras'
    );
    return list.map(normalizeCamera);
  },

  // ── GET /api/cameras/:id ──────────────────────────────────
  async getCameraById(id: string): Promise<Camera | undefined> {
    const cam = await tryLive(
      () => apiFetch<Camera>(API_ROUTES.cameraById(id)),
      MOCK_CAMERAS.find(c => c.id === id),
      `GET /cameras/${id}`
    );
    return cam ? normalizeCamera(cam) : undefined;
  },

  // ── POST /api/cameras ─────────────────────────────────────
  async createCamera(cameraData: Partial<Camera>): Promise<Camera> {
    const newCam: Camera = {
      id:          cameraData.id       ?? `CAM-NEW-${Math.floor(100 + Math.random() * 900)}`,
      name:        cameraData.name     ?? 'NEW-BORDER-CAM',
      sector:      cameraData.sector   ?? 'Sector B',
      outpost:     cameraData.outpost  ?? 'Border Outpost North',
      protocol:    cameraData.protocol ?? 'RTSP',
      streamUrl:   cameraData.streamUrl ?? 'rtsp://192.168.10.999/live',
      fps:                  30,
      resolution:           '1920x1080 (1080p)',
      status:               'online',
      healthScore:          100,
      visibilityScore:      90,
      lightingLux:          200,
      aiReliability:        95,
      adaptiveProcessingMode:     'Standard AI Inference',
      humanVerificationRequired:  false,
      verificationRecommendation: 'Nominal operational status.',
      activeZone:   'Restricted Area',
      lastActivity: 'Just now',
      nightVisionMode: false,
      dehazeEnabled:   false,
      autoStartInference: false,
    };

    const res = await tryLive(
      () => apiFetch<Camera>(API_ROUTES.cameras, {
        method: 'POST',
        body: JSON.stringify(newCam),
      }),
      newCam,
      'POST /cameras'
    );
    return normalizeCamera(res);
  },

  // ── POST /api/cameras/:id/test-source ─────────────────────
  // Tests the current camera source and returns real backend status.
  // Does NOT fake ONLINE — status reflects actual OpenCV probe result.
  async testCameraSource(cameraId: string): Promise<{
    camera_id: string; source_type: string; source_url_sanitized: string;
    status: 'online' | 'offline' | 'degraded'; health_score: number;
    resolution?: string; fps?: number; error?: string; message: string;
  }> {
    if (USE_MOCK) {
      return {
        camera_id: cameraId, source_type: 'MP4_FILE', source_url_sanitized: '',
        status: 'offline', health_score: 0, message: 'Mock mode — no real source test',
        error: 'Backend unavailable in mock mode'
      };
    }
    const res = await apiFetch<any>(`${API_ROUTES.cameras}/${cameraId}/test-source`, { method: 'POST' });
    if (res) {
      res.status = res.status?.toLowerCase();
    }
    return res;
  },

  // ── PATCH /api/cameras/:id/source ─────────────────────────
  // Updates camera source URL & type, verifies it, and returns real status.
  async updateCameraSource(
    cameraId: string, sourceUrl: string, sourceType?: string
  ): Promise<any> {
    if (USE_MOCK) {
      return { status: 'offline', source_verification: { status: 'offline', error: 'Mock mode' } };
    }
    const params = new URLSearchParams({ source_url: sourceUrl });
    if (sourceType) params.set('source_type', sourceType);
    const res = await apiFetch<any>(`${API_ROUTES.cameras}/${cameraId}/source?${params.toString()}`, { method: 'PATCH' });
    if (res) {
      if (res.status) res.status = res.status.toLowerCase();
      if (res.protocol) res.protocol = res.protocol === 'MP4_FILE' ? 'SIMULATED_FILE' : res.protocol;
      if (res.source_verification && res.source_verification.status) {
        res.source_verification.status = res.source_verification.status.toLowerCase();
      }
    }
    return res;
  },

  // ── POST /api/videos/upload ────────────────────────────────
  async uploadVideo(file: File, cameraId?: string): Promise<{
    video_id: string;
    filename: string;
    file_path: string;
    file_size_mb: number;
    camera_id?: string;
    fps: number;
    resolution: string;
    total_frames: number;
    duration_sec: number;
    status: string;
    sampled_frames_read: number;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    if (cameraId) formData.append('camera_id', cameraId);

    if (USE_MOCK) {
      return {
        video_id: `VID-${Date.now()}`,
        filename: file.name,
        file_path: `/storage/videos/${file.name}`,
        file_size_mb: Math.round((file.size / (1024 * 1024)) * 100) / 100,
        camera_id: cameraId,
        fps: 30,
        resolution: '1920x1080',
        total_frames: 300,
        duration_sec: 10.0,
        status: 'processed',
        sampled_frames_read: 50
      };
    }

    const res = await fetch(API_ROUTES.videoUpload, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.detail || `Upload failed with status ${res.status}`);
    }
    return await res.json();
  },

  // ── POST /api/cameras/:id/process-video ──────────────────
  async processCameraVideo(cameraId: string, videoId: string): Promise<any> {
    if (USE_MOCK) {
      return {
        message: `Video successfully associated with camera '${cameraId}'`,
        camera_id: cameraId,
        status: 'active_processing',
        fps: 30,
        resolution: '1920x1080',
        total_frames: 300,
        duration_sec: 10.0,
        sampled_frames_read: 50
      };
    }

    const params = new URLSearchParams({ video_id: videoId });
    return apiFetch(`${API_ROUTES.cameras}/${cameraId}/process-video?${params.toString()}`, { method: 'POST' });
  },

  // ── HELPER: GET VIDEO URL ─────────────────────────────────
  getVideoUrlForCamera(camera: Camera): string | null {
    if (!camera) return null;
    const host = API_BASE_URL.replace('/api/v1', '').replace(/\/$/, '');
    const CAMERA_DEMO_FILES: Record<string, string> = {
      'BORDER-CAM-07': 'gettyimages-2215078536-640_adpp.mp4',
      'SECTOR-B-CAM-03': 'gettyimages-2213890215-640_adpp.mp4',
      'BOP-NORTH-02': 'bop_north_02.mp4',
      'SOUTH-TRENCH-10': '17502678-hd_1080_1920_30fps.mp4',
    };

    const canonicalDemo = CAMERA_DEMO_FILES[camera.id];

    if (camera.protocol === 'SIMULATED_FILE' || camera.streamUrl?.endsWith('.mp4')) {
      let filename = camera.streamUrl?.split(/[/\\]/).pop();
      if (canonicalDemo && (!filename || filename.includes('test_sample') || filename.includes('dummy'))) {
        filename = canonicalDemo;
      }
      if (filename) {
        return `${host}/videos/${filename}`;
      }
    }
    // Return MJPEG stream for RTSP or Webcams if explicitly streaming, else demo video
    if (camera.protocol === 'RTSP' || camera.streamUrl?.startsWith('rtsp')) {
      if (canonicalDemo) {
        return `${host}/videos/${canonicalDemo}`;
      }
      return `${host}/api/v1/cameras/${camera.id}/stream`;
    }
    if (canonicalDemo) {
      return `${host}/videos/${canonicalDemo}`;
    }
    return null;
  },

  // ── GET /api/incidents ────────────────────────────────────
  getIncidents(): Promise<Incident[]> {
    return tryLive(
      () => apiFetch<Incident[]>(API_ROUTES.incidents),
      MOCK_INCIDENTS,
      'GET /incidents'
    );
  },

  // ── GET /api/incidents/:id ────────────────────────────────
  getIncidentById(id: string): Promise<Incident | undefined> {
    return tryLive(
      () => apiFetch<Incident>(API_ROUTES.incidentById(id)),
      MOCK_INCIDENTS.find(i => i.id === id),
      `GET /incidents/${id}`
    );
  },

  // ── PATCH /api/incidents/:id ──────────────────────────────
  async updateIncidentStatus(
    id: string,
    status: Incident['status']
  ): Promise<void> {
    if (USE_MOCK) return;
    try {
      await apiFetch(API_ROUTES.incidentById(id), {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      console.warn(`[IBVAP] Could not update incident ${id} status remotely.`, err);
    }
  },

  // ── GET /api/events ───────────────────────────────────────
  getEvents(): Promise<RawEvent[]> {
    return tryLive(
      () => apiFetch<RawEvent[]>(API_ROUTES.events),
      MOCK_RAW_EVENTS,
      'GET /events'
    );
  },

  // ── GET /api/detections ───────────────────────────────────
  getDetections(cameraId?: string): Promise<RawDetection[]> {
    const url = cameraId
      ? `${API_ROUTES.detections}?camera_id=${cameraId}`
      : API_ROUTES.detections;
    return tryLive(
      () => apiFetch<RawDetection[]>(url),
      [],
      'GET /detections'
    );
  },

  // ── POST /api/search/query (SentinelQuery AI) ─────────────
  async querySentinelAI(
    queryText: string,
    fallbackIncidents?: Incident[]
  ): Promise<{ filters: StructuredSearchFilters; results: Incident[] }> {
    // Local parse is always run first so the UI shows immediate feedback
    const filters = parseSentinelQuery(queryText);
    const localResults = searchIncidentVault(fallbackIncidents || MOCK_INCIDENTS, filters);

    return tryLive(
      () =>
        apiFetch<{ filters: StructuredSearchFilters; results: Incident[] }>(
          API_ROUTES.searchQuery,
          { method: 'POST', body: JSON.stringify({ query: queryText }) }
        ),
      { filters, results: localResults },
      'POST /search/query'
    );
  },

  // ── GET /api/zones ────────────────────────────────────────
  getZones(): Promise<VirtualZone[]> {
    return tryLive(
      () => apiFetch<VirtualZone[]>(API_ROUTES.zones),
      MOCK_ZONES,
      'GET /zones'
    );
  },

  // ── POST /api/zones ───────────────────────────────────────
  async createZone(zoneData: Partial<VirtualZone>): Promise<VirtualZone> {
    const newZone: VirtualZone = {
      id:                 zoneData.id ?? `ZONE-${Math.floor(10 + Math.random() * 90)}`,
      name:               zoneData.name ?? 'New Restricted Zone',
      sector:             zoneData.sector ?? 'Sector B',
      type:               zoneData.type ?? 'restricted_fence',
      sensitivity:        zoneData.sensitivity ?? 90,
      minThreatThreshold: zoneData.minThreatThreshold ?? 60,
      loiteringLimitSec:  zoneData.loiteringLimitSec ?? 15,
      active:             true,
      points:             zoneData.points ?? [
        { x: 10, y: 10 }, { x: 90, y: 10 },
        { x: 90, y: 90 }, { x: 10, y: 90 },
      ],
    };
    return tryLive(
      () => apiFetch<VirtualZone>(API_ROUTES.zones, {
        method: 'POST',
        body: JSON.stringify(newZone),
      }),
      newZone,
      'POST /zones'
    );
  },

  // ── PUT /api/zones/:id ────────────────────────────────────
  async updateZone(zoneId: string, zoneData: Partial<VirtualZone>): Promise<VirtualZone> {
    const bodyData = {
      name: zoneData.name,
      camera_id: (zoneData as any).cameraId || (zoneData as any).camera_id || 'BORDER-CAM-07',
      sector: zoneData.sector,
      zone_type: zoneData.type || (zoneData as any).zone_type || 'restricted_fence',
      polygon_coordinates: zoneData.points || (zoneData as any).polygon_coordinates || [],
      severity: (zoneData as any).alertSeverity || (zoneData as any).severity || 'high',
      sensitivity: zoneData.sensitivity ?? 90,
      min_threat_threshold: (zoneData as any).minThreatThreshold || (zoneData as any).min_threat_threshold || 60,
      loitering_limit_sec: zoneData.loiteringLimitSec || (zoneData as any).loitering_limit_sec || 15,
      enabled: zoneData.active !== undefined ? zoneData.active : true,
      human_detection: (zoneData as any).humanDetection !== undefined ? (zoneData as any).humanDetection : true,
      vehicle_detection: (zoneData as any).vehicleDetection !== undefined ? (zoneData as any).vehicleDetection : false,
      animal_detection: (zoneData as any).animalDetection !== undefined ? (zoneData as any).animalDetection : false,
      person_threshold: (zoneData as any).personThreshold !== undefined ? (zoneData as any).personThreshold : 1,
    };

    return tryLive(
      () => apiFetch<VirtualZone>(API_ROUTES.zoneById(zoneId), {
        method: 'PUT',
        body: JSON.stringify(bodyData),
      }),
      { ...zoneData, id: zoneId } as VirtualZone,
      `PUT /zones/${zoneId}`
    );
  },

  // ── DELETE /api/zones/:id ─────────────────────────────────
  async deleteZone(zoneId: string): Promise<void> {
    if (USE_MOCK) return;
    await apiFetch<void>(API_ROUTES.zoneById(zoneId), { method: 'DELETE' });
  },

  // ── GET /api/edge/status ──────────────────────────────────
  getEdgeStatus(): Promise<SystemMetrics> {
    return tryLive(
      () => apiFetch<SystemMetrics>(API_ROUTES.edgeStatus),
      INITIAL_METRICS,
      'GET /edge/status'
    );
  },

  // ── GET /api/sync/status ──────────────────────────────────
  getSyncStatus(): Promise<SyncJob[]> {
    return tryLive(
      () => apiFetch<SyncJob[]>(API_ROUTES.syncStatus),
      MOCK_SYNC_QUEUE,
      'GET /sync/status'
    );
  },

  // ── POST /api/sync/trigger ────────────────────────────────
  triggerSync(): Promise<any> {
    return tryLive(
      () => apiFetch<any>(API_ROUTES.syncTrigger, { method: 'POST' }),
      { success: true },
      'POST /sync/trigger'
    );
  },

  // ── GET /api/sync/connectivity ────────────────────────────
  getConnectivity(): Promise<{ central_connected: boolean }> {
    return tryLive(
      () => apiFetch<{ central_connected: boolean }>(API_ROUTES.syncConnectivity),
      { central_connected: false },
      'GET /sync/connectivity'
    );
  },

  // ── POST /api/sync/toggle-connectivity ────────────────────
  toggleConnectivity(connected?: boolean): Promise<{ central_connected: boolean; message: string }> {
    return tryLive(
      () => apiFetch<{ central_connected: boolean; message: string }>(
        `${API_ROUTES.syncToggleConnectivity}${connected !== undefined ? `?connected=${connected}` : ''}`, 
        { method: 'POST' }
      ),
      { central_connected: false, message: 'Connectivity toggled' },
      'POST /sync/toggle-connectivity'
    );
  },

  // ── GET /api/analytics/summary ────────────────────────────
  getAnalyticsSummary(): Promise<AnalyticsSummary> {
    return tryLive(
      () => apiFetch<AnalyticsSummary>(API_ROUTES.analytics),
      MOCK_ANALYTICS_SUMMARY,
      'GET /analytics/summary'
    );
  },

  // ── GET /api/anpr/stats ───────────────────────────────────
  getAnprStats(): Promise<ANPRStats> {
    return tryLive(
      () => apiFetch<ANPRStats>(API_ROUTES.anprStats),
      { total_reads: 0, unique_plates: 0, valid_format_count: 0, by_camera: {} },
      'GET /anpr/stats'
    );
  },

  // ── GET /api/anpr/search ──────────────────────────────────
  searchAnprRecords(params: { plate?: string; camera_id?: string; vehicle_class?: string; valid_only?: boolean; limit?: number }): Promise<ANPRObservation[]> {
    const query = new URLSearchParams();
    if (params.plate) query.append('plate', params.plate);
    if (params.camera_id) query.append('camera_id', params.camera_id);
    if (params.vehicle_class) query.append('vehicle_class', params.vehicle_class);
    if (params.valid_only !== undefined) query.append('valid_only', String(params.valid_only));
    if (params.limit) query.append('limit', String(params.limit));

    const url = `${API_ROUTES.anprSearch}?${query.toString()}`;
    return tryLive(
      () => apiFetch<ANPRObservation[]>(url),
      [],
      'GET /anpr/search'
    );
  },

  // ── GET /api/environment/condition ────────────────────────
  getEnvironmentCondition(): Promise<{ condition: string; confidence: number; ai_reliability?: number; human_verification_required?: boolean }> {
    return tryLive(
      () => apiFetch<{ condition: string; confidence: number; ai_reliability?: number; human_verification_required?: boolean }>(API_ROUTES.envCondition),
      { condition: 'normal', confidence: 99, ai_reliability: 95, human_verification_required: false },
      'GET /environment/condition'
    );
  },

  // ── POST /api/cameras/:id/detect  (YOLO + ByteTrack) ──────
  async runYoloDetection(
    cameraId: string,
    opts: { confThreshold?: number; frameStride?: number; maxFrames?: number } = {}
  ): Promise<YoloDetectResult> {
    const { confThreshold = 0.35, frameStride = 2, maxFrames = 150 } = opts;
    const url =
      `${API_ROUTES.detect(cameraId)}` +
      `?conf_threshold=${confThreshold}&frame_stride=${frameStride}&max_frames=${maxFrames}`;
    return apiFetch<YoloDetectResult>(url, { method: 'POST', timeoutMs: 60000 });
  },

  // ── POST /api/cameras/:id/detect-frame (Webcam Live Frame) ──
  async runWebcamInference(
    cameraId: string,
    fileBlob: Blob,
    confThreshold: number = 0.35
  ): Promise<{
    timestamp: string;
    person_count: number;
    detections: Array<{
      class: string;
      confidence: number;
      track_id: number | null;
      bounding_box: { x: number; y: number; width: number; height: number };
      bbox: { x: number; y: number; width: number; height: number };
    }>;
    vehicle_count: number;
    vehicle_detections: Array<{
      class: string;
      vehicle_class: string;
      confidence: number;
      track_id: number;
      track_label: string;
      bounding_box: { x: number; y: number; width: number; height: number };
      bbox: { x: number; y: number; width: number; height: number };
      direction: string;
      frames_seen: number;
    }>;
    incidents_created_count?: number;
    incident_ids?: string[];
    suspicious_activities?: any[];
    night_movements?: any[];
    security_events?: any[];
  }> {
    const formData = new FormData();
    formData.append('file', fileBlob, 'frame.jpg');

    if (USE_MOCK) {
      return {
        timestamp: new Date().toISOString(),
        person_count: 0,
        detections: [],
        vehicle_count: 0,
        vehicle_detections: [],
        suspicious_activities: [],
        night_movements: [],
      };
    }



    const url = `${API_ROUTES.detectFrame(cameraId)}?conf_threshold=${confThreshold}`;
    const res = await fetch(url, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.detail || `Frame inference failed: ${res.status}`);
    }
    return await res.json();
  },

  // ── POST /api/evidence (Webcam Evidence Upload) ────────────
  async uploadEvidence(formData: FormData): Promise<{
    success: boolean;
    incident_id: string;
    url: string;
  }> {
    if (USE_MOCK) {
      return {
        success: true,
        incident_id: `INC-MOCK-${Date.now()}`,
        url: ''
      };
    }

    const res = await fetch(API_ROUTES.evidence, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.detail || `Evidence upload failed: ${res.status}`);
    }
    return await res.json();
  },


  // ── GET /api/cameras/:id/tracks ───────────────────────────
  getCameraTracks(cameraId: string): Promise<TrackRecord[]> {
    return apiFetch<TrackRecord[]>(API_ROUTES.cameraTracks(cameraId));
  },

  // ── GET /api/cameras/:id/tracks/active ────────────────────
  getCameraActiveTracks(cameraId: string): Promise<TrackRecord[]> {
    return apiFetch<TrackRecord[]>(API_ROUTES.cameraActiveTracks(cameraId));
  },

  // ── GET /api/tracks ───────────────────────────────────────
  getAllTracks(state?: string): Promise<TrackRecord[]> {
    const url = state ? `${API_ROUTES.allTracks}?state=${state}` : API_ROUTES.allTracks;
    return apiFetch<TrackRecord[]>(url);
  },

  // ── PATCH /api/cameras/:id/inference-auto-start ────────────
  async updateCameraInferenceAutoStart(cameraId: string, autoStart: boolean): Promise<Camera> {
    if (USE_MOCK) {
      const mockCam = MOCK_CAMERAS.find(c => c.id === cameraId);
      if (mockCam) {
        mockCam.autoStartInference = autoStart;
        return normalizeCamera(mockCam);
      }
      throw new Error(`Camera ${cameraId} not found`);
    }

    const res = await apiFetch<Camera>(`${API_ROUTES.cameras}/${cameraId}/inference-auto-start?auto_start=${autoStart}`, {
      method: 'PATCH'
    });
    return normalizeCamera(res);
  },

  // ── Face Recognition Endpoints ──────────────────────────────
  async listRegisteredPeople(signal?: AbortSignal): Promise<RegisteredPerson[]> {
    return tryLive(
      async () => {
        const list = await apiFetch<RegisteredPerson[]>(`${API_BASE_URL}/faces/?active_only=false`, { signal });
        return list.map(p => ({
          ...p,
          personId: p.person_id,
          identityCode: p.identity_code,
          isActive: p.is_active,
          imagePath: p.image_path,
          createdAt: p.created_at,
          updatedAt: p.updated_at
        }));
      },
      mockRegisteredPeople,
      'GET /faces'
    );
  },

  async getFaceStatus(): Promise<{
    total_profiles: number;
    active_profiles: number;
    recognitions_today: number;
    unknown_detections: number;
    recent_recognitions: Array<{
      id: string;
      person_name: string;
      camera_name: string;
      sector: string;
      timestamp: string;
      confidence: number;
      status: 'MATCHED' | 'REVIEW';
      snapshot_url: string;
    }>;
  }> {
    return tryLive(
      () => apiFetch(`${API_BASE_URL}/faces/status`),
      {
        total_profiles: 3,
        active_profiles: 3,
        recognitions_today: 1,
        unknown_detections: 23,
        recent_recognitions: []
      },
      'GET /faces/status'
    );
  },

  async registerFace(formData: FormData): Promise<RegisteredPerson> {
    if (USE_MOCK) {
      const name = formData.get('name') as string;
      const identityCode = formData.get('identity_code') as string || undefined;
      if (identityCode && mockRegisteredPeople.some(p => p.identity_code === identityCode)) {
        throw new Error("Person with this identity code is already registered.");
      }
      const newPerson: RegisteredPerson = {
        id: `uuid-${Math.random().toString(36).substr(2, 9)}`,
        person_id: `person_${Math.random().toString(36).substr(2, 5)}`,
        name,
        identity_code: identityCode,
        identityCode,
        is_active: true,
        isActive: true,
        image_path: '',
        imagePath: '',
        created_at: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      newPerson.personId = newPerson.person_id;
      mockRegisteredPeople.push(newPerson);
      return newPerson;
    }

    const res = await apiFetch<RegisteredPerson>(`${API_BASE_URL}/faces/register`, {
      method: 'POST',
      body: formData,
    });
    return {
      ...res,
      personId: res.person_id,
      identityCode: res.identity_code,
      isActive: res.is_active,
      imagePath: res.image_path,
      createdAt: res.created_at,
      updatedAt: res.updated_at
    };
  },

  async getRegisteredPerson(personId: string): Promise<RegisteredPerson> {
    return tryLive(
      async () => {
        const res = await apiFetch<RegisteredPerson>(`${API_BASE_URL}/faces/${personId}`);
        return {
          ...res,
          personId: res.person_id,
          identityCode: res.identity_code,
          isActive: res.is_active,
          imagePath: res.image_path,
          createdAt: res.created_at,
          updatedAt: res.updated_at
        };
      },
      mockRegisteredPeople.find(p => p.person_id === personId || p.id === personId) || mockRegisteredPeople[0],
      `GET /faces/${personId}`
    );
  },

  async updateRegisteredPerson(personId: string, formData: FormData): Promise<RegisteredPerson> {
    if (USE_MOCK) {
      const idx = mockRegisteredPeople.findIndex(p => p.person_id === personId || p.id === personId);
      if (idx === -1) throw new Error("Registered person not found.");
      
      const name = formData.get('name') as string | null;
      const identityCode = formData.get('identity_code') as string | null;
      const isActiveStr = formData.get('is_active') as string | null;
      const isActive = isActiveStr !== null ? isActiveStr === 'true' : null;

      if (identityCode && identityCode !== mockRegisteredPeople[idx].identity_code) {
        if (mockRegisteredPeople.some(p => p.identity_code === identityCode)) {
          throw new Error("Person with this identity code is already registered.");
        }
      }

      const updated = { ...mockRegisteredPeople[idx] };
      if (name !== null) {
        updated.name = name;
      }
      if (identityCode !== null) {
        updated.identity_code = identityCode;
        updated.identityCode = identityCode;
      }
      if (isActive !== null) {
        updated.is_active = isActive;
        updated.isActive = isActive;
      }
      updated.updated_at = new Date().toISOString();
      updated.updatedAt = new Date().toISOString();

      mockRegisteredPeople[idx] = updated;
      return updated;
    }

    const res = await apiFetch<RegisteredPerson>(`${API_BASE_URL}/faces/${personId}`, {
      method: 'PUT',
      body: formData,
    });
    return {
      ...res,
      personId: res.person_id,
      identityCode: res.identity_code,
      isActive: res.is_active,
      imagePath: res.image_path,
      createdAt: res.created_at,
      updatedAt: res.updated_at
    };
  },

  async deleteRegisteredPerson(personId: string): Promise<{ message: string; person_id: string }> {
    if (USE_MOCK) {
      mockRegisteredPeople = mockRegisteredPeople.filter(p => p.person_id !== personId && p.id !== personId);
      return { message: "Registered person deleted successfully.", person_id: personId };
    }

    return await apiFetch<{ message: string; person_id: string }>(`${API_BASE_URL}/faces/${personId}`, {
      method: 'DELETE',
    });
  },

  async addFaceReference(personId: string, formData: FormData): Promise<any> {
    if (USE_MOCK) {
      const newRef = {
        id: `ref_${Date.now()}`,
        person_id: personId,
        image_path: `/storage/faces/${personId}_ref_${Date.now()}.jpg`,
        created_at: new Date().toISOString()
      };
      const p = mockRegisteredPeople.find(x => x.person_id === personId || x.id === personId);
      if (p) {
        p.references_count = (p.references_count || 1) + 1;
        p.references = p.references || [];
        p.references.push(newRef);
      }
      return newRef;
    }

    const res = await apiFetch<any>(`${API_BASE_URL}/faces/${personId}/references`, {
      method: 'POST',
      body: formData,
    });
    return {
      ...res,
      personId: res.person_id,
      imagePath: res.image_path,
      createdAt: res.created_at
    };
  },

  async listFaceReferences(personId: string): Promise<any[]> {
    if (USE_MOCK) {
      const p = mockRegisteredPeople.find(x => x.person_id === personId || x.id === personId);
      if (p && p.references) return p.references;
      return [
        {
          id: `ref_default_${personId}`,
          person_id: personId,
          image_path: `/storage/faces/${personId}.jpg`,
          created_at: new Date().toISOString()
        }
      ];
    }

    const refs = await apiFetch<any[]>(`${API_BASE_URL}/faces/${personId}/references`);
    return refs.map(r => ({
      ...r,
      personId: r.person_id,
      imagePath: r.image_path,
      createdAt: r.created_at
    }));
  },

  async deleteFaceReference(personId: string, referenceId: string): Promise<{ message: string; reference_id: string }> {
    if (USE_MOCK) {
      const p = mockRegisteredPeople.find(x => x.person_id === personId || x.id === personId);
      if (p) {
        if (p.is_active && (p.references_count || 1) <= 1) {
          throw new Error("Cannot delete the last remaining face reference for an active registered person.");
        }
        p.references_count = Math.max(1, (p.references_count || 1) - 1);
        p.references = (p.references || []).filter(r => r.id !== referenceId);
      }
      return { message: "Face reference deleted successfully.", reference_id: referenceId };
    }

    return await apiFetch<{ message: string; reference_id: string }>(`${API_BASE_URL}/faces/${personId}/references/${referenceId}`, {
      method: 'DELETE',
    });
  },

  async recognizeFace(formData: FormData): Promise<FaceRecognitionResult[]> {

    if (USE_MOCK) {
      return [
        {
          person_id: "person_david",
          personId: "person_david",
          name: "David",
          recognized: true,
          confidence: 0.94,
          bounding_box: [140, 140, 20, 20],
          boundingBox: [140, 140, 20, 20]
        }
      ];
    }

    const list = await apiFetch<FaceRecognitionResult[]>(`${API_BASE_URL}/faces/recognize`, {
      method: 'POST',
      body: formData,
    });
    return list.map(r => ({
      ...r,
      personId: r.person_id,
      boundingBox: r.bounding_box
    }));
  },

  // ── GET /api/v1/vehicles/stats ─────────────────────────────
  // Aggregate real-time vehicle counts across all cameras.
  async getVehicleStats(): Promise<VehicleStats> {
    const empty: VehicleStats = { total: 0, car: 0, motorcycle: 0, bus: 0, truck: 0, by_camera: {} };
    if (USE_MOCK) return empty;
    try {
      return await apiFetch<VehicleStats>(`${API_BASE_URL}/vehicles/stats`);
    } catch {
      return empty;
    }
  },

  // ── GET /api/v1/cameras/:id/vehicles ──────────────────────
  // Active vehicle tracks for a specific camera.
  async getCameraVehicles(cameraId: string): Promise<{ vehicle_count: number; vehicles: VehicleDetection[] }> {
    const empty = { vehicle_count: 0, vehicles: [] };
    if (USE_MOCK) return empty;
    try {
      return await apiFetch<{ vehicle_count: number; vehicles: VehicleDetection[] }>(
        `${API_BASE_URL}/cameras/${cameraId}/vehicles`
      );
    } catch {
      return empty;
    }
  },

  // ── GET /api/v1/anpr/stats ─────────────────────────────────
  async getANPRStats(): Promise<ANPRStats> {
    const empty: ANPRStats = { total_reads: 0, unique_plates: 0, valid_format_count: 0, by_camera: {} };
    if (USE_MOCK) return empty;
    try {
      return await apiFetch<ANPRStats>(`${API_BASE_URL}/anpr/stats`);
    } catch {
      return empty;
    }
  },

  // ── GET /api/v1/cameras/:id/anpr ───────────────────────────
  async getCameraANPR(cameraId: string, limit: number = 50): Promise<ANPRObservation[]> {
    if (USE_MOCK) return [];
    try {
      return await apiFetch<ANPRObservation[]>(`${API_BASE_URL}/cameras/${cameraId}/anpr?limit=${limit}`);
    } catch {
      return [];
    }
  },

  // ── GET /api/v1/anpr/search ────────────────────────────────
  async searchANPR(queryText: string, cameraId?: string): Promise<ANPRObservation[]> {
    if (USE_MOCK) return [];
    try {
      let url = `${API_BASE_URL}/anpr/search?plate=${encodeURIComponent(queryText)}`;
      if (cameraId) url += `&camera_id=${encodeURIComponent(cameraId)}`;
      return await apiFetch<ANPRObservation[]>(url);
    } catch {
      return [];
    }
  },

  // ── GET /api/v1/suspicious-activities ──────────────────────
  async getSuspiciousActivities(params?: {
    camera_id?: string;
    activity_type?: string;
    severity?: string;
    limit?: number;
  }): Promise<SuspiciousActivity[]> {
    if (USE_MOCK) return [];
    try {
      const q = new URLSearchParams();
      if (params?.camera_id) q.set('camera_id', params.camera_id);
      if (params?.activity_type) q.set('activity_type', params.activity_type);
      if (params?.severity) q.set('severity', params.severity);
      if (params?.limit) q.set('limit', String(params.limit));
      const qs = q.toString() ? `?${q.toString()}` : '';
      return await apiFetch<SuspiciousActivity[]>(`${API_ROUTES.suspiciousActivities}${qs}`);
    } catch {
      return [];
    }
  },

  // ── GET /api/v1/suspicious-activities/stats ────────────────
  async getSuspiciousActivityStats(): Promise<SuspiciousActivityStats> {
    const empty: SuspiciousActivityStats = {
      total_suspicious_activities: 0,
      activity_type_breakdown: {},
      camera_breakdown: {},
      severity_breakdown: {},
    };
    if (USE_MOCK) return empty;
    try {
      return await apiFetch<SuspiciousActivityStats>(API_ROUTES.suspiciousActivityStats);
    } catch {
      return empty;
    }
  },

  // ── GET /api/v1/cameras/:id/suspicious-activities ──────────
  async getCameraSuspiciousActivities(cameraId: string, limit: number = 50): Promise<SuspiciousActivity[]> {
    if (USE_MOCK) return [];
    try {
      return await apiFetch<SuspiciousActivity[]>(`${API_ROUTES.cameraSuspiciousActivities(cameraId)}?limit=${limit}`);
    } catch {
      return [];
    }
  },

  // ── GET /api/v1/night-movements ─────────────────────────────
  async getNightMovements(filters?: {
    cameraId?: string;
    trackId?: number;
    limit?: number;
  }): Promise<NightMovement[]> {
    if (USE_MOCK) return [];
    try {
      const params = new URLSearchParams();
      if (filters?.cameraId) params.append('camera_id', filters.cameraId);
      if (filters?.trackId !== undefined) params.append('track_id', String(filters.trackId));
      if (filters?.limit) params.append('limit', String(filters.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      return await apiFetch<NightMovement[]>(`${API_ROUTES.nightMovements}${qs}`);
    } catch {
      return [];
    }
  },

  // ── GET /api/v1/night-movements/stats ───────────────────────
  async getNightMovementStats(): Promise<NightMovementStats> {
    const empty: NightMovementStats = {
      total_night_movements: 0,
      camera_breakdown: {},
    };
    if (USE_MOCK) return empty;
    try {
      return await apiFetch<NightMovementStats>(API_ROUTES.nightMovementStats);
    } catch {
      return empty;
    }
  },

  // ── GET /api/v1/cameras/:id/night-movements ─────────────────
  async getCameraNightMovements(cameraId: string, limit: number = 50): Promise<NightMovement[]> {
    if (USE_MOCK) return [];
    try {
      return await apiFetch<NightMovement[]>(`${API_ROUTES.cameraNightMovements(cameraId)}?limit=${limit}`);
    } catch {
      return [];
    }
  },

  // ── GET /api/v1/security-events ─────────────────────────────
  async getSecurityEvents(params?: {
    camera_id?: string;
    threat_level?: string;
    status?: string;
    subject_type?: string;
    track_id?: number;
    limit?: number;
    offset?: number;
  }): Promise<UnifiedSecurityEvent[]> {
    if (USE_MOCK) return [];
    try {
      const q = new URLSearchParams();
      if (params?.camera_id) q.set('camera_id', params.camera_id);
      if (params?.threat_level) q.set('threat_level', params.threat_level);
      if (params?.status) q.set('status', params.status);
      if (params?.subject_type) q.set('subject_type', params.subject_type);
      if (params?.track_id !== undefined) q.set('track_id', String(params.track_id));
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      const url = qs ? `${API_ROUTES.securityEvents}?${qs}` : API_ROUTES.securityEvents;
      return await apiFetch<UnifiedSecurityEvent[]>(url);
    } catch (err) {
      console.error('[apiClient] getSecurityEvents failed:', err);
      return [];
    }
  },

  // ── GET /api/v1/security-events/:id ─────────────────────────
  async getSecurityEventById(eventId: string): Promise<UnifiedSecurityEvent | null> {
    if (USE_MOCK) return null;
    try {
      return await apiFetch<UnifiedSecurityEvent>(API_ROUTES.securityEventById(eventId));
    } catch (err) {
      console.error('[apiClient] getSecurityEventById failed:', err);
      return null;
    }
  },

  // ── GET /api/v1/security-events/stats ───────────────────────
  async getSecurityEventStats(): Promise<SecurityEventStats> {
    const empty: SecurityEventStats = {
      total_events: 0,
      active_events: 0,
      resolved_events: 0,
      threat_level_breakdown: {},
      camera_breakdown: {},
      contributing_signal_breakdown: {},
    };
    if (USE_MOCK) return empty;
    try {
      return await apiFetch<SecurityEventStats>(API_ROUTES.securityEventStats);
    } catch (err) {
      console.error('[apiClient] getSecurityEventStats failed:', err);
      return empty;
    }
  },

  // ── GET /api/v1/cameras/:id/security-events ─────────────────
  async getCameraSecurityEvents(cameraId: string, limit: number = 50): Promise<UnifiedSecurityEvent[]> {
    if (USE_MOCK) return [];
    try {
      return await apiFetch<UnifiedSecurityEvent[]>(`${API_ROUTES.cameraSecurityEvents(cameraId)}?limit=${limit}`);
    } catch (err) {
      console.error('[apiClient] getCameraSecurityEvents failed:', err);
      return [];
    }
  },

  // ── GET /api/v1/c2/status ───────────────────────────────────
  async getC2Status(): Promise<C2Status> {
    const fallback: C2Status = {
      enabled: false,
      endpoint_configured: false,
      connected: false,
      last_delivery: null,
      delivered_count: 0,
      failed_count: 0,
    };
    if (USE_MOCK) return fallback;
    try {
      return await apiFetch<C2Status>(API_ROUTES.c2Status);
    } catch (err) {
      console.error('[apiClient] getC2Status failed:', err);
      return fallback;
    }
  },

  // ── GET /api/v1/c2/events ───────────────────────────────────
  async getC2Deliveries(params?: {
    status?: string;
    security_event_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<C2DeliveryResponse> {
    const fallback: C2DeliveryResponse = {
      total: 0,
      limit: params?.limit || 50,
      offset: params?.offset || 0,
      deliveries: [],
    };
    if (USE_MOCK) return fallback;
    try {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.security_event_id) q.set('security_event_id', params.security_event_id);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      const qs = q.toString();
      const url = qs ? `${API_ROUTES.c2Events}?${qs}` : API_ROUTES.c2Events;
      return await apiFetch<C2DeliveryResponse>(url);
    } catch (err) {
      console.error('[apiClient] getC2Deliveries failed:', err);
      return fallback;
    }
  },

  // ── GET /api/v1/c2/events/:id ───────────────────────────────
  async getC2DeliveryById(id: string): Promise<C2DeliveryRecord | null> {
    if (USE_MOCK) return null;
    try {
      return await apiFetch<C2DeliveryRecord>(API_ROUTES.c2EventById(id));
    } catch (err) {
      console.error('[apiClient] getC2DeliveryById failed:', err);
      return null;
    }
  },

  // ── POST /api/v1/c2/test-event ──────────────────────────────
  async triggerC2TestEvent(): Promise<any> {
    if (USE_MOCK) {
      return { status: 'mock_skipped', message: 'Mock mode: C2 disabled' };
    }
    return await apiFetch<any>(API_ROUTES.c2TestEvent, { method: 'POST' });
  },
};


// ─────────────────────────────────────────────────────────────
// Lightweight types for raw backend events
// ─────────────────────────────────────────────────────────────
export interface RawEvent {
  id: string;
  camera: string;
  type: 'DETECTION' | 'ZONE_BREACH' | 'CAMERA_DOWN' | 'SYNC_COMPLETE';
  object: string;
  confidence: number;
  timestamp: string;
}

export interface RawDetection {
  id: string;
  camera_id: string;
  frame_index: number;
  timestamp_sec: number;
  object_type: string;
  fine_class?: string;
  confidence: number;
  track_id?: string;
  bounding_box: { x: number; y: number; width: number; height: number };
  bbox_pixels?: { x1: number; y1: number; x2: number; y2: number };
  timestamp: string;
}

/** Represents a single ByteTrack track record from the backend */
export interface TrackRecord {
  id: string;
  camera_id: string;
  track_id: number;            // Real ByteTrack integer ID — never randomly generated
  fine_class: string;          // e.g. "person", "car", "bus"
  object_type: string;         // "human" | "vehicle" | "animal"
  state: 'new' | 'active' | 'lost';
  confidence_max: number;
  confidence_last: number;
  bounding_box: { x: number; y: number; width: number; height: number };
  frame_first: number;
  frame_last: number;
  frames_seen: number;
  video_ts_first_sec: number;
  video_ts_last_sec: number;
  created_at?: string;
}

/** Response shape from POST /api/cameras/:id/detect */
export interface YoloDetectResult {
  success: boolean;
  camera_id: string;
  camera_name: string;
  video_path: string;
  conf_threshold_used: number;
  frame_stride_used: number;
  frames_analyzed: number;
  elapsed_sec: number;
  total_detections: number;
  saved_detections_to_db: number;
  saved_tracks_to_db: number;
  incidents_created_count?: number;
  incidents_created?: any[];
  suspicious_activities?: any[];
  night_movements?: any[];
  security_events?: any[];
  track_counts: { new: number; active: number; lost: number; total: number };

  detections: RawDetection[];
  tracks: TrackRecord[];
}

export interface AnalyticsSummary {
  totalIncidents: number;
  criticalCount:  number;
  highCount:      number;
  mediumCount:    number;
  lowCount:       number;
  falseAlarms:    number;
  resolvedToday:  number;
  avgThreatScore: number;
  topSector:      string;
  totalDetections?: number;
  confirmedThreats?: number;
  filteredSuppressed?: number;
  aiConfidence?: number;
  peopleDetected?: number;
  vehiclesDetected?: number;
  unknownTargets?: number;
  activeCameras?: number;
  totalCameras?: number;
  threatDistribution?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  cameraStatuses?: Array<{
    id: string;
    name: string;
    status: string;
    sector: string;
  }>;
  hourlyActivity?: Array<{
    time: string;
    count: number;
  }>;
  totalCandidateDetections?: number;
  filteredNoiseCount?: number;
  falseAlarmReductionRate?: number;
}

// ─────────────────────────────────────────────────────────────
// Internal mock fallbacks
// ─────────────────────────────────────────────────────────────
const MOCK_RAW_EVENTS: RawEvent[] = [
  { id: 'EVT-01', camera: 'BORDER-CAM-07',   type: 'DETECTION',   object: 'human',   confidence: 94.8, timestamp: 'Just now'    },
  { id: 'EVT-02', camera: 'SECTOR-B-CAM-03', type: 'ZONE_BREACH', object: 'vehicle', confidence: 89.2, timestamp: '2 mins ago'  },
  { id: 'EVT-03', camera: 'EAST-PERIM-04',   type: 'DETECTION',   object: 'animal',  confidence: 71.3, timestamp: '8 mins ago'  },
];

const MOCK_ANALYTICS_SUMMARY: AnalyticsSummary = {
  totalIncidents: MOCK_INCIDENTS.length,
  criticalCount:  MOCK_INCIDENTS.filter(i => i.severity === 'critical').length,
  highCount:      MOCK_INCIDENTS.filter(i => i.severity === 'high').length,
  mediumCount:    MOCK_INCIDENTS.filter(i => i.severity === 'medium').length,
  lowCount:       MOCK_INCIDENTS.filter(i => i.severity === 'low').length,
  falseAlarms:    MOCK_INCIDENTS.filter(i => i.status === 'false_alarm').length,
  resolvedToday:  MOCK_INCIDENTS.filter(i => i.status === 'verified').length,
  avgThreatScore: Math.round(
    MOCK_INCIDENTS.reduce((acc, i) => acc + i.threatScore, 0) / MOCK_INCIDENTS.length
  ),
  topSector: 'Sector B',
};

const MOCK_VEHICLE_STATS: VehicleStats = {
  total: 0,
  car: 0,
  motorcycle: 0,
  bus: 0,
  truck: 0,
  by_camera: {},
};
