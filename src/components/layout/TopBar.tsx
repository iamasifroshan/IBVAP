import React, { useState, useEffect } from 'react';
import {
  Bell,
  Settings,
  User
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { GovernmentEmblem } from '../common/GovernmentEmblem';
import { IndianNationalFlag } from '../common/IndianNationalFlag';

export const TopBar: React.FC = () => {
  const {
    incidents,
    setActivePage
  } = useApp();

  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const criticalCount = incidents.filter(i => i.severity === 'critical' && i.status === 'active').length;
  const activeAlertCount = incidents.filter(i => i.status === 'active').length || incidents.length;

  const dateStr = currentTime.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const timeStr = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  return (
    <header className="min-h-[96px] md:min-h-[102px] bg-[#0A192F] text-white px-5 md:px-8 py-3.5 md:py-4 flex items-center justify-between shadow-xl z-40 relative border-b border-[#1E3A5F] select-none">
      
      {/* ── Background Subtle Watermark ── */}
      <div className="absolute left-[450px] top-1/2 -translate-y-1/2 opacity-[0.05] pointer-events-none hidden 2xl:block">
        <svg width="200" height="200" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M95 15 C105 10 115 18 118 28 C120 38 128 42 135 50 C145 60 148 72 142 85 C138 92 145 102 140 115 C132 130 120 145 110 162 C104 172 98 185 95 188 C92 185 86 172 80 162 C70 145 58 130 50 115 C45 102 52 92 48 85 C42 72 45 60 55 50 C62 42 70 38 72 28 C75 18 85 10 95 15 Z"
            fill="#FFFFFF"
          />
        </svg>
      </div>

      {/* ── Left Side: Government of India Identity ── */}
      <div className="flex items-center gap-3.5 md:gap-5 shrink-0 z-10">
        
        {/* State Emblem of India with Dignified Proportions */}
        <div className="flex items-center justify-center pl-1 pr-1 shrink-0">
          <GovernmentEmblem size={52} variant="gold" />
        </div>

        {/* Official Government Hierarchy */}
        <div className="flex flex-col justify-center leading-normal">
          {/* 1. GOVERNMENT OF INDIA */}
          <div className="flex items-center gap-2">
            <span className="text-sm md:text-[15px] font-bold text-amber-300 tracking-[0.2em] uppercase font-serif leading-none">
              GOVERNMENT OF INDIA
            </span>
          </div>

          {/* 2. Ministry of Home Affairs • Border Security */}
          <div className="text-xs md:text-[13px] text-slate-200 font-medium tracking-wide mt-1">
            Ministry of Home Affairs • Border Security
          </div>

          {/* 3. IBVAP   Intelligent Border Video Analytics Platform */}
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-2xl md:text-[27px] font-black tracking-wider text-white font-mono leading-none">
              IBVAP
            </span>
            <span className="text-xs md:text-sm font-bold text-sky-200 tracking-wide">
              Intelligent Border Video Analytics Platform
            </span>
          </div>

          {/* 4. Secure Borders • Safer Nation • Smarter Tomorrow */}
          <div className="text-[11px] md:text-xs text-slate-400 font-medium italic mt-1 tracking-wide">
            Secure Borders • Safer Nation • Smarter Tomorrow
          </div>
        </div>
      </div>

      {/* ── Right Side: National Motto, Clock, Commander Profile ── */}
      <div className="flex items-center gap-4 md:gap-6 shrink-0 z-10">

        {/* National Slogan with Indian Tiranga Flag */}
        <div className="hidden xl:flex items-center gap-3.5 pr-5 border-r border-white/15">
          <IndianNationalFlag width={45} height={30} />

          {/* Large, clearly readable motto */}
          <div className="flex flex-col text-left leading-tight">
            <span className="text-[15px] md:text-base font-bold text-amber-200 tracking-wide font-serif">
              सुरक्षित सीमा, समृद्ध भारत
            </span>
            <span className="text-xs md:text-[13px] font-semibold text-slate-200 mt-1">
              Secure Borders, Prosperous India
            </span>
          </div>
        </div>

        {/* Operational Live Time & System Status */}
        <div className="hidden lg:flex flex-col text-right pr-1">
          <span className="text-xs font-semibold text-slate-300 leading-none">
            {dateStr}
          </span>
          <span className="text-base font-bold text-white font-mono tracking-wide leading-tight mt-1">
            {timeStr}
          </span>
          <div className="flex items-center justify-end gap-1.5 mt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-[11px] font-bold text-emerald-400 tracking-wide uppercase">
              System Online
            </span>
          </div>
        </div>

        {/* Commander Profile — With Station Inside Profile Card */}
        <div 
          onClick={() => setActivePage('system-verification')}
          className="flex items-center gap-3 px-3.5 py-2 rounded-lg bg-[#112240] border border-white/15 hover:border-sky-400/50 cursor-pointer transition-all shadow-sm group"
          title="Command Operations Station: Sector-B-HQ"
        >
          <div className="w-9 h-9 rounded-full bg-[#1B3054] border border-sky-400/50 flex items-center justify-center text-sky-200 shrink-0 group-hover:border-sky-400 transition-colors">
            <User className="w-5 h-5" />
          </div>
          <div className="flex flex-col text-left leading-tight">
            <span className="text-xs font-bold text-white tracking-wide">Commander</span>
            <span className="text-[11px] text-slate-300 font-medium mt-0.5">Sector North</span>
            <span className="text-[10px] text-sky-300 font-mono font-semibold tracking-wider mt-0.5">
              Station: Sector-B-HQ
            </span>
          </div>
        </div>

        {/* Notification Bell & Settings */}
        <div className="flex items-center gap-2 pl-2 border-l border-white/15">
          <button
            onClick={() => setActivePage('incidents')}
            className="w-10 h-10 rounded-lg bg-[#112240] hover:bg-[#1B3054] text-slate-200 hover:text-white border border-white/15 flex items-center justify-center relative transition-colors cursor-pointer"
            title={`${activeAlertCount} Total Incidents in System`}
          >
            <Bell className="w-5 h-5" />
            {(criticalCount > 0 || activeAlertCount > 0) && (
              <span className="absolute -top-1 -right-1 min-w-[19px] h-[19px] px-1 bg-red-600 text-white font-bold text-[10px] rounded-full flex items-center justify-center border-2 border-[#0A192F] animate-pulse">
                {criticalCount > 0 ? criticalCount : activeAlertCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActivePage('settings')}
            className="w-10 h-10 rounded-lg bg-[#112240] hover:bg-[#1B3054] text-slate-200 hover:text-white border border-white/15 flex items-center justify-center transition-colors cursor-pointer"
            title="System Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

      </div>
    </header>
  );
};
