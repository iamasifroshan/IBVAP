import React, { useState } from 'react';
import { 
  CloudFog, Sun, Moon, ShieldAlert, Settings2, ChevronDown, ChevronRight, CheckCircle2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { EnvironmentCondition } from '../../types';

export const EnviroVisionPage: React.FC = () => {
  const { environment, setEnvironment, cameras } = useApp();
  const [showTechnical, setShowTechnical] = useState(false);

  const envModes: {
    id: EnvironmentCondition;
    label: string;
    desc: string;
    icon: React.ReactNode;
    reliabilityImpact: string;
    bgClass: string;
    borderClass: string;
    activeClass: string;
    iconBg: string;
    accentColor: string;
    badgeStyle: string;
  }[] = [
    { 
      id: 'normal', 
      label: 'Normal Daytime', 
      desc: 'Clear weather conditions; optimal baseline AI precision', 
      icon: <Sun className="w-5 h-5 text-amber-500" />, 
      reliabilityImpact: '95-100% AI Confidence',
      bgClass: 'bg-gradient-to-br from-amber-50/70 via-sky-50/30 to-white',
      borderClass: 'border-amber-200/80 hover:border-amber-400 hover:shadow-md',
      activeClass: 'ring-2 ring-amber-500 border-amber-500 bg-amber-50/90 shadow-md',
      iconBg: 'bg-amber-100 text-amber-600 border border-amber-200/90 shadow-2xs',
      accentColor: 'text-amber-950',
      badgeStyle: 'bg-emerald-100/80 text-emerald-800 border-emerald-200'
    },
    { 
      id: 'night', 
      label: 'Night Mode', 
      desc: 'Thermal IR active; night vision enhancement enabled', 
      icon: <Moon className="w-5 h-5 text-indigo-500" />, 
      reliabilityImpact: '80-90% AI Confidence',
      bgClass: 'bg-gradient-to-br from-indigo-50/90 via-slate-50/70 to-purple-50/50',
      borderClass: 'border-indigo-200/80 hover:border-indigo-400 hover:shadow-md',
      activeClass: 'ring-2 ring-indigo-600 border-indigo-600 bg-indigo-50/95 shadow-md',
      iconBg: 'bg-indigo-100 text-indigo-700 border border-indigo-200 shadow-2xs',
      accentColor: 'text-indigo-950',
      badgeStyle: 'bg-indigo-100/80 text-indigo-800 border-indigo-200'
    },
    { 
      id: 'low_light', 
      label: 'Low Light Twilight', 
      desc: 'Dusk/Dawn low contrast; auto contrast boost enabled', 
      icon: <Sun className="w-5 h-5 text-orange-600" />, 
      reliabilityImpact: '75-85% AI Confidence',
      bgClass: 'bg-gradient-to-br from-orange-50/80 via-amber-50/50 to-rose-50/40',
      borderClass: 'border-orange-200/80 hover:border-orange-400 hover:shadow-md',
      activeClass: 'ring-2 ring-orange-500 border-orange-500 bg-orange-50/95 shadow-md',
      iconBg: 'bg-orange-100 text-orange-600 border border-orange-200 shadow-2xs',
      accentColor: 'text-orange-950',
      badgeStyle: 'bg-orange-100/80 text-orange-800 border-orange-200'
    },
    { 
      id: 'cloudy', 
      label: 'Overcast Daylight', 
      desc: 'Moderate light reduction; standard AI confidence', 
      icon: <CloudFog className="w-5 h-5 text-slate-600" />, 
      reliabilityImpact: '85-92% AI Confidence',
      bgClass: 'bg-gradient-to-br from-slate-100/90 via-blue-50/30 to-slate-50',
      borderClass: 'border-slate-300/80 hover:border-slate-400 hover:shadow-md',
      activeClass: 'ring-2 ring-slate-600 border-slate-600 bg-slate-100 shadow-md',
      iconBg: 'bg-slate-200/80 text-slate-700 border border-slate-300 shadow-2xs',
      accentColor: 'text-slate-900',
      badgeStyle: 'bg-slate-200/80 text-slate-700 border-slate-300'
    },
    { 
      id: 'fog', 
      label: 'Moderate Fog', 
      desc: 'Atmospheric degradation; dehaze AI filters activated', 
      icon: <CloudFog className="w-5 h-5 text-teal-600" />, 
      reliabilityImpact: '55-68% AI Confidence',
      bgClass: 'bg-gradient-to-br from-teal-50/80 via-cyan-50/50 to-sky-50/40',
      borderClass: 'border-teal-200 hover:border-teal-400 hover:shadow-md',
      activeClass: 'ring-2 ring-teal-600 border-teal-600 bg-teal-50/95 shadow-md',
      iconBg: 'bg-teal-100 text-teal-700 border border-teal-200 shadow-2xs',
      accentColor: 'text-teal-950',
      badgeStyle: 'bg-teal-100/80 text-teal-800 border-teal-200'
    },
    { 
      id: 'severe_fog', 
      label: 'Severe Fog Warning', 
      desc: 'Visibility < 30%; secondary human verification mandatory', 
      icon: <ShieldAlert className="w-5 h-5 text-red-600" />, 
      reliabilityImpact: '35-45% AI Confidence',
      bgClass: 'bg-gradient-to-br from-red-50/90 via-rose-50/50 to-amber-50/30',
      borderClass: 'border-red-200 hover:border-red-400 hover:shadow-md',
      activeClass: 'ring-2 ring-red-600 border-red-600 bg-red-50/95 shadow-md',
      iconBg: 'bg-red-100 text-red-600 border border-red-200 shadow-2xs animate-pulse',
      accentColor: 'text-red-950',
      badgeStyle: 'bg-red-100 text-red-700 border-red-200 font-bold'
    },
    { 
      id: 'dust', 
      label: 'Dust / Sandstorm', 
      desc: 'Particulate obstruction; high noise filtering active', 
      icon: <CloudFog className="w-5 h-5 text-amber-700" />, 
      reliabilityImpact: '45-55% AI Confidence',
      bgClass: 'bg-gradient-to-br from-amber-100/60 via-yellow-50/70 to-orange-50/50',
      borderClass: 'border-amber-300/90 hover:border-amber-400 hover:shadow-md',
      activeClass: 'ring-2 ring-amber-600 border-amber-600 bg-amber-50/95 shadow-md',
      iconBg: 'bg-amber-200/70 text-amber-800 border border-amber-300 shadow-2xs',
      accentColor: 'text-amber-950',
      badgeStyle: 'bg-amber-100 text-amber-800 border-amber-300'
    }
  ];

  return (
    <div className="space-y-[24px] max-w-[1400px]">
      
      {/* 1. PAGE HEADER */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded bg-[#1F5F8B]/10 text-[#1F5F8B]">
            <CloudFog className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-heading text-xl sm:text-2xl lg:text-[28px] font-bold text-[var(--primary-navy)] leading-tight">
              EnviroVision AI
            </h1>
            <p className="text-[13px] sm:text-[14px] text-[var(--text-muted)] mt-1 font-body">
              Atmospheric Adaptation Engine. Adjusts AI confidence based on environmental physics.
            </p>
          </div>
        </div>
        
        <div className={`px-4 py-2 rounded-full border text-sm font-bold flex items-center gap-2 ${
          environment === 'normal' ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30' : 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30'
        }`}>
          ENV: {environment.toUpperCase().replace('_', ' ')}
        </div>
      </div>

      {/* 3. MAIN SUMMARY (Environment Selector) */}
      <div className="bg-white border border-[var(--border-color)] rounded-xl shadow-2xs overflow-hidden">
        <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/70 flex items-center justify-between">
          <div>
            <h2 className="font-heading text-base sm:text-lg font-bold text-[var(--primary-navy)]">
              Operating Environment Simulation Mode
            </h2>
            <p className="text-xs text-slate-500 font-body mt-0.5">
              Select environmental conditions to trigger real-time physics degradation and confidence recalculation.
            </p>
          </div>
          <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
            {envModes.length} PROFILES
          </span>
        </div>
        <div className="p-[20px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[18px]">
            {envModes.map((mode) => {
              const isSelected = environment === mode.id;
              return (
                <div
                  key={mode.id}
                  onClick={() => setEnvironment(mode.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 flex flex-col justify-between h-full min-h-[155px] shadow-2xs hover:shadow-md hover:-translate-y-0.5 ${
                    isSelected ? mode.activeClass : `${mode.bgClass} ${mode.borderClass}`
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start mb-2.5">
                      <div className={`p-2 rounded-lg border shadow-2xs ${mode.iconBg}`}>
                        {mode.icon}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold font-mono border ${mode.badgeStyle}`}>
                          {mode.reliabilityImpact.split(' ')[0]}
                        </span>
                        {isSelected && <CheckCircle2 className="w-5 h-5 text-[#1F5F8B] shrink-0" />}
                      </div>
                    </div>
                    <h4 className={`text-sm font-bold mb-1 font-heading ${isSelected ? 'text-[#1F5F8B]' : mode.accentColor}`}>
                      {mode.label}
                    </h4>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-2 font-body">
                      {mode.desc}
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-black/5 flex items-center justify-between text-[11px] font-mono">
                    <span className="text-slate-400 font-medium">Confidence:</span>
                    <span className="font-semibold text-slate-700">{mode.reliabilityImpact}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. DETAILED ANALYSIS (Confidence Table) */}
      <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm overflow-hidden">
        <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/50 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-[var(--primary-navy)]">AI Detection Confidence Adaptation</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-[var(--border-color)]">
                <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider">Camera ID</th>
                <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider">Condition</th>
                <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider text-center">Raw Sensor Score</th>
                <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider text-center">EnviroVision Adapted</th>
                <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider text-right">Verification Rule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)]">
              {cameras.map((cam) => {
                const isHighDegraded = cam.aiReliability < 50;
                return (
                  <tr key={cam.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-[20px] font-semibold text-[var(--primary-navy)]">{cam.name}</td>
                    <td className="p-[20px]">
                      <span className="text-[13px] font-medium text-[var(--text-primary)] capitalize">
                        {environment.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-[20px] text-center text-[var(--text-muted)] line-through font-mono">
                      {Math.round(cam.visibilityScore * 0.7)}%
                    </td>
                    <td className="p-[20px] text-center font-bold">
                      <span className={`px-3 py-1 rounded text-[13px] font-mono ${isHighDegraded ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-[#10B981]/10 text-[#10B981]'}`}>
                        {cam.aiReliability}% {isHighDegraded && '(REDUCED)'}
                      </span>
                    </td>
                    <td className="p-[20px] text-right">
                      {cam.humanVerificationRequired ? (
                        <span className="inline-flex px-3 py-1 bg-[#D92D20]/10 text-[#D92D20] rounded text-xs font-bold uppercase tracking-wider">
                          Human Verification Required
                        </span>
                      ) : (
                        <span className="inline-flex px-3 py-1 bg-[#10B981]/10 text-[#10B981] rounded text-xs font-bold uppercase tracking-wider">
                          Automated Confirmed
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. TECHNICAL DATA (Expandable) */}
      <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm">
        <button 
          onClick={() => setShowTechnical(!showTechnical)}
          className="w-full px-[20px] py-[16px] flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-[var(--primary-navy)] font-semibold">
            <Settings2 className="w-5 h-5 text-[var(--text-muted)]" />
            Advanced Technical Data
          </div>
          {showTechnical ? <ChevronDown className="w-5 h-5 text-[var(--text-muted)]" /> : <ChevronRight className="w-5 h-5 text-[var(--text-muted)]" />}
        </button>
        
        {showTechnical && (
          <div className="p-[20px] border-t border-[var(--border-color)] bg-slate-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-[13px] font-mono text-[var(--text-primary)]">
              <div>
                <h4 className="font-sans font-semibold text-[14px] text-[var(--primary-navy)] mb-3">Optical Degradation Models</h4>
                <div className="space-y-2">
                  <div className="flex justify-between"><span>Atmospheric Scattering:</span> <span>Rayleigh / Mie</span></div>
                  <div className="flex justify-between"><span>Dark Current Noise:</span> <span>Compensated (ISO &gt; 800)</span></div>
                  <div className="flex justify-between"><span>Dehaze Algorithm:</span> <span>Dark Channel Prior (DCP)</span></div>
                  <div className="flex justify-between"><span>IR Cut Filter:</span> <span>{environment === 'night' ? 'Removed' : 'Active'}</span></div>
                </div>
              </div>
              <div>
                <h4 className="font-sans font-semibold text-[14px] text-[var(--primary-navy)] mb-3">AI Penalty Functions</h4>
                <div className="space-y-2">
                  <div className="flex justify-between"><span>Base Confidence:</span> <span>0.95</span></div>
                  <div className="flex justify-between"><span>Contrast Penalty (c):</span> <span>-0.15 (Low Lux)</span></div>
                  <div className="flex justify-between"><span>Occlusion Penalty (o):</span> <span>-0.35 (Particulate)</span></div>
                  <div className="flex justify-between"><span>Final Score Eq:</span> <span>P = Base * (1-c-o)</span></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
