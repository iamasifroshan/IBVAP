import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDrive, RefreshCw, Cpu, Activity, Clock, Settings2, Wifi, WifiOff,
  ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Database, Server,
  ShieldCheck, ArrowUpRight, Radio, Filter, RotateCcw
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SyncQueueItem, NetworkStatus } from '../../types';
import { ibvapApi } from '../../services/apiClient';

// ── Centralized Timestamp Formatters ───────────────────────────────────────
const formatTimestampIST = (raw: string | Date | undefined | null): string => {
  if (!raw) return '—';
  try {
    const date = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(date.getTime())) return String(raw);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'Asia/Kolkata', timeZoneName: 'short'
    }).format(date);
  } catch { return String(raw); }
};

const formatTimestampUTC = (raw: string | Date | undefined | null): string => {
  if (!raw) return '—';
  try {
    const date = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(date.getTime())) return String(raw);
    return new Intl.DateTimeFormat('en-US', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'UTC', timeZoneName: 'short'
    }).format(date);
  } catch { return String(raw); }
};

export const EdgeGuardPage: React.FC = () => {
  const {
    metrics,
    networkStatus,
    setNetworkStatus,
    syncQueue: globalSyncQueue,
    triggerManualSync
  } = useApp();

  const [queueFilter, setQueueFilter] = useState<'all' | 'unsynced' | 'synced'>('all');
  const [syncStepMessage, setSyncStepMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isCentralConnected, setIsCentralConnected] = useState<boolean>(networkStatus === 'online');
  const [showTechnical, setShowTechnical] = useState<boolean>(false);

  // Check connectivity status periodically
  const checkConnectivity = useCallback(async () => {
    try {
      const conn = await ibvapApi.getConnectivity();
      setIsCentralConnected(conn.central_connected);
    } catch {
      setIsCentralConnected(networkStatus === 'online');
    }
  }, [networkStatus]);

  useEffect(() => {
    checkConnectivity();
    const interval = setInterval(checkConnectivity, 5000);
    return () => clearInterval(interval);
  }, [checkConnectivity]);

  // Execute synchronization
  const handleRealSyncExecution = async () => {
    setSyncStepMessage(null);
    setSyncError(false);

    if (networkStatus === 'offline') {
      setSyncStepMessage('Cannot sync: Central Server is currently DISCONNECTED. Incidents remain stored safely in local queue.');
      setSyncError(true);
      return;
    }

    setIsSyncing(true);
    setSyncStepMessage('Synchronizing locally stored incidents & evidence to central server...');

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

  const handleNetworkChange = async (status: NetworkStatus) => {
    setNetworkStatus(status);
    setIsCentralConnected(status !== 'offline');
    try {
      await ibvapApi.toggleConnectivity(status !== 'offline');
    } catch {
      /* fallback */
    }
  };

  // Filtered queue items
  const filteredQueue = globalSyncQueue.filter(item => {
    if (queueFilter === 'unsynced') return item.status === 'unsynced' || item.status === 'queued' || item.status === 'failed' || item.status === 'syncing';
    if (queueFilter === 'synced') return item.status === 'synced';
    return true;
  });

  const unsyncedCount = globalSyncQueue.filter(
    item => item.status === 'unsynced' || item.status === 'queued' || item.status === 'failed' || item.status === 'syncing'
  ).length;

  // Storage calculations
  const storageUsedGB = (metrics.storageUsedMb / 1024).toFixed(2);
  const storageLimitGB = Math.round(metrics.storageLimitMb / 1024);
  const storagePct = Math.min(100, Math.round((metrics.storageUsedMb / (metrics.storageLimitMb || 8192)) * 100));

  return (
    <div className="space-y-[20px]">

      {/* ── 1. PAGE HEADER ────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-[20px]">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center shrink-0">
            <HardDrive className="w-6 h-6 text-[#1D4ED8]" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[24px] font-bold text-[#0B1F33] tracking-tight">EdgeGuard</h1>
              <span className="text-[13px] font-semibold text-slate-500">• Offline-First Edge Intelligence</span>
            </div>
            <p className="text-[14px] text-slate-500 mt-0.5">
              Zero internet dependency for AI processing and local storage.
            </p>
          </div>
        </div>

        {/* Far right status badge */}
        <div className="shrink-0">
          <span className={`px-4 py-2 rounded-full border text-[12px] font-extrabold tracking-wider uppercase flex items-center gap-2 shadow-sm ${
            networkStatus === 'online'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            {networkStatus === 'online' ? <Wifi className="w-4 h-4 text-emerald-600" /> : <WifiOff className="w-4 h-4 text-amber-600" />}
            {networkStatus === 'online' ? '● ONLINE — FULL CLOUD' : '● OFFLINE — LOCAL EDGE'}
          </span>
        </div>
      </div>

      {/* ── 2. TOP SYSTEM STATUS CARDS ───────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[20px]">

        {/* Card 1: Edge Node ID */}
        <div className="bg-white border border-slate-200 rounded-lg p-[18px] shadow-sm flex flex-col justify-between h-full">
          <div>
            <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">Edge Node</span>
            <div className="text-[20px] font-bold text-[#0B1F33] font-mono mt-2 flex items-center gap-2">
              <Cpu className="w-5 h-5 text-[#1F5F8B] shrink-0" />
              <span className="truncate">{metrics.edgeNodeId || 'BOP-NORTH-EDGE-01'}</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-400 font-medium mt-3 block">Border Outpost North</span>
        </div>

        {/* Card 2: AI Engine Status */}
        <div className="bg-white border border-slate-200 rounded-lg p-[18px] shadow-sm flex flex-col justify-between h-full">
          <div>
            <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">AI Engine Status</span>
            <div className="text-[20px] font-bold text-emerald-600 mt-2 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500 shrink-0" />
              <span>● Active</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-400 font-medium mt-3 block">YOLOv8n + ByteTrack</span>
        </div>

        {/* Card 3: Local Vault Storage */}
        <div className="bg-white border border-slate-200 rounded-lg p-[18px] shadow-sm flex flex-col justify-between h-full">
          <div>
            <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">Local Vault Storage</span>
            <div className="text-[20px] font-bold text-[#0B1F33] mt-2 flex items-baseline gap-1">
              <span>{storageUsedGB} GB</span>
              <span className="text-[13px] text-slate-400 font-normal">/ {storageLimitGB} GB</span>
            </div>
            {/* Subtle Progress Bar */}
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-3">
              <div
                className="bg-[#1F5F8B] h-full rounded-full transition-all duration-500"
                style={{ width: `${storagePct}%` }}
              />
            </div>
          </div>
          <span className="text-[11px] text-slate-400 font-medium mt-2 block">{storagePct}% Capacity Utilized</span>
        </div>

        {/* Card 4: Last Successful Sync */}
        <div className="bg-white border border-slate-200 rounded-lg p-[18px] shadow-sm flex flex-col justify-between h-full">
          <div>
            <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">Last Successful Sync</span>
            <div className="text-[13px] font-bold text-[#0B1F33] font-mono mt-2 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="truncate">{formatTimestampUTC(metrics.lastSyncTimestamp)}</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-400 font-medium mt-3 block">UTC Sync Timestamp</span>
        </div>
      </div>

      {/* ── 3. MAIN CONTENT GRID (42% / 58%) ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[20px]">

        {/* ── LEFT COLUMN: OPERATIONS & CONTROLS (42%) ──────────── */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden h-fit">
          <div className="px-[20px] py-[14px] border-b border-slate-100">
            <h2 className="text-[14px] font-bold text-[#0B1F33] uppercase tracking-wider">Operations & Controls</h2>
          </div>

          <div className="p-[20px] space-y-[20px]">

            {/* Network Mode */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[13px] font-bold text-[#0B1F33] uppercase tracking-wide">Network Mode</span>
                <span className={`text-[11px] font-mono font-bold ${
                  networkStatus === 'offline' ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {networkStatus === 'offline' ? 'OFFLINE / LOCAL EDGE' : 'ONLINE / FULL CLOUD'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleNetworkChange('online')}
                  className={`py-2.5 px-3 border rounded-lg text-[13px] font-semibold transition-colors shadow-sm flex items-center justify-center gap-1.5 ${
                    networkStatus === 'online'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-bold'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Wifi className="w-4 h-4" /> Force Online
                </button>
                <button
                  onClick={() => handleNetworkChange('offline')}
                  className={`py-2.5 px-3 border rounded-lg text-[13px] font-semibold transition-colors shadow-sm flex items-center justify-center gap-1.5 ${
                    networkStatus === 'offline'
                      ? 'bg-amber-50 border-amber-200 text-amber-700 font-bold'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <WifiOff className="w-4 h-4" /> Force Offline
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-slate-100 pt-[16px] space-y-3">
              <span className="text-[13px] font-bold text-[#0B1F33] uppercase tracking-wide block">Manual Synchronization</span>
              <p className="text-[12px] text-slate-500 leading-relaxed">
                Synchronize locally stored incidents and evidence when connectivity is available.
              </p>
              <button
                onClick={handleRealSyncExecution}
                disabled={isSyncing}
                className="w-full py-2.5 px-4 bg-[#1F5F8B] hover:bg-[#0F2742] text-white text-[13px] font-semibold rounded-lg shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Synchronizing Queue...' : 'Trigger Mission Sync & Forward'}
              </button>

              {syncStepMessage && (
                <div className={`text-[12px] p-3 rounded-lg border font-medium flex items-start justify-between gap-2 ${
                  syncError
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-blue-50 text-[#1F5F8B] border-blue-200'
                }`}>
                  <span>{syncStepMessage}</span>
                  {syncError && (
                    <button
                      onClick={handleRealSyncExecution}
                      className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-800 text-[10px] font-bold rounded shrink-0 transition-colors"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-slate-100 pt-[16px] space-y-3">
              <span className="text-[13px] font-bold text-[#0B1F33] uppercase tracking-wide block">Local Processing</span>
              <div className="space-y-[10px] text-[13px]">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">AI Inference:</span>
                  <span className="text-emerald-600 font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Active
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Local Storage:</span>
                  <span className="text-emerald-600 font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Available
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Network Dependency:</span>
                  <span className="text-[#0B1F33] font-bold font-mono">None (Zero Cloud)</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── RIGHT COLUMN: LOCAL SYNC QUEUE (58%) ─────────────────── */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col">
          <div className="px-[20px] py-[14px] border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-[#0B1F33] uppercase tracking-wider flex items-center gap-2">
                <Database className="w-4 h-4 text-[#1F5F8B]" /> Local Sync Queue
              </span>
              <span className="text-[11px] font-bold px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full font-mono">
                {unsyncedCount} UNSYNCED
              </span>
            </div>

            {/* Queue Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md text-[11px] font-semibold">
              {(['all', 'unsynced', 'synced'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setQueueFilter(tab)}
                  className={`px-2.5 py-1 rounded capitalize transition-colors ${
                    queueFilter === tab
                      ? 'bg-white text-[#0B1F33] shadow-sm font-bold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[460px]">
            {filteredQueue.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">
                  {queueFilter === 'unsynced'
                    ? 'All local incidents are synchronized.'
                    : 'Queue is empty.'
                  }
                </p>
                <p className="text-[12px] text-slate-400 mt-1">No pending records in offline vault.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredQueue.map((item, idx) => {
                  const status = item.status || 'unsynced';
                  const badgeStyle =
                    status === 'synced'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : status === 'syncing'
                      ? 'bg-cyan-50 text-cyan-700 border-cyan-200 animate-pulse'
                      : status === 'failed'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200';

                  return (
                    <div
                      key={idx}
                      className="px-[20px] py-[14px] hover:bg-slate-50/70 transition-colors flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="text-[14px] font-bold text-[#0B1F33] font-mono truncate">
                          Incident {item.incidentId}
                        </div>
                        <div className="text-[12px] text-slate-400 font-mono mt-1">
                          Queued: {formatTimestampIST(item.timestamp)}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border uppercase tracking-wider ${badgeStyle}`}>
                          {status.replace('_', ' ')}
                        </span>
                        {(status === 'unsynced' || status === 'failed') && (
                          <button
                            onClick={handleRealSyncExecution}
                            title="Retry sync for this item"
                            className="p-1 text-slate-400 hover:text-[#1F5F8B] transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. ADVANCED TECHNICAL DATA (Collapsible Below) ──────── */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <button
          onClick={() => setShowTechnical(!showTechnical)}
          className="w-full px-[20px] py-[16px] flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-[#0B1F33] font-bold text-[14px] uppercase tracking-wider">
            <Settings2 className="w-4 h-4 text-[#1F5F8B]" />
            Advanced Technical Data
          </div>
          {showTechnical ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
        </button>

        {showTechnical && (
          <div className="p-[20px] border-t border-slate-100 bg-slate-50/50">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[20px] text-[13px]">
              <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-2 font-mono">
                <div className="text-[11px] text-slate-400 font-bold uppercase font-sans mb-2">Node Specs</div>
                <div className="flex justify-between"><span className="text-slate-500">Node ID:</span> <span className="font-bold text-[#0B1F33]">{metrics.edgeNodeId || 'BOP-NORTH-EDGE-01'}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Connection Status:</span> <span className={`font-bold ${isCentralConnected ? 'text-emerald-600' : 'text-amber-600'}`}>{isCentralConnected ? 'CONNECTED' : 'DISCONNECTED'}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Queue Depth:</span> <span>{globalSyncQueue.length} Items ({unsyncedCount} Unsynced)</span></div>
              </div>

              <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-2 font-mono">
                <div className="text-[11px] text-slate-400 font-bold uppercase font-sans mb-2">Storage Telemetry</div>
                <div className="flex justify-between"><span className="text-slate-500">Capacity:</span> <span>{storageLimitGB} GB ({metrics.storageLimitMb} MB)</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Storage Used:</span> <span>{storageUsedGB} GB ({metrics.storageUsedMb} MB)</span></div>
                <div className="flex justify-between"><span className="text-slate-500">SQLite Engine:</span> <span>WAL Mode (0 Corrupt)</span></div>
              </div>

              <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-2 font-mono">
                <div className="text-[11px] text-slate-400 font-bold uppercase font-sans mb-2">AI & Sync Pipeline</div>
                <div className="flex justify-between"><span className="text-slate-500">AI Engine:</span> <span>v2.4.0-EdgeYOLO</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Model:</span> <span>YOLOv8n (Int8 ONNX)</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Last Sync Attempt:</span> <span>{formatTimestampUTC(metrics.lastSyncTimestamp)}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
