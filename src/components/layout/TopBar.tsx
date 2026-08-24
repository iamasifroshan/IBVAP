import React from 'react';
import {
  ShieldAlert,
  Wifi,
  WifiOff,
  RefreshCw,
  Bell,
  UserCircle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const TopBar: React.FC = () => {
  const {
    metrics,
    networkStatus,
    setNetworkStatus,
    incidents,
  } = useApp();

  const criticalCount = incidents.filter(i => i.severity === 'critical' && i.status === 'active').length;

  return (
    <header className="h-16 bg-[#0F2742] text-white px-6 flex items-center justify-between shadow-sm z-40 relative">

      {/* ── Brand ── */}
      <div className="flex items-center gap-4">
        {/* Placeholder Emblem */}
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center border border-white/20">
          <ShieldAlert className="w-5 h-5 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-base tracking-wide leading-tight text-white">IBVAP</span>
          <span className="text-xs text-blue-200 whitespace-nowrap">Intelligent Border Video Analytics Platform</span>
        </div>

        {/* Edge node identifier */}
        <div className="hidden lg:flex items-center gap-3 pl-6 ml-2 border-l border-white/20 text-xs text-blue-200 font-medium">
          <span>Edge Node: {metrics.edgeNodeId}</span>
        </div>
      </div>

      {/* ── Right: Key metrics & Profile ── */}
      <div className="flex items-center gap-6">

        {/* Critical threat alert */}
        {criticalCount > 0 && (
          <div className="flex items-center gap-2 text-[#D92D20] bg-red-950/40 px-3 py-1.5 rounded border border-[#D92D20]/50 text-sm font-semibold">
            <ShieldAlert className="w-4 h-4 animate-pulse" />
            <span>{criticalCount} Critical</span>
          </div>
        )}

        {/* Cameras online */}
        <div className="text-blue-100 flex items-center gap-2 text-sm">
          <span>Cameras:</span>
          <span className="text-[#10B981] font-bold">{metrics.activeCameras}</span>
          <span className="text-blue-300">/ {metrics.totalCameras}</span>
        </div>

        {/* Network status toggle */}
        <div className="flex items-center gap-2 text-sm cursor-pointer" onClick={() => setNetworkStatus(networkStatus === 'online' ? 'offline' : 'online')}>
          {networkStatus === 'online' ? (
            <span className="flex items-center gap-1.5 text-[#10B981] font-bold bg-[#10B981]/10 px-3 py-1 rounded border border-[#10B981]/30">
              <Wifi className="w-4 h-4" /> ONLINE
            </span>
          ) : networkStatus === 'syncing' ? (
            <span className="flex items-center gap-1.5 text-[#1F5F8B] font-bold bg-[#1F5F8B]/20 px-3 py-1 rounded border border-[#1F5F8B]/50 animate-pulse">
              <RefreshCw className="w-4 h-4 animate-spin" /> SYNCING
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[#F59E0B] font-bold bg-[#F59E0B]/10 px-3 py-1 rounded border border-[#F59E0B]/30">
              <WifiOff className="w-4 h-4" /> OFFLINE
            </span>
          )}
        </div>
        
        {/* Profile / Notifications placeholder */}
        <div className="flex items-center gap-4 pl-4 border-l border-white/20">
          <button className="text-blue-200 hover:text-white transition-colors relative">
            <Bell className="w-5 h-5" />
            {criticalCount > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#D92D20] rounded-full border border-[#0F2742]"></span>}
          </button>
          <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1.5 rounded transition-colors">
            <UserCircle className="w-7 h-7 text-blue-200" />
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-semibold leading-none text-white">Commander</span>
              <span className="text-[10px] text-blue-300 mt-0.5">Sector North</span>
            </div>
          </div>
        </div>
      </div>

    </header>
  );
};
