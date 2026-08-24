import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Video, Upload, Play, Pause, Radio, Sparkles, Activity, AlertTriangle,
  Crosshair, MapPin, CloudFog, Camera as CameraIcon, CheckCircle, ShieldAlert
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ibvapApi } from '../../services/apiClient';

interface ZonePolygon {
  name: string;
  points: { x: number; y: number }[];
}

export const LiveSurveillancePage: React.FC = () => {
  const {
    cameras,
    activeCameraId,
    setActiveCameraId,
    environment,
    addIncident,
    metrics
  } = useApp();

  // Mode & Playback states
  const [feedSource, setFeedSource] = useState<'SIMULATED' | 'WEBCAM' | 'UPLOADED'>('WEBCAM');
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'detections' | 'tracking' | 'technical'>('overview');

  // Webcam states
  const [webcamActive, setWebcamActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [webcamFPS, setWebcamFPS] = useState<number>(0);
  const [inferenceLatency, setInferenceLatency] = useState<number>(0);
  const [personCount, setPersonCount] = useState<number>(0);
  const [webcamStatus, setWebcamStatus] = useState<'NORMAL' | 'ALERT' | 'NO HUMAN DETECTED'>('NO HUMAN DETECTED');
  const [lastDetectionTime, setLastDetectionTime] = useState<string>('Never');

  // Real-time YOLO lists
  const [realDetections, setRealDetections] = useState<any[]>([]);
  const [realTracks, setRealTracks] = useState<any[]>([]);

  // Canvas / Video Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const inferenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAlertingRef = useRef<boolean>(false);
  const lastAlertTimeRef = useRef<number>(0);

  const activeCamera = cameras.find(c => c.id === activeCameraId) || cameras[0];
  const [zonePolygon, setZonePolygon] = useState<ZonePolygon | null>(null);

  // ── Fetch active zones for camera ─────────────────────────────────────────
  useEffect(() => {
    const cameraId = (activeCamera as any).camera_id || activeCamera.id;
    ibvapApi.getZones()
      .then((zones: any[]) => {
        const zone = zones.find((z: any) =>
          z.camera_id === cameraId || z.camera_id === activeCamera.id
        ) || zones[0];
        if (zone?.polygon_coordinates?.length >= 3) {
          const raw = zone.polygon_coordinates as { x: number; y: number }[];
          const maxCoord = Math.max(...raw.map(p => Math.max(p.x, p.y)));
          const scale = maxCoord > 1.0 ? 100.0 : 1.0;
          setZonePolygon({
            name: zone.name || 'Restricted Zone',
            points: raw.map(p => ({ x: p.x / scale, y: p.y / scale })),
          });
        } else {
          setZonePolygon(null);
        }
      })
      .catch(() => setZonePolygon(null));
  }, [activeCamera]);

  // ── Clean up stream and timers on destroy or source swap ───────────────────
  const stopWebcam = useCallback(() => {
    if (inferenceIntervalRef.current) {
      clearInterval(inferenceIntervalRef.current);
      inferenceIntervalRef.current = null;
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    setWebcamActive(false);
    setCameraError(null);
    setRealDetections([]);
    setRealTracks([]);
    setPersonCount(0);
    setWebcamStatus('NO HUMAN DETECTED');
    isAlertingRef.current = false;

    // Clear canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  // ── Start Browser Webcam ──────────────────────────────────────────────────
  const startWebcam = useCallback(() => {
    stopWebcam();
    setCameraError(null);

    navigator.mediaDevices?.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((stream) => {
        webcamStreamRef.current = stream;
        setWebcamActive(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.src = '';
          videoRef.current.play().catch(e => console.warn("Failed to autoplay webcam:", e));
        }
      })
      .catch((err) => {
        console.error('Webcam access failed:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError('Camera access denied. Enable webcam permission to use Live Surveillance.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setCameraError('No webcam detected.');
        } else {
          setCameraError(`Camera access error: ${err.message || 'Unknown error'}`);
        }
        setWebcamActive(false);
      });
  }, [stopWebcam]);

  // ── Monitor feed source and camera selector updates ────────────────────────
  useEffect(() => {
    if (feedSource === 'WEBCAM') {
      startWebcam();
    } else {
      stopWebcam();
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
    return () => stopWebcam();
  }, [feedSource, activeCameraId, startWebcam, stopWebcam]);

  // ── Capture composite screenshot & Upload evidence ─────────────────────────
  const captureAndUploadEvidence = useCallback((count: number, dets: any[]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Setup composited canvas
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = video.videoWidth || video.clientWidth || 640;
    compositeCanvas.height = video.videoHeight || video.clientHeight || 480;
    const ctx = compositeCanvas.getContext('2d');
    if (!ctx) return;

    // Draw raw video frame
    ctx.drawImage(video, 0, 0, compositeCanvas.width, compositeCanvas.height);
    // Scale and draw overlay canvas
    ctx.drawImage(canvas, 0, 0, compositeCanvas.width, compositeCanvas.height);

    // Save composited image as Blob
    compositeCanvas.toBlob((blob) => {
      if (!blob) return;
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const camId = (activeCamera as any).camera_id || activeCamera.id;

      const formData = new FormData();
      formData.append('file', blob, 'screenshot.jpg');
      formData.append('camera_id', camId);
      formData.append('sector', activeCamera.sector);
      formData.append('timestamp', ts);
      formData.append('event_type', 'MULTIPLE_PERSONS_DETECTED');
      formData.append('person_count', String(count));
      formData.append('threat_level', 'critical');
      formData.append('confidence_values', dets.map(d => `${Math.round(d.confidence * 100)}%`).join(', '));

      ibvapApi.uploadEvidence(formData)
        .then((res) => {
          console.log(`[IBVAP] Evidence uploaded successfully! Incident ID: ${res.incident_id}`);
        })
        .catch((e) => {
          console.error('[IBVAP] Failed to upload evidence:', e);
        });
    }, 'image/jpeg');
  }, [activeCamera]);

  // ── Draw bounding boxes on Canvas ──────────────────────────────────────────
  const drawDetections = useCallback((dets: any[]) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // 1. Draw cyan restricted zone polygon
    if (zonePolygon && zonePolygon.points.length >= 3) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(zonePolygon.points[0].x * W, zonePolygon.points[0].y * H);
      zonePolygon.points.slice(1).forEach(p => ctx.lineTo(p.x * W, p.y * H));
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 200, 200, 0.05)';
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(0, 220, 220, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // 2. Draw red bounding boxes
    const count = dets.length;
    dets.forEach((det: any, idx: number) => {
      const nb = det.bounding_box;
      if (!nb) return;

      const bx = nb.x * W;
      const by = nb.y * H;
      const bw = nb.width * W;
      const bh = nb.height * H;

      const conf = det.confidence || 0;
      const label = `PERSON #${idx + 1}`;
      const subLabel = `CONF: ${Math.round(conf * 100)}%`;

      ctx.save();
      // Draw red alert box
      ctx.strokeStyle = count > 1 ? '#D92D20' : '#10B981'; // red for alert, green for normal
      ctx.lineWidth = 2.5;
      ctx.strokeRect(bx, by, bw, bh);

      // Label background
      ctx.fillStyle = count > 1 ? 'rgba(217, 45, 32, 0.95)' : 'rgba(16, 185, 129, 0.95)';
      const textWidth = Math.max(ctx.measureText(label).width, ctx.measureText(subLabel).width);
      ctx.fillRect(bx, Math.max(0, by - 30), textWidth + 12, 30);

      // Label text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(label, bx + 6, Math.max(10, by - 18));
      ctx.font = '8px monospace';
      ctx.fillText(subLabel, bx + 6, Math.max(20, by - 8));
      ctx.restore();
    });
  }, [zonePolygon]);

  // ── Run Real-Time Frame Inference (Webcam loop) ────────────────────────────
  const runFrameInference = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !webcamActive) return;

    // Create temporary canvas to grab the current video frame
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth || 640;
    tempCanvas.height = video.videoHeight || 480;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    tempCanvas.toBlob(async (blob) => {
      if (!blob) return;
      const startTime = performance.now();
      const camId = (activeCamera as any).camera_id || activeCamera.id;

      try {
        const res = await ibvapApi.runWebcamInference(camId, blob, 0.35);
        const latency = Math.round(performance.now() - startTime);
        setInferenceLatency(latency);
        setWebcamFPS(Math.round(1000 / (latency || 100)));

        const dets = res.detections || [];
        const count = dets.length;
        setPersonCount(count);
        setRealDetections(dets);

        // Update real tracks array
        setRealTracks(dets.map((d: any) => ({
          track_id: d.track_id || Math.floor(Math.random() * 1000),
          confidence_max: d.confidence,
          fine_class: d.class
        })));

        setLastDetectionTime(new Date().toLocaleTimeString());

        // Decision logic
        if (count === 0) {
          setWebcamStatus('NO HUMAN DETECTED');
          isAlertingRef.current = false;
        } else if (count === 1) {
          setWebcamStatus('NORMAL');
          isAlertingRef.current = false;
        } else {
          setWebcamStatus('ALERT');
          // Cooldown state machine for evidence screenshot
          const now = Date.now();
          if (!isAlertingRef.current || (now - lastAlertTimeRef.current > 30000)) {
            isAlertingRef.current = true;
            lastAlertTimeRef.current = now;
            // Draw box on canvas immediately then take composite screenshot
            drawDetections(dets);
            setTimeout(() => captureAndUploadEvidence(count, dets), 100);
          }
        }

        // Draw overlay boxes
        drawDetections(dets);

      } catch (err) {
        console.warn('Frame inference failed:', err);
      }
    }, 'image/jpeg');
  }, [webcamActive, activeCamera, drawDetections, captureAndUploadEvidence]);

  // ── Toggle AI Inference loop ──────────────────────────────────────────────
  const toggleInference = () => {
    if (isDetecting) {
      if (inferenceIntervalRef.current) {
        clearInterval(inferenceIntervalRef.current);
        inferenceIntervalRef.current = null;
      }
      setIsDetecting(false);
      // Clear detections overlay
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      setRealDetections([]);
      setRealTracks([]);
      setPersonCount(0);
      setWebcamStatus('NO HUMAN DETECTED');
    } else {
      if (feedSource !== 'WEBCAM') {
        runRealYoloDetection();
      } else {
        if (!webcamActive) {
          startWebcam();
        }
        setIsDetecting(true);
        // Start loop every 180ms (~5.5 fps) to controlled load on CPU
        inferenceIntervalRef.current = setInterval(runFrameInference, 180);
      }
    }
  };

  // ── Cleanup interval on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (inferenceIntervalRef.current) {
        clearInterval(inferenceIntervalRef.current);
      }
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeCamera) {
      stopWebcam();
      const url = URL.createObjectURL(file);
      setUploadedVideoUrl(url);
      setFeedSource('UPLOADED');
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = url;
        videoRef.current.play().catch(() => {});
      }
      try {
        const detectId = (activeCamera as any).camera_id || activeCamera.id;
        const uploadRes = await ibvapApi.uploadVideo(file, detectId);
        await ibvapApi.processCameraVideo(detectId, uploadRes.video_id);
        await runRealYoloDetection();
      } catch (err: any) {
        console.warn('Failed to upload MP4:', err);
      }
    }
  };

  const runRealYoloDetection = async () => {
    if (!activeCamera) return;
    setIsDetecting(true);
    try {
      const detectId = (activeCamera as any).camera_id || activeCamera.id;
      const data = await ibvapApi.runYoloDetection(detectId, {
        confThreshold: 0.30,
        frameStride: 2,
        maxFrames: 150
      });

      if (data && data.detections) {
        setRealDetections(data.detections);
        setRealTracks(data.tracks || []);

        const incCount = data.incidents_created_count || 0;
        if (incCount > 0 && data.incidents_created) {
          data.incidents_created.forEach((inc: any) => {
            addIncident({
              id: inc.id || inc.incident_id,
              timestamp: inc.timestamp || new Date().toLocaleString(),
              sector: activeCamera.sector || 'Sector B',
              cameraName: activeCamera.name,
              cameraId: detectId,
              outpost: activeCamera.outpost || 'Border Outpost North',
              objectType: (inc.object_type === 'person' ? 'human' : inc.object_type) as any,
              persistentId: inc.track_id,
              threatScore: inc.threat_score,
              severity: (inc.threat_level || 'critical') as any,
              explainableReason: inc.explainable_reason,
              environmentalCondition: 'normal',
              aiReliability: 92,
              visibilityScore: 90,
              status: 'active',
              snapshotUrl: '',
              zoneName: inc.zone_name,
              loiteringDurationSec: 0,
              speedKmh: 4.2,
              direction: 'Inward Perimeter',
              smartAlertConfirmed: true,
              syncedToCloud: false,
              threatFactors: [
                { category: 'PERIMETER_BREACH', scoreContribution: 50, description: `Target ${inc.track_id} crossed virtual fence in ${inc.zone_name}` }
              ]
            });
          });
        }
      } else {
        setRealDetections([]);
        setRealTracks([]);
      }
    } catch (err: any) {
      console.warn('Real YOLO+ByteTrack detection error:', err);
    } finally {
      setIsDetecting(false);
    }
  };

  return (
    <div className="space-y-[24px]">

      {/* Top: Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[var(--primary-navy)]">Live Surveillance</h1>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm">
            <span className="font-semibold text-[var(--text-primary)]">Camera:</span>
            <select
              className="bg-white border border-[var(--border-color)] text-[var(--text-primary)] rounded px-3 py-1.5 focus:outline-none focus:border-[#1F5F8B] shadow-sm"
              value={activeCameraId}
              onChange={(e) => setActiveCameraId(e.target.value)}
            >
              {cameras.map(cam => (
                <option key={cam.id} value={cam.id}>{cam.name} - {cam.sector}</option>
              ))}
            </select>

            <span className="font-semibold text-[var(--text-primary)] ml-2">Source:</span>
            <select
              className="bg-white border border-[var(--border-color)] text-[var(--text-primary)] rounded px-3 py-1.5 focus:outline-none focus:border-[#1F5F8B] shadow-sm font-semibold text-xs"
              value={feedSource}
              onChange={(e) => setFeedSource(e.target.value as any)}
            >
              <option value="WEBCAM">Real Live Webcam</option>
              <option value="SIMULATED">Simulated File Stream</option>
            </select>

            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              activeCamera.status === 'online' ? 'bg-[#10B981]/10 text-[#10B981]' :
              activeCamera.status === 'degraded' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-slate-100 text-slate-500'
            }`}>
              {activeCamera.status.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="px-4 py-2 bg-white border border-[var(--border-color)] hover:bg-slate-50 text-[var(--text-primary)] text-sm font-semibold rounded shadow-sm cursor-pointer transition-colors flex items-center gap-2">
            <Upload className="w-4 h-4" /> Upload MP4
            <input type="file" accept="video/mp4" onChange={handleFileUpload} className="hidden" />
          </label>
          <button
            onClick={toggleInference}
            className={`px-4 py-2 text-white text-sm font-semibold rounded shadow-sm flex items-center gap-2 transition-colors ${
              isDetecting ? 'bg-[#D92D20] hover:bg-[#b02017]' : 'bg-[#1F5F8B] hover:bg-[#0F2742]'
            }`}
          >
            <Radio className={`w-4 h-4 ${isDetecting ? 'animate-pulse' : ''}`} />
            {isDetecting ? 'AI INFERENCE RUNNING (STOP)' : 'Start AI Inference'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-[24px]">

        {/* Left: Main Video Viewport */}
        <div className="lg:w-[68%] flex flex-col gap-[24px]">
          <div className="relative bg-black rounded-lg overflow-hidden shadow-sm border border-[var(--border-color)]">
            
            {cameraError ? (
              <div className="w-full h-[550px] flex flex-col items-center justify-center text-slate-400 bg-slate-950 p-6">
                <AlertTriangle className="w-12 h-12 text-orange-500 mb-4 animate-bounce" />
                <span className="text-sm font-bold tracking-wider uppercase text-orange-400 text-center">{cameraError}</span>
                <button
                  onClick={startWebcam}
                  className="mt-4 px-3 py-1.5 bg-[#1F5F8B] text-white rounded text-xs font-bold hover:bg-[#0F2742]"
                >
                  RETRY
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  src={feedSource === 'UPLOADED' && uploadedVideoUrl ? uploadedVideoUrl : (feedSource === 'SIMULATED' ? (ibvapApi.getVideoUrlForCamera(activeCamera) || '') : undefined)}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-[550px] object-cover"
                />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />
              </>
            )}

            <div className="absolute top-4 left-4 flex gap-2 z-20">
              <span className="px-3 py-1.5 bg-black/70 backdrop-blur-sm text-white text-xs font-semibold rounded shadow-sm flex items-center gap-2 border border-white/10">
                <Radio className="w-3.5 h-3.5 text-[#D92D20] animate-pulse" /> LIVE STREAM
              </span>
              {feedSource === 'WEBCAM' && (
                <span className={`px-3 py-1.5 rounded text-white text-xs font-bold ${
                  webcamStatus === 'ALERT' ? 'bg-[#D92D20]/90 border border-red-500/30' :
                  webcamStatus === 'NORMAL' ? 'bg-[#10B981]/90 border border-emerald-500/30' :
                  'bg-slate-700/90'
                }`}>
                  {webcamStatus === 'ALERT' ? '⚠ ALERT / CRITICAL' :
                   webcamStatus === 'NORMAL' ? '✓ NORMAL' : 'NO HUMAN DETECTED'}
                </span>
              )}
            </div>

            <div className="absolute bottom-4 left-4 right-4 flex justify-between bg-black/70 backdrop-blur-sm px-4 py-2.5 rounded-lg items-center text-white shadow-sm text-sm border border-white/10 z-20">
              <button onClick={() => setIsPlaying(!isPlaying)} className="hover:text-blue-300 transition-colors">
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <div className="flex gap-6 font-semibold font-mono text-xs">
                {feedSource === 'WEBCAM' && webcamActive && (
                  <>
                    <span className="text-[#93C5FD]">WEBCAM ACTIVE</span>
                    <span className="text-emerald-400">{webcamFPS} FPS</span>
                    <span className="text-slate-300">LATENCY: {inferenceLatency}ms</span>
                  </>
                )}
                {feedSource !== 'WEBCAM' && (
                  <>
                    <span className="text-slate-300">Resolution: {activeCamera.resolution}</span>
                    <span className="text-[#10B981]">{activeCamera.fps} FPS</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Real-time Decision status bar */}
          {feedSource === 'WEBCAM' && (
            <div className={`p-[16px] rounded-lg border flex justify-between items-center text-sm font-semibold transition-all duration-300 ${
              webcamStatus === 'ALERT' ? 'bg-red-50 border-red-200 text-[#D92D20]' :
              webcamStatus === 'NORMAL' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
              'bg-slate-50 border-slate-200 text-slate-500'
            }`}>
              <div className="flex items-center gap-2">
                {webcamStatus === 'ALERT' ? <ShieldAlert className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                <span className="uppercase tracking-wide font-mono">
                  {webcamStatus === 'ALERT' ? 'MULTIPLE PERSONS DETECTED — ALERT' :
                   webcamStatus === 'NORMAL' ? '1 PERSON DETECTED — NORMAL' :
                   'NO HUMAN DETECTED'}
                </span>
              </div>
              <div className="font-mono text-xs">
                COUNT: {personCount} | LAST: {lastDetectionTime}
              </div>
            </div>
          )}

          {/* Below Video: AI Status / Timeline */}
          <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm flex justify-between items-center text-[15px]">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-[#10B981]" />
              <span className="font-semibold text-[var(--primary-navy)]">AI Status:</span>
              <span className="text-[#10B981] font-bold">Optimal ({metrics.processingFps} FPS)</span>
            </div>
            <div className="flex items-center gap-3">
              <CloudFog className="w-5 h-5 text-[var(--secondary-blue)]" />
              <span className="font-semibold text-[var(--primary-navy)]">Environment:</span>
              <span className="text-[var(--text-muted)] capitalize">{environment.replace('_', ' ')}</span>
            </div>
          </div>
        </div>

        {/* Right Panel: Tab Widgets */}
        <div className="lg:w-[32%] bg-white border border-[var(--border-color)] rounded-lg shadow-sm flex flex-col">
          <div className="flex border-b border-[var(--border-color)] overflow-x-auto">
            {['overview', 'detections', 'tracking', 'technical'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`flex-1 py-3 px-2 text-[13px] font-semibold tracking-wide uppercase whitespace-nowrap transition-colors ${
                  activeTab === tab
                    ? 'text-[#1F5F8B] border-b-2 border-[#1F5F8B] bg-slate-50/50'
                    : 'text-[var(--text-muted)] hover:text-[var(--primary-navy)] hover:bg-slate-50 border-b-2 border-transparent'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 p-[20px] overflow-y-auto">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Live Status</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-100 rounded text-xs font-mono">
                      <span className="text-slate-500 font-semibold">CAMERA ID</span>
                      <span className="font-bold">{(activeCamera as any).camera_id || activeCamera.id}</span>
                    </div>
                    <div className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-100 rounded text-xs font-mono">
                      <span className="text-slate-500 font-semibold">PERSON COUNT</span>
                      <span className="font-bold text-[#1F5F8B]">{personCount}</span>
                    </div>
                    <div className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-100 rounded text-xs font-mono">
                      <span className="text-slate-500 font-semibold">AI INFERENCE</span>
                      <span className={`font-bold ${isDetecting ? 'text-emerald-500' : 'text-slate-400'}`}>
                        {isDetecting ? 'ACTIVE' : 'IDLE'}
                      </span>
                    </div>
                  </div>
                </div>

                {personCount >= 2 && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Active Alerts</h3>
                    <div className="p-3 bg-red-50 border border-red-100 rounded flex items-start gap-3 animate-pulse">
                      <AlertTriangle className="w-5 h-5 text-[#D92D20] shrink-0 mt-0.5" />
                      <div>
                        <div className="text-sm font-bold text-[#D92D20]">MULTIPLE PERSONS DETECTED</div>
                        <div className="text-xs text-[#D92D20]/80 mt-1">Automatic evidence captured and logged. Threat level: ALERT.</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'detections' && (
              <div className="space-y-2">
                {realDetections.length === 0 ? (
                  <div className="text-center text-sm text-[var(--text-muted)] py-8 font-mono">No detections in frame.</div>
                ) : (
                  realDetections.map((d, i) => (
                    <div key={i} className="p-2.5 border border-slate-200 rounded flex justify-between items-center bg-slate-50 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <Crosshair className="w-4 h-4 text-[#1F5F8B]" />
                        <span className="font-semibold capitalize text-slate-800">{d.class} #{i + 1}</span>
                      </div>
                      <span className="font-bold text-[#10B981]">{(d.confidence * 100).toFixed(0)}%</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'tracking' && (
              <div className="space-y-2">
                {realTracks.length === 0 ? (
                  <div className="text-center text-sm text-[var(--text-muted)] py-8 font-mono">No active tracks.</div>
                ) : (
                  realTracks.map((t, idx) => (
                    <div key={idx} className="p-2.5 border border-slate-200 rounded bg-slate-50 space-y-1 font-mono text-xs">
                      <div className="flex justify-between items-center border-b border-slate-100 pb-1">
                        <span className="font-bold text-[#1F5F8B]">TRACK-00{t.track_id}</span>
                        <span className="font-bold text-emerald-500">{(t.confidence_max * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>CLASS: {t.fine_class}</span>
                        <span>STATUS: ACTIVE</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'technical' && (
              <div className="space-y-3 text-xs font-mono bg-slate-50 p-4 rounded border border-slate-200 text-slate-700">
                <div className="flex justify-between"><span>Inference Mode:</span> <span>{feedSource}</span></div>
                <div className="flex justify-between"><span>Model:</span> <span>YOLOv8n (Nano-CPU)</span></div>
                <div className="flex justify-between"><span>Latency:</span> <span>{inferenceLatency}ms</span></div>
                <div className="flex justify-between"><span>Inference FPS:</span> <span>{webcamFPS} FPS</span></div>
                <div className="flex justify-between"><span>Backend Status:</span> <span>Connected (port 8000)</span></div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
