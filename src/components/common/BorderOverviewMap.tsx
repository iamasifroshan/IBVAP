import React, { useState } from 'react';
import {
  Camera,
  AlertTriangle,
  Settings,
  Plus,
  Minus,
  Crosshair,
  Layers,
  Shield,
  Radio,
  Eye
} from 'lucide-react';
import { Camera as CameraType, Incident } from '../../types';

interface Props {
  cameras: CameraType[];
  incidents: Incident[];
  onSelectCamera?: (cam: CameraType) => void;
  onSelectIncident?: (inc: Incident) => void;
}

export const BorderOverviewMap: React.FC<Props> = ({
  cameras,
  incidents,
  onSelectCamera,
  onSelectIncident
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [showLayers, setShowLayers] = useState<boolean>(true);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <div className="bg-white rounded-lg border border-slate-300 shadow-xs flex flex-col overflow-hidden transition-all">
      {/* ── Panel Header ── */}
      <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-sky-100 text-[#0F2742] flex items-center justify-center border border-sky-300 shrink-0">
            <Layers className="w-3.5 h-3.5 text-sky-800" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-[#0F2742] tracking-tight uppercase">
                BORDER OVERVIEW MAP
              </h2>
              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold tracking-wider uppercase bg-emerald-100 text-emerald-800 font-mono">
                ACTIVE
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium">Geospatial tactical grid, sector perimeters & intrusion radar</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex text-[10px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">
            SECTOR B • 34°18'42"N 74°22'18"E
          </span>
          <button 
            onClick={() => setShowLayers(prev => !prev)}
            className={`p-1.5 rounded border transition-colors ${
              showLayers ? 'bg-sky-50 text-sky-700 border-sky-300' : 'text-slate-500 border-slate-200 hover:bg-slate-100'
            }`}
            title="Toggle Map Overlay Layers"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Map Canvas Surface (Responsive Height: 380px mobile / 540px desktop) ── */}
      <div className="relative w-full h-[380px] xl:h-[540px] bg-[#14261C] overflow-hidden select-none">
        
        {/* Topographic Satellite Terrain Base */}
        <div 
          className="absolute inset-0 transition-transform duration-300 origin-center"
          style={{ transform: `scale(${zoom})` }}
        >
          <svg width="100%" height="100%" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="terrainBg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1E3827" />
                <stop offset="50%" stopColor="#162D1F" />
                <stop offset="100%" stopColor="#0E1F15" />
              </linearGradient>
              <filter id="borderGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Realistic Satellite Geospatial Imagery Base */}
            <image 
              href="/satellite_border_map.jpg" 
              x="0" 
              y="0" 
              width="1000" 
              height="500" 
              preserveAspectRatio="xMidYMid slice" 
            />
            {/* Minimal tint so satellite imagery is visually dominant */}
            <rect width="1000" height="500" fill="#0A160F" opacity="0.12" />

            {/* Subtle Topographic Elevation Contour Lines */}
            <path d="M0,90 Q300,30 600,100 T1000,70" fill="none" stroke="#527A5E" strokeWidth="0.8" strokeDasharray="4,4" opacity="0.25" />
            <path d="M0,170 Q320,110 650,180 T1000,140" fill="none" stroke="#527A5E" strokeWidth="0.8" strokeDasharray="4,4" opacity="0.25" />
            <path d="M0,250 Q280,190 620,260 T1000,220" fill="none" stroke="#527A5E" strokeWidth="0.8" strokeDasharray="4,4" opacity="0.25" />
            <path d="M0,330 Q260,270 580,340 T1000,300" fill="none" stroke="#527A5E" strokeWidth="0.8" strokeDasharray="4,4" opacity="0.25" />

            {/* Sector Boundary Lines */}
            <line x1="250" y1="0" x2="250" y2="500" stroke="#38BDF8" strokeWidth="1" strokeDasharray="6,6" opacity="0.3" />
            <line x1="550" y1="0" x2="550" y2="500" stroke="#38BDF8" strokeWidth="1" strokeDasharray="6,6" opacity="0.3" />
            <line x1="800" y1="0" x2="800" y2="500" stroke="#38BDF8" strokeWidth="1" strokeDasharray="6,6" opacity="0.3" />

            {/* Sector Labels */}
            <text x="120" y="36" fill="#38BDF8" opacity="0.5" fontSize="11" fontWeight="bold" fontFamily="monospace">SECTOR A</text>
            <text x="390" y="36" fill="#38BDF8" opacity="0.5" fontSize="11" fontWeight="bold" fontFamily="monospace">SECTOR B (ACTIVE)</text>
            <text x="670" y="36" fill="#38BDF8" opacity="0.5" fontSize="11" fontWeight="bold" fontFamily="monospace">SECTOR C</text>
            <text x="890" y="36" fill="#38BDF8" opacity="0.5" fontSize="11" fontWeight="bold" fontFamily="monospace">SECTOR D</text>

            {/* National Border Line (Yellow Dotted Line) */}
            <path 
              d="M380,0 C420,110 370,180 430,260 C460,320 420,400 450,500" 
              fill="none" 
              stroke="#FACC15" 
              strokeWidth="3" 
              strokeDasharray="8,5"
              filter="url(#borderGlow)"
            />

            {/* High Exclusion Restricted Buffer Zone Polygon */}
            <polygon points="360,0 450,0 490,500 390,500" fill="#FACC15" fillOpacity="0.04" />
          </svg>
        </div>

        {/* ── Top-Left Compact Operational Legend ── */}
        {showLayers && (
          <div className="absolute top-2.5 left-2.5 bg-[#0A192F]/88 backdrop-blur-sm border border-white/15 rounded-md p-2 text-[10px] text-slate-100 z-20 shadow-md flex flex-col gap-1 min-w-[130px] pointer-events-none">
            <div className="text-[8px] font-bold uppercase tracking-wider text-slate-400 border-b border-white/10 pb-0.5 font-mono flex items-center justify-between">
              <span>MAP TELEMETRY</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-white/70 shrink-0" />
              <span className="text-[9px] text-slate-200">Camera Online</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 border border-white/70 shrink-0" />
              <span className="text-[9px] text-slate-200">Camera Offline</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-red-600 flex items-center justify-center text-white font-bold text-[7px] shrink-0">▲</span>
              <span className="text-[9px] text-slate-200">Incident High</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 flex items-center justify-center text-black font-bold text-[7px] shrink-0">▲</span>
              <span className="text-[9px] text-slate-200">Incident Med/Low</span>
            </div>
            <div className="flex items-center gap-1.5 pt-0.5 border-t border-white/10">
              <span className="w-3 h-0.5 bg-yellow-400 rounded-xs shrink-0"></span>
              <span className="text-[9px] font-semibold text-yellow-300">Border Line</span>
            </div>
          </div>
        )}

        {/* ── Active Incident Breach Radar Ring in Center (Visually Dominant) ── */}
        <div 
          onClick={() => onSelectIncident && incidents.length > 0 && onSelectIncident(incidents[0])}
          className="absolute left-[48%] top-[45%] -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
        >
          <div className="absolute -inset-12 rounded-full border border-red-500/40 bg-red-500/15 animate-ping opacity-60"></div>
          <div className="absolute -inset-6 rounded-full border border-red-500/70 bg-red-500/20 animate-pulse"></div>
          <div className="relative w-9 h-9 rounded-full bg-red-600 border-2 border-white shadow-[0_0_15px_rgba(239,68,68,0.9)] flex items-center justify-center text-white group-hover:scale-110 transition-transform">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="absolute top-10 -left-16 bg-[#0A192F]/95 text-white border border-red-500 text-[9px] font-bold px-2 py-0.5 rounded shadow whitespace-nowrap">
            BREACH ALERT: Sector B-04
          </div>
        </div>

        {/* ── Interactive Camera Markers (Sleek & Unobtrusive) ── */}
        {/* Cam 1: North West */}
        <div 
          onClick={() => onSelectCamera && cameras.length > 0 && onSelectCamera(cameras[0])}
          className="absolute left-[28%] top-[26%] -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
        >
          <div className="w-6 h-6 rounded-full bg-emerald-600 border-2 border-white shadow-sm flex items-center justify-center text-white group-hover:scale-115 transition-transform">
            <Camera className="w-3 h-3" />
          </div>
          <div className="hidden group-hover:block absolute bottom-7 left-1/2 -translate-x-1/2 bg-[#0A192F] text-white text-[10px] font-mono px-2 py-0.5 rounded shadow-md whitespace-nowrap border border-white/20">
            BORDER-CAM-07 (Online)
          </div>
        </div>

        {/* Cam 2: North East */}
        <div 
          onClick={() => onSelectCamera && cameras.length > 1 && onSelectCamera(cameras[1])}
          className="absolute left-[66%] top-[22%] -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
        >
          <div className="w-6 h-6 rounded-full bg-red-600 border-2 border-white shadow-sm flex items-center justify-center text-white group-hover:scale-115 transition-transform">
            <Camera className="w-3 h-3" />
          </div>
          <div className="hidden group-hover:block absolute bottom-7 left-1/2 -translate-x-1/2 bg-[#0A192F] text-white text-[10px] font-mono px-2 py-0.5 rounded shadow-md whitespace-nowrap border border-white/20">
            SECTOR-B-CAM-03 (Offline)
          </div>
        </div>

        {/* Cam 3: Central West */}
        <div 
          onClick={() => onSelectCamera && cameras.length > 2 && onSelectCamera(cameras[2])}
          className="absolute left-[20%] top-[60%] -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
        >
          <div className="w-6 h-6 rounded-full bg-emerald-600 border-2 border-white shadow-sm flex items-center justify-center text-white group-hover:scale-115 transition-transform">
            <Camera className="w-3 h-3" />
          </div>
          <div className="hidden group-hover:block absolute bottom-7 left-1/2 -translate-x-1/2 bg-[#0A192F] text-white text-[10px] font-mono px-2 py-0.5 rounded shadow-md whitespace-nowrap border border-white/20">
            BOP-NORTH-02 (Online)
          </div>
        </div>

        {/* Cam 4: South West */}
        <div 
          onClick={() => onSelectCamera && cameras.length > 3 && onSelectCamera(cameras[3])}
          className="absolute left-[34%] top-[82%] -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
        >
          <div className="w-6 h-6 rounded-full bg-emerald-600 border-2 border-white shadow-sm flex items-center justify-center text-white group-hover:scale-115 transition-transform">
            <Camera className="w-3 h-3" />
          </div>
          <div className="hidden group-hover:block absolute bottom-7 left-1/2 -translate-x-1/2 bg-[#0A192F] text-white text-[10px] font-mono px-2 py-0.5 rounded shadow-md whitespace-nowrap border border-white/20">
            SOUTH-TRENCH-10 (Online)
          </div>
        </div>

        {/* Cam 5: Central East */}
        <div 
          onClick={() => onSelectCamera && cameras.length > 4 && onSelectCamera(cameras[4])}
          className="absolute left-[70%] top-[64%] -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
        >
          <div className="w-6 h-6 rounded-full bg-emerald-600 border-2 border-white shadow-sm flex items-center justify-center text-white group-hover:scale-115 transition-transform">
            <Camera className="w-3 h-3" />
          </div>
          <div className="hidden group-hover:block absolute bottom-7 left-1/2 -translate-x-1/2 bg-[#0A192F] text-white text-[10px] font-mono px-2 py-0.5 rounded shadow-md whitespace-nowrap border border-white/20">
            EAST-GATE-01 (Online)
          </div>
        </div>

        {/* Cam 6: South East */}
        <div 
          onClick={() => onSelectCamera && cameras.length > 5 && onSelectCamera(cameras[5])}
          className="absolute left-[82%] top-[84%] -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer group"
        >
          <div className="w-6 h-6 rounded-full bg-emerald-600 border-2 border-white shadow-sm flex items-center justify-center text-white group-hover:scale-115 transition-transform">
            <Camera className="w-3 h-3" />
          </div>
          <div className="hidden group-hover:block absolute bottom-7 left-1/2 -translate-x-1/2 bg-[#0A192F] text-white text-[10px] font-mono px-2 py-0.5 rounded shadow-md whitespace-nowrap border border-white/20">
            WEST-FENCE-04 (Online)
          </div>
        </div>

        {/* ── Zoom Controls on Right ── */}
        <div className="absolute right-4 top-4 bg-white/95 backdrop-blur-md rounded-xl border border-slate-300 shadow-lg flex flex-col z-20 overflow-hidden">
          <button 
            onClick={() => setZoom(z => Math.min(z + 0.15, 1.6))}
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors border-b border-slate-200"
            title="Zoom In (+)"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setZoom(z => Math.max(z - 0.15, 0.8))}
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors border-b border-slate-200"
            title="Zoom Out (−)"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setZoom(1)}
            className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
            title="Locate / Re-center"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>
  );
};
