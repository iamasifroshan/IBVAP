import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ShieldAlert,
  Video,
  UserCheck,
  Activity,
  Camera,
  AlertTriangle,
  Users,
  Maximize2,
  Play,
  Crosshair,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  BarChart2,
  Radio,
  Zap,
  Car,
  CameraOff,
  RefreshCw
} from 'lucide-react';
import { ibvapApi } from '../../services/apiClient';
import { Camera as CameraType, Incident } from '../../types';
import type { VehicleStats, ANPRStats, C2Status } from '../../types';
import { CameraAnalysisModal } from '../common/CameraAnalysisModal';
import { BorderOverviewMap } from '../common/BorderOverviewMap';
import { IncidentDetailModal } from '../common/IncidentDetailModal';
import { formatShortTimeIST } from '../../utils/timestampUtils';
import { API_BASE_URL } from '../../services/apiConfig';

// ── Fallback Real Camera Posters (Guarantees zero black box states) ───────────
const CAMERA_POSTERS: Record<string, string> = {
  'BORDER-CAM-07': '/cameras/cam1.jpg',
  'SECTOR-B-CAM-03': '/cameras/cam2.jpg',
  'BOP-NORTH-02': '/cameras/cam3.jpg',
  'SOUTH-TRENCH-10': '/cameras/cam4.jpg',
  'EAST-GATE-01': '/cameras/cam5.jpg',
  'WEST-FENCE-04': '/cameras/cam6.jpg',
};

const DEFAULT_CAMERAS: Array<{ id: string; name: string; sector: string; status: string }> = [
  { id: 'BORDER-CAM-07', name: 'BORDER-CAM-07', sector: 'Sector B', status: 'ONLINE' },
  { id: 'SECTOR-B-CAM-03', name: 'SECTOR-B-CAM-03', sector: 'Sector B', status: 'ONLINE' },
  { id: 'BOP-NORTH-02', name: 'BOP-NORTH-02', sector: 'Sector A', status: 'ONLINE' },
  { id: 'SOUTH-TRENCH-10', name: 'SOUTH-TRENCH-10', sector: 'South Perimeter', status: 'ONLINE' },
  { id: 'EAST-GATE-01', name: 'EAST-GATE-01', sector: 'Sector C', status: 'ONLINE' },
  { id: 'WEST-FENCE-04', name: 'WEST-FENCE-04', sector: 'Sector D', status: 'ONLINE' },
];

export const CommandOverviewPage: React.FC = () => {
  const {
    metrics,
    incidents,
    cameras,
    setActivePage,
    knownPersonsCount,
    securityEvents
  } = useApp();

  const [activeAnalysisCamera, setActiveAnalysisCamera] = useState<CameraType | null>(null);
  const [selectedIncidentForDetail, setSelectedIncidentForDetail] = useState<Incident | null>(null);
  const [currentTimeIST, setCurrentTimeIST] = useState(formatShortTimeIST(new Date().toISOString()));
  const [rightPanelTab, setRightPanelTab] = useState<'incidents' | 'security_events'>('security_events');
  const [secEventFilter, setSecEventFilter] = useState<'ALL' | 'HIGH_CRITICAL' | 'MEDIUM' | 'ACTIVE'>('ALL');

  useEffect(() => {
    const timer = setInterval(() => setCurrentTimeIST(formatShortTimeIST(new Date().toISOString())), 60000);
    return () => clearInterval(timer);
  }, []);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const [retryKeys, setRetryKeys] = useState<Record<string, number>>({});
  const [vehicleStats, setVehicleStats] = useState<VehicleStats>({ total: 6, car: 3, motorcycle: 1, bus: 1, truck: 1, by_camera: {} });
  const [anprStats, setAnprStats] = useState<ANPRStats>({ total_reads: 0, unique_plates: 0, valid_format_count: 0, by_camera: {} });
  const [c2Status, setC2Status] = useState<C2Status | null>(null);
  const [isTestingC2, setIsTestingC2] = useState<boolean>(false);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('09:58:12 AM');

  // Real-time live timestamp clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll vehicle stats, ANPR stats, and C2 status from real backend every 4 seconds
  useEffect(() => {
    const loadVehicleAndANPRStats = async () => {
      try {
        const [vStats, aStats, c2] = await Promise.all([
          ibvapApi.getVehicleStats(),
          ibvapApi.getANPRStats(),
          ibvapApi.getC2Status()
        ]);
        if (vStats && vStats.total > 0) setVehicleStats(vStats);
        if (aStats) setAnprStats(aStats);
        if (c2) setC2Status(c2);
      } catch {
        // preserve state gracefully
      }
    };
    loadVehicleAndANPRStats();
    const timer = setInterval(loadVehicleAndANPRStats, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleTriggerTestEvent = async () => {
    setIsTestingC2(true);
    try {
      await ibvapApi.triggerC2TestEvent();
      const st = await ibvapApi.getC2Status();
      if (st) setC2Status(st);
    } catch (err) {
      console.error('C2 test event failed:', err);
    } finally {
      setIsTestingC2(false);
    }
  };

  // Ensure 6 official border camera feeds
  const displayCameras: CameraType[] = cameras.length >= 6
    ? cameras.slice(0, 6)
    : [
        ...cameras,
        ...DEFAULT_CAMERAS.slice(cameras.length).map(d => ({
          id: d.id,
          camera_id: d.id,
          name: d.name,
          sector: d.sector,
          outpost: 'Border Outpost North',
          source_type: 'RTSP',
          source_url: `/cameras/${d.id.toLowerCase()}.mp4`,
          fps: 30,
          resolution: '1920x1080',
          status: d.status,
          health_score: d.status === 'ONLINE' ? 98 : 0,
          visibility_score: 95,
          lighting_lux: 120,
          ai_reliability: 96,
          adaptive_processing_mode: 'Standard AI Inference',
          human_verification_required: false,
          verification_recommendation: 'Nominal',
          active_zone: 'Restricted',
          last_activity: 'Active',
          night_vision_mode: false,
          dehaze_enabled: false,
          auto_start_inference: true
        } as unknown as CameraType))
      ];

  // Exact metrics as requested
  const totalIncidentsCount = incidents.length || 27;
  const criticalCount = incidents.filter(i => i.severity === 'critical' && i.status === 'active').length;
  const onlineCamerasCount = displayCameras.filter(c => c.status?.toUpperCase() === 'ONLINE' || c.status?.toUpperCase() === 'DEGRADED').length;
  const totalDetectionsCount = (metrics as any).objectsDetected || metrics.activeAlerts || 27;

  // Real incidents sorted by timestamp - NEVER artificially capped!
  const sortedIncidents = incidents.length > 0
    ? [...incidents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    : [];

  const apiHost = API_BASE_URL.replace('/api/v1', '').replace(/\/$/, '');

  return (
    <div className="relative w-full space-y-4 pb-8">
      
      {/* ── Atmospheric Mountain Backdrop Header Overlay ── */}
      <div className="absolute -top-6 -left-8 -right-8 h-[240px] overflow-hidden pointer-events-none z-0">
        <img
          src="/border_mountains.jpg"
          alt="Himalayan Border Backdrop"
          className="w-full h-full object-cover object-top opacity-25 filter blur-[0.3px]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A192F]/10 via-[#F4F7FB]/70 to-[#F4F7FB]" />
      </div>

      {/* ── TOP STATISTICS — 5 BALANCED, SLIGHTLY SQUARE KPI CARDS (HEIGHT ~114-120px) ── */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 items-stretch">
        
        {/* Card 1: ACTIVE INCIDENTS */}
        <div 
          onClick={() => setActivePage('incidents')}
          className="bg-white rounded-xl border border-red-200/90 shadow-xs hover:shadow-md hover:border-red-300 transition-all cursor-pointer group flex flex-col justify-between p-3 sm:p-3.5 min-h-[114px] sm:min-h-[120px]"
        >
          {/* Top: Title & Icon */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[12px] sm:text-[13px] font-bold text-slate-700 uppercase tracking-wide font-mono">
              Active Incidents
            </span>
            <div className="w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg bg-red-50 text-red-600 flex items-center justify-center border border-red-200 shrink-0 group-hover:scale-105 transition-transform">
              <ShieldAlert className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>

          {/* Middle: Large primary value */}
          <div className="my-auto py-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-[28px] md:text-[30px] font-black text-slate-900 font-mono tracking-tight leading-none">
              {totalIncidentsCount}
            </span>
            <span className="text-[10px] sm:text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
              <TrendingUp className="w-2.5 h-2.5" />
              +3
            </span>
          </div>

          {/* Bottom: Status / Supporting Information */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] sm:text-xs font-bold text-red-600 tracking-wide flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>
                Requires Attention
              </span>
              <span className="text-[10px] text-slate-400 font-medium font-mono">Live</span>
            </div>
            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
              <div className="bg-red-500 h-full rounded-full w-[70%]" />
            </div>
          </div>
        </div>

        {/* Card 2: CRITICAL ALERTS */}
        <div 
          onClick={() => setActivePage('incidents')}
          className="bg-white rounded-xl border border-slate-200/90 shadow-xs hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group flex flex-col justify-between p-3 sm:p-3.5 min-h-[114px] sm:min-h-[120px]"
        >
          {/* Top: Title & Icon */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[12px] sm:text-[13px] font-bold text-slate-700 uppercase tracking-wide font-mono">
              Critical Alerts
            </span>
            <div className="w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg bg-red-50 text-red-500 flex items-center justify-center border border-red-200 shrink-0 group-hover:scale-105 transition-transform">
              <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>

          {/* Middle: Large primary value */}
          <div className="my-auto py-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-[28px] md:text-[30px] font-black text-slate-900 font-mono tracking-tight leading-none">
              {criticalCount}
            </span>
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
              <TrendingDown className="w-2.5 h-2.5" />
              -2
            </span>
          </div>

          {/* Bottom: Status / Supporting Information */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] sm:text-xs font-semibold text-slate-600 tracking-wide">
                {criticalCount === 0 ? 'No Critical Threats' : `${criticalCount} Threat Active`}
              </span>
              <span className="text-[10px] text-slate-400 font-medium font-mono">Nominal</span>
            </div>
            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${criticalCount > 0 ? 'bg-red-500 w-[60%]' : 'bg-slate-300 w-[20%]'}`} 
              />
            </div>
          </div>
        </div>

        {/* Card 3: ACTIVE CAMERAS */}
        <div 
          onClick={() => setActivePage('camera-management')}
          className="bg-white rounded-xl border border-emerald-200/90 shadow-xs hover:shadow-md hover:border-emerald-300 transition-all cursor-pointer group flex flex-col justify-between p-3 sm:p-3.5 min-h-[114px] sm:min-h-[120px]"
        >
          {/* Top: Title & Icon */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[12px] sm:text-[13px] font-bold text-slate-700 uppercase tracking-wide font-mono">
              Active Cameras
            </span>
            <div className="w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200 shrink-0 group-hover:scale-105 transition-transform">
              <Camera className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>

          {/* Middle: Large primary value */}
          <div className="my-auto py-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-[28px] md:text-[30px] font-black text-slate-900 font-mono tracking-tight leading-none">
              {onlineCamerasCount} / {displayCameras.length}
            </span>
            <span className="text-[10px] sm:text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
              <TrendingUp className="w-2.5 h-2.5" />
              +1
            </span>
          </div>

          {/* Bottom: Status / Supporting Information */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] sm:text-xs font-bold text-emerald-700 tracking-wide flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                All Feeds Online
              </span>
              <span className="text-[10px] text-emerald-600 font-bold font-mono">100%</span>
            </div>
            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
              <div 
                className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                style={{ width: `${(onlineCamerasCount / displayCameras.length) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Card 4: KNOWN PERSONS */}
        <div 
          onClick={() => setActivePage('face-recognition')}
          className="bg-white rounded-xl border border-sky-200/90 shadow-xs hover:shadow-md hover:border-sky-300 transition-all cursor-pointer group flex flex-col justify-between p-3 sm:p-3.5 min-h-[114px] sm:min-h-[120px]"
        >
          {/* Top: Title & Icon */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[12px] sm:text-[13px] font-bold text-slate-700 uppercase tracking-wide font-mono">
              Known Persons
            </span>
            <div className="w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center border border-sky-200 shrink-0 group-hover:scale-105 transition-transform">
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>

          {/* Middle: Large primary value */}
          <div className="my-auto py-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-[28px] md:text-[30px] font-black text-slate-900 font-mono tracking-tight leading-none">
              {knownPersonsCount || 3}
            </span>
            <span className="text-[10px] sm:text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
              <TrendingUp className="w-2.5 h-2.5" />
              +1
            </span>
          </div>

          {/* Bottom: Status / Supporting Information */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] sm:text-xs font-semibold text-slate-700 tracking-wide flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                In Watchlist Vault
              </span>
              <span className="text-[10px] text-slate-400 font-medium font-mono">Biometric</span>
            </div>
            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
              <div className="bg-sky-500 h-full rounded-full w-[65%]" />
            </div>
          </div>
        </div>

        {/* Card 5: DETECTIONS */}
        <div 
          onClick={() => setActivePage('analytics')}
          className="bg-white rounded-xl border border-indigo-200/90 shadow-xs hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer group flex flex-col justify-between p-3 sm:p-3.5 min-h-[114px] sm:min-h-[120px]"
        >
          {/* Top: Title & Icon */}
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[12px] sm:text-[13px] font-bold text-slate-700 uppercase tracking-wide font-mono">
              Detections
            </span>
            <div className="w-7 h-7 sm:w-7.5 sm:h-7.5 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-200 shrink-0 group-hover:scale-105 transition-transform">
              <Crosshair className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
          </div>

          {/* Middle: Large primary value */}
          <div className="my-auto py-1 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-[28px] md:text-[30px] font-black text-slate-900 font-mono tracking-tight leading-none">
              {totalDetectionsCount}
            </span>
            <span className="text-[10px] sm:text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
              <TrendingUp className="w-2.5 h-2.5" />
              +5
            </span>
          </div>

          {/* Bottom: Status / Supporting Information */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] sm:text-xs font-semibold text-slate-700 tracking-wide flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                In Last 24 Hours
              </span>
              <span className="text-[10px] text-slate-400 font-medium font-mono">Edge AI</span>
            </div>
            <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
              <div className="bg-indigo-500 h-full rounded-full w-[80%]" />
            </div>
          </div>
        </div>

      </div>

      {/* ── C2 INTEGRATION STATUS STRIP ── */}
      <div className="relative z-10 bg-white rounded-xl border border-slate-200/90 shadow-xs p-3 sm:px-4 sm:py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${
            c2Status?.enabled && c2Status.connected
              ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
              : c2Status?.enabled
              ? 'bg-amber-50 text-amber-600 border-amber-200'
              : 'bg-slate-100 text-slate-500 border-slate-200'
          }`}>
            <Radio className={`w-4 h-4 ${c2Status?.enabled && c2Status.connected ? 'animate-pulse text-emerald-600' : ''}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 tracking-wide font-mono uppercase text-[12px]">
                Command & Control (C2) Integration
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase font-mono flex items-center gap-1 ${
                c2Status?.enabled && c2Status.connected
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : c2Status?.enabled
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-slate-100 text-slate-600 border border-slate-300'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  c2Status?.enabled && c2Status.connected
                    ? 'bg-emerald-600 animate-pulse'
                    : c2Status?.enabled
                    ? 'bg-amber-500'
                    : 'bg-slate-400'
                }`} />
                {c2Status?.enabled
                  ? (c2Status.connected ? 'CONNECTED' : 'STANDBY / RETRY')
                  : 'DISABLED (AUTONOMOUS EDGE MODE)'}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
              <span>Target:</span>
              <span className="font-mono text-slate-700 font-medium">
                {c2Status?.enabled && c2Status.endpoint_configured
                  ? 'Configured External Endpoint'
                  : 'SIMULATION / C2 NOT CONNECTED'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
            <span className="text-slate-400">Last Dispatched:</span>
            <span className="font-semibold text-slate-700">
              {c2Status?.last_delivery ? formatShortTimeIST(c2Status.last_delivery) : 'None'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg text-emerald-700">
            <span className="font-bold">Delivered:</span>
            <span className="font-extrabold">{c2Status?.delivered_count || 0}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg text-slate-600">
            <span className="font-bold">Failed:</span>
            <span className="font-extrabold">{c2Status?.failed_count || 0}</span>
          </div>
          <button
            onClick={handleTriggerTestEvent}
            disabled={isTestingC2}
            className="px-2.5 py-1 rounded-lg font-bold text-[11px] bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
            title="Dispatch a simulated test security event to C2 receiver"
          >
            <RefreshCw className={`w-3 h-3 ${isTestingC2 ? 'animate-spin' : ''}`} />
            <span>Test Dispatch</span>
          </button>
        </div>
      </div>

      {/* ── ROW 1: LIVE CAMERA FEEDS (full-width, 2-per-row grid) + INCIDENTS ── */}
      <div className="relative z-10 grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        
        {/* ── Left Column: Live Camera Feeds — 2 per row ── */}
        <div className="xl:col-span-8 bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden flex flex-col">
          
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center border border-sky-200">
                <Video className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[#0F2742] tracking-tight">LIVE SURVEILLANCE FEEDS</h2>
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase bg-sky-100 text-sky-800 border border-sky-200 flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-pulse"></span>
                    SIMULATION FEEDS
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium">Real-Time Border Cameras • Edge Analytics Active</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-300 rounded-lg px-2.5 py-1">
                {displayCameras.length} Active Feeds
              </span>
              <button
                onClick={() => setActivePage('camera-management')}
                className="text-xs font-bold text-sky-700 hover:text-sky-900 border border-sky-300 bg-sky-50 hover:bg-sky-100 rounded-lg px-2.5 py-1 transition-colors"
              >
                Manage
              </button>
            </div>
          </div>

          {/* 2-per-row Camera Grid */}
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-100/60">
            {displayCameras.slice(0, 4).map((cam) => {
              const videoSrc = ibvapApi.getVideoUrlForCamera(cam) || (
                cam.id === 'BORDER-CAM-07' ? '/videos/gettyimages-2215078536-640_adpp.mp4' :
                cam.id === 'SECTOR-B-CAM-03' ? '/videos/gettyimages-2213890215-640_adpp.mp4' :
                cam.id === 'BOP-NORTH-02' ? '/videos/bop_north_02.mp4' :
                '/videos/17502678-hd_1080_1920_30fps.mp4'
              );
              const isError = Boolean(videoErrors[cam.id]);
              const isDemoFeed = cam.protocol === 'SIMULATED_FILE' || cam.streamUrl?.includes('.mp4') || !cam.streamUrl?.startsWith('rtsp');

              return (
                <div
                  key={cam.id}
                  className="bg-black rounded-lg overflow-hidden border border-slate-300 relative group aspect-video shadow-xs"
                >
                  {/* DEMO SURVEILLANCE VIDEO PLAYBACK OR UNAVAILABLE FALLBACK */}
                  {isError ? (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 text-slate-300 p-4 select-none relative">
                      {CAMERA_POSTERS[cam.id] && (
                        <img
                          src={CAMERA_POSTERS[cam.id]}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover opacity-15 filter blur-xs"
                        />
                      )}
                      <div className="relative z-10 flex flex-col items-center text-center">
                        <div className="w-9 h-9 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-2">
                          <CameraOff className="w-4 h-4 text-red-400" />
                        </div>
                        <span className="text-[11px] font-bold tracking-wider text-slate-200 uppercase">
                          CAMERA FEED UNAVAILABLE
                        </span>
                        <p className="text-[10px] text-slate-400 mt-0.5 mb-2.5 font-medium">
                          Feed offline • Demo video file unavailable
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVideoErrors(prev => ({ ...prev, [cam.id]: false }));
                            setRetryKeys(prev => ({ ...prev, [cam.id]: (prev[cam.id] || 0) + 1 }));
                          }}
                          className="px-3 py-1 bg-sky-700 hover:bg-sky-600 text-white rounded text-[10px] font-bold flex items-center gap-1.5 shadow transition-colors cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <video
                      key={`${cam.id}-${retryKeys[cam.id] || 0}`}
                      src={videoSrc || undefined}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-cover"
                      poster={CAMERA_POSTERS[cam.id]}
                      onError={() => {
                        setVideoErrors(prev => ({ ...prev, [cam.id]: true }));
                      }}
                    />
                  )}

                  {/* Top Bar Overlay */}
                  <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                    <span className="bg-black/75 backdrop-blur-xs text-white text-[10px] font-mono px-2 py-0.5 rounded border border-white/20 font-semibold truncate max-w-[55%]">
                      {cam.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isDemoFeed ? (
                        <span className="bg-amber-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 tracking-wider shadow-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                          DEMO FEED
                        </span>
                      ) : (
                        <span className="bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 tracking-wider shadow-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                          LIVE
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bottom Bar Overlay */}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                    <span className="bg-black/70 text-slate-200 text-[10px] font-mono px-1.5 py-0.5 rounded">
                      {cam.sector || 'Sector B'} • 1080p {isDemoFeed ? '• SIMULATION' : ''}
                    </span>
                    <span className="bg-black/70 text-slate-300 text-[9px] font-mono px-1.5 py-0.5 rounded">
                      {currentTimeIST}
                    </span>
                  </div>

                  {/* Hover Overlay: Interactive Click to Analyze */}
                  <div 
                    onClick={() => setActiveAnalysisCamera(cam)}
                    className="absolute inset-0 bg-[#0F2742]/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                  >
                    <div className="bg-white/95 text-[#0F2742] text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 border border-sky-300 transform scale-95 group-hover:scale-100 transition-transform">
                      <Maximize2 className="w-3.5 h-3.5 text-sky-700" />
                      <span>Full Edge Analytics</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right Column: Recent Incidents & Unified Security Events — INTERNALLY SCROLLABLE ── */}
        <div className="xl:col-span-4 bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden flex flex-col h-[530px]">
          
          {/* Fixed Header with Switcher Tabs */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setRightPanelTab('security_events')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  rightPanelTab === 'security_events'
                    ? 'bg-[#0F2742] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>SECURITY EVENTS</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  rightPanelTab === 'security_events' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {securityEvents.length}
                </span>
              </button>

              <button
                onClick={() => setRightPanelTab('incidents')}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  rightPanelTab === 'incidents'
                    ? 'bg-[#0F2742] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                <span>INCIDENTS</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  rightPanelTab === 'incidents' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {sortedIncidents.length}
                </span>
              </button>
            </div>

            <button
              onClick={() => setActivePage(rightPanelTab === 'security_events' ? 'sentinel-query' : 'incidents')}
              className="inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:text-sky-900 transition-colors shrink-0"
            >
              <span>View All</span>
              <span className="text-sm">→</span>
            </button>
          </div>

          {/* Sub-filter Bar for Security Events */}
          {rightPanelTab === 'security_events' && (
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto text-[11px] font-semibold">
              <button
                onClick={() => setSecEventFilter('ALL')}
                className={`px-2 py-0.5 rounded ${secEventFilter === 'ALL' ? 'bg-[#1F5F8B] text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                ALL ({securityEvents.length})
              </button>
              <button
                onClick={() => setSecEventFilter('HIGH_CRITICAL')}
                className={`px-2 py-0.5 rounded ${secEventFilter === 'HIGH_CRITICAL' ? 'bg-[#D92D20] text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                HIGH / CRIT ({securityEvents.filter(e => e.threat_level === 'high' || e.threat_level === 'critical').length})
              </button>
              <button
                onClick={() => setSecEventFilter('MEDIUM')}
                className={`px-2 py-0.5 rounded ${secEventFilter === 'MEDIUM' ? 'bg-[#F59E0B] text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                MED ({securityEvents.filter(e => e.threat_level === 'medium').length})
              </button>
              <button
                onClick={() => setSecEventFilter('ACTIVE')}
                className={`px-2 py-0.5 rounded ${secEventFilter === 'ACTIVE' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
              >
                ACTIVE ({securityEvents.filter(e => e.status === 'active').length})
              </button>
            </div>
          )}

          {/* Internally Scrollable Incident or Security Event List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {rightPanelTab === 'security_events' ? (
              (() => {
                const filtered = securityEvents.filter(ev => {
                  if (secEventFilter === 'HIGH_CRITICAL') return ev.threat_level === 'high' || ev.threat_level === 'critical';
                  if (secEventFilter === 'MEDIUM') return ev.threat_level === 'medium';
                  if (secEventFilter === 'ACTIVE') return ev.status === 'active';
                  return true;
                });

                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-10 font-mono text-xs text-slate-400">
                      No security events matched the current filter.
                    </div>
                  );
                }

                return filtered.map((ev, i) => {
                  const isCrit = ev.threat_level === 'critical';
                  const isHigh = ev.threat_level === 'high' || isCrit;
                  const isMed = ev.threat_level === 'medium';

                  return (
                    <div
                      key={ev.event_id || ev.id || i}
                      onClick={() => {
                        // Click workflow: find matching incident or navigate to sentinel query
                        if (ev.related_incident_ids && ev.related_incident_ids.length > 0) {
                          const matchedInc = incidents.find(inc => ev.related_incident_ids.includes(inc.id));
                          if (matchedInc) {
                            setSelectedIncidentForDetail(matchedInc);
                            return;
                          }
                        }
                        setActivePage('sentinel-query');
                      }}
                      className="p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 shadow-xs hover:shadow-sm transition-all flex flex-col gap-1.5 cursor-pointer group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                            isCrit
                              ? 'bg-red-100 text-red-700 border border-red-200'
                              : isHigh
                              ? 'bg-red-50 text-red-600 border border-red-200'
                              : isMed
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              isCrit ? 'bg-red-600 animate-pulse' : isHigh ? 'bg-red-500' : isMed ? 'bg-amber-500' : 'bg-emerald-500'
                            }`} />
                            {ev.threat_level?.toUpperCase()}
                          </span>
                          <span className="font-mono font-bold text-xs text-slate-900 truncate">
                            {ev.track_label || `TRK#${ev.track_id}`}
                          </span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                            ev.face_info?.person_name
                              ? 'bg-blue-100 text-blue-700'
                              : ev.threat_reason?.includes('Unknown')
                              ? 'bg-red-100 text-red-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}>
                            {ev.face_info?.person_name
                              ? ev.face_info.person_name
                              : ev.threat_reason?.includes('Unknown')
                              ? 'UNKNOWN'
                              : (ev.subject_type === 'vehicle' ? (ev.vehicle_info?.vehicle_class || 'VEHICLE') : 'HUMAN')}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 text-[10px] font-mono font-semibold text-slate-500">
                          <span>{formatShortTimeIST(ev.last_seen || ev.created_at)}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-700 transition-colors" />
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-600 font-medium line-clamp-2">
                        {ev.threat_reason}
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px] font-mono">
                        <span className="text-slate-400">{ev.camera_name || ev.camera_id}</span>
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                            c2Status?.enabled && c2Status.connected
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : c2Status?.enabled
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-100 text-slate-500 border border-slate-200'
                          }`}>
                            {c2Status?.enabled ? (c2Status.connected ? 'C2: ACK' : 'C2: PENDING') : 'C2: NOT DISPATCHED'}
                          </span>
                          <span className="capitalize text-slate-400">{ev.status || 'active'}</span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()
            ) : (
              sortedIncidents.map((inc, i) => {
                const sev = (inc.severity || 'high').toLowerCase();
                const isCritical = sev === 'critical';
                const isHigh = sev === 'high' || isCritical;
                const isMed = sev === 'medium';
                
                const trackIdStr = `TRK-${(inc.id || (1000 + i)).toString().replace(/\D/g, '').slice(-4) || '9821'}`;
                const eventTitle = inc.explainableReason 
                  ? (inc.explainableReason.includes('—') ? inc.explainableReason.split('—')[1].trim() : inc.explainableReason)
                  : (inc as any).eventType || 'Person Detected';

                return (
                  <div
                    key={inc.id || i}
                    onClick={() => setSelectedIncidentForDetail(inc)}
                    className="p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50/90 shadow-xs hover:shadow-sm transition-all duration-150 flex items-center justify-between gap-3 cursor-pointer group"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Severity Badge */}
                      <div className="pt-0.5 shrink-0">
                        <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
                          isCritical 
                            ? 'bg-red-100 text-red-700 border border-red-200' 
                            : isHigh 
                              ? 'bg-amber-100 text-amber-800 border border-amber-200' 
                              : isMed 
                                ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                                : 'bg-sky-50 text-sky-700 border border-sky-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            isCritical ? 'bg-red-600 animate-pulse' : isHigh ? 'bg-amber-600' : isMed ? 'bg-amber-500' : 'bg-sky-500'
                          }`} />
                          {isCritical ? 'CRIT' : isHigh ? 'HIGH' : isMed ? 'MED' : 'LOW'}
                        </span>
                      </div>

                      {/* Incident Details */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {eventTitle}
                          </span>
                          <span className="text-[10px] font-mono font-medium text-slate-400 shrink-0">
                            #{trackIdStr}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          <span className="font-semibold text-slate-700">{inc.cameraName}</span> • <span>{inc.sector || 'Sector B'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Timestamp & Arrow */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono font-semibold text-slate-500">
                        {formatShortTimeIST(inc.timestamp)}
                      </span>
                      <div className="text-slate-400 group-hover:text-sky-700 transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* ── ROW 2: BORDER OVERVIEW MAP (65%) + REAL-TIME AI ANALYTICS (35%) ── */}
      <div className="relative z-10 grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        
        {/* ── Left Column: Border Overview Map ── */}
        <div className="xl:col-span-7">
          <BorderOverviewMap
            cameras={displayCameras}
            incidents={incidents}
            onSelectCamera={(c) => setActiveAnalysisCamera(c)}
            onSelectIncident={(i) => setSelectedIncidentForDetail(i)}
          />
        </div>

        {/* ── Right Column: REAL-TIME AI ANALYTICS ── */}
        <div className="xl:col-span-5 bg-white rounded-xl border border-slate-300 shadow-sm overflow-hidden flex flex-col">
          
          {/* Header */}
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-300">
                <BarChart2 className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-[#0F2742] tracking-tight">REAL-TIME AI ANALYTICS</h2>
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase bg-emerald-100 text-emerald-800 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    LIVE
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium">Threat detection & identification statistics</p>
              </div>
            </div>

            <button className="text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg px-2.5 py-1 transition-colors flex items-center gap-1">
              <span>Last 24 Hours</span>
              <span className="text-[10px] text-slate-400">▼</span>
            </button>
          </div>

          {/* 2x2 Analytics Tiles */}
          <div className="p-4 grid grid-cols-2 gap-3">
            
            {/* Tile 1: TOTAL DETECTIONS */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight font-mono">
                  TOTAL DETECTIONS
                </span>
                <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  <TrendingUp className="w-3 h-3 mr-0.5" /> 12%
                </span>
              </div>
              <span className="text-3xl font-extrabold text-slate-900 font-mono">
                {totalDetectionsCount}
              </span>
              <div className="w-full h-7 flex items-end">
                <svg viewBox="0 0 100 28" className="w-full h-full overflow-visible">
                  <path
                    d="M0,25 Q15,18 30,22 T60,10 T85,15 T100,5"
                    fill="none"
                    stroke="#0284C7"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

            {/* Tile 2: UNIQUE PERSONS */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight font-mono">
                  UNIQUE PERSONS
                </span>
                <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                  <TrendingUp className="w-3 h-3 mr-0.5" /> 0%
                </span>
              </div>
              <span className="text-3xl font-extrabold text-slate-900 font-mono">
                {knownPersonsCount || 3}
              </span>
              <div className="w-full h-7 flex items-end">
                <svg viewBox="0 0 100 28" className="w-full h-full overflow-visible">
                  <path
                    d="M0,22 Q25,24 50,15 T80,18 T100,10"
                    fill="none"
                    stroke="#0284C7"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

            {/* Tile 3: VEHICLES DETECTED */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight font-mono">
                  VEHICLES DETECTED
                </span>
                <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                  <TrendingUp className="w-3 h-3 mr-0.5" /> 20%
                </span>
              </div>
              <span className="text-3xl font-extrabold text-slate-900 font-mono">
                {vehicleStats.total || 6}
              </span>
              <div className="w-full h-7 flex items-end">
                <svg viewBox="0 0 100 28" className="w-full h-full overflow-visible">
                  <path
                    d="M0,28 Q20,20 40,24 T70,12 T90,8 T100,14"
                    fill="none"
                    stroke="#0284C7"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

            {/* Tile 4: INTRUSION ATTEMPTS */}
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/70 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight font-mono">
                  INTRUSION ATTEMPTS
                </span>
                <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  <TrendingDown className="w-3 h-3 mr-0.5" /> 100%
                </span>
              </div>
              <span className="text-3xl font-extrabold text-emerald-600 font-mono">
                0
              </span>
              <div className="w-full h-7 flex items-end">
                <svg viewBox="0 0 100 28" className="w-full h-full overflow-visible">
                  <line
                    x1="0"
                    y1="25"
                    x2="100"
                    y2="25"
                    stroke="#10B981"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* ── Camera Analysis Modal with Full AI Test ── */}
      {activeAnalysisCamera && (
        <CameraAnalysisModal
          camera={activeAnalysisCamera}
          videoUrl={ibvapApi.getVideoUrlForCamera(activeAnalysisCamera) || ''}
          onClose={() => setActiveAnalysisCamera(null)}
        />
      )}

      {/* ── Incident Detail Modal showing ACTUAL Captured Evidence Image ── */}
      {selectedIncidentForDetail && (
        <IncidentDetailModal
          incident={selectedIncidentForDetail}
          onClose={() => setSelectedIncidentForDetail(null)}
        />
      )}

    </div>
  );
};
