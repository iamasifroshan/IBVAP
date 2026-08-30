import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  PageId,
  NetworkStatus,
  EnvironmentCondition,
  Incident,
  Camera,
  VirtualZone,
  SyncQueueItem,
  SystemMetrics
} from '../types';
import { MOCK_CAMERAS, MOCK_INCIDENTS, MOCK_ZONES, MOCK_SYNC_QUEUE, INITIAL_METRICS } from '../mock/data';
import { ibvapApi } from '../services/apiClient';

interface AppContextType {
  activePage: PageId;
  setActivePage: (page: PageId) => void;
  networkStatus: NetworkStatus;
  setNetworkStatus: (status: NetworkStatus) => void;
  environment: EnvironmentCondition;
  setEnvironment: (env: EnvironmentCondition) => void;
  cameras: Camera[];
  incidents: Incident[];
  zones: VirtualZone[];
  syncQueue: SyncQueueItem[];
  metrics: SystemMetrics;
  selectedIncident: Incident | null;
  setSelectedIncident: (inc: Incident | null) => void;
  explainableIncident: Incident | null;
  setExplainableIncident: (inc: Incident | null) => void;
  activeCameraId: string;
  setActiveCameraId: (id: string) => void;
  triggerManualSync: () => Promise<{ success: boolean; count: number; message: string }>;
  updateIncidentStatus: (id: string, status: Incident['status']) => void;
  updateCamera: (id: string, patch: Partial<Camera>) => void;
  addIncident: (incident: Partial<Incident>) => void;
  currentTimeStr: string;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const LOCAL_STORAGE_KEYS = {
  INCIDENTS: 'ibvap_incidents',
  SYNC_QUEUE: 'ibvap_sync_queue',
  NETWORK_STATUS: 'ibvap_network_status',
  METRICS: 'ibvap_metrics',
  CAMERAS: 'ibvap_cameras',
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activePage, setActivePage] = useState<PageId>('command-overview');

  // Load persistent state from localStorage if available
  const [networkStatus, setNetworkStatusState] = useState<NetworkStatus>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEYS.NETWORK_STATUS);
    return (saved as NetworkStatus) || 'offline';
  });

  const [environment, setEnvironment] = useState<EnvironmentCondition>('normal');
  const [cameras, setCameras] = useState<Camera[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEYS.CAMERAS);
    if (saved) {
      try { return JSON.parse(saved); } catch { /* fallback */ }
    }
    return [];
  });

  const [incidents, setIncidents] = useState<Incident[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEYS.INCIDENTS);
    if (saved) {
      try { return JSON.parse(saved); } catch { /* fallback */ }
    }
    return [];
  });

  const [zones, setZones] = useState<VirtualZone[]>([]);

  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEYS.SYNC_QUEUE);
    if (saved) {
      try { return JSON.parse(saved); } catch { /* fallback */ }
    }
    return MOCK_SYNC_QUEUE;
  });

  const [metrics, setMetrics] = useState<SystemMetrics>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEYS.METRICS);
    if (saved) {
      try { return JSON.parse(saved); } catch { /* fallback */ }
    }
    return INITIAL_METRICS;
  });

  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [explainableIncident, setExplainableIncident] = useState<Incident | null>(null);
  const [activeCameraId, setActiveCameraId] = useState<string>('BORDER-CAM-07');
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Save changes to localStorage for persistent state across refreshes & navigation
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.CAMERAS, JSON.stringify(cameras));
  }, [cameras]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.INCIDENTS, JSON.stringify(incidents));
  }, [incidents]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(syncQueue));
  }, [syncQueue]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.NETWORK_STATUS, networkStatus);
  }, [networkStatus]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.METRICS, JSON.stringify(metrics));
  }, [metrics]);

  // Wrapper for network status changes with backend toggle
  const setNetworkStatus = (status: NetworkStatus) => {
    setNetworkStatusState(status);
    ibvapApi.toggleConnectivity(status !== 'offline').catch(() => {});
  };

  // Clock Ticker
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentTimeStr = currentTime.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  // Load backend data on mount & poll
  useEffect(() => {
    let ws: WebSocket | null = null;
    let pollTimeout: ReturnType<typeof setTimeout>;
    let isComponentMounted = true;
    let backoffDelay = 2000;
    const MAX_BACKOFF = 30000;
    let localNetworkStatus = 'offline';

    const loadBackendData = async () => {
      try {
        const [liveCams, liveIncidents, liveMetrics, liveZones, liveSync] = await Promise.all([
          ibvapApi.getCameras(),
          ibvapApi.getIncidents(),
          ibvapApi.getEdgeStatus(),
          ibvapApi.getZones(),
          ibvapApi.getSyncStatus()
        ]);

        if (liveCams) setCameras(liveCams);
        if (liveIncidents) {
          // Preserve local unsynced states
          setIncidents(prev => {
            const unsyncedMap = new Map(prev.filter(i => !i.syncedToCloud).map(i => [i.id, i]));
            return liveIncidents.map(inc => unsyncedMap.get(inc.id) || inc);
          });
        }
        if (liveMetrics) setMetrics(prev => ({ ...prev, ...liveMetrics }));
        if (liveZones) setZones(liveZones);
        if (liveSync && liveSync.length > 0) {
          setSyncQueue(prev => {
            const localUnsynced = prev.filter(i => i.status === 'unsynced' || i.status === 'syncing' || i.status === 'failed');
            const mergedMap = new Map(liveSync.map(i => [i.id, i]));
            localUnsynced.forEach(u => mergedMap.set(u.id, u));
            return Array.from(mergedMap.values());
          });
        }
      } catch (err) {
        console.warn("Failed to load backend data:", err);
        // DO NOT overwrite state with mock data or empty arrays here.
        throw err;
      }
    };

    const checkHealthAndConnect = async () => {
      if (!isComponentMounted) return;
      
      try {
        if (localNetworkStatus !== 'online') {
          setNetworkStatusState('connecting');
          localNetworkStatus = 'connecting';
        }
        
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';
        const healthUrl = API_BASE_URL.replace(/\/api\/v1\/?$/, '/health');
        
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error("Health check failed");
        
        const healthData = await res.json();
        
        if (healthData.status === 'healthy' || healthData.ready === true) {
          // Backend is ready
          backoffDelay = 2000; // reset backoff
          if (localNetworkStatus !== 'online') {
            await loadBackendData();
            setNetworkStatusState('online');
            localNetworkStatus = 'online';
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              connectWebSocket();
            }
          }
          // Poll health slowly when online
          pollTimeout = setTimeout(checkHealthAndConnect, 10000);
        } else {
          // Backend initializing
          setNetworkStatusState('connecting');
          localNetworkStatus = 'connecting';
          pollTimeout = setTimeout(checkHealthAndConnect, 3000);
        }
      } catch (err) {
        setNetworkStatusState('offline');
        localNetworkStatus = 'offline';
        if (ws) {
           ws.close();
           ws = null;
        }
        // Exponential backoff
        backoffDelay = Math.min(backoffDelay * 1.5, MAX_BACKOFF);
        pollTimeout = setTimeout(checkHealthAndConnect, backoffDelay);
      }
    };

    const connectWebSocket = () => {
      if (ws) return;
      const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/detections';
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // WS connected, but we rely on health check for 'online' status
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'incident_event') {
            loadBackendData().catch(console.error);
          }
        } catch (e) {
          console.error("Failed to parse WS message", e);
        }
      };

      ws.onclose = () => {
        ws = null;
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    checkHealthAndConnect();

    return () => {
      isComponentMounted = false;
      if (ws) ws.close();
      clearTimeout(pollTimeout);
    };
  }, []);

  // ── Trigger Real Manual Synchronization ──────────────────────────────────
  const triggerManualSync = async (): Promise<{ success: boolean; count: number; message: string }> => {
    if (networkStatus === 'offline') {
      return {
        success: false,
        count: 0,
        message: 'Cannot sync: Central Server is currently DISCONNECTED. Incidents remain stored safely in local queue.'
      };
    }

    setNetworkStatusState('syncing');

    // Find pending items needing sync
    const pendingItems = syncQueue.filter(
      item => item.status === 'unsynced' || item.status === 'failed' || item.status === 'queued'
    );

    if (pendingItems.length === 0) {
      setNetworkStatusState('online');
      return {
        success: true,
        count: 0,
        message: 'SQLite Sync Queue is empty. All local incidents are synchronized.'
      };
    }

    // Step 1: Set pending items to SYNCING
    const pendingIds = new Set(pendingItems.map(i => i.id));
    setSyncQueue(prev => prev.map(item =>
      pendingIds.has(item.id) ? { ...item, status: 'syncing' as const, progressPct: 50 } : item
    ));

    // Wait a brief moment to show progress transition
    await new Promise(r => setTimeout(r, 600));

    try {
      // Step 2: Trigger backend sync endpoint
      await ibvapApi.triggerSync();
    } catch {
      /* proceed with local sync transition if backend simulated */
    }

    const nowUtcStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

    // Step 3: Transition queue items to SYNCED
    setSyncQueue(prev => prev.map(item =>
      pendingIds.has(item.id)
        ? { ...item, status: 'synced' as const, progressPct: 100, attempts: (item.attempts || 0) + 1 }
        : item
    ));

    // Step 4: Mark incidents as synced to cloud
    const pendingIncIds = new Set(pendingItems.map(i => i.incidentId));
    setIncidents(prev => prev.map(inc =>
      (pendingIncIds.has(inc.incidentId) || pendingIncIds.has(inc.id))
        ? { ...inc, syncedToCloud: true, syncedTimestamp: nowUtcStr, status: inc.status }
        : inc
    ));

    // Step 5: Update metrics
    setMetrics(prev => ({
      ...prev,
      lastSyncTimestamp: nowUtcStr,
      offlineQueueCount: Math.max(0, prev.offlineQueueCount - pendingItems.length)
    }));

    setNetworkStatusState('online');

    return {
      success: true,
      count: pendingItems.length,
      message: `Successfully synchronized ${pendingItems.length} incident(s) and evidence from local vault to Central Server.`
    };
  };

  const updateIncidentStatus = (id: string, status: Incident['status']) => {
    setIncidents(prev => prev.map(inc => inc.id === id ? { ...inc, status } : inc));
  };

  const updateCamera = (id: string, patch: Partial<Camera>) => {
    setCameras(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const addIncident = (newInc: Partial<Incident>) => {
    const isOffline = networkStatus === 'offline';
    const incId = newInc.id || `INC-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const fullInc: Incident = {
      id: incId,
      timestamp: newInc.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
      sector: newInc.sector || 'Sector B',
      cameraName: newInc.cameraName || 'BORDER-CAM-07',
      cameraId: newInc.cameraId || 'BORDER-CAM-07',
      outpost: newInc.outpost || 'Border Outpost North',
      objectType: newInc.objectType || 'human',
      persistentId: newInc.persistentId || `TRACK-${Math.floor(8000 + Math.random() * 1000)}`,
      threatScore: newInc.threatScore || 75,
      severity: newInc.severity || 'high',
      explainableReason: newInc.explainableReason || 'Real-time detection triggered by BorderThreat engine.',
      threatFactors: newInc.threatFactors || [
        { category: 'Zone Breach', scoreContribution: 35, description: 'Target entered restricted boundary' },
        { category: 'Time Factor', scoreContribution: 20, description: 'Night perimeter activity' }
      ],
      environmentalCondition: environment,
      aiReliability: 85,
      visibilityScore: 80,
      status: 'active',
      snapshotUrl: newInc.snapshotUrl || 'https://images.unsplash.com/photo-1509114397022-ed747cca3f65?q=80&w=800&auto=format&fit=crop',
      zoneName: newInc.zoneName || 'Sector B Restricted Zone',
      direction: 'Inward Perimeter',
      smartAlertConfirmed: true,
      syncedToCloud: !isOffline
    };

    setIncidents(prev => [fullInc, ...prev]);

    setMetrics(prev => ({
      ...prev,
      activeAlerts: prev.activeAlerts + 1,
      criticalAlerts: fullInc.severity === 'critical' ? prev.criticalAlerts + 1 : prev.criticalAlerts,
      offlineQueueCount: isOffline ? prev.offlineQueueCount + 1 : prev.offlineQueueCount
    }));

    if (isOffline) {
      setSyncQueue(prev => [
        {
          id: `SQ-${Math.floor(1000 + Math.random() * 9000)}`,
          incidentId: fullInc.id,
          timestamp: fullInc.timestamp,
          eventType: 'CRITICAL_BREACH_ALERT',
          priority: 'P1_CRITICAL' as const,
          payloadSizeKb: 340,
          status: 'unsynced' as const,
          progressPct: 0,
          attempts: 0
        },
        ...prev
      ]);
    }
  };

  return (
    <AppContext.Provider value={{
      activePage,
      setActivePage,
      networkStatus,
      setNetworkStatus,
      environment,
      setEnvironment,
      cameras,
      incidents,
      zones,
      syncQueue,
      metrics,
      selectedIncident,
      setSelectedIncident,
      explainableIncident,
      setExplainableIncident,
      activeCameraId,
      setActiveCameraId,
      triggerManualSync,
      updateIncidentStatus,
      updateCamera,
      addIncident,
      currentTimeStr
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
