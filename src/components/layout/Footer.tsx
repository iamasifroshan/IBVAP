import React from 'react';
import { GovernmentEmblem } from '../common/GovernmentEmblem';

export const Footer: React.FC = () => {
  return (
    <footer className="h-12 bg-[#E9F0F8]/90 border-t border-slate-200/90 text-slate-600 px-4 md:px-8 flex items-center justify-between text-xs select-none shrink-0 z-30">
      {/* Left: Emblem & Platform Name */}
      <div className="flex items-center gap-2.5">
        <GovernmentEmblem size={24} variant="dark" />
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 leading-tight">
          <span className="font-extrabold text-[#0F2742] tracking-wider font-mono">
            IBVAP
          </span>
          <span className="hidden md:inline text-slate-500 font-medium">
            Intelligent Border Video Analytics Platform
          </span>
        </div>
      </div>

      {/* Center: Ministry of Home Affairs */}
      <div className="hidden sm:flex flex-col items-center text-center leading-tight">
        <span className="font-semibold text-slate-700 text-[11px]">
          Ministry of Home Affairs | Government of India
        </span>
        <span className="text-[10px] text-slate-500 font-medium">
          Secure Borders, Prosperous India
        </span>
      </div>

      {/* Right: Operational Health & Version */}
      <div className="flex items-center gap-4 text-[11px] font-mono">
        <span className="hidden md:inline text-slate-500">Version 1.6.0</span>
        <span className="flex items-center gap-1.5 font-bold text-emerald-700">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>All Systems Operational</span>
        </span>
      </div>
    </footer>
  );
};
