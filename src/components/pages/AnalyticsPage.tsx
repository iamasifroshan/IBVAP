import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  Check,
  X,
  Activity,
  ShieldCheck
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { evaluateSmartAlert } from '../../services/smartAlertEngine';
import { ibvapApi } from '../../services/apiClient';

export const AnalyticsPage: React.FC = () => {
  const { metrics } = useApp();
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const res = await ibvapApi.getAnalyticsSummary();
        setSummary(res);
      } catch (err) {
        console.warn("Failed to fetch analytics summary, serving default metrics.");
      }
    };
    loadSummary();
    const timer = setInterval(loadSummary, 4000);
    return () => clearInterval(timer);
  }, []);

  const [activeTraceTab, setActiveTraceTab] = useState<'CONFIRMED' | 'FILTERED'>('CONFIRMED');

  const confirmedDecision = evaluateSmartAlert({
    rawConfidence: 88,
    framesConfirmed: 45,
    hasPersistentTrack: true,
    zoneBreached: true,
    objectType: 'human',
    loiteringSec: 42,
    environmentalCondition: 'fog',
    aiReliability: 68
  });

  const filteredDecision = evaluateSmartAlert({
    rawConfidence: 58,
    framesConfirmed: 1,
    hasPersistentTrack: false,
    zoneBreached: false,
    objectType: 'animal',
    loiteringSec: 0,
    environmentalCondition: 'dust',
    aiReliability: 48
  });

  const activeDecision = activeTraceTab === 'CONFIRMED' ? confirmedDecision : filteredDecision;

  return (
    <div className="space-y-[24px] max-w-[1400px]">
      
      {/* 1. PAGE HEADER */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded bg-[#10B981]/10 text-[#10B981]">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-[28px] font-semibold text-[var(--primary-navy)] leading-tight">
              SmartAlert Analytics
            </h1>
            <p className="text-[15px] text-[var(--text-muted)] mt-1">
              False Alarm Reduction & Decision Traces. Prevents control room fatigue by filtering transient noise.
            </p>
          </div>
        </div>
        
        <div className="px-4 py-2 rounded-full border border-[#10B981]/30 bg-[#10B981]/10 text-[#10B981] text-sm font-bold flex items-center gap-2 tracking-wide">
          <Activity className="w-4 h-4"/> 
          {summary?.falseAlarmReductionRate !== undefined ? `${summary.falseAlarmReductionRate}%` : '84.6%'} REDUCTION RATE
        </div>
      </div>

      {/* 2. METRICS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[20px]">
        
        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm">
          <span className="text-[13px] text-[var(--text-muted)] font-semibold uppercase tracking-wider">Raw Camera Detections</span>
          <div className="text-[28px] font-bold text-[var(--primary-navy)] mt-2">{summary?.totalCandidateDetections ?? 8120}</div>
          <div className="text-[13px] text-[var(--text-muted)] mt-1">Total candidate bounding boxes</div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm">
          <span className="text-[13px] text-[var(--text-muted)] font-semibold uppercase tracking-wider">Filtered Noise & False Alarms</span>
          <div className="text-[28px] font-bold text-[#10B981] mt-2">{summary?.filteredNoiseCount ?? 6870}</div>
          <div className="text-[13px] text-[#10B981]/80 mt-1 font-medium">Suppressed by SmartAlert</div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm">
          <span className="text-[13px] text-[var(--text-muted)] font-semibold uppercase tracking-wider">Escalated Valid Threat Alerts</span>
          <div className="text-[28px] font-bold text-[#D92D20] mt-2">{summary?.totalIncidents ?? 1250}</div>
          <div className="text-[13px] text-[var(--text-muted)] mt-1">Verified security incidents</div>
        </div>

        <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm">
          <span className="text-[13px] text-[var(--text-muted)] font-semibold uppercase tracking-wider">Suppression Efficiency</span>
          <div className="text-[28px] font-bold text-[#1F5F8B] mt-2">
            {summary?.falseAlarmReductionRate !== undefined ? `${summary.falseAlarmReductionRate}%` : '84.6%'}
          </div>
          <div className="text-[13px] text-[var(--text-muted)] mt-1">Control room fatigue reduction</div>
        </div>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[24px]">
        {/* 3. VISIBLE 8-STEP DECISION TRACE MATRIX */}
        <div className="lg:col-span-2 bg-white border border-[var(--border-color)] rounded-lg shadow-sm">
          <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-[var(--primary-navy)]">Decision Trace Matrix</h2>
            <div className="flex bg-slate-100 p-1 rounded">
              <button
                onClick={() => setActiveTraceTab('CONFIRMED')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                  activeTraceTab === 'CONFIRMED' ? 'bg-white text-[#D92D20] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Confirmed Incident
              </button>
              <button
                onClick={() => setActiveTraceTab('FILTERED')}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                  activeTraceTab === 'FILTERED' ? 'bg-white text-[#10B981] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Filtered Noise
              </button>
            </div>
          </div>

          <div className="p-[20px] space-y-6">
            <div className={`p-4 rounded-lg border flex items-center justify-between ${
              activeDecision.isConfirmedAlert 
                ? 'bg-[#D92D20]/5 border-[#D92D20]/20 text-[#D92D20]' 
                : 'bg-[#10B981]/5 border-[#10B981]/20 text-[#10B981]'
            }`}>
              <div>
                <span className="font-bold text-[14px] uppercase tracking-wider block mb-1">
                  DECISION: {activeDecision.decisionLabel}
                </span>
                <span className="text-[13px] font-medium opacity-90 block">
                  {activeDecision.reductionReason}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-bold uppercase tracking-wider block mb-1 opacity-80">SMARTALERT PASS SCORE</span>
                <strong className="text-2xl font-bold">{activeDecision.overallEfficiencyScore}%</strong>
              </div>
            </div>

            <div className="space-y-3">
              {activeDecision.traceSteps.map((step, idx) => (
                <div key={idx} className="p-3 bg-white border border-[var(--border-color)] rounded flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded ${step.passed ? 'bg-[#10B981]/10 text-[#10B981]' : 'bg-[#D92D20]/10 text-[#D92D20]'}`}>
                      {step.passed ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-semibold text-[var(--primary-navy)] text-[14px]">{step.stepName}</h4>
                      <p className="text-[var(--text-muted)] text-[13px] mt-0.5">{step.details}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-wider uppercase border ${
                    step.passed ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20' : 'bg-[#D92D20]/10 text-[#D92D20] border-[#D92D20]/20'
                  }`}>
                    {step.passed ? 'PASSED' : 'FAILED'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 4. MAIN FILTERING REASONS BREAKDOWN */}
        <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm">
          <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/50">
            <h2 className="text-lg font-semibold text-[var(--primary-navy)]">Filtering Reasons</h2>
            <p className="text-[13px] text-[var(--text-muted)] mt-1">6,870 Suppressed Events</p>
          </div>
          
          <div className="p-[20px] space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">1-Frame Unstable Ghosts</span>
                <span className="text-[#10B981] font-bold text-[13px]">41.3%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-[#10B981] h-full w-[41.3%]"></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">Dust & Particle Noise</span>
                <span className="text-[#F59E0B] font-bold text-[13px]">25.0%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-[#F59E0B] h-full w-[25%]"></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">Tree Shadows & Lights</span>
                <span className="text-[#1F5F8B] font-bold text-[13px]">16.7%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-[#1F5F8B] h-full w-[16.7%]"></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">Wildlife Movement</span>
                <span className="text-[#10B981] font-bold text-[13px]">11.8%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-[#10B981] h-full w-[11.8%]"></div>
              </div>
            </div>
            
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">Outside Virtual Fence</span>
                <span className="text-[#1F5F8B] font-bold text-[13px]">5.2%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className="bg-[#1F5F8B] h-full w-[5.2%]"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
