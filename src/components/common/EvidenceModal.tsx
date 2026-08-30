import React from 'react';
import {
  X,
  Eye,
  CheckCircle2,
  ShieldX,
  Clock,
  MapPin,
  Radio,
  FileText,
  Lock,
  Layers,
  Sparkles,
  UserCheck,
  Zap,
  Activity,
  Check,
  AlertTriangle,
  Camera,
  Shield,
  Crosshair,
  Target
} from 'lucide-react';
import { Incident } from '../../types';
import { Badge } from './Badge';
import { useApp } from '../../context/AppContext';
import { evaluateSmartAlert } from '../../services/smartAlertEngine';
import { API_BASE_URL } from '../../services/apiConfig';

interface EvidenceModalProps {
  incident: Incident | null;
  onClose: () => void;
}

// ── Centralized Timestamp Formatter (IST) ─────────────────────────────────
const formatTimestamp = (raw: string | Date | undefined | null): string => {
  if (!raw) return '—';
  try {
    const date = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(date.getTime())) return String(raw);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
      timeZoneName: 'short'
    }).format(date);
  } catch {
    return String(raw);
  }
};

const formatTimestampShort = (raw: string | Date | undefined | null): string => {
  if (!raw) return '—';
  try {
    const date = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(date.getTime())) return String(raw);
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).format(date);
  } catch {
    return String(raw);
  }
};

export const EvidenceModal: React.FC<EvidenceModalProps> = ({ incident, onClose }) => {
  const { updateIncidentStatus, setExplainableIncident } = useApp();

  if (!incident) return null;

  // Run SmartAlert decision trace for this incident
  const smartAlertDecision = evaluateSmartAlert({
    rawConfidence: 94,
    framesConfirmed: 120,
    hasPersistentTrack: true,
    zoneBreached: incident.threatScore > 50,
    objectType: incident.objectType,
    loiteringSec: incident.loiteringDurationSec || 42,
    environmentalCondition: incident.environmentalCondition,
    aiReliability: incident.aiReliability
  });

  // Map validation checks from backend if available, otherwise fallback to local evaluation
  let displayDecisionLabel = smartAlertDecision.decisionLabel;
  let displayTraceSteps = smartAlertDecision.traceSteps;

  if (incident.validationChecks && incident.validationChecks.decision) {
    const vc = incident.validationChecks;
    displayDecisionLabel = vc.decision === 'CONFIRMED_INCIDENT' ? 'CONFIRMED HIGH ALERT' : 'FILTERED NOISE';

    displayTraceSteps = [];
    const ruleKeys = [
      { key: 'rule1_confidence_threshold', name: '1. Confidence Threshold' },
      { key: 'rule2_same_track_id', name: '2. Same Track ID Check' },
      { key: 'rule3_multiframe_persistence', name: '3. Multi-frame Persistence' },
      { key: 'rule4_virtual_fence_relevance', name: '4. Virtual Fence Relevance' },
      { key: 'rule5_duplicate_suppression', name: '5. Duplicate Suppression' }
    ];

    ruleKeys.forEach(r => {
      if (vc[r.key]) {
        displayTraceSteps.push({
          stepName: r.name,
          passed: vc[r.key].passed,
          details: `${vc[r.key].actual} (${vc[r.key].status})`
        });
      }
    });
  }

  // Derive threat label and color
  const threatScore = incident.threatScore;
  const threatLabel = threatScore >= 80 ? 'CRITICAL' : threatScore >= 65 ? 'HIGH' : threatScore >= 40 ? 'MEDIUM' : 'LOW';
  const threatColor = threatScore >= 80 ? '#D92D20' : threatScore >= 65 ? '#E04F16' : threatScore >= 40 ? '#D97706' : '#2563EB';

  // Parse timestamps
  const capturedTs = incident.timestamp;
  const capturedDate = capturedTs ? new Date(capturedTs) : new Date();
  const detectionStartDate = new Date(capturedDate.getTime() - 42_000); // ~42s before capture
  const alertGeneratedDate = new Date(capturedDate.getTime() + 2_000);
  const lastUpdatedDate = new Date(capturedDate.getTime() + 4_000);

  // Determine person count from explainable reason
  const personCountMatch = incident.explainableReason?.match(/(\d+)\s*persons?/i);
  const personCount = personCountMatch ? parseInt(personCountMatch[1], 10) : 1;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className="bg-[#F8FAFC] border border-slate-200 rounded-xl w-full max-w-[1120px] overflow-hidden shadow-2xl flex flex-col max-h-[94vh]"
        style={{ animation: 'fadeInScale 0.2s ease-out' }}
      >

        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div className="px-[24px] py-[20px] bg-white border-b border-slate-200 flex items-start justify-between gap-6">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-11 h-11 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center shrink-0 mt-0.5">
              <Eye className="w-5 h-5 text-[#1D4ED8]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-[22px] font-bold text-[#0B1F33] tracking-tight leading-tight">Evidence Record</h2>
                <Badge variant={incident.severity}>{incident.severity}</Badge>
              </div>
              <p className="text-[13px] text-slate-400 font-mono mt-1 truncate">
                ID: {incident.id}
              </p>
              <div className="flex items-center gap-2 mt-2 text-[14px] text-slate-600 font-medium">
                <Camera className="w-4 h-4 text-slate-400 shrink-0" />
                <span>Captured by <span className="font-bold text-[#0B1F33] font-mono">{incident.cameraName}</span></span>
                <span className="text-slate-300">•</span>
                <span>{incident.outpost}</span>
                <span className="text-slate-300">•</span>
                <span>{incident.sector}</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-5 shrink-0">
            <div className="text-right hidden sm:block">
              <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider block">Captured</span>
              <span className="text-[13px] text-slate-700 font-semibold mt-0.5 block">{formatTimestamp(capturedTs)}</span>
              <div className="mt-2">
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border uppercase tracking-wider ${
                  incident.syncedToCloud
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  {incident.syncedToCloud ? '● CLOUD SYNCED' : '● SAVED LOCALLY'}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors border border-transparent hover:border-slate-200"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── MAIN CONTENT ───────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1">
          <div className="p-[24px] flex flex-col lg:flex-row gap-[20px]">

            {/* ── LEFT COLUMN (58–62%) ──────────────────────────────── */}
            <div className="lg:w-[60%] flex flex-col gap-[20px]">

              {/* ── A. Evidence Snapshot Card ───────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                <div className="px-[16px] py-[12px] border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="w-3.5 h-3.5 text-[#D92D20] animate-pulse" />
                    <span className="text-[12px] font-bold text-[#0B1F33] uppercase tracking-wider">Evidence Snapshot</span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-slate-400 font-mono">
                    <span>Frame #00142</span>
                    <span>Captured: {formatTimestamp(capturedTs)}</span>
                  </div>
                </div>

                {/* Image Container */}
                <div className="relative bg-[#0A0F1A]">
                  <img
                    src={incident.snapshotUrl
                      ? (incident.snapshotUrl.startsWith('/') ? `${API_BASE_URL.replace('/api/v1', '').replace(/\/$/, '')}${incident.snapshotUrl}` : incident.snapshotUrl)
                      : 'https://images.unsplash.com/photo-1509114397022-ed747cca3f65?q=80&w=800&auto=format&fit=crop'
                    }
                    alt="Incident Evidence Snapshot"
                    className="w-full object-contain"
                    style={{ maxHeight: '420px', minHeight: '280px' }}
                  />

                  {/* AI Bounding Box Overlay */}
                  <div className="absolute top-[20%] left-[26%] w-[130px] h-[175px] border-2 border-red-500 bg-red-500/5 rounded-sm pointer-events-none flex flex-col justify-between p-1">
                    <span className="bg-red-600 text-white text-[9px] font-mono px-1.5 py-0.5 font-bold self-start rounded-sm shadow uppercase leading-tight">
                      HUMAN #{incident.persistentId}
                    </span>
                    <span className="bg-black/80 text-white text-[9px] font-mono px-1.5 py-0.5 self-end rounded-sm leading-tight">
                      CONF: {incident.aiReliability}%
                    </span>
                  </div>

                  {/* Second person bounding box (if multiple) */}
                  {personCount >= 2 && (
                    <div className="absolute top-[18%] right-[18%] w-[110px] h-[160px] border-2 border-red-500 bg-red-500/5 rounded-sm pointer-events-none flex flex-col justify-between p-1">
                      <span className="bg-red-600 text-white text-[9px] font-mono px-1.5 py-0.5 font-bold self-start rounded-sm shadow uppercase leading-tight">
                        PERSON #02
                      </span>
                      <span className="bg-black/80 text-white text-[9px] font-mono px-1.5 py-0.5 self-end rounded-sm leading-tight">
                        CONF: 91%
                      </span>
                    </div>
                  )}

                  {/* Cyan restricted zone fence */}
                  <div
                    className="absolute inset-x-[8%] top-[10%] bottom-[6%] pointer-events-none rounded-sm"
                    style={{
                      border: '1.5px dashed rgba(0, 210, 210, 0.5)',
                      background: 'rgba(0, 200, 200, 0.03)',
                    }}
                  />
                </div>

                {/* Bottom metadata bar */}
                <div className="px-[16px] py-[10px] border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500 bg-slate-50/80">
                  <div className="flex items-center gap-5">
                    <span>Frame: <b className="text-slate-700">#00142</b></span>
                    <span>Camera: <b className="text-slate-700">{incident.cameraName}</b></span>
                  </div>
                  <div className="flex items-center gap-5">
                    <span>Detection: <b className="text-[#D92D20]">{personCount} Person{personCount !== 1 ? 's' : ''}</b></span>
                    <span>Time: <b className="text-slate-700">{formatTimestampShort(capturedTs)}</b></span>
                  </div>
                </div>
              </div>

              {/* ── B. SmartAlert Decision Trace ────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-[16px] py-[14px] border-b border-slate-100 flex items-center justify-between">
                  <span className="font-bold text-[14px] text-[#0B1F33] flex items-center gap-2 uppercase tracking-wide">
                    <Sparkles className="w-4 h-4 text-[#1D4ED8]" /> SmartAlert Decision Trace
                  </span>
                  <span className={`text-[11px] font-bold px-3 py-1.5 rounded-full border ${
                    displayDecisionLabel.includes('CONFIRMED')
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {displayDecisionLabel}
                  </span>
                </div>

                <div className="p-[16px] space-y-0">
                  {displayTraceSteps.map((step, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 py-[12px] ${
                        idx < displayTraceSteps.length - 1 ? 'border-b border-slate-100' : ''
                      }`}
                    >
                      {/* Step number + timeline dot */}
                      <div className="flex items-center gap-2.5 shrink-0 w-[180px] min-w-[180px]">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                          step.passed ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'
                        }`}>
                          {step.passed
                            ? <Check className="w-3 h-3" />
                            : <X className="w-3 h-3" />
                          }
                        </div>
                        <span className="text-[13px] font-semibold text-[#0B1F33] leading-tight">{step.stepName}</span>
                      </div>
                      {/* Details */}
                      <span className={`text-[12px] leading-tight pt-0.5 ${
                        step.passed ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'
                      }`}>
                        {step.details}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── RIGHT COLUMN (38–42%) ─────────────────────────────── */}
            <div className="lg:w-[40%] flex flex-col gap-[20px]">

              {/* ── A. Threat Assessment ────────────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-[20px]">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-3">Threat Assessment</span>
                <div className="flex items-end gap-4">
                  <div>
                    <span className="text-[36px] font-extrabold leading-none" style={{ color: threatColor }}>{threatScore}</span>
                    <span className="text-[16px] text-slate-400 font-semibold ml-1">/ 100</span>
                  </div>
                  <span
                    className="text-[13px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full mb-1"
                    style={{
                      color: threatColor,
                      backgroundColor: `${threatColor}12`,
                      border: `1px solid ${threatColor}30`
                    }}
                  >
                    {threatLabel}
                  </span>
                </div>
              </div>

              {/* ── B. Tracking Details ─────────────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-[20px]">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-4">Tracking Details</span>
                <div className="space-y-[14px]">
                  {[
                    { label: 'Track ID', value: `#${incident.persistentId}`, mono: true },
                    { label: 'Camera', value: incident.cameraName, mono: true },
                    { label: 'Sector', value: incident.sector },
                    { label: 'Restricted Zone', value: incident.zoneName },
                    { label: 'Detected Objects', value: `${personCount} Person${personCount !== 1 ? 's' : ''}`, highlight: personCount >= 2 },
                    { label: 'Detection Type', value: personCount >= 2 ? 'Multiple Human Detection' : 'Single Human Detection' },
                  ].map((row, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-[13px] text-slate-400 font-medium">{row.label}</span>
                      <span className={`text-[14px] font-semibold text-right ${
                        row.highlight ? 'text-[#D92D20] font-bold' : 'text-[#0B1F33]'
                      } ${row.mono ? 'font-mono' : ''}`}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── C. Event Timeline ───────────────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-[20px]">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-4">Event Timeline</span>
                <div className="space-y-[16px]">
                  {[
                    { label: 'Detection Started', ts: detectionStartDate },
                    { label: 'Evidence Captured', ts: capturedDate },
                    { label: 'Alert Generated', ts: alertGeneratedDate },
                    { label: 'Last Updated', ts: lastUpdatedDate },
                  ].map((row, i) => (
                    <div key={i} className="flex flex-col">
                      <span className="text-[12px] text-slate-400 font-medium">{row.label}</span>
                      <span className="text-[13px] text-[#0B1F33] font-semibold mt-0.5 font-mono">{formatTimestamp(row.ts)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── D. Analysis Metrics ─────────────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-[20px]">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-4">Analysis Metrics</span>
                <div className="space-y-[14px]">
                  {[
                    { label: 'Loitering Time', value: `${incident.loiteringDurationSec || 42} Seconds`, color: '#D97706' },
                    { label: 'Trajectory Vector', value: incident.direction },
                    { label: 'Estimated Speed', value: `${incident.speedKmh || 4.2} km/h` },
                    { label: 'Environment', value: incident.environmentalCondition.replace('_', ' ').toUpperCase(), bold: true },
                    { label: 'Visibility Score', value: `${incident.visibilityScore}%` },
                    { label: 'AI Reliability', value: `${incident.aiReliability}%`, color: incident.aiReliability >= 60 ? '#059669' : '#D97706' },
                  ].map((row, i) => (
                    <div key={i} className="flex justify-between items-center">
                      <span className="text-[13px] text-slate-400 font-medium">{row.label}</span>
                      <span
                        className={`text-[14px] font-semibold ${row.bold ? 'font-bold' : ''}`}
                        style={{ color: row.color || '#0B1F33' }}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── E. Explainable Context ──────────────────────────── */}
              <div className="bg-[#F0F7FF] border border-[#BFDBFE] rounded-lg p-[16px]">
                <span className="text-[11px] text-[#1D4ED8] font-bold uppercase tracking-wider flex items-center gap-2 mb-2">
                  <FileText className="w-3.5 h-3.5" /> Explainable Context
                </span>
                <p className="text-[13px] text-slate-700 leading-relaxed">
                  {incident.explainableReason || 'No contextual explanation available.'}
                </p>
              </div>

              {/* ── F. Operational Actions ──────────────────────────── */}
              <div className="pt-[4px]">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block mb-3">Operator Actions</span>
                <div className="grid grid-cols-2 gap-[10px]">
                  <button
                    onClick={() => {
                      updateIncidentStatus(incident.id, 'investigating');
                      onClose();
                    }}
                    className="px-4 py-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm text-[13px] font-semibold"
                  >
                    <Activity className="w-4 h-4" /> Investigating
                  </button>

                  <button
                    onClick={() => {
                      updateIncidentStatus(incident.id, 'verified');
                      onClose();
                    }}
                    className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm text-[13px] font-semibold"
                  >
                    <AlertTriangle className="w-4 h-4" /> Verify Threat
                  </button>

                  <button
                    onClick={() => {
                      updateIncidentStatus(incident.id, 'false_alarm');
                      onClose();
                    }}
                    className="col-span-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm text-[13px] font-semibold"
                  >
                    <ShieldX className="w-4 h-4" /> Mark False Alarm
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
