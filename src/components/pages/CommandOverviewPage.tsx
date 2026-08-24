import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ShieldAlert, Video, HardDrive, CheckCircle2, Activity, Camera, AlertTriangle } from 'lucide-react';
import { ThreatScoreBadge } from '../common/ThreatScoreBadge';
import { ibvapApi } from '../../services/apiClient';
import { CameraAnalysisModal } from '../common/CameraAnalysisModal';
import { Camera as CameraType } from '../../types';

export const CommandOverviewPage: React.FC = () => {
  const { metrics, incidents, cameras, setActivePage } = useApp();
  const [activeAnalysisCamera, setActiveAnalysisCamera] = useState<CameraType | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});

  const criticalCount = incidents.filter(i => i.severity === 'critical' && i.status === 'active').length;
  const onlineCount = cameras.filter(c => c.status === 'online').length;
  
  // The primary active feed (prototype simulation or actual first camera)
  const mainCamera = cameras[0];
  const recentIncidents = [...incidents].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  ).slice(0, 5);

  const getSeverityColor = (severity: string) => {
    switch(severity) {
      case 'critical': return 'bg-[#D92D20]';
      case 'high': return 'bg-[#F59E0B]';
      case 'medium': return 'bg-[#F59E0B]';
      case 'low': return 'bg-[#1F5F8B]';
      default: return 'bg-slate-400';
    }
  };

  return (
    <div className="space-y-[24px]">
      
      {/* 1. Header */}
      <div>
        <h1 className="text-[28px] font-semibold text-[var(--primary-navy)]">Border Security Operations Dashboard</h1>
        <p className="text-[15px] text-[var(--text-muted)] mt-1">Real-time monitoring and AI-assisted incident management</p>
      </div>

      {/* 2. Summary Cards - Max 4 in one row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[16px]">
        
        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm flex flex-col justify-between hover:border-slate-300 transition-colors h-full">
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">Active Incidents</span>
            <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
          </div>
          <div className="mt-4">
            <span className="text-[32px] font-bold text-[var(--primary-navy)] leading-none">{incidents.filter(i => i.status === 'active').length}</span>
          </div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[#D92D20]/30 shadow-sm flex flex-col justify-between hover:border-[#D92D20]/60 transition-colors relative overflow-hidden h-full">
          {criticalCount > 0 && <div className="absolute top-0 left-0 w-1 h-full bg-[#D92D20]"></div>}
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-[#D92D20] uppercase tracking-wider">Critical Alerts</span>
            <ShieldAlert className="w-5 h-5 text-[#D92D20]" />
          </div>
          <div className="mt-4">
            <span className="text-[32px] font-bold text-[#D92D20] leading-none">{criticalCount}</span>
          </div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm flex flex-col justify-between hover:border-slate-300 transition-colors h-full">
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">Connected Cameras</span>
            <Camera className="w-5 h-5 text-[#10B981]" />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-[32px] font-bold text-[#10B981] leading-none">{onlineCount}</span>
            <span className="text-base text-[var(--text-muted)] font-medium">/ {cameras.length}</span>
          </div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm flex flex-col justify-between hover:border-slate-300 transition-colors h-full">
          <div className="flex justify-between items-start">
            <span className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">AI Processing Status</span>
            <Activity className="w-5 h-5 text-[#1F5F8B]" />
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-[32px] font-bold text-[#1F5F8B] leading-none">Optimal</span>
            <span className="text-sm text-[var(--text-muted)]">({metrics.processingFps} FPS)</span>
          </div>
        </div>

      </div>

      {/* 3. Main Content Grid */}
      <div className="flex flex-col xl:flex-row gap-[20px]">
        
        {/* Left: Live Camera Overview (75%) */}
        <div className="xl:w-[75%] flex flex-col">
          <div className="bg-slate-50 border border-[var(--border-color)] rounded-lg shadow-sm flex flex-col flex-1 overflow-hidden">
            
            <div className="px-[24px] pt-[20px] pb-[16px] flex justify-between items-center">
              <h2 className="text-lg font-semibold text-[var(--primary-navy)] tracking-tight">Live Camera Overview</h2>
              <button 
                onClick={() => setActivePage('live-surveillance')}
                className="text-[13px] font-bold text-[#1F5F8B] hover:text-[#0F2742] transition-colors flex items-center gap-1 uppercase tracking-wider"
              >
                View All Cameras →
              </button>
            </div>
            
            <div className="px-[24px] pb-[24px]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
                {cameras.slice(0, 4).map((cam) => {
                  const videoUrl = ibvapApi.getVideoUrlForCamera(cam);
                  const hasActiveIncident = incidents.some(inc => inc.cameraId === cam.id && inc.status === 'active');
                  
                  return (
                    <div 
                      key={cam.id} 
                      className={`bg-white rounded-lg overflow-hidden cursor-pointer group border shadow-sm flex flex-col transition-all duration-200 relative ${
                        hasActiveIncident 
                          ? 'border-[#D92D20] ring-1 ring-[#D92D20]/25' 
                          : 'border-[var(--border-color)] hover:border-[#1F5F8B]'
                      }`}
                      onClick={() => {
                        if (videoUrl) {
                          setActiveAnalysisCamera(cam);
                        } else {
                          setActivePage('live-surveillance');
                        }
                      }}
                    >
                      {/* Feed Image/Video Container (16:9) */}
                      <div className="relative w-full aspect-video bg-slate-900 overflow-hidden shrink-0">
                        {videoUrl && !videoErrors[cam.id] ? (
                          <video 
                            src={videoUrl}
                            autoPlay
                            loop
                            muted
                            playsInline
                            preload="metadata"
                            className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-all duration-500"
                            onError={(e) => {
                              console.error("Video failed to load for camera " + cam.id, e);
                              setVideoErrors(prev => ({ ...prev, [cam.id]: true }));
                            }}
                          />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 bg-slate-900">
                            <Video className="w-8 h-8 mb-2 opacity-50" />
                            <span className="text-[11px] font-semibold tracking-wider uppercase text-red-500">VIDEO SOURCE UNAVAILABLE</span>
                            <span className="text-[10px] text-slate-500 mt-1">NO VIDEO SOURCE LINKED OR LOAD FAILURE</span>
                          </div>
                        )}

                        {/* Top Overlay */}
                        <div className="absolute top-0 left-0 right-0 p-2.5 flex justify-between items-start bg-gradient-to-b from-black/80 to-transparent z-10">
                          <span className="text-white text-[11px] font-bold font-mono shadow-sm bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm border border-white/10">
                            {cam.name}
                          </span>
                          
                          <span className="px-2 py-0.5 text-[9px] font-bold rounded flex items-center gap-1.5 shadow-sm backdrop-blur-sm border uppercase tracking-wider bg-[#10B981]/20 text-[#10B981] border-[#10B981]/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></span>
                            ONLINE
                          </span>
                        </div>
                      </div>

                      {/* Bottom Metadata Strip */}
                      <div className="px-[16px] py-[12px] bg-white border-t border-[var(--border-color)] h-[58px] flex flex-col justify-center">
                        <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-0.5 truncate">{cam.sector}</div>
                        <div className={`text-[12px] font-bold truncate ${hasActiveIncident ? 'text-[#D92D20]' : 'text-[#1F5F8B]'}`}>
                          {hasActiveIncident ? 'HUMAN DETECTED' : 'NORMAL'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right: System Health & Recent Alerts (25%) */}
        <div className="xl:w-[25%] flex flex-col gap-[20px]">
          
          {/* System Health panel */}
          <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm">
            <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/50">
              <h2 className="text-lg font-semibold text-[var(--primary-navy)] tracking-tight">System Health</h2>
            </div>
            <div className="p-[20px] space-y-4">
              <div className="flex justify-between items-center text-[14px]">
                <span className="text-[var(--text-muted)] font-medium">AI Engine</span>
                <span className="text-[#10B981] font-semibold flex items-center gap-1.5"><span className="w-2 h-2 bg-[#10B981] rounded-full"></span> Active</span>
              </div>
              <div className="flex justify-between items-center text-[14px]">
                <span className="text-[var(--text-muted)] font-medium">Database</span>
                <span className="text-[#10B981] font-semibold flex items-center gap-1.5"><span className="w-2 h-2 bg-[#10B981] rounded-full"></span> Connected</span>
              </div>
              <div className="flex justify-between items-center text-[14px]">
                <span className="text-[var(--text-muted)] font-medium">Edge Storage</span>
                <span className="text-[var(--primary-navy)] font-semibold">{metrics.storageUsedMb} MB / 8 GB</span>
              </div>
              <div className="flex justify-between items-center text-[14px]">
                <span className="text-[var(--text-muted)] font-medium">Network</span>
                <span className="text-[#10B981] font-semibold flex items-center gap-1.5"><span className="w-2 h-2 bg-[#10B981] rounded-full"></span> Online</span>
              </div>
            </div>
          </div>

          {/* Recent Incidents panel */}
          <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm flex-1 flex flex-col">
            <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/50 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-[var(--primary-navy)] tracking-tight">Recent Incidents</h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-[20px] space-y-0">
              {recentIncidents.length === 0 ? (
                <div className="text-[14px] text-[var(--text-muted)] text-center py-8">No recent incidents.</div>
              ) : (
                recentIncidents.map(inc => (
                  <div key={inc.id} className="flex items-start gap-3 py-[14px] border-b border-slate-100 last:border-0 cursor-pointer group" onClick={() => setActivePage('incidents')}>
                    {/* Color Dot */}
                    <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${getSeverityColor(inc.severity)}`}></div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <div className="text-[14px] font-semibold text-[var(--primary-navy)] capitalize truncate group-hover:text-[#1F5F8B] transition-colors leading-tight">
                          {inc.objectType}
                        </div>
                        <div className={`text-[10px] font-bold uppercase tracking-wider leading-tight ${
                          inc.severity === 'critical' ? 'text-[#D92D20]' :
                          inc.severity === 'high' ? 'text-[#F59E0B]' :
                          inc.severity === 'medium' ? 'text-[#F59E0B]' : 'text-[#1F5F8B]'
                        }`}>
                          {inc.severity}
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center">
                        <div className="text-[12px] text-[var(--text-muted)] truncate">
                          {inc.sector}
                        </div>
                        <div className="text-[11px] font-semibold text-[var(--text-primary)]">
                          {new Date(inc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {recentIncidents.length > 0 && (
              <div className="px-[20px] pb-[20px] pt-0">
                <button 
                  onClick={() => setActivePage('incidents')}
                  className="w-full py-2.5 text-[13px] font-bold text-[#1F5F8B] bg-[#1F5F8B]/5 hover:bg-[#1F5F8B]/10 rounded transition-colors uppercase tracking-wider"
                >
                  View All →
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
