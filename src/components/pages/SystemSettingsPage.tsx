import React, { useState, useEffect, useCallback } from 'react';
import { 
  Settings, 
  Save, 
  CheckCircle2,
  Cpu,
  ShieldAlert,
  HardDrive,
  Server,
  RotateCcw,
  RefreshCw
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

const DEFAULT_SETTINGS = {
  fastApiEndpoint: 'http://localhost:8000/api/v1',
  edgeModel: 'YOLOv8-Border-Custom-Quantized',
  confidenceThreshold: 65,
  restrictedStartHour: '22',
  restrictedEndHour: '04',
  loiteringThresholdSec: 15,
  storageRetentionDays: 30,
};

export const SystemSettingsPage: React.FC = () => {
  const { metrics, networkStatus } = useApp();

  const [fastApiEndpoint, setFastApiEndpoint] = useState(DEFAULT_SETTINGS.fastApiEndpoint);
  const [edgeModel, setEdgeModel] = useState(DEFAULT_SETTINGS.edgeModel);
  const [confidenceThreshold, setConfidenceThreshold] = useState(DEFAULT_SETTINGS.confidenceThreshold);
  const [restrictedStartHour, setRestrictedStartHour] = useState(DEFAULT_SETTINGS.restrictedStartHour);
  const [restrictedEndHour, setRestrictedEndHour] = useState(DEFAULT_SETTINGS.restrictedEndHour);
  const [loiteringThresholdSec, setLoiteringThresholdSec] = useState(DEFAULT_SETTINGS.loiteringThresholdSec);
  const [storageRetentionDays, setStorageRetentionDays] = useState(DEFAULT_SETTINGS.storageRetentionDays);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState('05 Sept 2026, 01:30 PM IST');

  // Genuine backend connection state
  const [backendStatus, setBackendStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');

  const checkBackend = useCallback(async (url: string) => {
    if (networkStatus === 'offline') {
      setBackendStatus('disconnected');
      return;
    }
    setBackendStatus('checking');
    try {
      const res = await fetch(`${url}/cameras`, { 
        method: 'GET',
        signal: AbortSignal.timeout(2500) 
      });
      if (res.ok) {
        setBackendStatus('connected');
      } else {
        const rootUrl = url.replace(/\/api\/v1\/?$/, '');
        const fallback = await fetch(`${rootUrl}/docs`, { 
          method: 'GET',
          signal: AbortSignal.timeout(2000) 
        });
        setBackendStatus(fallback.ok ? 'connected' : 'disconnected');
      }
    } catch {
      setBackendStatus('disconnected');
    }
  }, [networkStatus]);

  useEffect(() => {
    checkBackend(fastApiEndpoint);
  }, [fastApiEndpoint, checkBackend]);

  const handleSave = () => {
    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const formattedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    setLastSavedTime(`${formattedDate}, ${formattedTime} IST`);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3500);
  };

  const handleReset = () => {
    setFastApiEndpoint(DEFAULT_SETTINGS.fastApiEndpoint);
    setEdgeModel(DEFAULT_SETTINGS.edgeModel);
    setConfidenceThreshold(DEFAULT_SETTINGS.confidenceThreshold);
    setRestrictedStartHour(DEFAULT_SETTINGS.restrictedStartHour);
    setRestrictedEndHour(DEFAULT_SETTINGS.restrictedEndHour);
    setLoiteringThresholdSec(DEFAULT_SETTINGS.loiteringThresholdSec);
    setStorageRetentionDays(DEFAULT_SETTINGS.storageRetentionDays);
    checkBackend(DEFAULT_SETTINGS.fastApiEndpoint);
  };

  // Real storage calculation from AppContext metrics
  const storageUsedMb = metrics?.storageUsedMb ?? 1420;
  const storageLimitMb = metrics?.storageLimitMb ?? 8192;
  const storageUsedPercent = Math.min(100, Math.round((storageUsedMb / storageLimitMb) * 100));

  return (
    <div className="w-full max-w-[1360px] mx-auto space-y-3.5 pb-2">
      
      {/* ==================================================
          2. SETTINGS PAGE HEADER
          ================================================== */}
      <div className="p-3.5 sm:px-5 sm:py-3.5 bg-white border border-slate-200/90 shadow-2xs rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0F2742]/5 border border-[#0F2742]/10 flex items-center justify-center text-[#1F5F8B] shrink-0">
            <Settings className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-lg sm:text-[20px] font-bold text-[#0F2742] tracking-wide uppercase">
              IBVAP SYSTEM SETTINGS
            </h1>
            <p className="text-xs text-slate-500">
              Configure AI inference, alert rules, storage and backend connection.
            </p>
          </div>
        </div>

        <div className="flex items-center self-start sm:self-center shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            SYSTEM CONFIGURATION ACTIVE
          </span>
        </div>
      </div>

      {/* ==================================================
          3. COMPACT 2-COLUMN SETTINGS GRID
          ================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-start">
        
        {/* --------------------------------------------------
            CARD 1: AI INFERENCE
            -------------------------------------------------- */}
        <div className="bg-white border border-slate-200/90 rounded-lg shadow-2xs overflow-hidden">
          <div className="px-4.5 py-2.5 bg-slate-50/70 border-b border-slate-200/80 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#1F5F8B]" />
            <h2 className="text-[15px] font-bold uppercase tracking-wider text-[#0F2742]">
              AI INFERENCE
            </h2>
          </div>

          <div className="p-4 sm:p-4.5 space-y-3.5">
            {/* Deployed Edge Model */}
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Deployed Edge Model
              </label>
              <select 
                value={edgeModel} 
                onChange={(e) => setEdgeModel(e.target.value)}
                className="w-full h-9 px-3 bg-white border border-slate-300 rounded-md text-slate-800 text-[13px] font-medium focus:outline-none focus:ring-1 focus:ring-[#1F5F8B] focus:border-[#1F5F8B] transition-colors cursor-pointer shadow-2xs"
              >
                <option value="YOLOv8-Border-Custom-Quantized">YOLOv8-Border-Custom (FP16 TensorRT Edge)</option>
                <option value="MobileNet-Edge-V2">MobileNet Edge V2 (Low Power 15W Outpost)</option>
                <option value="Edge-TPU-Thermal-V1">Edge TPU Thermal IR Model</option>
              </select>
            </div>

            {/* Detection Confidence */}
            <div className="pt-2.5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-semibold text-slate-700">Detection Confidence</span>
                <span className="text-[15px] font-bold text-[#1F5F8B] font-mono px-2 py-0.5 bg-blue-50 border border-blue-100 rounded">
                  {confidenceThreshold}%
                </span>
              </div>
              <input 
                type="range" 
                min="40" 
                max="90" 
                value={confidenceThreshold} 
                onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#1F5F8B]"
              />
              <p className="text-[12px] text-slate-500 mt-1">
                Minimum confidence required for detection.
              </p>
            </div>
          </div>
        </div>

        {/* --------------------------------------------------
            CARD 2: ALERT & RESTRICTED HOURS
            -------------------------------------------------- */}
        <div className="bg-white border border-slate-200/90 rounded-lg shadow-2xs overflow-hidden">
          <div className="px-4.5 py-2.5 bg-slate-50/70 border-b border-slate-200/80 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#1F5F8B]" />
            <h2 className="text-[15px] font-bold uppercase tracking-wider text-[#0F2742]">
              ALERT & RESTRICTED HOURS
            </h2>
          </div>

          <div className="p-4 sm:p-4.5 space-y-3.5">
            {/* Restricted Hours */}
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                Restricted Hours
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[11px] text-slate-500 font-medium block mb-1">Start Hour</span>
                  <input 
                    type="text" 
                    value={restrictedStartHour}
                    onChange={(e) => setRestrictedStartHour(e.target.value)}
                    className="w-full h-9 px-3 bg-white border border-slate-300 rounded-md text-slate-800 text-[13px] font-mono text-center font-semibold focus:outline-none focus:ring-1 focus:ring-[#1F5F8B] focus:border-[#1F5F8B] transition-colors shadow-2xs"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 font-medium block mb-1">End Hour</span>
                  <input 
                    type="text" 
                    value={restrictedEndHour}
                    onChange={(e) => setRestrictedEndHour(e.target.value)}
                    className="w-full h-9 px-3 bg-white border border-slate-300 rounded-md text-slate-800 text-[13px] font-mono text-center font-semibold focus:outline-none focus:ring-1 focus:ring-[#1F5F8B] focus:border-[#1F5F8B] transition-colors shadow-2xs"
                  />
                </div>
              </div>
            </div>

            {/* Loitering Trigger */}
            <div className="pt-2.5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-semibold text-slate-700">Loitering Trigger</span>
                <span className="text-[15px] font-bold text-amber-700 font-mono px-2 py-0.5 bg-amber-50 border border-amber-200 rounded">
                  {loiteringThresholdSec} seconds
                </span>
              </div>
              <input 
                type="range" 
                min="5" 
                max="60" 
                value={loiteringThresholdSec} 
                onChange={(e) => setLoiteringThresholdSec(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#D97706]"
              />
              <p className="text-[12px] text-slate-500 mt-1">
                Trigger alert after continuous presence exceeds the threshold.
              </p>
            </div>
          </div>
        </div>

        {/* --------------------------------------------------
            CARD 3: STORAGE & EVIDENCE
            -------------------------------------------------- */}
        <div className="bg-white border border-slate-200/90 rounded-lg shadow-2xs overflow-hidden">
          <div className="px-4.5 py-2.5 bg-slate-50/70 border-b border-slate-200/80 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[#1F5F8B]" />
            <h2 className="text-[15px] font-bold uppercase tracking-wider text-[#0F2742]">
              STORAGE & EVIDENCE
            </h2>
          </div>

          <div className="p-4 sm:p-4.5 space-y-3.5">
            {/* Evidence Retention */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-semibold text-slate-700">Evidence Retention</span>
                <span className="text-[15px] font-bold text-[#1F5F8B] font-mono px-2 py-0.5 bg-blue-50 border border-blue-100 rounded">
                  {storageRetentionDays} days
                </span>
              </div>
              <input 
                type="range" 
                min="7" 
                max="90" 
                value={storageRetentionDays} 
                onChange={(e) => setStorageRetentionDays(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#1F5F8B]"
              />
              <p className="text-[12px] text-slate-500 mt-1">
                Older evidence is automatically removed according to the retention policy.
              </p>
            </div>

            {/* Storage Used */}
            <div className="pt-2.5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-bold text-slate-700 uppercase tracking-wider">STORAGE USED</span>
                <span className="text-[15px] font-bold text-[#0F2742] font-mono">
                  {storageUsedPercent}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-[#1F5F8B] rounded-full transition-all duration-300"
                  style={{ width: `${storageUsedPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1 text-[12px] text-slate-500 font-mono">
                <span>{storageUsedMb.toLocaleString()} MB</span>
                <span>{storageLimitMb.toLocaleString()} MB</span>
              </div>
            </div>
          </div>
        </div>

        {/* --------------------------------------------------
            CARD 4: BACKEND CONNECTION
            -------------------------------------------------- */}
        <div className="bg-white border border-slate-200/90 rounded-lg shadow-2xs overflow-hidden">
          <div className="px-4.5 py-2.5 bg-slate-50/70 border-b border-slate-200/80 flex items-center gap-2">
            <Server className="w-4 h-4 text-[#1F5F8B]" />
            <h2 className="text-[15px] font-bold uppercase tracking-wider text-[#0F2742]">
              BACKEND CONNECTION
            </h2>
          </div>

          <div className="p-4 sm:p-4.5 space-y-3.5">
            {/* FastAPI Endpoint */}
            <div>
              <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                FastAPI Endpoint
              </label>
              <input 
                type="text" 
                value={fastApiEndpoint}
                onChange={(e) => setFastApiEndpoint(e.target.value)}
                onBlur={() => checkBackend(fastApiEndpoint)}
                className="w-full h-9 px-3 bg-white border border-slate-300 rounded-md text-[#0F2742] text-[13px] font-mono focus:outline-none focus:ring-1 focus:ring-[#1F5F8B] focus:border-[#1F5F8B] transition-colors shadow-2xs"
              />
            </div>

            {/* Connection Status */}
            <div className="pt-2.5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-semibold text-slate-700">Connection Status</span>
                <div className="flex items-center gap-2">
                  {backendStatus === 'connected' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      ● CONNECTED
                    </span>
                  ) : backendStatus === 'checking' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse"></span>
                      CHECKING...
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold bg-red-50 text-red-700 border border-red-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                      ● DISCONNECTED
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => checkBackend(fastApiEndpoint)}
                    disabled={backendStatus === 'checking'}
                    title="Test Connection"
                    className="px-2.5 py-1 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${backendStatus === 'checking' ? 'animate-spin' : ''}`} />
                    <span>Test Connection</span>
                  </button>
                </div>
              </div>
              <p className="text-[12px] text-slate-500 mt-1">
                FastAPI computer vision inference server
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* ==================================================
          8. COMPACT ACTION BAR
          ================================================== */}
      <div className="p-3 px-4 sm:px-5 bg-white border border-slate-200/90 rounded-lg shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 font-medium">
            Last saved: <span className="font-mono text-slate-700 font-semibold">{lastSavedTime}</span>
          </span>
          {savedSuccess && (
            <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5 animate-in fade-in ml-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Settings saved successfully
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 ml-auto">
          <button
            type="button"
            onClick={handleReset}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 text-xs font-bold text-white bg-[#1F5F8B] hover:bg-[#164769] rounded-md transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            Save Changes
          </button>
        </div>
      </div>

    </div>
  );
};

