import React, { useState } from 'react';
import { Play, Power, RotateCcw, ShieldAlert, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const LiveDemoController: React.FC = () => {
  const { networkStatus, setNetworkStatus, setActivePage, addIncident, triggerManualSync } = useApp();
  const [loading, setLoading] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const runTest = async (testId: string, action: () => Promise<any>) => {
    setLoading(testId);
    setResultMsg(null);
    try {
      await action();
      setResultMsg(`SUCCESS: ${testId}`);
    } catch (e: any) {
      setResultMsg(`FAIL: ${e.message}`);
    } finally {
      setLoading(null);
      setTimeout(() => setResultMsg(null), 4000);
    }
  };

  const handleOfflineToggle = () => {
    const isOffline = networkStatus === 'offline';
    setNetworkStatus(isOffline ? 'online' : 'offline');
    setResultMsg(`System is now ${isOffline ? 'ONLINE' : 'OFFLINE'}`);
    setTimeout(() => setResultMsg(null), 3000);
  };

  const handleTestIncident = () => {
    runTest('Create Incident', async () => {
      // Simulate real detection triggering an incident
      const inc = {
        sector: 'Sector A',
        cameraName: 'TEST-CAM-01',
        cameraId: 'test-01',
        outpost: 'Lab',
        objectType: 'human' as const,
        threatScore: 92,
        severity: 'critical' as const,
        explainableReason: 'Test boundary breach.',
        zoneName: 'Test Zone',
      };
      // Since it's a test, just add to local context (if offline, goes to queue)
      addIncident(inc);
      setActivePage('incidents');
    });
  };

  const triggerInference = () => {
    runTest('Real Inference', async () => {
      await fetch('http://localhost:8000/api/video/test-inference');
    });
  };

  const baseButtonClass = "inline-flex items-center justify-center gap-[8px] px-[14px] h-[36px] rounded-lg whitespace-nowrap text-[13px] font-semibold transition-colors border shadow-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="bg-white border-b border-slate-200 w-full min-h-[48px] flex flex-wrap md:flex-nowrap items-center gap-[12px] px-[24px] box-border relative z-30 select-none">
      
      <div className="flex items-center min-w-[150px] shrink-0 md:border-r border-slate-200 md:pr-[12px] py-2">
        <span className="font-bold text-[var(--primary-navy)] text-[13px] flex items-center gap-1.5 uppercase tracking-wide">
          <Zap className="w-4 h-4 text-[#F59E0B]" /> Live Actions
        </span>
      </div>
      
      <div className="flex items-center gap-[12px] overflow-x-auto py-2 no-scrollbar flex-1">
        <button 
          onClick={triggerInference}
          disabled={loading !== null}
          className={`${baseButtonClass} bg-[#1F5F8B] hover:bg-[#0F2742] text-white border-transparent`}
        >
          <Play className="w-4 h-4" /> Start Inference
        </button>
        
        <button 
          onClick={handleTestIncident}
          disabled={loading !== null}
          className={`${baseButtonClass} bg-white hover:bg-slate-50 border-slate-300 text-slate-700`}
        >
          <ShieldAlert className="w-4 h-4 text-red-600" /> Create Incident
        </button>

        <button 
          onClick={handleOfflineToggle}
          className={`${baseButtonClass} ${
            networkStatus === 'offline' 
              ? 'bg-amber-500 hover:bg-amber-600 border-amber-600 text-white font-bold' 
              : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
          }`}
        >
          <Power className="w-4 h-4" /> {networkStatus === 'offline' ? 'Restore Online' : 'Go Offline'}
        </button>

        <button 
          onClick={() => { triggerManualSync(); setActivePage('edge-guard'); }}
          disabled={loading !== null}
          className={`${baseButtonClass} bg-white hover:bg-slate-50 border-slate-300 text-slate-700`}
        >
          <RotateCcw className="w-4 h-4 text-[#1F5F8B]" /> Sync Queue
        </button>
      </div>

      {resultMsg && (
        <div className="flex items-center shrink-0 ml-auto py-2">
          <span className={`font-semibold px-3 py-1 rounded text-[12px] shadow-sm whitespace-nowrap ${
            resultMsg.startsWith('FAIL') ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-green-100 text-green-700 border border-green-200'
          }`}>
            {resultMsg}
          </span>
        </div>
      )}
    </div>
  );
};
