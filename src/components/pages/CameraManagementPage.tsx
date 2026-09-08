import React, { useState } from 'react';
import { 
  Camera as CameraIcon, CheckCircle2, RefreshCw, XCircle, Loader2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ibvapApi } from '../../services/apiClient';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';

type SourceType = 'SIMULATED_FILE' | 'WEBCAM' | 'RTSP';

export const CameraManagementPage: React.FC = () => {
  const { cameras, updateCamera } = useApp();
  
  const [sourceConfigCamId, setSourceConfigCamId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>('SIMULATED_FILE');
  const [sourceUrl, setSourceUrl] = useState<string>('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const sourceConfigCam = cameras.find(c => c.id === sourceConfigCamId);

  const openSourceConfig = (camId: string) => {
    const cam = cameras.find(c => c.id === camId);
    if (!cam) return;
    setSourceConfigCamId(camId);
    const prot = cam.protocol;
    setSourceType((prot === 'SIMULATED_FILE' || prot === 'MP4_FILE' as any || !prot) ? 'SIMULATED_FILE' : prot as SourceType);
    setSourceUrl(cam.streamUrl || '');
    setTestResult(null);
  };

  const handleTestSource = async () => {
    if (!sourceConfigCamId) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      // First save/update the camera source in the database, which triggers verification
      const res = await ibvapApi.updateCameraSource(sourceConfigCamId, sourceUrl, sourceType);
      const verify = res.source_verification || {};
      
      const isOnline = res.status?.toUpperCase() === 'ONLINE' || verify.status?.toUpperCase() === 'ONLINE';
      
      setTestResult({
        status: isOnline ? 'online' : 'offline',
        health_score: res.healthScore || res.health_score || 0,
        resolution: verify.resolution || res.resolution,
        fps: res.fps,
        error: verify.error
      });
      
      const statusLower = res.status?.toLowerCase();
      updateCamera(sourceConfigCamId, {
        status: statusLower as any,
        healthScore: res.healthScore || res.health_score,
        protocol: res.protocol === 'MP4_FILE' ? 'SIMULATED_FILE' : res.protocol,
        streamUrl: res.streamUrl,
        fps: res.fps,
        resolution: res.resolution,
        lastActivity: statusLower === 'online' 
          ? `Verified ${res.resolution} @ ${res.fps?.toFixed(0)}fps` 
          : `Offline: ${verify.error?.slice(0, 60) || 'Stream unavailable'}`,
      });
    } catch (err: any) {
      setTestResult({ status: 'error', health_score: 0, error: err?.message || 'Request failed' });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      
      <div className="flex items-center justify-between p-5 bg-white border border-slate-200 shadow-sm rounded-lg">
        <div>
          <h1 className="font-heading text-xl sm:text-2xl lg:text-[28px] font-bold text-[#0B1F33] uppercase tracking-wide flex items-center gap-3">
            <CameraIcon className="w-6 h-6 text-[#005EA8]" /> Camera Management
          </h1>
          <p className="text-[13px] sm:text-[14px] text-slate-500 mt-1 font-body">Configure physical and simulated camera feeds for the backend processing pipeline.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left: Camera List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {cameras.map((cam) => (
              <Card key={cam.id} className="p-4 bg-white border-slate-200 flex flex-col justify-between space-y-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-[#0B1F33]">{cam.name}</div>
                    <div className="text-xs text-slate-500 font-medium mt-0.5">{cam.sector} • {cam.outpost}</div>
                  </div>
                  <Badge variant={cam.status}>{cam.status}</Badge>
                </div>
                
                <div className="text-sm space-y-2">
                  <div className="flex justify-between"><span className="text-slate-500 font-medium">Protocol:</span> <span className="font-bold text-slate-700">{cam.protocol || 'SIMULATED'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-medium">FPS:</span> <span className="text-green-600 font-bold">{cam.fps}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-medium">Health:</span> <span className={`font-bold ${cam.healthScore > 80 ? 'text-green-600' : 'text-amber-600'}`}>{cam.healthScore}/100</span></div>
                </div>

                <div className="pt-3 border-t border-slate-100">
                  <button 
                    onClick={() => openSourceConfig(cam.id)}
                    className="w-full py-2 text-sm font-bold text-[#005EA8] bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
                  >
                    Configure Source
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Right: Source Config Panel */}
        <div className="lg:col-span-1">
          {sourceConfigCamId && sourceConfigCam ? (
            <Card title={`Configure Source: ${sourceConfigCam.name}`} className="sticky top-4">
              <div className="space-y-4 text-sm mt-2">
                
                <div>
                  <label className="block text-slate-600 font-medium mb-1.5">Source Type</label>
                  <select 
                    value={sourceType} 
                    onChange={e => setSourceType(e.target.value as SourceType)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                  >
                    <option value="SIMULATED_FILE">MP4 File / Simulated File</option>
                    <option value="WEBCAM">Webcam (Index 0/1)</option>
                    <option value="RTSP">RTSP Stream URL</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 font-medium mb-1.5">Source URL / Path / Index</label>
                  <input 
                    type="text" 
                    value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                    placeholder="e.g. C:/path/to/video.mp4"
                    className="w-full bg-slate-50 border border-slate-300 rounded-md p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#005EA8]/20 focus:border-[#005EA8]"
                  />
                </div>

                <button 
                  onClick={handleTestSource}
                  disabled={testLoading}
                  className="w-full py-2.5 bg-[#005EA8] hover:bg-blue-700 text-white font-bold rounded-md flex justify-center items-center gap-2 transition-colors disabled:opacity-70 shadow-sm"
                >
                  {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Test Connection on Backend
                </button>

                {testResult && (
                  <div className={`p-4 rounded-md border shadow-sm ${testResult.status === 'online' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    {testResult.status === 'online' ? (
                      <div className="text-green-800">
                        <div className="font-bold flex items-center gap-2 text-green-700"><CheckCircle2 className="w-5 h-5"/> Success</div>
                        <div className="mt-2 font-medium">Resolution: {testResult.resolution}</div>
                        <div className="font-medium">FPS: {testResult.fps?.toFixed(1)}</div>
                      </div>
                    ) : (
                      <div className="text-red-800">
                        <div className="font-bold flex items-center gap-2 text-red-700"><XCircle className="w-5 h-5"/> Failed</div>
                        <div className="mt-2 text-xs break-words font-medium">{testResult.error}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card className="flex flex-col items-center justify-center p-8 text-center text-slate-400 h-[300px] border-dashed border-slate-300 bg-slate-50 shadow-none">
              <CameraIcon className="w-12 h-12 mb-3 text-slate-300" />
              <div className="font-medium">Select a camera to configure its video source.</div>
            </Card>
          )}
        </div>

      </div>
    </div>
  );
};
