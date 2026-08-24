/**
 * IBVAP API Configuration
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for all backend connection settings.
 * Values are read from Vite environment variables (.env file).
 *
 * To switch from mock data to real FastAPI backend:
 *   1. Start the Python/FastAPI server: uvicorn main:app --reload --port 8000
 *   2. Change VITE_USE_MOCK=false in your .env file
 *   3. The app will automatically use live backend data
 *
 * Backend contract: Python/FastAPI at http://localhost:8000/api/v1
 */

// ─── Core URL config ──────────────────────────────────────────
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

export const WS_BASE_URL: string =
  import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws/detections';

/**
 * Master switch: when true the app uses built-in mock data
 * (EdgeGuard offline-safe mode). When false it calls FastAPI.
 *
 * Default: true  (safe — always works without a running backend)
 */
export const USE_MOCK: boolean =
  (import.meta.env.VITE_USE_MOCK ?? 'true') === 'true';

// ─── Route catalogue ──────────────────────────────────────────
/** All backend REST endpoints in one place. */
export const API_ROUTES = {
  // Camera management
  cameras:        `${API_BASE_URL}/cameras`,
  cameraById:     (id: string) => `${API_BASE_URL}/cameras/${id}`,
  cameraStatus:   (id: string) => `${API_BASE_URL}/cameras/${id}/status`,
  cameraStream:   (id: string) => `${API_BASE_URL}/cameras/${id}/stream`,

  // Video processing & MP4 Upload
  videoUpload:       `${API_BASE_URL}/videos/upload`,
  processVideo:      (cameraId: string) => `${API_BASE_URL}/cameras/${cameraId}/process-video`,
  cameraStreamStatus: (cameraId: string) => `${API_BASE_URL}/cameras/${cameraId}/stream-status`,

  // Incidents & detections
  incidents:      `${API_BASE_URL}/incidents`,
  incidentById:   (id: string) => `${API_BASE_URL}/incidents/${id}`,
  events:         `${API_BASE_URL}/events`,
  detections:     `${API_BASE_URL}/detections`,
  detect:         (cameraId: string) => `${API_BASE_URL}/cameras/${cameraId}/detect`,
  detectFrame:    (cameraId: string) => `${API_BASE_URL}/cameras/${cameraId}/detect-frame`,
  cameraDetections: (cameraId: string) => `${API_BASE_URL}/cameras/${cameraId}/detections`,
  evidence:       `${API_BASE_URL}/evidence`,

  // ByteTrack tracking
  cameraTracks:       (cameraId: string) => `${API_BASE_URL}/cameras/${cameraId}/tracks`,
  cameraActiveTracks: (cameraId: string) => `${API_BASE_URL}/cameras/${cameraId}/tracks/active`,
  allTracks:          `${API_BASE_URL}/tracks`,

  // AI search
  searchQuery:    `${API_BASE_URL}/search/query`,

  // Virtual zones
  zones:          `${API_BASE_URL}/zones`,
  zoneById:       (id: string) => `${API_BASE_URL}/zones/${id}`,

  // EdgeGuard / system
  edgeStatus:     `${API_BASE_URL}/edge/status`,
  syncStatus:     `${API_BASE_URL}/sync/status`,
  syncTrigger:    `${API_BASE_URL}/sync/trigger`,

  // Analytics
  analytics:      `${API_BASE_URL}/analytics/summary`,
  threatHistory:  `${API_BASE_URL}/analytics/threats`,

  // Environment
  envCondition:   `${API_BASE_URL}/environment/condition`,

  // WebSocket (real-time)
  wsDetections:   WS_BASE_URL,
} as const;

// ─── HTTP helper ──────────────────────────────────────────────
interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Typed fetch wrapper with timeout and standard JSON headers.
 * Throws on non-2xx responses so callers can catch cleanly.
 */
export async function apiFetch<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const { timeoutMs = 8000, ...rest } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...rest.headers,
      },
      ...rest,
    });

    if (!response.ok) {
      // Try to extract the FastAPI error detail from the response body
      let detail = `${response.status}: ${response.statusText}`;
      try {
        const errBody = await response.json();
        if (errBody?.detail) {
          detail = typeof errBody.detail === 'string'
            ? errBody.detail
            : JSON.stringify(errBody.detail);
        }
      } catch {
        // Body was not JSON — use the status text
      }
      const err = new Error(`API error ${detail} — ${url}`) as any;
      err.apiDetail = detail;
      throw err;
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
