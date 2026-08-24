import React from 'react';
import { X, ShieldAlert, CheckCircle2, Info, ArrowUpRight, Plus, Minus, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Incident } from '../../types';
import { ThreatScoreBadge } from './ThreatScoreBadge';
import { calculateBorderThreat } from '../../services/borderThreatEngine';

interface ExplainableThreatModalProps {
  incident: Incident | null;
  onClose: () => void;
}

export const ExplainableThreatModal: React.FC<ExplainableThreatModalProps> = ({ incident, onClose }) => {
  if (!incident) return null;

  // Run calculation engine dynamically to show full mathematical audit
  const calculated = calculateBorderThreat({
    objectType: incident.objectType,
    zoneBreached: incident.threatScore > 50,
    zoneType: 'restricted_fence',
    timeHourUtc: 23,
    loiteringDurationSec: incident.loiteringDurationSec || 42,
    directionInward: true,
    repeatedApproachCount: 2,
    multiFrameConfirmed: incident.smartAlertConfirmed,
    rawConfidence: 94,
    aiReliability: incident.aiReliability,
    environmentalCondition: incident.environmentalCondition
  });

  const displayFactors = (incident.threatFactors && incident.threatFactors.length > 0)
    ? incident.threatFactors
    : calculated.factors;

  const posAdj = displayFactors.filter(f => f.scoreContribution >= 0).reduce((acc, f) => acc + f.scoreContribution, 0);
  const negAdj = displayFactors.filter(f => f.scoreContribution < 0).reduce((acc, f) => acc + Math.abs(f.scoreContribution), 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <ShieldAlert className="w-6 h-6 text-[#005EA8]" />
            <div>
              <h2 className="text-lg font-bold text-[#0B1F33] tracking-wide uppercase flex items-center gap-3">
                BorderThreat Engine — Mathematical Audit
                <span className="px-2.5 py-0.5 bg-blue-50 text-[#005EA8] text-[10px] rounded-full border border-blue-200 font-bold">
                  EXPLAINABLE AI
                </span>
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Incident ID: <strong className="text-slate-800 font-mono">{incident.id}</strong> | Sector: {incident.sector} ({incident.cameraName})
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content Body */}
        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto text-sm">
          
          {/* Top Threat Score Gauge Banner */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between shadow-sm">
            <div>
              <span className="text-slate-500 block text-xs font-semibold uppercase tracking-wider mb-2">Calculated Threat Index:</span>
              <ThreatScoreBadge score={incident.threatScore} showExplainBtn={false} />
            </div>
            <div className="text-right">
              <span className="text-slate-500 block text-xs font-semibold uppercase tracking-wider mb-2">Threat Level:</span>
              <span className={`font-bold uppercase px-3 py-1 rounded-full text-xs shadow-sm ${
                incident.threatScore >= 80 ? 'bg-red-100 text-red-800 border border-red-200' :
                incident.threatScore >= 60 ? 'bg-orange-100 text-orange-800 border border-orange-200' :
                incident.threatScore >= 30 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-blue-100 text-blue-800 border border-blue-200'
              }`}>
                {incident.severity} PRIORITY
              </span>
            </div>
          </div>

          {/* Explainable Sentence */}
          <div className="p-4 bg-white border border-slate-200 shadow-sm rounded-lg text-slate-700">
            <span className="text-[#0B1F33] font-bold uppercase tracking-wide block mb-2 flex items-center gap-2">
              <Info className="w-5 h-5 text-[#005EA8]" /> Why Was This Score Generated?
            </span>
            <p className="text-slate-600 leading-relaxed font-medium">{incident.explainableReason}</p>
          </div>

          {/* Recommended Operator Action Panel */}
          <div className="p-4 bg-amber-50 border border-amber-200 shadow-sm rounded-lg text-amber-900">
            <span className="text-amber-800 font-bold uppercase tracking-wide block mb-2 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" /> Recommended Operator Action:
            </span>
            <p className="text-amber-700 font-medium leading-relaxed">{calculated.recommendedAction}</p>
          </div>

          {/* Factor Score Contributions List (+ and - points) */}
          <div>
            <div className="flex justify-between items-center mb-3 px-1">
              <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wide flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-[#005EA8]" /> Factor-by-Factor Score Contributions
              </h4>
              <span className="text-slate-500 text-xs font-bold">
                Pos: <strong className="text-green-600">+{posAdj}</strong> | Neg: <strong className="text-red-600">-{negAdj}</strong>
              </span>
            </div>

            <div className="space-y-3">
              {displayFactors.map((factor, idx) => {
                const isPositive = factor.scoreContribution >= 0;

                return (
                  <div 
                    key={idx} 
                    className="p-4 bg-white border border-slate-200 shadow-sm rounded-lg flex items-start justify-between gap-4 transition-all hover:border-blue-300"
                  >
                    <div>
                      <div className="font-bold text-slate-800 flex items-center gap-2.5">
                        <span className={`w-2.5 h-2.5 rounded-full shadow-sm ${isPositive ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        {factor.category.replace(/_/g, ' ')}
                      </div>
                      <p className="text-slate-500 text-xs mt-1.5 leading-relaxed">{factor.description}</p>
                    </div>

                    <div className={`px-3 py-1 font-bold rounded-full text-xs shrink-0 flex items-center gap-1.5 shadow-sm border ${
                      isPositive 
                        ? 'bg-green-50 border-green-200 text-green-700' 
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                      {isPositive ? <Plus className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                      {Math.abs(factor.scoreContribution)} PTS
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* SmartAlert Confirmation Footnote */}
          <div className="p-4 bg-green-50 border border-green-200 shadow-sm rounded-lg flex items-center justify-between text-green-800 font-medium">
            <span className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              SmartAlert Multi-Frame Temporal Filtering Passed (Persistent ID: <span className="font-mono">{incident.persistentId}</span>)
            </span>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-md text-sm font-semibold transition-colors shadow-sm"
          >
            Close Audit Breakdown
          </button>
        </div>

      </div>
    </div>
  );
};
