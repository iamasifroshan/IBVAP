import React, { useState } from 'react';
import {
  Play,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { PageId, EnvironmentCondition, NetworkStatus } from '../../types';

interface DemoStep {
  stepNumber: number;
  title: string;
  subtitle: string;
  targetPage: PageId;
  environment: EnvironmentCondition;
  networkStatus: NetworkStatus;
  activeCameraId: string;
  innovationTag: 'EdgeGuard' | 'EnviroVision' | 'BorderThreat' | 'SmartAlert' | 'SentinelQuery';
  explanationText: string;
}

const DEMO_STEPS: DemoStep[] = [
  {
    stepNumber: 1,
    title: 'Step 1: Border Command Overview',
    subtitle: 'Existing CCTV infrastructure converted to local AI intelligence.',
    targetPage: 'command-overview',
    environment: 'normal',
    networkStatus: 'online',
    activeCameraId: 'BORDER-CAM-07',
    innovationTag: 'EdgeGuard',
    explanationText: 'IBVAP turns legacy CCTV streams into edge AI intelligence without needing internet connectivity.'
  },
  {
    stepNumber: 2,
    title: 'Step 2: Live CCTV Feed & Target Detection',
    subtitle: 'AI detects human target on BORDER-CAM-07 feed.',
    targetPage: 'live-surveillance',
    environment: 'normal',
    networkStatus: 'online',
    activeCameraId: 'BORDER-CAM-07',
    innovationTag: 'SmartAlert',
    explanationText: 'CCTV feed processes target bounding boxes and persistent tracking IDs locally.'
  },
  {
    stepNumber: 3,
    title: 'Step 3: EnviroVision Atmospheric Adaptation',
    subtitle: 'Dense Fog detected. Visibility drops to 38%. AI reliability adapts.',
    targetPage: 'enviro-vision',
    environment: 'fog',
    networkStatus: 'online',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'EnviroVision',
    explanationText: 'EnviroVision evaluates visibility before trusting AI outputs. When fog hits, human verification is recommended.'
  },
  {
    stepNumber: 4,
    title: 'Step 4: Virtual Restricted Fence Breach',
    subtitle: 'Tracked target crosses Sector B Zero-Tolerance boundary.',
    targetPage: 'virtual-fence',
    environment: 'fog',
    networkStatus: 'online',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'BorderThreat',
    explanationText: 'Virtual boundary algorithms detect unauthorized zone entry and calculate loitering duration.'
  },
  {
    stepNumber: 5,
    title: 'Step 5: SmartAlert Multi-Frame Confirmation',
    subtitle: 'Filter engine validates 120 contiguous frames to eliminate false alerts.',
    targetPage: 'incidents',
    environment: 'fog',
    networkStatus: 'online',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'SmartAlert',
    explanationText: 'SmartAlert suppresses single-frame glitches and animal movements, reducing false alarms by 84.6%.'
  },
  {
    stepNumber: 6,
    title: 'Step 6: BorderThreat Mathematical Audit',
    subtitle: 'Calculates explainable score (89/100 CRITICAL PRIORITY).',
    targetPage: 'incidents',
    environment: 'fog',
    networkStatus: 'online',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'BorderThreat',
    explanationText: 'Score audit explains exact points: +40 Zone Breach, +20 Night Vector, +15 Loitering, -7 Fog Penalty.'
  },
  {
    stepNumber: 7,
    title: 'Step 7: Real-Time Alert & Evidence Capture',
    subtitle: 'Generates evidence snapshot with SHA-256 cryptographic hash.',
    targetPage: 'incidents',
    environment: 'fog',
    networkStatus: 'online',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'EdgeGuard',
    explanationText: 'Evidence snapshot captured and signed with SHA-256 hash checksum in local database.'
  },
  {
    stepNumber: 8,
    title: 'Step 8: Simulate Complete Border Network Failure',
    subtitle: 'Communication link cut. Network state switches to OFFLINE (EDGE).',
    targetPage: 'edge-guard',
    environment: 'fog',
    networkStatus: 'offline',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'EdgeGuard',
    explanationText: 'Network severed! IBVAP enters strict offline-first edge processing mode.'
  },
  {
    stepNumber: 9,
    title: 'Step 9: EdgeGuard Local Autonomous Operation',
    subtitle: 'AI detection, threat scoring, and alerts continue 100% locally.',
    targetPage: 'edge-guard',
    environment: 'fog',
    networkStatus: 'offline',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'EdgeGuard',
    explanationText: 'No camera frame loss! Local AI inference engine continues at 30 FPS at the border outpost.'
  },
  {
    stepNumber: 10,
    title: 'Step 10: Local Evidence Storage (UNSYNCED)',
    subtitle: 'New threat incident saved to EdgeGuard IndexedDB vault as UNSYNCED.',
    targetPage: 'edge-guard',
    environment: 'fog',
    networkStatus: 'offline',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'EdgeGuard',
    explanationText: 'Incidents queued in local vault without requiring cloud bandwidth.'
  },
  {
    stepNumber: 11,
    title: 'Step 11: Network Link Re-established',
    subtitle: 'Satellite / cellular internet connection restored.',
    targetPage: 'edge-guard',
    environment: 'fog',
    networkStatus: 'online',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'EdgeGuard',
    explanationText: 'Network restored! MissionSync automatically detects backhaul connection.'
  },
  {
    stepNumber: 12,
    title: 'Step 12: MissionSync Auto-Synchronization',
    subtitle: 'Prioritized sync pipeline: UNSYNCED → QUEUED → SYNCING → SYNCED.',
    targetPage: 'edge-guard',
    environment: 'fog',
    networkStatus: 'syncing',
    activeCameraId: 'SECTOR-B-CAM-03',
    innovationTag: 'EdgeGuard',
    explanationText: 'MissionSync transmits critical incident metadata and snapshots first, saving satellite bandwidth.'
  },
  {
    stepNumber: 13,
    title: 'Step 13: SentinelQuery AI Natural Language Search',
    subtitle: 'Officer searches: "Show high-risk human intrusions in Sector B last night."',
    targetPage: 'sentinel-query',
    environment: 'normal',
    networkStatus: 'online',
    activeCameraId: 'BORDER-CAM-07',
    innovationTag: 'SentinelQuery',
    explanationText: 'Natural language search query executed by border security officer.'
  },
  {
    stepNumber: 14,
    title: 'Step 14: Intent Parsing & Search Filters Matrix',
    subtitle: 'Extracts: Human target, Sector B, Score >= 60, Restricted night hours.',
    targetPage: 'sentinel-query',
    environment: 'normal',
    networkStatus: 'online',
    activeCameraId: 'BORDER-CAM-07',
    innovationTag: 'SentinelQuery',
    explanationText: 'Safe non-hallucinated parsing converts plain text into validated JSON query filters.'
  },
  {
    stepNumber: 15,
    title: 'Step 15: Exact Matching Stored Evidence Records',
    subtitle: 'Displays actual evidence records INC-2026-0891 and INC-2026-0890.',
    targetPage: 'sentinel-query',
    environment: 'normal',
    networkStatus: 'online',
    activeCameraId: 'BORDER-CAM-07',
    innovationTag: 'SentinelQuery',
    explanationText: 'Real evidence snapshots retrieved directly from the EdgeGuard vault!'
  }
];

const TAG_COLORS: Record<DemoStep['innovationTag'], string> = {
  EdgeGuard:     'bg-emerald-900/60 text-emerald-400 border-emerald-800/50',
  EnviroVision:  'bg-amber-900/50   text-amber-400   border-amber-800/50',
  BorderThreat:  'bg-red-900/50     text-red-400     border-red-800/50',
  SmartAlert:    'bg-indigo-900/50  text-indigo-400  border-indigo-800/50',
  SentinelQuery: 'bg-cyan-900/50    text-cyan-400    border-cyan-800/50',
};

export const SihDemoController: React.FC = () => {
  const {
    setActivePage,
    setEnvironment,
    setNetworkStatus,
    setActiveCameraId,
    incidents,
    setSelectedIncident,
    setExplainableIncident,
    triggerManualSync
  } = useApp();

  // Start collapsed — takes minimal space by default
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isDemoActive, setIsDemoActive] = useState(false);

  const currentStep = DEMO_STEPS[currentStepIndex];

  const applyStepState = (index: number) => {
    const step = DEMO_STEPS[index];
    setCurrentStepIndex(index);
    setActivePage(step.targetPage);
    setEnvironment(step.environment);
    setNetworkStatus(step.networkStatus);
    setActiveCameraId(step.activeCameraId);

    if (step.stepNumber === 6) {
      const inc = incidents.find(i => i.id === 'INC-2026-0891');
      if (inc) setExplainableIncident(inc);
    } else if (step.stepNumber === 7) {
      const inc = incidents.find(i => i.id === 'INC-2026-0891');
      if (inc) setSelectedIncident(inc);
    } else if (step.stepNumber === 12) {
      triggerManualSync();
    }
  };

  const handleNext = () => {
    if (currentStepIndex < DEMO_STEPS.length - 1) applyStepState(currentStepIndex + 1);
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) applyStepState(currentStepIndex - 1);
  };

  const handleLaunch = (stepIdx: number) => {
    setIsDemoActive(true);
    applyStepState(stepIdx);
  };

  // ── COLLAPSED — single compact line ──────────────────────────
  if (!isExpanded) {
    return (
      <div className="bg-[#060810] border-b border-slate-800/60 px-4 py-1.5 flex items-center justify-between font-mono text-xs">
        <div className="flex items-center gap-2 text-slate-600">
          <Sparkles className="w-3 h-3 text-slate-700" />
          <span className="text-[10px] uppercase tracking-wider">SIH Demo Mode</span>
          {isDemoActive && (
            <span className="text-[10px] text-slate-500">
              — Step {currentStep.stepNumber}/{DEMO_STEPS.length}: {currentStep.title}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-300 transition-colors px-2 py-0.5 rounded border border-slate-800 hover:border-slate-700"
        >
          <Play className="w-2.5 h-2.5" />
          {isDemoActive ? 'Controls' : 'Launch Demo'}
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // ── EXPANDED: PRESET SELECTOR (not yet in step flow) ─────────
  if (!isDemoActive) {
    return (
      <div className="bg-[#080C14] border-b border-slate-800 font-mono text-xs">
        <div className="px-4 py-2 flex items-center justify-between border-b border-slate-800/60">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">SIH Hackathon Demo — 15-Step Judge Presentation</span>
          </div>
          <button
            onClick={() => setIsExpanded(false)}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Collapse <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[10px] text-slate-600 uppercase tracking-wider mr-1">Quick Scenarios:</span>
          <button
            onClick={() => handleLaunch(0)}
            className="px-2.5 py-1 bg-slate-800/60 hover:bg-slate-700/60 text-slate-200 rounded border border-slate-700 text-[11px] font-bold transition-colors"
          >
            Normal Overview
          </button>
          <button
            onClick={() => handleLaunch(2)}
            className="px-2.5 py-1 bg-amber-900/30 hover:bg-amber-900/50 text-amber-300 rounded border border-amber-800/40 text-[11px] font-bold transition-colors"
          >
            Fog / EnviroVision
          </button>
          <button
            onClick={() => handleLaunch(5)}
            className="px-2.5 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-300 rounded border border-red-800/40 text-[11px] font-bold transition-colors"
          >
            BorderThreat Audit
          </button>
          <button
            onClick={() => handleLaunch(7)}
            className="px-2.5 py-1 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-300 rounded border border-emerald-800/40 text-[11px] font-bold transition-colors"
          >
            Offline EdgeGuard
          </button>
          <button
            onClick={() => handleLaunch(12)}
            className="px-3 py-1 bg-cyan-900/40 hover:bg-cyan-900/60 text-cyan-300 rounded border border-cyan-800/50 text-[11px] font-bold flex items-center gap-1.5 transition-colors"
          >
            <Play className="w-3 h-3 fill-cyan-300" /> Full 15-Step Judge Flow
          </button>
        </div>
      </div>
    );
  }

  // ── EXPANDED: ACTIVE STEP NAVIGATION ─────────────────────────
  return (
    <div className="bg-[#080C14] border-b-2 border-slate-700/60 px-4 py-2.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 font-mono text-xs">

      {/* Step info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-200 font-extrabold text-sm shrink-0">
          {currentStep.stepNumber}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-extrabold text-slate-100 text-[11px] uppercase tracking-wide">
              {currentStep.title}
            </h4>
            <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border uppercase ${TAG_COLORS[currentStep.innovationTag]}`}>
              {currentStep.innovationTag}
            </span>
          </div>
          <p className="text-slate-400 text-[10px] font-sans truncate mt-0.5">
            {currentStep.explanationText}
          </p>
        </div>
      </div>

      {/* Navigation controls */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={handlePrev}
          disabled={currentStepIndex === 0}
          className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-30 text-slate-300 rounded border border-slate-700 flex items-center gap-1 transition-colors text-[11px]"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Prev
        </button>

        <span className="text-slate-600 text-[11px] font-bold px-1 tabular-nums">
          {currentStepIndex + 1} / {DEMO_STEPS.length}
        </span>

        <button
          onClick={handleNext}
          disabled={currentStepIndex === DEMO_STEPS.length - 1}
          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-slate-100 font-extrabold rounded flex items-center gap-1 transition-colors text-[11px]"
        >
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => { setIsDemoActive(false); setIsExpanded(false); }}
          className="p-1.5 text-slate-600 hover:text-slate-400 hover:bg-slate-800 rounded transition-colors ml-1"
          title="Exit Demo"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setIsExpanded(false)}
          className="p-1.5 text-slate-600 hover:text-slate-400 hover:bg-slate-800 rounded transition-colors"
          title="Minimize"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
