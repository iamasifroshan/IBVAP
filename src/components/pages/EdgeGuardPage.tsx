import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HardDrive, RefreshCw, Cpu, Activity, Clock, Wifi, WifiOff,
  CheckCircle2, AlertTriangle, Database, Server,
  Radio, RotateCcw, Camera as CameraIcon, Eye, ChevronRight,
  Shield, Zap, Monitor, Signal, XCircle, Info, ArrowRight,
  Settings, Layers, CircleDot
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NetworkStatus, Camera } from '../../types';
import { ibvapApi } from '../../services/apiClient';

// ── IST Timestamp Formatter ────────────────────────────────────
const formatTimestampIST = (raw: string | Date | undefined | null): string => {
  if (!raw) return '—';
  try {
    const date = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(date.getTime())) return String(raw);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZone: 'Asia/Kolkata',
    }).format(date);
  } catch { return String(raw); }
};

const formatUptime = (seconds: number | undefined): string => {
  if (seconds === undefined || seconds === null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
};

// ── Status Dot Component ────────────────────────────────────────
const StatusDot: React.FC<{ status: 'online' | 'ready' | 'degraded' | 'offline' | 'unknown' | 'connecting' }> = ({ status }) => {
  const color = {
    online: 'bg-emerald-500',
    ready: 'bg-emerald-500',
    degraded: 'bg-amber-500',
    offline: 'bg-red-500',
    unknown: 'bg-slate-400',
    connecting: 'bg-amber-500 animate-pulse',
  }[status] || 'bg-slate-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${color} shrink-0`} />;
};

// ── Health data interface ────────────────────────────────────────
interface HealthData {
  status?: string;
  service?: string;
  database?: string;
  storage?: string;
  ready?: boolean;
  cameras?: { total: number; online: number; offline: number };
  ai_subsystems?: {
    overall?: string;
    yolo?: string;
    yunet?: string;
    sface?: string;
  };
  runtime?: {
    uptime_seconds?: number;
    memory_mb?: number;
  };
}

export const EdgeGuardPage: React.FC = () => {
  const {
    metrics,
    networkStatus,
    setNetworkStatus,
    cameras,
    syncQueue: globalSyncQueue,
    triggerManualSync,
    setActivePage,
    setActiveCameraId,
  } = useApp();

  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState(false);
  const [isCentralConnected, setIsCentralConnected] = useState<boolean>(networkStatus === 'online');
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [syncStepMessage, setSyncStepMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());

  // ── Fetch /health endpoint ─────────────────────────────────────
  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(false);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';
      const healthUrl = API_BASE_URL.replace(/\/api\/v1\/?$/, '/health');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('Health check failed');
      const data: HealthData = await res.json();
      setHealthData(data);
      setLastRefreshTime(new Date());
    } catch {
      setHealthError(true);
      setHealthData(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // ── Check connectivity ─────────────────────────────────────────
  const checkConnectivity = useCallback(async () => {
    try {
      const conn = await ibvapApi.getConnectivity();
      setIsCentralConnected(conn.central_connected);
    } catch {
      setIsCentralConnected(networkStatus === 'online');
    }
  }, [networkStatus]);

  useEffect(() => {
    fetchHealth();
    checkConnectivity();
    const interval = setInterval(() => {
      fetchHealth();
      checkConnectivity();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchHealth, checkConnectivity]);

  // ── Sync handler ───────────────────────────────────────────────
  const handleNetworkChange = async (status: NetworkStatus) => {
    setNetworkStatus(status);
    setIsCentralConnected(status !== 'offline');
    try {
      await ibvapApi.toggleConnectivity(status !== 'offline');
      if (status === 'online') {
        setTimeout(() => handleRealSyncExecution(), 100);
      }
    } catch { /* fallback */ }
  };

  const handleRealSyncExecution = async () => {
    setSyncStepMessage(null);
    setSyncError(false);
    if (networkStatus === 'offline') {
      setSyncStepMessage('Cannot sync: Central Server is currently DISCONNECTED.');
      setSyncError(true);
      return;
    }
    setIsSyncing(true);
    setSyncStepMessage('Synchronizing locally stored incidents & evidence...');
    try {
      const result = await triggerManualSync();
      setSyncStepMessage(result.message);
      setSyncError(!result.success);
    } catch (err: any) {
      setSyncStepMessage('Synchronization failed: ' + (err.message || String(err)));
      setSyncError(true);
    } finally {
      setIsSyncing(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────────
  const storageUsedGB = (metrics.storageUsedMb / 1024).toFixed(2);
  const storageLimitGB = Math.round(metrics.storageLimitMb / 1024);
  const storagePct = Math.min(100, Math.round((metrics.storageUsedMb / (metrics.storageLimitMb || 8192)) * 100));

  const unsyncedCount = globalSyncQueue.filter(
    item => item.status === 'unsynced' || item.status === 'queued' || item.status === 'failed' || item.status === 'syncing'
  ).length;

  // Camera counts from real camera array
  const onlineCameras = cameras.filter(c => {
    const s = (c.status || '').toLowerCase();
    return s === 'online' || s === 'configured';
  }).length;
  const degradedCameras = cameras.filter(c => (c.status || '').toLowerCase() === 'degraded').length;
  const offlineCameras = cameras.filter(c => {
    const s = (c.status || '').toLowerCase();
    return s === 'offline' || s === 'error';
  }).length;

  // Global system status
  const globalStatus = useMemo(() => {
    if (healthError || !healthData) {
      if (networkStatus === 'connecting') return 'CONNECTING';
      if (networkStatus === 'offline') return 'OFFLINE';
      return 'UNKNOWN';
    }
    if (healthData.status === 'healthy' && healthData.ready) {
      if (offlineCameras > 0 || degradedCameras > 0) return 'DEGRADED';
      return 'OPERATIONAL';
    }
    if (healthData.status === 'degraded') return 'DEGRADED';
    return 'OFFLINE';
  }, [healthData, healthError, networkStatus, offlineCameras, degradedCameras]);

  const globalStatusStyle = {
    OPERATIONAL: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    DEGRADED: 'bg-amber-50 text-amber-700 border-amber-200',
    OFFLINE: 'bg-red-50 text-red-700 border-red-200',
    CONNECTING: 'bg-blue-50 text-blue-700 border-blue-200',
    UNKNOWN: 'bg-slate-100 text-slate-600 border-slate-300',
  }[globalStatus] || 'bg-slate-100 text-slate-600 border-slate-300';

  // AI subsystem rows
  const aiModules = useMemo(() => {
    const subs = healthData?.ai_subsystems;
    return [
      { name: 'OBJECT DETECTION', model: 'YOLOv8n', status: subs?.yolo || null },
      { name: 'TRACKING', model: 'ByteTrack', status: subs?.yolo ? subs.yolo : null }, // ByteTrack is tied to YOLO
      { name: 'FACE DETECTION', model: 'YuNet', status: subs?.yunet || null },
      { name: 'FACE RECOGNITION', model: 'SFace', status: subs?.sface || null },
      { name: 'ANPR', model: 'EasyOCR', status: subs?.overall === 'READY' ? 'READY' : null }, // EasyOCR is part of overall
      { name: 'SUSPICIOUS ACTIVITY', model: 'Rule Engine', status: subs?.overall === 'READY' ? 'READY' : null },
      { name: 'NIGHT MOVEMENT', model: 'Rule Engine', status: subs?.overall === 'READY' ? 'READY' : null },
      { name: 'UNIFIED INTELLIGENCE', model: 'Threat Engine', status: subs?.overall === 'READY' ? 'READY' : null },
    ];
  }, [healthData]);

  // Service conditions
  const serviceConditions = useMemo(() => {
    const conditions: { label: string; severity: 'warning' | 'error' | 'info' }[] = [];
    if (healthError) {
      conditions.push({ label: 'BACKEND HEALTH CHECK FAILED', severity: 'error' });
    }
    if (networkStatus === 'offline') {
      conditions.push({ label: 'CENTRAL SERVER DISCONNECTED', severity: 'warning' });
    }
    if (networkStatus === 'connecting') {
      conditions.push({ label: 'CONNECTING TO BACKEND', severity: 'info' });
    }
    cameras.forEach(c => {
      const s = (c.status || '').toLowerCase();
      if (s === 'offline' || s === 'error') {
        conditions.push({ label: `CAMERA ${c.id} OFFLINE`, severity: 'warning' });
      }
      if (s === 'degraded') {
        conditions.push({ label: `CAMERA ${c.id} DEGRADED`, severity: 'warning' });
      }
    });
    if (healthData?.database && healthData.database !== 'healthy') {
      conditions.push({ label: 'DATABASE HEALTH DEGRADED', severity: 'error' });
    }
    if (unsyncedCount > 0) {
      conditions.push({ label: `${unsyncedCount} RECORDS PENDING SYNCHRONIZATION`, severity: 'info' });
    }
    return conditions;
  }, [healthError, networkStatus, cameras, healthData, unsyncedCount]);

  const mapAiStatus = (status: string | null): 'online' | 'degraded' | 'offline' | 'unknown' => {
    if (!status) return 'unknown';
    const s = status.toUpperCase();
    if (s === 'READY' || s === 'LOADED' || s === 'ACTIVE') return 'online';
    if (s === 'DEGRADED' || s === 'PARTIAL') return 'degraded';
    if (s === 'ERROR' || s === 'FAILED' || s === 'OFFLINE') return 'offline';
    return 'unknown';
  };

  const mapAiLabel = (status: string | null): string => {
    if (!status) return 'UNKNOWN';
    return status.toUpperCase();
  };

  return (
    <div className="space-y-4">

      {/* ── HEADER ──────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded bg-slate-900 flex items-center justify-center shrink-0">
              <HardDrive className="w-4.5 h-4.5 text-sky-400" />
            </div>
            <div>
              <h1 className="font-heading text-xl sm:text-2xl lg:text-[28px] font-bold text-[#0B1F33] tracking-tight uppercase">
                EDGE OPERATIONS
              </h1>
              <p className="text-[13px] sm:text-[14px] text-slate-500 font-medium font-body mt-0.5">
                Edge Surveillance Operations Center • Operational health and runtime status of the IBVAP edge surveillance pipeline.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SYSTEM STATUS</span>
          <span className={`px-3 py-1 rounded border text-[11px] font-extrabold tracking-wider uppercase ${globalStatusStyle}`}>
            {globalStatus === 'OPERATIONAL' && '● '}
            {globalStatus === 'DEGRADED' && '◐ '}
            {globalStatus === 'OFFLINE' && '○ '}
            {globalStatus === 'CONNECTING' && '◌ '}
            {globalStatus === 'UNKNOWN' && '— '}
            {globalStatus}
          </span>
          <button
            onClick={() => { fetchHealth(); checkConnectivity(); }}
            disabled={healthLoading}
            className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh status"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── OPERATIONAL STATUS STRIP ────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* Edge Runtime */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between min-h-[92px]">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">EDGE RUNTIME</div>
          <div className="flex items-center gap-2">
            <StatusDot status={
              networkStatus === 'online' ? 'online' :
              networkStatus === 'connecting' ? 'connecting' :
              healthError ? 'offline' : 'unknown'
            } />
            <span className="text-sm sm:text-[15px] font-bold text-[#0B1F33] uppercase">
              {networkStatus === 'online' ? 'ONLINE' :
               networkStatus === 'connecting' ? 'CONNECTING' :
               networkStatus === 'offline' ? 'OFFLINE' : 'UNKNOWN'}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">
            {healthData?.service || 'IBVAP Backend'} {healthData?.ready ? '• Ready' : ''}
          </div>
        </div>

        {/* AI Inference */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between min-h-[92px]">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">AI INFERENCE</div>
          <div className="flex items-center gap-2">
            <StatusDot status={mapAiStatus(healthData?.ai_subsystems?.overall || null)} />
            <span className="text-sm sm:text-[15px] font-bold text-[#0B1F33] uppercase">
              {mapAiLabel(healthData?.ai_subsystems?.overall || null)}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">YOLO / Face / ANPR</div>
        </div>

        {/* Camera Network */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between min-h-[92px]">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">CAMERA NETWORK</div>
          <div className="flex items-center gap-2">
            <StatusDot status={
              cameras.length === 0 ? 'unknown' :
              offlineCameras > 0 ? 'degraded' :
              'online'
            } />
            <span className="text-sm sm:text-[15px] font-bold text-[#0B1F33] uppercase">
              {onlineCameras} / {cameras.length} ONLINE
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">
            {degradedCameras > 0 ? `${degradedCameras} Degraded • ` : ''}{offlineCameras > 0 ? `${offlineCameras} Offline` : 'All nominal'}
          </div>
        </div>

        {/* Event Channel */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between min-h-[92px]">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">EVENT CHANNEL</div>
          <div className="flex items-center gap-2">
            <StatusDot status={
              networkStatus === 'online' ? 'online' :
              networkStatus === 'connecting' ? 'connecting' : 'offline'
            } />
            <span className="text-sm sm:text-[15px] font-bold text-[#0B1F33] uppercase">
              {networkStatus === 'online' ? 'CONNECTED' :
               networkStatus === 'connecting' ? 'RECONNECTING' : 'DISCONNECTED'}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">WebSocket</div>
        </div>

        {/* Database */}
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between min-h-[92px]">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">DATABASE</div>
          <div className="flex items-center gap-2">
            <StatusDot status={
              healthData?.database === 'healthy' ? 'online' :
              healthData?.database ? 'degraded' : 'unknown'
            } />
            <span className="text-sm sm:text-[15px] font-bold text-[#0B1F33] uppercase">
              {healthData?.database === 'healthy' ? 'CONNECTED' :
               healthData?.database ? healthData.database.toUpperCase() : 'UNKNOWN'}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono">SQLite</div>
        </div>
      </div>

      {/* ── EDGE RUNTIME + AI PIPELINE (Two-Column) ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">

        {/* ── EDGE RUNTIME STATUS ────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-3 sm:px-4.5 sm:py-3.5 bg-slate-50/90 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-[#1F5F8B]" />
              <span className="font-heading text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">
                EDGE RUNTIME STATUS
              </span>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            <RuntimeRow label="BACKEND" value={healthData?.status === 'healthy' ? 'ONLINE' : healthData?.status?.toUpperCase() || 'UNKNOWN'} mono />
            <RuntimeRow label="HOST" value={metrics.edgeNodeId || 'LOCAL EDGE NODE'} mono />
            <RuntimeRow label="PORT" value="8000" mono />
            <RuntimeRow label="UPTIME" value={healthData?.runtime?.uptime_seconds !== undefined ? formatUptime(healthData.runtime.uptime_seconds) : '—'} mono />
            <RuntimeRow label="MEMORY" value={healthData?.runtime?.memory_mb !== undefined ? `${healthData.runtime.memory_mb.toFixed(1)} MB` : '—'} mono />
            <RuntimeRow label="STORAGE" value={`${storageUsedGB} GB / ${storageLimitGB} GB (${storagePct}%)`} mono />
            <RuntimeRow label="DATABASE" value={healthData?.database === 'healthy' ? 'HEALTHY' : healthData?.database?.toUpperCase() || 'UNKNOWN'} mono />
            <RuntimeRow label="GPU" value="NOT REQUIRED" info="CPU inference mode" />
            <RuntimeRow label="LAST SYNC" value={formatTimestampIST(metrics.lastSyncTimestamp)} mono />
          </div>

          {/* Network Mode & Sync Controls */}
          <div className="p-4 sm:p-4.5 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">NETWORK MODE</span>
              <span className={`text-[11px] font-mono font-bold ${
                networkStatus === 'offline' ? 'text-amber-600' : 'text-emerald-600'
              }`}>
                {networkStatus === 'offline' ? 'OFFLINE / LOCAL EDGE' : 'ONLINE / FULL CLOUD'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => handleNetworkChange('online')}
                className={`py-2 px-3 border rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  networkStatus === 'online'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Wifi className="w-3.5 h-3.5" /> Force Online
              </button>
              <button
                onClick={() => handleNetworkChange('offline')}
                className={`py-2 px-3 border rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  networkStatus === 'offline'
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <WifiOff className="w-3.5 h-3.5" /> Force Offline
              </button>
            </div>
            <button
              onClick={handleRealSyncExecution}
              disabled={isSyncing}
              className="w-full py-2.5 px-4 bg-[#1F5F8B] hover:bg-[#184B6E] text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Synchronizing...' : 'TRIGGER MISSION SYNC'}
            </button>
            {syncStepMessage && (
              <div className={`text-xs p-2.5 rounded-lg border font-medium ${
                syncError
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-blue-50 text-[#1F5F8B] border-blue-200'
              }`}>
                {syncStepMessage}
              </div>
            )}
          </div>
        </div>

        {/* ── AI PIPELINE HEALTH ─────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-3 sm:px-4.5 sm:py-3.5 bg-slate-50/90 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#1F5F8B]" />
                <span className="font-heading text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">
                  AI PIPELINE HEALTH
                </span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                healthData?.ai_subsystems?.overall === 'READY'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : healthData?.ai_subsystems?.overall
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-slate-100 text-slate-500 border border-slate-200'
              }`}>
                {healthData?.ai_subsystems?.overall || 'UNKNOWN'}
              </span>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {aiModules.map((mod, idx) => (
              <div key={idx} className="px-4 py-2.5 sm:px-4.5 sm:py-3 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                <div className="min-w-0">
                  <div className="text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">{mod.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">{mod.model}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusDot status={mapAiStatus(mod.status)} />
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${
                    mapAiStatus(mod.status) === 'online' ? 'text-emerald-600' :
                    mapAiStatus(mod.status) === 'degraded' ? 'text-amber-600' :
                    mapAiStatus(mod.status) === 'offline' ? 'text-red-600' :
                    'text-slate-500'
                  }`}>
                    {mapAiLabel(mod.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CAMERA OPERATIONS MATRIX ────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
        <div className="px-4 py-3 sm:px-4.5 sm:py-3.5 bg-slate-50/90 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CameraIcon className="w-4 h-4 text-[#1F5F8B]" />
            <span className="font-heading text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">
              CAMERA OPERATIONS
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-200 text-slate-700">
              {cameras.length} UNITS
            </span>
          </div>
          {selectedCamera && (
            <button
              onClick={() => setSelectedCamera(null)}
              className="text-xs text-slate-500 hover:text-slate-700 font-medium cursor-pointer"
            >
              Close Inspector
            </button>
          )}
        </div>
        <div className={`grid ${selectedCamera ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'} divide-x divide-slate-200`}>
          {/* Camera List */}
          <div className={`${selectedCamera ? 'lg:col-span-7' : ''} divide-y divide-slate-100`}>
            {cameras.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                <CameraIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-600">NO CAMERAS REGISTERED</p>
              </div>
            ) : (
              cameras.map(cam => {
                const camStatus = (cam.status || '').toLowerCase();
                const isSelected = selectedCamera?.id === cam.id;
                return (
                  <div
                    key={cam.id}
                    onClick={() => setSelectedCamera(cam)}
                    className={`px-4 py-3 sm:px-4.5 sm:py-3.5 flex items-center justify-between gap-3.5 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50 border-l-4 border-l-[#1F5F8B]' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <StatusDot status={
                        camStatus === 'online' || camStatus === 'configured' ? 'online' :
                        camStatus === 'degraded' ? 'degraded' :
                        camStatus === 'offline' || camStatus === 'error' ? 'offline' : 'unknown'
                      } />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-[13px] font-bold text-[#0B1F33] font-mono truncate">{cam.id}</div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">{cam.name} • {cam.sector}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-[11px] font-bold uppercase ${
                        camStatus === 'online' || camStatus === 'configured' ? 'text-emerald-600' :
                        camStatus === 'degraded' ? 'text-amber-600' :
                        'text-red-600'
                      }`}>
                        {(cam.status || 'UNKNOWN').toUpperCase()}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">{cam.protocol || '—'}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Camera Inspector */}
          {selectedCamera && (
            <div className="lg:col-span-5 p-4 sm:p-5 space-y-3.5 bg-slate-50/40">
              <div className="flex items-center justify-between">
                <span className="font-heading text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">CAMERA INSPECTOR</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  (selectedCamera.status || '').toLowerCase() === 'online' || (selectedCamera.status || '').toLowerCase() === 'configured'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {(selectedCamera.status || 'UNKNOWN').toUpperCase()}
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <InspectorRow label="CAMERA ID" value={selectedCamera.id} mono />
                <InspectorRow label="NAME" value={selectedCamera.name} />
                <InspectorRow label="SECTOR" value={selectedCamera.sector} />
                <InspectorRow label="OUTPOST" value={selectedCamera.outpost} />
                <InspectorRow label="SOURCE TYPE" value={selectedCamera.protocol || '—'} mono />
                <InspectorRow label="RESOLUTION" value={selectedCamera.resolution || '—'} mono />
                <InspectorRow label="FPS" value={selectedCamera.fps ? `${selectedCamera.fps} fps` : '—'} mono />
                <InspectorRow label="HEALTH SCORE" value={`${selectedCamera.healthScore}%`} mono />
                <InspectorRow label="AI RELIABILITY" value={`${selectedCamera.aiReliability}%`} mono />
                <InspectorRow label="VISIBILITY" value={`${selectedCamera.visibilityScore}%`} mono />
                <InspectorRow label="ACTIVE ZONE" value={selectedCamera.activeZone || '—'} />
                <InspectorRow label="NIGHT VISION" value={selectedCamera.nightVisionMode ? 'ENABLED' : 'DISABLED'} />
                <InspectorRow label="LAST ACTIVITY" value={selectedCamera.lastActivity || '—'} />
              </div>
              <button
                onClick={() => {
                  setActiveCameraId(selectedCamera.id);
                  setActivePage('live-surveillance');
                }}
                className="w-full py-2 bg-[#1F5F8B] hover:bg-[#184B6E] text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-2xs cursor-pointer mt-2"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>OPEN LIVE SURVEILLANCE</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── PERFORMANCE TELEMETRY + EVENT CHANNEL (Two-Column) ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">

        {/* ── PERFORMANCE TELEMETRY ──────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-3 sm:px-4.5 sm:py-3.5 bg-slate-50/90 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#1F5F8B]" />
              <span className="font-heading text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">
                PERFORMANCE TELEMETRY
              </span>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            <RuntimeRow label="AI INFERENCE FPS" value={metrics.processingFps ? `${metrics.processingFps} FPS` : '—'} mono />
            <RuntimeRow label="ACTIVE CAMERAS" value={`${onlineCameras} / ${cameras.length}`} mono />
            <RuntimeRow label="TOTAL INCIDENTS" value={`${metrics.activeAlerts}`} mono />
            <RuntimeRow label="CRITICAL ALERTS" value={`${metrics.criticalAlerts}`} mono />
            <RuntimeRow label="SYNC QUEUE" value={`${globalSyncQueue.length} total • ${unsyncedCount} pending`} mono />
            <RuntimeRow label="FALSE ALARM REDUCTION" value={`${metrics.falseAlarmReductionRate}%`} mono />
            <RuntimeRow label="EDGE NODE" value={metrics.edgeNodeId || '—'} mono />
            <RuntimeRow label="LOCATION" value={metrics.edgeNodeLocation || '—'} />
          </div>
        </div>

        {/* ── EVENT CHANNEL ──────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-3 sm:px-4.5 sm:py-3.5 bg-slate-50/90 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#1F5F8B]" />
              <span className="font-heading text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">
                EVENT CHANNEL
              </span>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            <RuntimeRow label="WEBSOCKET" value={
              networkStatus === 'online' ? 'CONNECTED' :
              networkStatus === 'connecting' ? 'RECONNECTING' :
              'DISCONNECTED'
            } mono />
            <RuntimeRow label="ENDPOINT" value="ws://localhost:8000/ws/detections" mono />
            <RuntimeRow label="EVENT TYPES" value="incident_event, security_event_update, security_event_resolved" />
            <RuntimeRow label="CENTRAL SERVER" value={isCentralConnected ? 'CONNECTED' : 'DISCONNECTED'} mono />
            <RuntimeRow label="CONNECTIVITY MODE" value={networkStatus === 'offline' ? 'OFFLINE / LOCAL EDGE' : 'ONLINE / FULL CLOUD'} mono />
            <RuntimeRow label="LAST REFRESH" value={formatTimestampIST(lastRefreshTime)} mono />
          </div>

          {/* Storage Gauge */}
          <div className="p-4 border-t border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-500 uppercase tracking-wider">LOCAL VAULT STORAGE</span>
              <span className="font-mono font-bold text-[#0B1F33]">{storageUsedGB} GB / {storageLimitGB} GB</span>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  storagePct > 90 ? 'bg-red-500' : storagePct > 70 ? 'bg-amber-500' : 'bg-[#1F5F8B]'
                }`}
                style={{ width: `${storagePct}%` }}
              />
            </div>
            <div className="text-[11px] text-slate-400 font-mono">{storagePct}% capacity utilized</div>
          </div>
        </div>
      </div>

      {/* ── SERVICE CONDITIONS + OPERATOR ACTIONS ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">

        {/* ── SERVICE CONDITIONS ──────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-3 sm:px-4.5 sm:py-3.5 bg-slate-50/90 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#1F5F8B]" />
              <span className="font-heading text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">
                SERVICE CONDITIONS
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                serviceConditions.length === 0
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
                {serviceConditions.length === 0 ? 'CLEAR' : `${serviceConditions.length} ACTIVE`}
              </span>
            </div>
          </div>
          {serviceConditions.length === 0 ? (
            <div className="p-6 text-center">
              <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
              <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">NO ACTIVE SERVICE CONDITIONS</div>
              <p className="text-[11px] text-slate-400 mt-1">All subsystems operating within normal parameters.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {serviceConditions.map((cond, idx) => (
                <div key={idx} className="px-4 py-3 flex items-center gap-2.5">
                  {cond.severity === 'error' ? (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  ) : cond.severity === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  ) : (
                    <Info className="w-4 h-4 text-blue-500 shrink-0" />
                  )}
                  <span className={`text-xs font-bold uppercase tracking-wider ${
                    cond.severity === 'error' ? 'text-red-700' :
                    cond.severity === 'warning' ? 'text-amber-700' :
                    'text-blue-700'
                  }`}>
                    {cond.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── OPERATOR ACTIONS ────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
          <div className="px-4 py-3 sm:px-4.5 sm:py-3.5 bg-slate-50/90 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#1F5F8B]" />
              <span className="font-heading text-xs sm:text-[13px] font-bold text-[#0B1F33] uppercase tracking-wider">
                OPERATOR ACTIONS
              </span>
            </div>
          </div>
          <div className="p-4 sm:p-4.5 space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <ActionButton
                label="OPEN LIVE SURVEILLANCE"
                icon={<Eye className="w-4 h-4" />}
                onClick={() => setActivePage('live-surveillance')}
              />
              <ActionButton
                label="SYSTEM VERIFICATION"
                icon={<Shield className="w-4 h-4" />}
                onClick={() => setActivePage('system-verification')}
              />
              <ActionButton
                label="SYSTEM SETTINGS"
                icon={<Settings className="w-4 h-4" />}
                onClick={() => setActivePage('settings')}
              />
              <ActionButton
                label="REFRESH STATUS"
                icon={<RefreshCw className={`w-4 h-4 ${healthLoading ? 'animate-spin' : ''}`} />}
                onClick={() => { fetchHealth(); checkConnectivity(); }}
                disabled={healthLoading}
              />
            </div>

            {/* System Verification Link */}
            <div className="pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                <div>
                  <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">NEED DETAILED VALIDATION?</div>
                  <p className="text-[11px] text-slate-400 mt-0.5">Run comprehensive subsystem verification tests.</p>
                </div>
                <button
                  onClick={() => setActivePage('system-verification')}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer shrink-0"
                >
                  <Zap className="w-3.5 h-3.5 text-[#1F5F8B]" />
                  OPEN SYSTEM VERIFICATION
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────

const RuntimeRow: React.FC<{ label: string; value: string; mono?: boolean; info?: string }> = ({ label, value, mono, info }) => (
  <div className="px-4 py-2.5 sm:px-4.5 sm:py-3 flex items-center justify-between gap-2.5">
    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">{label}</span>
    <div className="flex items-center gap-1.5 min-w-0">
      <span className={`text-xs sm:text-[13px] font-bold text-[#0B1F33] truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
      {info && <span className="text-[10px] text-slate-400 shrink-0">({info})</span>}
    </div>
  </div>
);

const InspectorRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-center justify-between gap-2.5 py-1">
    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">{label}</span>
    <span className={`text-xs sm:text-[13px] font-bold text-[#0B1F33] text-right truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);

const ActionButton: React.FC<{ label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }> = ({ label, icon, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="px-3.5 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center gap-2 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
  >
    {icon}
    <span className="truncate">{label}</span>
  </button>
);
