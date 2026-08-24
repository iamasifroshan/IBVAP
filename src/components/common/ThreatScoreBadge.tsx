import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Incident } from '../../types';

interface ThreatScoreBadgeProps {
  score: number;
  incident?: Incident;
  onExplain?: (incident: Incident) => void;
  showExplainBtn?: boolean;
}

export const ThreatScoreBadge: React.FC<ThreatScoreBadgeProps> = ({
  score,
  incident,
  onExplain,
  showExplainBtn = true
}) => {
  let colorClass = 'text-blue-800 bg-blue-100 border-blue-200';
  let label = 'Low';

  if (score >= 80) {
    colorClass = 'text-red-800 bg-red-100 border-red-200 font-bold';
    label = 'Critical';
  } else if (score >= 65) {
    colorClass = 'text-orange-800 bg-orange-100 border-orange-200 font-bold';
    label = 'High';
  } else if (score >= 40) {
    colorClass = 'text-amber-800 bg-amber-100 border-amber-200 font-semibold';
    label = 'Medium';
  }

  return (
    <div className="inline-flex items-center gap-2">
      <div className={`px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${colorClass}`}>
        <span className="text-xs">{score}</span>
        <span className="text-[10px] uppercase tracking-wider opacity-90">/ 100 ({label})</span>
      </div>
      {showExplainBtn && incident && onExplain && (
        <button
          onClick={() => onExplain(incident)}
          title="View Explainable Threat Breakdown"
          className="p-1 rounded text-slate-500 hover:text-[#005EA8] hover:bg-blue-50 transition-colors border border-transparent"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
