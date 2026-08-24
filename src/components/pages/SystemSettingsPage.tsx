import React, { useState } from 'react';
import { 
  Settings, 
  Save, 
  CheckCircle2
} from 'lucide-react';
import { Card } from '../common/Card';

export const SystemSettingsPage: React.FC = () => {
  const [fastApiEndpoint, setFastApiEndpoint] = useState('http://localhost:8000/api/v1');
  const [edgeModel, setEdgeModel] = useState('YOLOv8-Border-Custom-Quantized');
  const [confidenceThreshold, setConfidenceThreshold] = useState(65);
  const [restrictedStartHour, setRestrictedStartHour] = useState(22);
  const [restrictedEndHour, setRestrictedEndHour] = useState(4);
  const [loiteringThresholdSec, setLoiteringThresholdSec] = useState(15);
  const [storageRetentionDays, setStorageRetentionDays] = useState(30);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6">
      
      {/* Header Banner */}
      <div className="p-5 bg-white border border-slate-200 shadow-sm rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-full bg-blue-50 text-[#005EA8]">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#0B1F33] uppercase tracking-wide">
              IBVAP System Settings & Mission Parameters
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Configure edge AI inference thresholds, restricted night hours, alert triggers, storage policies, and MissionSync rules.
            </p>
          </div>
        </div>
      </div>

      {savedSuccess && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm font-semibold flex items-center gap-3 shadow-sm animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <span>System configuration successfully saved to local EdgeGuard vault.</span>
        </div>
      )}

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* 1. Edge AI Thresholds & Models */}
        <Card title="Edge AI Model & Confidence Thresholds">
          <div className="space-y-5 mt-2">
            <div>
              <label className="text-slate-600 font-semibold block mb-2 text-sm">Deployed Edge Model Architecture:</label>
              <select 
                value={edgeModel} 
                onChange={(e) => setEdgeModel(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
              >
                <option value="YOLOv8-Border-Custom-Quantized">YOLOv8-Border-Custom (FP16 TensorRT Edge)</option>
                <option value="MobileNet-Edge-V2">MobileNet Edge V2 (Low Power 15W Outpost)</option>
                <option value="Edge-TPU-Thermal-V1">Edge TPU Thermal IR Model</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-slate-600 font-semibold text-sm">Detection Confidence Threshold:</span>
                <span className="text-[#005EA8] font-bold text-sm">{confidenceThreshold}%</span>
              </div>
              <input 
                type="range" 
                min="40" 
                max="90" 
                value={confidenceThreshold} 
                onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#005EA8]"
              />
            </div>
          </div>
        </Card>

        {/* 2. Restricted Hours & Alert Rules */}
        <Card title="Restricted Hours & Border Alert Rules">
          <div className="space-y-5 mt-2">
            <div>
              <label className="text-slate-600 font-semibold block mb-2 text-sm">Restricted Night Protocol Hours (UTC):</label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-slate-500 font-medium uppercase tracking-wider block mb-1.5">Start Hour (Dusk)</span>
                  <input 
                    type="number" 
                    value={restrictedStartHour}
                    onChange={(e) => setRestrictedStartHour(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                  />
                </div>
                <div>
                  <span className="text-xs text-slate-500 font-medium uppercase tracking-wider block mb-1.5">End Hour (Dawn)</span>
                  <input 
                    type="number" 
                    value={restrictedEndHour}
                    onChange={(e) => setRestrictedEndHour(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-slate-600 font-semibold text-sm">Loitering Time Trigger:</span>
                <span className="text-orange-600 font-bold text-sm">{loiteringThresholdSec} Seconds</span>
              </div>
              <input 
                type="range" 
                min="5" 
                max="60" 
                value={loiteringThresholdSec} 
                onChange={(e) => setLoiteringThresholdSec(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-500"
              />
            </div>
          </div>
        </Card>

        {/* 3. Storage Retention Policy */}
        <Card title="EdgeGuard Storage Retention Policy">
          <div className="space-y-5 mt-2">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-slate-600 font-semibold text-sm">Local Evidence Retention Window:</span>
                <span className="text-[#005EA8] font-bold text-sm">{storageRetentionDays} Days</span>
              </div>
              <input 
                type="range" 
                min="7" 
                max="90" 
                value={storageRetentionDays} 
                onChange={(e) => setStorageRetentionDays(Number(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#005EA8]"
              />
              <span className="text-xs text-slate-500 mt-2 block font-medium">
                Local evidence snapshots older than {storageRetentionDays} days are automatically pruned from IndexedDB.
              </span>
            </div>
          </div>
        </Card>

        {/* 4. FastAPI Backend Endpoint Configuration */}
        <Card title="FastAPI Computer Vision Backend Connection">
          <div className="space-y-5 mt-2">
            <div>
              <label className="text-slate-600 font-semibold block mb-2 text-sm">Python FastAPI Endpoint URL:</label>
              <input 
                type="text" 
                value={fastApiEndpoint}
                onChange={(e) => setFastApiEndpoint(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-[#0B1F33] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
              />
              <span className="text-xs text-slate-500 mt-2 block font-medium">
                Connects prototype interface to a real Python/FastAPI computer vision backend.
              </span>
            </div>
          </div>
        </Card>

      </div>

      {/* Save Action */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="px-6 py-3 bg-[#005EA8] hover:bg-blue-700 text-white font-bold rounded-md text-sm uppercase tracking-wider flex items-center gap-2 transition-colors shadow-sm"
        >
          <Save className="w-5 h-5" /> Save Mission Parameters
        </button>
      </div>

    </div>
  );
};
