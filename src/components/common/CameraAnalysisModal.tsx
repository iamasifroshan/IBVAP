import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Square, ShieldAlert, X, Crosshair, Shield, Zap, Clock, Loader2, AlertCircle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Camera } from '../../types';
import { ibvapApi, YoloDetectResult } from '../../services/apiClient';
import { API_BASE_URL } from '../../services/apiConfig';

interface CameraAnalysisModalProps {
  camera: Camera;
  videoUrl: string;
  onClose: () => void;
}

type StageState = 'idle' | 'processing' | 'complete' | 'alert' | 'error';
interface PipelineStage { id: string; label: string; sublabel: string; state: StageState; }

interface TimelineEvent {
  type: 'detection' | 'zone_entry' | 'alert';
  timeStr: string;
  timestampSec: number;
  trackId: number | null;
  description: string;
  confidence?: number;
  zoneName?: string;
  threatScore?: number;
}

interface ZonePolygon {
  name: string;
  points: { x: number; y: number }[];
}

export const CameraAnalysisModal: React.FC<CameraAnalysisModalProps> = ({ camera, videoUrl, onClose }) => {
  const { addIncident } = useApp();

  const [status, setStatus] = useState<'READY' | 'ANALYZING' | 'HUMAN DETECTED' | 'NO HUMANS DETECTED' | 'ERROR'>('READY');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [incidentFiled, setIncidentFiled] = useState(false);
  const [humansDetected, setHumansDetected] = useState(0);
  const [maxConfidence, setMaxConfidence] = useState<number | null>(null);
  const [framesAnalyzed, setFramesAnalyzed] = useState(0);
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('00:00');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [zonePolygon, setZonePolygon] = useState<ZonePolygon | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([
    { id: 'detection',    label: 'DETECTION',    sublabel: 'YOLOv8 Classify',  state: 'idle' },
    { id: 'tracking',     label: 'TRACKING',     sublabel: 'Persistent ID',     state: 'idle' },
    { id: 'zone',         label: 'ZONE CHECK',   sublabel: 'Virtual Fence',     state: 'idle' },
    { id: 'smartalert',   label: 'SMARTALERT',   sublabel: 'Temporal Filter',   state: 'idle' },
    { id: 'borderthreat', label: 'BORDERTHREAT', sublabel: 'Explainable Score', state: 'idle' },
    { id: 'evidence',     label: 'EVIDENCE',     sublabel: 'Local Storage',     state: 'idle' },
  ]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const detectionsByFrame = useRef<Map<number, any[]>>(new Map());
  const analysisResult = useRef<YoloDetectResult | null>(null);
  const videoFps = useRef<number>(30);
  const statusRef = useRef<string>('READY');

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const setStageState = (id: string, state: StageState) =>
    setStages(prev => prev.map(s => s.id === id ? { ...s, state } : s));

  // Fetch zone polygon on mount
  useEffect(() => {
    const cameraId = (camera as any).camera_id || camera.id;
    const host = API_BASE_URL.replace('/api/v1', '').replace(/\/$/, '');
    fetch(`${host}/api/v1/zones`)
      .then(r => r.json())
      .then((zones: any[]) => {
        const zone = zones.find((z: any) =>
          z.camera_id === cameraId || z.camera_id === camera.id
        ) || zones[0];
        if (zone?.polygon_coordinates?.length >= 3) {
          const raw = zone.polygon_coordinates as { x: number; y: number }[];
          const maxCoord = Math.max(...raw.map(p => Math.max(p.x, p.y)));
          const scale = maxCoord > 1.0 ? 100.0 : 1.0;
          setZonePolygon({
            name: zone.name || 'Restricted Zone',
            points: raw.map(p => ({ x: p.x / scale, y: p.y / scale })),
          });
        }
      })
      .catch(() => {});
  }, [camera]);

  // Keep statusRef in sync so drawOverlay callback always reads fresh value
  useEffect(() => { statusRef.current = status; }, [status]);

  const drawOverlay = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth || 640;
      canvas.height = video.clientHeight || 360;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Draw zone polygon
    if (zonePolygon && zonePolygon.points.length >= 3) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(zonePolygon.points[0].x * W, zonePolygon.points[0].y * H);
      zonePolygon.points.slice(1).forEach(p => ctx.lineTo(p.x * W, p.y * H));
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,200,200,0.06)';
      ctx.fill();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = 'rgba(0,220,220,0.75)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      const corners = ['P1','P2','P3','P4'];
      zonePolygon.points.forEach((p, i) => {
        if (i >= 4) return;
        ctx.fillStyle = 'rgba(0,200,200,0.9)';
        ctx.beginPath(); ctx.arc(p.x*W, p.y*H, 4, 0, Math.PI*2); ctx.fill();
        ctx.font = 'bold 10px monospace';
        ctx.fillStyle = 'rgba(0,220,220,0.9)';
        ctx.fillText(corners[i], p.x*W+6, p.y*H-4);
      });
      const cx = zonePolygon.points.reduce((s,p)=>s+p.x,0)/zonePolygon.points.length*W;
      const ty = Math.min(...zonePolygon.points.map(p=>p.y))*H - 10;
      ctx.font = 'bold 10px monospace';
      const zLabel = zonePolygon.name.toUpperCase();
      const lw = ctx.measureText(zLabel).width;
      ctx.fillStyle = 'rgba(0,180,180,0.85)';
      ctx.fillRect(cx-lw/2-6, ty-14, lw+12, 16);
      ctx.fillStyle = '#000';
      ctx.fillText(zLabel, cx-lw/2, ty-2);
      ctx.restore();
    }

    // Draw detections
    if (statusRef.current !== 'HUMAN DETECTED' || detectionsByFrame.current.size === 0) return;

    const currentFrame = Math.round(video.currentTime * videoFps.current);
    const stride = analysisResult.current?.frame_stride_used || 2;
    let bestKey: number | null = null;
    let bestDiff = Infinity;
    for (const key of detectionsByFrame.current.keys()) {
      const diff = Math.abs(key - currentFrame);
      if (diff < bestDiff && diff <= stride * 5) { bestDiff = diff; bestKey = key; }
    }
    const frameDets = bestKey !== null ? detectionsByFrame.current.get(bestKey) : null;
    if (!frameDets || frameDets.length === 0) return;

    frameDets.forEach((det: any) => {
      const bb = det.bounding_box;
      if (!bb) return;
      const bx = bb.x * W;
      const by = bb.y * H;
      const bw = bb.width * W;
      const bh = bb.height * H;
      if (bw < 2 || bh < 2) return;
      const tid = det.track_id;
      const confPct = Math.round((det.confidence || 0) * 100);
      const label = tid != null ? `HUMAN #TRACK-${String(tid).padStart(4,'0')}` : 'HUMAN (UNTRACKED)';
      const subLabel = `CONF: ${confPct}%`;

      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(220,30,30,0.7)';
      ctx.strokeStyle = '#E53E3E';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur = 0;

      // Corner ticks
      const tick = Math.min(12, bw*0.15, bh*0.1);
      ctx.strokeStyle = '#FC8181';
      ctx.lineWidth = 2;
      const ticks = [
        [bx,by,bx+tick,by,bx,by+tick],
        [bx+bw-tick,by,bx+bw,by,bx+bw,by+tick],
        [bx,by+bh-tick,bx,by+bh,bx+tick,by+bh],
        [bx+bw-tick,by+bh,bx+bw,by+bh,bx+bw,by+bh-tick],
      ];
      ticks.forEach(([x1,y1,x2,y2,x3,y3]) => {
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.moveTo(x2,y2); ctx.lineTo(x3,y3); ctx.stroke();
      });

      ctx.font = 'bold 11px monospace';
      const lw1 = ctx.measureText(label).width;
      const lw2 = ctx.measureText(subLabel).width;
      const blockW = Math.max(lw1, lw2) + 12;
      const blockH = 32;
      const lx = Math.max(0, Math.min(bx, W - blockW));
      const ly = Math.max(0, by - blockH - 2);
      ctx.fillStyle = 'rgba(197,30,30,0.92)';
      ctx.fillRect(lx, ly, blockW, blockH);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(label, lx+6, ly+12);
      ctx.fillStyle = 'rgba(255,200,200,0.95)';
      ctx.font = '9px monospace';
      ctx.fillText(subLabel, lx+6, ly+25);
      ctx.restore();
    });
  }, [zonePolygon]);

  // Animation loop
  useEffect(() => {
    const loop = () => {
      const video = videoRef.current;
      if (video) {
        setCurrentTimeStr(formatTime(video.currentTime));
        setProgressPct((video.currentTime / (video.duration || 1)) * 100);
      }
      drawOverlay();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawOverlay]);

  const buildTimeline = (data: YoloDetectResult): TimelineEvent[] => {
    const events: TimelineEvent[] = [];
    (data.tracks || []).forEach(t => {
      events.push({
        type: 'detection',
        timeStr: formatTime(t.video_ts_first_sec || 0),
        timestampSec: t.video_ts_first_sec || 0,
        trackId: t.track_id,
        description: `Human detected — ${t.fine_class}`,
        confidence: t.confidence_max,
      });
    });
    (data.incidents_created || []).forEach((inc: any) => {
      if (inc.event_type === 'zone_entry' || inc.event_type === 'zone_breach') {
        events.push({
          type: 'zone_entry', timeStr: '??:??', timestampSec: 0,
          trackId: parseInt(inc.track_id) || null,
          description: `Zone entry — Track #${inc.track_id}`,
          zoneName: inc.zone_name, threatScore: inc.threat_score,
        });
      }
      if ((inc.threat_score || 0) >= 70) {
        events.push({
          type: 'alert', timeStr: '??:??', timestampSec: 0,
          trackId: parseInt(inc.track_id) || null,
          description: `SMARTALERT — Threat ${inc.threat_score}/100`,
          threatScore: inc.threat_score,
        });
      }
    });
    return events.sort((a, b) => a.timestampSec - b.timestampSec);
  };

  const startAnalysis = async () => {
    setErrorMessage('');
    setIncidentFiled(false);
    setStatus('ANALYZING');
    statusRef.current = 'ANALYZING';
    setTimeline([]);
    setFramesAnalyzed(0);
    setElapsedSec(null);
    detectionsByFrame.current = new Map();
    analysisResult.current = null;
    setStages(prev => prev.map(s => ({ ...s, state: 'processing' })));

    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }

    try {
      const detectId = (camera as any).camera_id || camera.id;
      console.log(`[IBVAP] → POST /detect camera='${detectId}'`);

      const data = await ibvapApi.runYoloDetection(detectId, {
        confThreshold: 0.35,
        frameStride: 2,
        maxFrames: 200,
      });

      console.log(`[IBVAP] ← detect: detections=${data.total_detections} tracks=${data.tracks?.length} elapsed=${data.elapsed_sec}s`);
      analysisResult.current = data;

      // Group detections by frame_index for O(1) render lookup
      const grouped = new Map<number, any[]>();
      (data.detections || []).forEach((det: any) => {
        const fi = det.frame_index ?? 0;
        if (!grouped.has(fi)) grouped.set(fi, []);
        grouped.get(fi)!.push(det);
      });
      detectionsByFrame.current = grouped;

      const humanDets = (data.detections || []).filter((d: any) => d.object_type === 'human');
      const maxConf = humanDets.length > 0 ? Math.max(...humanDets.map((d: any) => d.confidence || 0)) : null;
      const humanTracks = (data.tracks || []).filter((t: any) => t.object_type === 'human');

      setHumansDetected(humanTracks.length);
      setMaxConfidence(maxConf);
      setFramesAnalyzed(data.frames_analyzed || 0);
      setElapsedSec(data.elapsed_sec || null);
      videoFps.current = (camera as any).fps || 30;
      setTimeline(buildTimeline(data));

      const hasZone = (data.incidents_created_count || 0) > 0;
      const hasHighThreat = (data.incidents_created || []).some((i: any) => (i.threat_score||0) >= 70);

      setStageState('detection', 'complete');
      setStageState('tracking', 'complete');
      setStageState('zone', hasZone ? 'alert' : 'complete');
      setStageState('smartalert', hasHighThreat ? 'alert' : 'complete');
      setStageState('borderthreat', hasHighThreat ? 'alert' : 'complete');
      setStageState('evidence', 'complete');

      if (humanDets.length > 0) {
        setStatus('HUMAN DETECTED');
        statusRef.current = 'HUMAN DETECTED';
        (data.incidents_created || []).forEach((inc: any) => {
          addIncident({
            id: inc.incident_id || inc.id || `INC-${Date.now()}`,
            timestamp: inc.timestamp || new Date().toISOString().slice(0,19).replace('T',' '),
            sector: camera.sector, cameraName: camera.name,
            cameraId: (camera as any).camera_id || camera.id,
            outpost: camera.outpost, objectType: 'human',
            persistentId: `TRACK-${inc.track_id}`,
            threatScore: inc.threat_score || 75,
            severity: inc.threat_level || 'high',
            explainableReason: inc.explainable_reason || 'Human crossing virtual fence.',
            environmentalCondition: 'normal', aiReliability: camera.aiReliability || 92,
            visibilityScore: camera.visibilityScore || 85, status: 'active',
            snapshotUrl: '', zoneName: inc.zone_name || camera.activeZone,
            loiteringDurationSec: 0, speedKmh: 4.2, direction: 'Inward Perimeter',
            smartAlertConfirmed: true, syncedToCloud: false,
            threatFactors: [{ category: 'PERIMETER_BREACH', scoreContribution: 50, description: `Track #${inc.track_id} crossed ${inc.zone_name}` }],
          });
        });
      } else {
        setStatus('NO HUMANS DETECTED');
        statusRef.current = 'NO HUMANS DETECTED';
        setStages(prev => prev.map(s => ({ ...s, state: 'complete' })));
      }
    } catch (err: any) {
      console.error('[IBVAP] Analysis failed:', err);
      const detail = err?.apiDetail || err?.message || 'Analysis service unavailable. Ensure backend is running on port 8000.';
      setErrorMessage(detail);
      setStatus('ERROR');
      statusRef.current = 'ERROR';
      setStages(prev => prev.map(s => ({ ...s, state: 'error' })));
    }
  };

  const stopAnalysis = () => {
    setStatus('READY');
    statusRef.current = 'READY';
    detectionsByFrame.current = new Map();
    analysisResult.current = null;
    setHumansDetected(0);
    setMaxConfidence(null);
    setTimeline([]);
    setStages(prev => prev.map(s => ({ ...s, state: 'idle' })));
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
  };

  const handleFileIncident = () => {
    if (incidentFiled) return;
    setIncidentFiled(true);
    addIncident({
      id: `INC-${new Date().getFullYear()}-${Math.floor(1000+Math.random()*9000)}`,
      timestamp: new Date().toISOString().slice(0,19).replace('T',' '),
      sector: camera.sector, cameraName: camera.name,
      cameraId: (camera as any).camera_id || camera.id,
      outpost: camera.outpost, objectType: 'human',
      persistentId: `MANUAL-${Date.now()}`,
      threatScore: 85, severity: 'high',
      explainableReason: `${humansDetected} human(s) manually verified at ${currentTimeStr}.`,
      environmentalCondition: 'normal', aiReliability: camera.aiReliability||92,
      visibilityScore: camera.visibilityScore||85, status: 'active',
      snapshotUrl: '', zoneName: camera.activeZone,
      loiteringDurationSec: 0, speedKmh: 0, direction: 'Unknown',
      smartAlertConfirmed: false, syncedToCloud: false,
      threatFactors: [{ category: 'Manual Operator Verification', scoreContribution: 95, description: 'Human verified by operator' }],
    });
  };

  const seekVideo = (sec: number) => {
    if (videoRef.current && sec > 0) videoRef.current.currentTime = sec;
  };

  const stageColors: Record<StageState, { bg: string; border: string; text: string; dot: string }> = {
    idle:       { bg: 'bg-slate-50',    border: 'border-slate-200',   text: 'text-slate-400',   dot: 'bg-slate-300'   },
    processing: { bg: 'bg-blue-50',     border: 'border-blue-200',    text: 'text-[#1F5F8B]',   dot: 'bg-[#1F5F8B]'  },
    complete:   { bg: 'bg-emerald-50',  border: 'border-emerald-200', text: 'text-emerald-600', dot: 'bg-emerald-500' },
    alert:      { bg: 'bg-red-50',      border: 'border-red-200',     text: 'text-[#D92D20]',   dot: 'bg-[#D92D20]'  },
    error:      { bg: 'bg-orange-50',   border: 'border-orange-200',  text: 'text-orange-600',  dot: 'bg-orange-500'  },
  };
  const stageLabelMap: Record<StageState, string> = {
    idle:'IDLE', processing:'PROCESSING', complete:'COMPLETE', alert:'ALERT', error:'ERROR'
  };
  const timelineColorMap: Record<string, string> = {
    detection:  'text-[#1F5F8B] bg-blue-50  border-blue-200',
    zone_entry: 'text-amber-700 bg-amber-50 border-amber-200',
    alert:      'text-[#D92D20] bg-red-50   border-red-200',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3">
      <div className={`bg-white w-full max-w-[1300px] rounded-xl shadow-2xl flex flex-col border-2 overflow-hidden transition-colors duration-300 ${
        status === 'HUMAN DETECTED' ? 'border-[#D92D20]' :
        status === 'ERROR' ? 'border-orange-300' : 'border-[#1F5F8B]/30'
      }`} style={{ maxHeight: '95vh' }}>

        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-4">
            <Crosshair className="w-5 h-5 text-[#60A5FA]" />
            <span className="text-sm font-bold tracking-widest uppercase">
              CAMERA ANALYSIS — {(camera as any).camera_id || camera.id}
            </span>
            <span className="text-[10px] font-mono text-slate-400 hidden md:block">{camera.sector} · {camera.outpost}</span>
            {status === 'ANALYZING' && (
              <span className="px-2 py-0.5 bg-[#1F5F8B] text-white rounded text-[10px] font-bold animate-pulse flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> PROCESSING
              </span>
            )}
            {status === 'HUMAN DETECTED' && (
              <span className="px-2 py-0.5 bg-[#D92D20] text-white rounded text-[10px] font-bold animate-pulse">
                ● HUMANS DETECTED
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pipeline stages */}
        <div className="px-4 py-2 border-b border-slate-700 bg-slate-800 flex items-center gap-1.5 overflow-x-auto shrink-0">
          {stages.map((stage, i) => {
            const c = stageColors[stage.state];
            return (
              <React.Fragment key={stage.id}>
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shrink-0 ${c.bg} ${c.border}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot} ${stage.state === 'processing' ? 'animate-pulse' : ''}`} />
                  <div>
                    <div className={`text-[9px] font-bold ${c.text}`}>{stage.label}</div>
                    <div className="text-[8px] text-slate-400">{stage.sublabel}</div>
                    <div className={`text-[8px] font-semibold ${c.text}`}>{stageLabelMap[stage.state]}</div>
                  </div>
                </div>
                {i < stages.length - 1 && <span className="text-slate-600 text-xs shrink-0">→</span>}
              </React.Fragment>
            );
          })}
        </div>

        {/* Main body */}
        <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">

          {/* Video + canvas */}
          <div className="lg:w-[70%] bg-black relative flex items-center justify-center shrink-0" style={{ minHeight: '380px' }}>
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain"
              style={{ maxHeight: '500px' }}
              autoPlay muted loop playsInline preload="auto"
              onError={() => {
                setErrorMessage(`Video failed to load: ${videoUrl}`);
                setStatus('ERROR');
                statusRef.current = 'ERROR';
              }}
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

            {status === 'ANALYZING' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                <Loader2 className="w-12 h-12 text-[#60A5FA] animate-spin mb-3" />
                <span className="text-white font-bold tracking-widest text-sm">Running YOLO+ByteTrack…</span>
                <span className="text-slate-300 text-xs mt-2 font-mono">Processing up to 200 frames</span>
              </div>
            )}

            <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-2.5 py-1 bg-black/70 rounded text-[10px] font-mono border border-white/10">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                <span className="text-white font-semibold">{(camera as any).camera_id || camera.id}</span>
              </div>
              {zonePolygon && (
                <div className="px-2.5 py-1 bg-black/60 text-[9px] font-mono text-cyan-300 rounded border border-cyan-500/30">
                  ZONE ACTIVE: {zonePolygon.name.toUpperCase()}
                </div>
              )}
            </div>

            {status === 'HUMAN DETECTED' && (
              <div className="absolute bottom-3 right-3 bg-black/80 text-white rounded p-2 text-[10px] font-mono space-y-0.5 border border-red-500/30 z-10">
                <div><span className="text-slate-400">HUMANS:</span> <span className="text-[#FC8181] font-bold">{humansDetected}</span></div>
                <div><span className="text-slate-400">TRACKS:</span> <span className="text-[#93C5FD] font-bold">{analysisResult.current?.tracks?.length || 0}</span></div>
                {maxConfidence !== null && <div><span className="text-slate-400">CONF:</span> <span className="text-emerald-400 font-bold">{Math.round(maxConfidence*100)}%</span></div>}
                {elapsedSec !== null && <div><span className="text-slate-400">ELAPSED:</span> <span className="font-bold">{elapsedSec}s</span></div>}
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="lg:w-[30%] border-l border-slate-200 flex flex-col bg-white overflow-hidden">

            {/* Status */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 shrink-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">System Status</div>
              <div className={`px-3 py-2 rounded-lg border font-bold text-xs tracking-wide text-center uppercase ${
                status === 'READY'              ? 'bg-slate-100 text-slate-500 border-slate-200' :
                status === 'ANALYZING'          ? 'bg-blue-50 text-[#1F5F8B] border-blue-200 animate-pulse' :
                status === 'HUMAN DETECTED'     ? 'bg-red-50 text-[#D92D20] border-red-200' :
                status === 'NO HUMANS DETECTED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                  'bg-orange-50 text-orange-700 border-orange-200'
              }`}>{status}</div>

              {status === 'ERROR' && errorMessage && (
                <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-[10px] text-orange-700 flex gap-1.5">
                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span className="break-all">{errorMessage}</span>
                </div>
              )}
            </div>

            {/* Stats */}
            {(status === 'HUMAN DETECTED' || status === 'NO HUMANS DETECTED') && (
              <div className="p-3 border-b border-slate-100 shrink-0">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-red-50 border border-red-100 rounded-lg p-2">
                    <div className="text-2xl font-bold text-[#D92D20]">{humansDetected}</div>
                    <div className="text-[9px] text-[#D92D20]/70 font-semibold uppercase">Humans</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-2">
                    <div className="text-2xl font-bold text-[#1F5F8B]">{analysisResult.current?.tracks?.length||0}</div>
                    <div className="text-[9px] text-[#1F5F8B]/70 font-semibold uppercase">Tracks</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <div className="text-lg font-bold text-slate-700">{framesAnalyzed}</div>
                    <div className="text-[9px] text-slate-500 font-semibold uppercase">Frames</div>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2">
                    <div className="text-lg font-bold text-emerald-700">
                      {maxConfidence !== null ? `${Math.round(maxConfidence*100)}%` : '—'}
                    </div>
                    <div className="text-[9px] text-emerald-700/70 font-semibold uppercase">Max Conf</div>
                  </div>
                </div>
                {(analysisResult.current?.incidents_created_count||0) > 0 && (
                  <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#D92D20] shrink-0" />
                    <span className="text-[11px] text-[#D92D20] font-bold">
                      {analysisResult.current?.incidents_created_count} zone incident(s) logged
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Detection Timeline
              </div>
              {timeline.length === 0 ? (
                <div className="text-[11px] text-slate-400 italic py-2">
                  {status === 'READY' ? 'Click Run YOLO Inference to start.' :
                   status === 'ANALYZING' ? 'Processing…' : 'No events recorded.'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {timeline.map((ev, i) => (
                    <button
                      key={i}
                      onClick={() => seekVideo(ev.timestampSec)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg border text-[10px] transition-all hover:opacity-80 ${timelineColorMap[ev.type]||timelineColorMap.detection}`}
                    >
                      <div className="flex justify-between items-start gap-1">
                        <span className="font-bold uppercase leading-tight">
                          {ev.type === 'detection' && '● '}
                          {ev.type === 'zone_entry' && '⚠ '}
                          {ev.type === 'alert' && '🔴 '}
                          {ev.description}
                        </span>
                        <span className="font-mono shrink-0 font-bold">{ev.timeStr}</span>
                      </div>
                      {ev.trackId != null && <div className="text-[9px] opacity-70 mt-0.5">Track #{String(ev.trackId).padStart(4,'0')}</div>}
                      {ev.confidence != null && <div className="text-[9px] opacity-70">Conf: {Math.round(ev.confidence*100)}%</div>}
                      {ev.zoneName && <div className="text-[9px] opacity-70 font-semibold">{ev.zoneName}</div>}
                      {ev.threatScore != null && <div className="text-[9px] font-bold">Threat: {ev.threatScore}/100</div>}
                    </button>
                  ))}
                </div>
              )}

              {/* ByteTrack summary */}
              {analysisResult.current?.tracks && analysisResult.current.tracks.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">ByteTrack Summary</div>
                  <div className="space-y-1">
                    {analysisResult.current.tracks.map((t: any) => (
                      <div key={t.track_id} className="flex items-center justify-between text-[10px] py-1 border-b border-slate-100">
                        <span className="font-mono font-bold text-[#1F5F8B]">TRK#{String(t.track_id).padStart(4,'0')}</span>
                        <span className="capitalize text-slate-600">{t.fine_class}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          t.state==='active' ? 'bg-emerald-100 text-emerald-700' :
                          t.state==='new'    ? 'bg-blue-100 text-blue-700' :
                                              'bg-slate-100 text-slate-500'
                        }`}>{(t.state||'').toUpperCase()}</span>
                        <span className="text-slate-500">{Math.round(t.confidence_max*100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-3 border-t border-slate-200 space-y-2 shrink-0 bg-slate-50">
              {status === 'HUMAN DETECTED' && (
                <button
                  onClick={handleFileIncident}
                  disabled={incidentFiled}
                  className="w-full py-2.5 bg-[#D92D20] hover:bg-[#b02017] text-white font-bold rounded text-xs tracking-wider uppercase flex justify-center items-center gap-1.5 disabled:opacity-50"
                >
                  <ShieldAlert className="w-4 h-4" />
                  {incidentFiled ? '✓ Incident Logged' : 'File Manual Incident'}
                </button>
              )}
              <button
                onClick={startAnalysis}
                disabled={status === 'ANALYZING'}
                className="w-full py-2.5 bg-[#1F5F8B] hover:bg-[#0F2742] text-white font-bold rounded text-xs tracking-wider uppercase flex justify-center items-center gap-2 disabled:opacity-50"
              >
                {status === 'ANALYZING'
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing…</>
                  : <><Zap className="w-4 h-4" /> Run YOLO Inference</>}
              </button>
              <button
                onClick={stopAnalysis}
                disabled={status === 'READY'}
                className="w-full py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold rounded text-xs tracking-wider uppercase flex justify-center items-center gap-1.5 disabled:opacity-40"
              >
                <Square className="w-3.5 h-3.5" /> Stop / Reset
              </button>
            </div>
          </div>
        </div>

        {/* Scrubber */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-4 text-xs font-mono shrink-0">
          <span className="font-semibold text-slate-500 uppercase tracking-wider shrink-0">Timeline:</span>
          <input
            type="range" min="0" max="100" value={progressPct}
            onChange={e => { if (videoRef.current) videoRef.current.currentTime = (parseFloat(e.target.value)/100)*videoRef.current.duration; }}
            className="flex-1 accent-[#1F5F8B] h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-slate-500 shrink-0">{currentTimeStr}</span>
          {framesAnalyzed > 0 && (
            <span className="text-slate-400 shrink-0 text-[10px]">
              {framesAnalyzed} frames · {elapsedSec}s
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
