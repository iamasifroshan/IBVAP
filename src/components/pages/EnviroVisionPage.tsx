import React, { useState } from 'react';
import { 
  CloudFog, Sun, Moon, ShieldAlert, Settings2, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { EnvironmentCondition } from '../../types';

export const EnviroVisionPage: React.FC = () => {
  const { environment, setEnvironment, cameras } = useApp();
  const [showTechnical, setShowTechnical] = useState(false);

  const envModes: { id: EnvironmentCondition; label: string; desc: string; icon: React.ReactNode; reliabilityImpact: string }[] = [
    { id: 'normal', label: 'Normal Daytime', desc: 'Clear weather conditions; optimal baseline AI precision', icon: <Sun className="w-5 h-5 text-amber-500" />, reliabilityImpact: '95-100% AI Confidence' },
    { id: 'night', label: 'Night Mode', desc: 'Thermal IR active; night vision enhancement enabled', icon: <Moon className="w-5 h-5 text-indigo-500" />, reliabilityImpact: '80-90% AI Confidence' },
    { id: 'low_light', label: 'Low Light Twilight', desc: 'Dusk/Dawn low contrast; auto contrast boost enabled', icon: <Sun className="w-5 h-5 text-yellow-600" />, reliabilityImpact: '75-85% AI Confidence' },
    { id: 'cloudy', label: 'Overcast Daylight', desc: 'Moderate light reduction; standard AI confidence', icon: <CloudFog className="w-5 h-5 text-slate-500" />, reliabilityImpact: '85-92% AI Confidence' },
    { id: 'fog', label: 'Moderate Fog', desc: 'Atmospheric degradation; dehaze AI filters activated', icon: <CloudFog className="w-5 h-5 text-[#1F5F8B]" />, reliabilityImpact: '55-68% AI Confidence' },
    { id: 'severe_fog', label: 'Severe Fog Warning', desc: 'Visibility < 30%; secondary human verification mandatory', icon: <ShieldAlert className="w-5 h-5 text-[#D92D20]" />, reliabilityImpact: '35-45% AI Confidence' },
    { id: 'dust', label: 'Dust / Sandstorm', desc: 'Particulate obstruction; high noise filtering active', icon: <CloudFog className="w-5 h-5 text-amber-600" />, reliabilityImpact: '45-55% AI Confidence' }
  ];

  const degradedCameraCount = cameras.filter(c => c.aiReliability < 60).length;

  return (
    <div className="space-y-[24px] max-w-[1400px]">
      
      {/* 1. PAGE HEADER */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded bg-[#1F5F8B]/10 text-[#1F5F8B]">
            <CloudFog className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-[28px] font-semibold text-[var(--primary-navy)] leading-tight">
              EnviroVision AI
            </h1>
            <p className="text-[15px] text-[var(--text-muted)] mt-1">
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

      {/* 2. CRITICAL PHYSICS LIMIT & UNCERTAINTY WARNING */}
      {(environment === 'fog' || environment === 'severe_fog' || environment === 'dust' || degradedCameraCount > 0) && (
        <div className="bg-red-50 border border-[#D92D20]/30 rounded-lg p-[20px] flex items-start gap-4">
          <AlertTriangle className="w-6 h-6 text-[#D92D20] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-[#D92D20] uppercase tracking-wider">
              Environmental Degradation Detected ({degradedCameraCount} Feeds Affected)
            </h3>
            <p className="text-[15px] text-[#D92D20]/80 mt-1">
              Atmospheric particles reduce physical photon transmission. EnviroVision penalizes AI reliability scores dynamically and enforces secondary human verification.
            </p>
          </div>
        </div>
      )}

      {/* 3. MAIN SUMMARY (Environment Selector) */}
      <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm">
        <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/50">
          <h2 className="text-lg font-semibold text-[var(--primary-navy)]">Operating Environment Simulation Mode</h2>
        </div>
        <div className="p-[20px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[20px]">
            {envModes.map((mode) => {
              const isSelected = environment === mode.id;
              return (
                <div
                  key={mode.id}
                  onClick={() => setEnvironment(mode.id)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all flex flex-col justify-between h-full min-h-[140px] ${
                    isSelected ? 'bg-[#1F5F8B]/5 border-[#1F5F8B] shadow-sm' : 'bg-white border-[var(--border-color)] hover:border-slate-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="p-2 rounded bg-slate-50 border border-slate-100">{mode.icon}</div>
                    {isSelected && <CheckCircle2 className="w-5 h-5 text-[#1F5F8B]" />}
                  </div>
                  <div>
                    <h4 className={`text-sm font-semibold mb-1 ${isSelected ? 'text-[#1F5F8B]' : 'text-[var(--primary-navy)]'}`}>{mode.label}</h4>
                    <p className="text-[13px] text-[var(--text-muted)] line-clamp-2">{mode.desc}</p>
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
