import React from 'react';
import { AlertTriangle, CheckCircle2, CloudFog } from 'lucide-react';
import { EnvironmentCondition } from '../../types';

interface ReliabilityMeterProps {
  reliability: number; // 0 - 100
  visibility: number; // 0 - 100
  environment: EnvironmentCondition;
  compact?: boolean;
}

export const ReliabilityMeter: React.FC<ReliabilityMeterProps> = ({
  reliability,
  visibility,
  environment,
  compact = false
}) => {
  let isDegraded = reliability < 60;
  let barColor = 'bg-green-600';
  let textColor = 'text-green-700';

  if (reliability < 50) {
    barColor = 'bg-red-600';
    textColor = 'text-red-700';
  } else if (reliability < 75) {
    barColor = 'bg-amber-500';
    textColor = 'text-amber-700';
  }

  const envLabels: Record<EnvironmentCondition, string> = {
    normal: 'Normal Daytime',
    night: 'Night (Thermal IR)',
    low_light: 'Low Light Twilight',
    cloudy: 'Overcast Daylight',
    fog: 'Moderate Fog',
    severe_fog: 'Severe Fog Warning',
    dust: 'Dust / Sandstorm'
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">AI Reliability:</span>
        <span className={`font-bold ${textColor}`}>{reliability}%</span>
        {isDegraded && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
      </div>
    );
  }

  return (
    <div className="p-4 bg-white border border-slate-200 shadow-sm rounded-lg text-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-600 font-semibold flex items-center gap-2">
          <CloudFog className="w-4 h-4 text-[#005EA8]" />
          EnviroVision AI Reliability
        </span>
        <span className={`font-bold ${textColor} text-base`}>{reliability}%</span>
      </div>

      {/* Progress Gauge */}
      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
        <div 
          className={`h-full transition-all duration-500 ${barColor}`} 
          style={{ width: `${reliability}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
        <span>Visibility: <strong className="text-slate-800">{visibility}%</strong></span>
        <span>Condition: <strong className="text-[#005EA8]">{envLabels[environment]}</strong></span>
      </div>

      {isDegraded && (
        <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-amber-800 text-xs flex items-center gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
          <span>Reduced AI Confidence: Secondary human verification enforced</span>
        </div>
      )}
    </div>
  );
};
