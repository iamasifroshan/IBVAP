import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  ShieldAlert, Video, UserCheck, Activity, Camera, AlertTriangle, 
  WifiOff, Radio, Users, Server, Database, BrainCircuit, ActivitySquare, Car
} from 'lucide-react';
import { ibvapApi } from '../../services/apiClient';
import { Camera as CameraType } from '../../types';
import type { VehicleStats, ANPRStats } from '../../types';
import { CameraAnalysisModal } from '../common/CameraAnalysisModal';
import { formatShortTimeIST } from '../../utils/timestampUtils';


// ── DashboardCameraCard ───────────────────────────────────────────────────────
const DashboardCameraCard: React.FC<{
  cam: CameraType;
  onSelect: () => void;
  videoErrors: Record<string, boolean>;
  setVideoErrors: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  hasActiveIncident: boolean;
}> = ({ cam, onSelect, videoErrors, setVideoErrors, hasActiveIncident }) => {
  const videoUrl = ibvapApi.getVideoUrlForCamera(cam);
  const isOffline = cam.status?.toUpperCase() === 'OFFLINE' || cam.status?.toUpperCase() === 'ERROR';
  
  return (
    <div 
      className={`bg-white rounded-lg overflow-hidden cursor-pointer group border shadow-sm flex flex-col transition-all duration-200 relative ${
        hasActiveIncident 
          ? 'border-[#D92D20] ring-1 ring-[#D92D20]/25' 
          : 'border-[var(--border-color)] hover:border-[#1F5F8B] hover:shadow-md'
      }`}
      onClick={onSelect}
    >
      <div className="relative w-full aspect-video bg-slate-900 overflow-hidden shrink-0">
        {!isOffline && videoUrl && !videoErrors[cam.id] ? (
          <video 
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-all duration-500"
            onError={() => {
              setVideoErrors(prev => ({ ...prev, [cam.id]: true }));
            }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-slate-950">
            {isOffline ? <WifiOff className="w-8 h-8 mb-2 text-red-500/70" /> : <Video className="w-8 h-8 mb-2 opacity-50" />}
            <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">
              {isOffline ? 'OFFLINE' : 'NO VIDEO FEED'}
            </span>
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 p-2.5 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent z-10 pointer-events-none">
          <span className="text-white text-[11px] font-bold font-mono shadow-sm bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm border border-white/10">
            {cam.name}
          </span>
          
          {cam.status?.toUpperCase() === 'ONLINE' ? (
            <span className="px-2 py-0.5 text-[9px] font-bold rounded flex items-center gap-1.5 shadow-sm backdrop-blur-sm border uppercase tracking-wider bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></span>
              ONLINE
            </span>
          ) : cam.status?.toUpperCase() === 'DEGRADED' ? (
            <span className="px-2 py-0.5 text-[9px] font-bold rounded flex items-center gap-1.5 shadow-sm backdrop-blur-sm border uppercase tracking-wider bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse"></span>
              DEGRADED
            </span>
          ) : (
            <span className="px-2 py-0.5 text-[9px] font-bold rounded flex items-center gap-1.5 shadow-sm backdrop-blur-sm border uppercase tracking-wider bg-[#D92D20]/20 text-[#D92D20] border-[#D92D20]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D92D20]"></span>
              OFFLINE
            </span>
          )}
        </div>
      </div>

      <div className="px-[16px] py-[12px] bg-white border-t border-[var(--border-color)] h-[58px] flex flex-col justify-center">
        <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-0.5 truncate">{cam.sector}</div>
        <div className={`text-[12px] font-bold truncate ${hasActiveIncident ? 'text-[#D92D20]' : 'text-[#1F5F8B]'}`}>
          {hasActiveIncident ? 'HUMAN DETECTED' : 'NORMAL'}
        </div>
      </div>
    </div>
  );
};


export const CommandOverviewPage: React.FC = () => {
  const { metrics, incidents, cameras, setActivePage, knownPersonsCount, networkStatus } = useApp();
  const [activeAnalysisCamera, setActiveAnalysisCamera] = useState<CameraType | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const [healthData, setHealthData] = useState<any>(null);
  const [vehicleStats, setVehicleStats] = useState<VehicleStats>({ total: 0, car: 0, motorcycle: 0, bus: 0, truck: 0, by_camera: {} });
  const [anprStats, setAnprStats] = useState<ANPRStats>({ total_reads: 0, unique_plates: 0, valid_format_count: 0, by_camera: {} });

  useEffect(() => {
    // Fetch detailed health metrics for the dashboard
    fetch('http://localhost:8000/health')
      .then(res => res.json())
      .then(data => setHealthData(data))
      .catch(err => console.error("Health fetch error:", err));
  }, []);

  // Poll vehicle stats and ANPR stats every 4 seconds — real data, never hardcoded
  useEffect(() => {
    const loadVehicleAndANPRStats = async () => {
      try {
        const [vStats, aStats] = await Promise.all([
          ibvapApi.getVehicleStats(),
          ibvapApi.getANPRStats()
        ]);
        setVehicleStats(vStats);
        setAnprStats(aStats);
      } catch {
        // silently keep previous value on network failure
      }
    };
    loadVehicleAndANPRStats();
    const timer = setInterval(loadVehicleAndANPRStats, 4000);
    return () => clearInterval(timer);
  }, []);

  const criticalCount = incidents.filter(i => i.severity === 'critical' && i.status === 'active').length;
  const onlineCount = cameras.filter(c => c.status?.toUpperCase() === 'ONLINE' || c.status?.toUpperCase() === 'DEGRADED').length;
  
  const recentIncidents = [...incidents].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ).slice(0, 5);

  const formatUptime = (seconds: number) => {
    if (!seconds) return '0m 0s';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-[24px]">
      
      {/* 1. Header */}
      <div>
        <h1 className="text-[28px] font-bold text-[#0B1F33] tracking-tight">IBVAP Command Center</h1>
        <p className="text-[15px] text-[var(--text-muted)] mt-1 font-medium">Intelligent Border Video Analytics Platform — SIH Demonstration</p>
      </div>

      {/* 2. Global System Status Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-[16px]">
        {/* Network Status */}
        <div className={`p-4 rounded-lg border shadow-sm flex items-center justify-between ${
          networkStatus === 'online' ? 'bg-[#F0FDF4] border-[#86EFAC] text-[#166534]' : 
          networkStatus === 'connecting' ? 'bg-[#FEFCE8] border-[#FDE047] text-[#854D0E]' : 
          'bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B]'
        }`}>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest opacity-80 block mb-1">System Status</span>
            <span className="text-xl font-bold flex items-center gap-2">
              <Server className="w-5 h-5" /> 
              {networkStatus.toUpperCase()}
            </span>
          </div>
          {networkStatus === 'online' && <ActivitySquare className="w-8 h-8 opacity-40" />}
        </div>

        {/* Database Health */}
        <div className="bg-white p-4 rounded-lg border border-[var(--border-color)] shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1">Database</span>
            <span className={`text-xl font-bold flex items-center gap-2 ${healthData?.database === 'healthy' ? 'text-[#10B981]' : 'text-[#D92D20]'}`}>
              <Database className="w-5 h-5" /> 
              {healthData?.database ? healthData.database.toUpperCase() : 'PENDING'}
            </span>
          </div>
        </div>

        {/* AI Subsystems */}
        <div className="bg-white p-4 rounded-lg border border-[var(--border-color)] shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1">AI Subsystems</span>
            <span className={`text-xl font-bold flex items-center gap-2 ${healthData?.ai_subsystems?.overall === 'READY' ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
              <BrainCircuit className="w-5 h-5" /> 
              {healthData?.ai_subsystems?.overall || 'PENDING'}
            </span>
          </div>
        </div>

        {/* Uptime / Memory */}
        <div className="bg-white p-4 rounded-lg border border-[var(--border-color)] shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1">Backend Uptime</span>
            <span className="text-xl font-bold flex items-center gap-2 text-[#0B1F33]">
              <Activity className="w-5 h-5" /> 
              {healthData ? formatUptime(healthData.runtime?.uptime_seconds) : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Core Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-[16px]">
        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Active Incidents</span>
            <ShieldAlert className="w-5 h-5 text-[#F59E0B]" />
          </div>
          <div className="mt-4">
            <span className="text-[36px] font-bold text-[#0B1F33] leading-none">{incidents.filter(i => i.status === 'active').length}</span>
          </div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[#D92D20]/40 shadow-sm flex flex-col justify-between relative overflow-hidden">
          {criticalCount > 0 && <div className="absolute top-0 left-0 w-1.5 h-full bg-[#D92D20]"></div>}
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-[#D92D20] uppercase tracking-widest">Critical Alerts</span>
            <AlertTriangle className="w-5 h-5 text-[#D92D20]" />
          </div>
          <div className="mt-4">
            <span className="text-[36px] font-bold text-[#D92D20] leading-none">{criticalCount}</span>
          </div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Active Cameras</span>
            <Camera className="w-5 h-5 text-[#10B981]" />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-[36px] font-bold text-[#10B981] leading-none">{onlineCount}</span>
            <span className="text-base text-[var(--text-muted)] font-medium">/ {cameras.length}</span>
          </div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm flex flex-col justify-between cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => setActivePage('face-recognition')}>
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Known Persons</span>
            <UserCheck className="w-5 h-5 text-[#005EA8]" />
          </div>
          <div className="mt-4">
            <span className="text-[36px] font-bold text-[#005EA8] leading-none">{knownPersonsCount}</span>
          </div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Detections (Current)</span>
            <Users className="w-5 h-5 text-[#1F5F8B]" />
          </div>
          <div className="mt-4">
            <span className="text-[36px] font-bold text-[#0B1F33] leading-none">{(metrics as any).objectsDetected || metrics.activeAlerts || 0}</span>
          </div>
        </div>

        {/* Vehicles Live — real data from TrackRegistry, never hardcoded */}
        <div className="bg-white p-[20px] rounded-lg border border-[#F59E0B]/40 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-bold text-[#92400E] uppercase tracking-widest">Vehicles (Live)</span>
            <Car className="w-5 h-5 text-[#F59E0B]" />
          </div>
          <div className="mt-3">
            <span className="text-[36px] font-bold text-[#F59E0B] leading-none">{vehicleStats.total}</span>
          </div>
          {vehicleStats.total > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {vehicleStats.car > 0 && <span className="text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">Car {vehicleStats.car}</span>}
              {vehicleStats.truck > 0 && <span className="text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">Truck {vehicleStats.truck}</span>}
              {vehicleStats.motorcycle > 0 && <span className="text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">Moto {vehicleStats.motorcycle}</span>}
              {vehicleStats.bus > 0 && <span className="text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">Bus {vehicleStats.bus}</span>}
            </div>
          ) : (
            <div className="mt-2 text-[10px] text-[var(--text-muted)] font-medium">No vehicle activity</div>
          )}
        </div>
      </div>

      {/* 4. Split Views: Live Feeds & Recent Incidents */}
      <div className="flex flex-col xl:flex-row gap-[20px]">
        
        {/* Left: Camera Grid */}
        <div className="xl:w-[70%] flex flex-col">
          <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm flex flex-col flex-1 overflow-hidden">
            <div className="px-[24px] py-[16px] border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-base font-bold text-[#0B1F33] uppercase tracking-wider">Live Feeds</h2>
              <button 
                onClick={() => setActivePage('live-surveillance')}
                className="text-[12px] font-bold text-[#005EA8] hover:text-blue-800 transition-colors uppercase tracking-wider"
              >
                Go to Live Surveillance →
              </button>
            </div>
            <div className="p-[20px]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
                {cameras.slice(0, 4).map((cam) => {
                  const hasActiveIncident = incidents.some(inc => inc.cameraId === cam.id && inc.status === 'active');
                  
                  return (
                    <DashboardCameraCard
                      key={cam.id}
                      cam={cam}
                      onSelect={() => setActiveAnalysisCamera(cam)}
                      videoErrors={videoErrors}
                      setVideoErrors={setVideoErrors}
                      hasActiveIncident={hasActiveIncident}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Recent Incidents */}
        <div className="xl:w-[30%] flex flex-col">
          <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm flex flex-col flex-1 overflow-hidden">
            <div className="px-[20px] py-[16px] border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-base font-bold text-[#0B1F33] uppercase tracking-wider">Recent Incidents</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              {recentIncidents.length === 0 ? (
                <div className="p-8 text-center text-[var(--text-muted)]">
                  <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm font-medium">No recent incidents</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-color)]">
                  {recentIncidents.map(inc => (
                    <div key={inc.id} className="p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded ${
                          inc.severity === 'critical' ? 'bg-[#D92D20] text-white' : 
                          inc.severity === 'high' ? 'bg-[#F59E0B] text-white' : 
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {inc.severity}
                        </span>
                        <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                          {formatShortTimeIST(inc.timestamp)} IST
                        </span>
                      </div>
                      <div className="text-[13px] font-bold text-[#0B1F33] truncate mt-1.5">{((inc as any).type || inc.objectType || 'Alert').replace(/_/g, ' ')}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-[var(--text-muted)] font-mono">{inc.cameraName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {recentIncidents.length > 0 && (
              <div className="p-3 border-t border-[var(--border-color)] bg-slate-50/50">
                <button 
                  onClick={() => setActivePage('incidents')}
                  className="w-full py-2 text-[12px] font-bold text-[#005EA8] hover:bg-blue-50 rounded transition-colors uppercase tracking-widest"
                >
                  View All Evidence →
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {activeAnalysisCamera && (
        <CameraAnalysisModal 
          camera={activeAnalysisCamera} 
          videoUrl={ibvapApi.getVideoUrlForCamera(activeAnalysisCamera) || ''} 
          onClose={() => setActiveAnalysisCamera(null)} 
        />
      )}
    </div>
  );
};
