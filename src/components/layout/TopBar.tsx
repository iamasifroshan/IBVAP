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
  const activeAlertCount = incidents.filter(i => i.status === 'active').length || incidents.length || 72;

  // Format Date exactly: "Mon, 07 Sept 2026"
  const weekday = currentTime.toLocaleDateString('en-GB', { weekday: 'short' });
  const day = currentTime.toLocaleDateString('en-GB', { day: '2-digit' });
  const rawMonth = currentTime.toLocaleDateString('en-GB', { month: 'short' });
  const month = rawMonth === 'Sep' ? 'Sept' : rawMonth;
  const year = currentTime.getFullYear();
  const formattedDate = `${weekday}, ${day} ${month} ${year}`;

  // Format Time: "02:37:27 PM"
  const formattedTime = currentTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  return (
    <header className="h-[72px] bg-[#06152B] text-white px-4 md:px-6 flex items-center justify-between shadow-md z-40 relative border-b border-[#142C4E] select-none shrink-0">
      
      {/* ── Left Side: Official Government of India Identity ── */}
      <div className="flex items-center gap-3.5 shrink-0">
        
        {/* State Emblem of India (Gold) */}
        <div className="flex items-center justify-center shrink-0">
          <GovernmentEmblem size={44} variant="gold" />
        </div>

        {/* 4-Line Official Typography Stack */}
        <div className="flex flex-col justify-center leading-tight">
          {/* 1. GOVERNMENT OF INDIA */}
          <span className="text-[12px] font-bold text-[#E5A93C] tracking-[0.16em] uppercase leading-none">
            GOVERNMENT OF INDIA
          </span>

          {/* 2. Ministry of Home Affairs • Border Security */}
          <span className="text-[11.5px] text-slate-200 font-normal mt-0.5 leading-tight">
            Ministry of Home Affairs • Border Security
          </span>

          {/* 3. IBVAP + Subtitle (Both in Sky Blue / Cyan) */}
          <div className="flex items-baseline gap-2 mt-0.5 leading-none">
            <span className="text-[19px] font-bold tracking-tight text-[#38BDF8] leading-none">
              IBVAP
            </span>
            <span className="text-[12.5px] font-medium text-[#38BDF8] tracking-normal">
              Intelligent Border Video Analytics Platform
            </span>
          </div>

          {/* 4. Secure Borders • Safer Nation • Smarter Tomorrow */}
          <span className="text-[10px] text-slate-400 font-normal mt-0.5 leading-tight">
            Secure Borders • Safer Nation • Smarter Tomorrow
          </span>
        </div>
      </div>

      {/* ── Right Side: National Motto, Live Clock, Commander Profile, Actions ── */}
      <div className="flex items-center gap-4 md:gap-5 shrink-0">

        {/* National Motto with Tiranga Flag */}
        <div className="hidden xl:flex items-center gap-2.5">
          <IndianNationalFlag width={36} height={24} />

          <div className="flex flex-col text-left leading-tight">
            <span className="text-[13.5px] font-bold text-[#E5A93C] leading-tight">
              सुरक्षित सीमा, समृद्ध भारत
            </span>
            <span className="text-[11px] text-white font-normal leading-tight mt-0.5">
              Secure Borders, Prosperous India
            </span>
          </div>
        </div>

        {/* Operational Live Time & System Status */}
        <div className="hidden lg:flex flex-col text-right leading-tight">
          <span className="text-[11px] text-slate-200 font-medium leading-none">
            {formattedDate}
          </span>
          <span className="text-[15.5px] font-bold text-[#38BDF8] font-mono tracking-wide leading-tight mt-0.5">
            {formattedTime}
          </span>
          <div className="flex items-center justify-end gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></span>
            <span className="text-[9.5px] font-bold text-[#10B981] font-mono tracking-wider uppercase">
              SYSTEM ONLINE
            </span>
          </div>
        </div>

        {/* Commander Profile Card */}
        <div 
          onClick={() => setActivePage('system-verification')}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#0C203D] border border-[#1A3860] hover:border-sky-400/50 cursor-pointer transition-all shadow-2xs group"
          title="Command Operations Station: Sector-B-HQ"
        >
          <div className="w-7 h-7 rounded-full bg-[#142B4D] border border-sky-400/40 flex items-center justify-center text-sky-300 shrink-0 group-hover:border-sky-400 transition-colors">
            <User className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col text-left leading-tight">
            <span className="text-[11px] font-bold text-white tracking-wide leading-tight">Commander</span>
            <span className="text-[9.5px] text-sky-200 font-normal leading-tight">Sector North</span>
            <span className="text-[9px] text-sky-300 font-mono font-medium tracking-wider leading-tight">
              Station: Sector-B-HQ
            </span>
          </div>
        </div>

        {/* Notification Bell & Settings Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActivePage('incidents')}
            className="w-8 h-8 rounded-md bg-[#0C203D] hover:bg-[#142B4D] text-slate-200 hover:text-white border border-[#1A3860] flex items-center justify-center relative transition-colors cursor-pointer shadow-2xs"
            title={`${activeAlertCount} Total Incidents in System`}
          >
            <Bell className="w-4 h-4" />
            {(criticalCount > 0 || activeAlertCount > 0) && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 bg-red-600 text-white font-bold text-[8.5px] rounded-full flex items-center justify-center border-2 border-[#06152B]">
                {criticalCount > 0 ? criticalCount : activeAlertCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActivePage('settings')}
            className="w-8 h-8 rounded-md bg-[#0C203D] hover:bg-[#142B4D] text-slate-200 hover:text-white border border-[#1A3860] flex items-center justify-center transition-colors cursor-pointer shadow-2xs"
            title="System Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  );
};
