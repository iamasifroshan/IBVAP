import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Video, Upload, Play, Pause, Radio, Sparkles, Activity, AlertTriangle,
  Crosshair, MapPin, CloudFog, Camera as CameraIcon, CheckCircle, ShieldAlert
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ibvapApi } from '../../services/apiClient';
import { getCameraById } from '../../types';
import type { C2Status } from '../../types';

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
    metrics,
    updateCamera,
    networkStatus,
    securityEvents,
    setActivePage,
  } = useApp();

  // Mode & Playback states
  const [feedSource, setFeedSource] = useState<'SIMULATED' | 'WEBCAM' | 'UPLOADED'>('SIMULATED');
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'detections' | 'tracking' | 'technical'>('overview');

  // Webcam states
  const [webcamActive, setWebcamActive] = useState<boolean>(false);
  const [webcamConnecting, setWebcamConnecting] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [webcamFPS, setWebcamFPS] = useState<number>(0);
  const [inferenceLatency, setInferenceLatency] = useState<number>(0);
  const [personCount, setPersonCount] = useState<number>(0);
  const [evidenceUploaded, setEvidenceUploaded] = useState<boolean>(false);
  const [webcamStatus, setWebcamStatus] = useState<'NORMAL' | 'ALERT' | 'NO HUMAN DETECTED'>('NO HUMAN DETECTED');
  const [lastDetectionTime, setLastDetectionTime] = useState<string>('Never');

  // ── GATE: Camera only starts after user clicks START LIVE TEST ────────────
  const [liveTestStarted, setLiveTestStarted] = useState<boolean>(false);
  const [cameraLifecycle, setCameraLifecycle] = useState<'OFF' | 'READY' | 'STARTING' | 'LIVE' | 'STOPPED' | 'ERROR'>('OFF');

  // Real-time YOLO lists
  const [realDetections, setRealDetections] = useState<any[]>([]);
  const [realTracks, setRealTracks] = useState<any[]>([]);
  // Vehicle detection state
  const [vehicleCount, setVehicleCount] = useState<number>(0);
  const [vehicleDetections, setVehicleDetections] = useState<any[]>([]);
  // Suspicious activity state
  const [suspiciousActivities, setSuspiciousActivities] = useState<any[]>([]);
  // Night movement state
  const [nightMovements, setNightMovements] = useState<any[]>([]);
  // Unified Security Events state (Phase 4)
  const [liveSecurityEvents, setLiveSecurityEvents] = useState<any[]>([]);
  // C2 Integration status (Phase 6)
  const [c2Status, setC2Status] = useState<C2Status | null>(null);


  // Canvas / Video Refs
  const videoRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const inferenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAlertingRef = useRef<boolean>(false);
  const lastAlertTimeRef = useRef<number>(0);
  const wasPausedForNetworkRef = useRef<boolean>(false);
  // Ref that always mirrors webcamActive — lets runFrameInference read the
  // current value without stale closure issues.
  const webcamActiveRef = useRef<boolean>(false);
  // Guard: only one inference request in-flight at a time to prevent pile-up
  const isInferenceInFlightRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const seqCounterRef = useRef<number>(0);
  const inferenceTimestampsRef = useRef<number[]>([]);

  const activeCamera = getCameraById(cameras, activeCameraId);
  const [zonePolygon, setZonePolygon] = useState<ZonePolygon | null>(null);

  // ── Component lifecycle: Ensure ALL tracks stopped upon leaving page ─────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (inferenceIntervalRef.current) {
        clearInterval(inferenceIntervalRef.current);
        inferenceIntervalRef.current = null;
      }
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(t => {
          t.stop();
        });
        webcamStreamRef.current = null;
      }
      if (videoRef.current && 'srcObject' in videoRef.current) {
        const vid = videoRef.current as HTMLVideoElement;
        if (vid && vid.srcObject) {
          const s = vid.srcObject as MediaStream;
          s.getTracks().forEach(t => t.stop());
          vid.srcObject = null;
        }
      }
    };
  }, []);

  // Poll C2 Integration status every 5 seconds
  useEffect(() => {
    let active = true;
    const loadC2 = async () => {
      try {
        const st = await ibvapApi.getC2Status();
        if (active && st) setC2Status(st);
      } catch {
        // preserve
      }
    };
    loadC2();
    const timer = setInterval(loadC2, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

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
    if (videoRef.current && 'srcObject' in videoRef.current) {
      const vid = videoRef.current as HTMLVideoElement;
      if (vid && vid.srcObject) {
        const s = vid.srcObject as MediaStream;
        s.getTracks().forEach(track => track.stop());
        vid.srcObject = null;
      }
    }
    webcamActiveRef.current = false;
    isInferenceInFlightRef.current = false;
    inferenceTimestampsRef.current = [];
    setWebcamActive(false);
    setWebcamConnecting(false);
    setIsDetecting(false);
    setCameraLifecycle('OFF');
    setCameraError(null);
    setWebcamFPS(0);
    setInferenceLatency(0);
    setPersonCount(0);
    setVehicleCount(0);
    setVehicleDetections([]);
    setRealDetections([]);
    setRealTracks([]);
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
  const startWebcam = useCallback(async (): Promise<boolean> => {
    if (webcamStreamRef.current && webcamActiveRef.current && videoRef.current && 'srcObject' in videoRef.current && (videoRef.current as HTMLVideoElement).srcObject) {
      // Stream is already active — reuse it without stopping
      return true;
    }

    // Stop any existing interval and stream before requesting a new one
    if (inferenceIntervalRef.current) {
      clearInterval(inferenceIntervalRef.current);
      inferenceIntervalRef.current = null;
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(t => t.stop());
      webcamStreamRef.current = null;
    }
    webcamActiveRef.current = false;
    isInferenceInFlightRef.current = false;
    inferenceTimestampsRef.current = [];
    setWebcamActive(false);
    setWebcamConnecting(true);
    setCameraLifecycle('STARTING');
    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      if (!isMountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return false;
      }
      webcamStreamRef.current = stream;
      if (videoRef.current && 'srcObject' in videoRef.current) {
        (videoRef.current as HTMLVideoElement).srcObject = stream;
        (videoRef.current as HTMLVideoElement).play().catch(e => console.warn("Failed to autoplay webcam:", e));
      }
      setWebcamConnecting(false);
      webcamActiveRef.current = true;
      setWebcamActive(true);
      setCameraLifecycle('LIVE');
      return true;
    } catch (err: any) {
      console.error('Webcam access failed:', err);
      setCameraLifecycle('ERROR');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Allow camera access and try again.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No compatible camera was detected.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError('The camera is currently being used by another application.');
      } else if (err.name === 'OverconstrainedError') {
        setCameraError('Camera does not support the requested resolution. Please try a different camera.');
      } else {
        setCameraError('Unable to start the selected camera. Please retry.');
      }
      setWebcamConnecting(false);
      webcamActiveRef.current = false;
      setWebcamActive(false);
      return false;
    }
  }, []);

  // ── Ensure video element remains bound to webcamStreamRef across renders ──
  useEffect(() => {
    if (feedSource === 'WEBCAM' && webcamActive && videoRef.current && webcamStreamRef.current && 'srcObject' in videoRef.current) {
      if ((videoRef.current as HTMLVideoElement).srcObject !== webcamStreamRef.current) {
        (videoRef.current as HTMLVideoElement).srcObject = webcamStreamRef.current;
      }
      (videoRef.current as HTMLVideoElement).play().catch(() => {});
    }
  }, [feedSource, webcamActive]);

  // ── Sync feed source with selected camera protocol ──────────────────────
  useEffect(() => {
    if (activeCamera) {
      const targetSource = activeCamera.protocol === 'WEBCAM' ? 'WEBCAM' : 'SIMULATED';
      setFeedSource(prev => prev === targetSource ? prev : targetSource);
    }
  }, [activeCameraId, activeCamera.id, activeCamera.protocol]);

  // ── Handle Source Switch & Persistence ──────────────────────────────────────
  const handleSourceChange = async (val: 'SIMULATED' | 'WEBCAM') => {
    setFeedSource(val);
    if (!activeCamera) return;
    try {
      const type = val === 'WEBCAM' ? 'WEBCAM' : 'SIMULATED_FILE';
      const url = activeCamera.streamUrl || '';
      const res = await ibvapApi.updateCameraSource(activeCamera.id, url, type);
      
      const statusLower = res.status?.toLowerCase();
      updateCamera(activeCamera.id, {
        protocol: type as any,
        streamUrl: url,
        status: (statusLower || activeCamera.status) as any,
        healthScore: res.healthScore || res.health_score || activeCamera.healthScore,
      });
    } catch (err) {
      console.warn("Failed to persist source choice in DB:", err);
    }
  };

  // ── Monitor feed source and camera selector updates ────────────────────────
  // GATE: Only start webcam/inference when user has explicitly clicked START LIVE TEST
  useEffect(() => {
    if (!liveTestStarted) {
      // User has not started the live test — do NOT access camera
      return;
    }

    if (feedSource === 'WEBCAM') {
      startWebcam().then(success => {
        if (!success) return;
        if (!inferenceIntervalRef.current) {
          setIsDetecting(true);
          inferenceIntervalRef.current = setInterval(() => {
            if (runFrameInferenceRef.current) runFrameInferenceRef.current();
          }, 180);
        }
      });
    } else {
      stopWebcam();
      if (videoRef.current && 'srcObject' in videoRef.current) {
        (videoRef.current as HTMLVideoElement).srcObject = null;
      }
      // For simulated/uploaded feeds, start inference and playback
      if (videoRef.current && 'paused' in videoRef.current && (videoRef.current as HTMLVideoElement).paused) {
        (videoRef.current as HTMLVideoElement).play().catch(() => {});
      }
      if (!inferenceIntervalRef.current) {
        setIsDetecting(true);
        inferenceIntervalRef.current = setInterval(() => {
          if (runFrameInferenceRef.current) runFrameInferenceRef.current();
        }, 180);
      }
    }

    return () => {
      // Clean up intervals on unmount / change
      if (inferenceIntervalRef.current) {
        clearInterval(inferenceIntervalRef.current);
        inferenceIntervalRef.current = null;
      }
    };
  }, [feedSource, activeCameraId, liveTestStarted, startWebcam, stopWebcam]);

  // ── Capture composite screenshot & Upload evidence ─────────────────────────
  const captureAndUploadEvidence = useCallback((count: number, dets: any[], incidentId?: string) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Setup composited canvas
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = (video as any).videoWidth || (video as HTMLImageElement).naturalWidth || video.clientWidth || 640;
    compositeCanvas.height = (video as any).videoHeight || (video as HTMLImageElement).naturalHeight || video.clientHeight || 480;
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
      formData.append('event_type', 'UNKNOWN_PERSON_DETECTED');
      formData.append('person_count', String(count));
      formData.append('threat_level', 'critical');
      formData.append('confidence_values', dets.map(d => `${Math.round(d.confidence * 100)}%`).join(', '));
      if (incidentId) {
        formData.append('incident_id', incidentId);
      }

      ibvapApi.uploadEvidence(formData)
        .then((res) => {
          console.log(`[IBVAP] Evidence uploaded successfully! Incident ID: ${res.incident_id}`);
          setEvidenceUploaded(true);
        })
        .catch((e) => {
          console.error('[IBVAP] Failed to upload evidence:', e);
        });
    }, 'image/jpeg');
  }, [activeCamera]);

  // ── Draw bounding boxes on Canvas ──────────────────────────────────────────
  const drawDetections = useCallback((dets: any[], vdets: any[] = [], susp: any[] = [], nightMoves: any[] = []) => {
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

    // 2. Draw person bounding boxes (red = unknown, green = known)
    dets.forEach((det: any, idx: number) => {
      const nb = det.bounding_box;
      if (!nb) return;

      const bx = nb.x * W;
      const by = nb.y * H;
      const bw = nb.width * W;
      const bh = nb.height * H;

      const yoloConf = det.confidence || 0;
      const face = det.face;
      const identityStatus: string = det.identity_status || face?.identity_status || (face?.recognized ? 'KNOWN' : (face ? 'UNKNOWN' : 'FACE_UNAVAILABLE'));

      let line1 = det.track_id != null ? `TRK#${det.track_id}` : `PERSON #${idx + 1}`;
      let line2 = 'FACE UNAVAILABLE';
      let line3 = 'NO FACE';
      let themeColor = '#64748B'; // Slate 500 for FACE_UNAVAILABLE

      if (identityStatus === 'KNOWN') {
        const confLevel = face?.confidence_level || face?.confidenceLevel || 'HIGH';
        const recConf = face?.recognition_confidence ?? face?.confidence ?? 0;
        const pName = (face?.name || det.person_name || 'KNOWN').toUpperCase();
        line1 = `KNOWN · ${confLevel}`;
        line2 = pName;
        line3 = `CONF: ${Math.round(recConf * 100)}%`;
        themeColor = '#10B981'; // Emerald 500
      } else if (identityStatus === 'UNKNOWN') {
        const recConf = face?.recognition_confidence ?? face?.confidence ?? 0;
        line1 = `UNKNOWN · NO MATCH`;
        line2 = 'NO MATCH';
        line3 = recConf > 0 ? `CONF: ${Math.round(recConf * 100)}%` : `CONF: ${Math.round(yoloConf * 100)}%`;
        themeColor = '#D92D20'; // Red 600 for confirmed UNKNOWN threat
      } else if (identityStatus === 'FACE_PROCESSING_ERROR') {
        line1 = 'FACE ERROR';
        line2 = 'PROCESSING FAILED';
        line3 = 'RETRY';
        themeColor = '#F59E0B'; // Amber 500
      } else {
        // FACE_UNAVAILABLE (no face visible, turned away, occluded)
        line1 = det.track_id != null ? `TRK#${det.track_id}` : `PERSON #${idx + 1}`;
        line2 = 'FACE UNAVAILABLE';
        line3 = 'NO FACE';
        themeColor = '#64748B'; // Slate 500
      }

      ctx.save();
      // Draw professional bounding box
      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      // Label background (Dark panel)
      ctx.fillStyle = 'rgba(11, 31, 51, 0.9)'; // Dark navy background
      const textWidth = Math.max(
        ctx.measureText(line1).width,
        ctx.measureText(line2).width,
        ctx.measureText(line3).width
      ) + 20; // Extra padding
      const labelHeight = 40;
      
      // Draw label background slightly above the box
      ctx.fillRect(bx, Math.max(0, by - labelHeight), textWidth, labelHeight);
      
      // Top color bar for the label
      ctx.fillStyle = themeColor;
      ctx.fillRect(bx, Math.max(0, by - labelHeight), textWidth, 3);

      // Label text
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(line1, bx + 6, Math.max(12, by - 25));
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = identityStatus === 'KNOWN' ? '#10B981' : (identityStatus === 'UNKNOWN' ? '#F87171' : '#F8FAFC');
      ctx.fillText(line2, bx + 6, Math.max(24, by - 14));
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#94A3B8'; // Slate 400
      ctx.fillText(line3, bx + 6, Math.max(34, by - 4));
      
      // Behavioral Badge for Suspicious Activity (e.g., LOITERING · TRK#41 · 34s · MEDIUM)
      const matchingSusp = susp.find((s: any) => s.track_id === det.track_id);
      if (matchingSusp) {
        const actLabel = (matchingSusp.activity_type || '').replace(/_/g, ' ');
        const dur = `${matchingSusp.duration_sec ?? 0}s`;
        const sev = matchingSusp.severity || 'MEDIUM';
        const suspBadgeText = `${actLabel} · ${matchingSusp.track_label || `TRK#${det.track_id}`} · ${dur} · ${sev}`;

        const badgeColor = sev === 'HIGH' ? '#EF4444' : '#F59E0B';
        ctx.font = 'bold 10px monospace';
        const badgeW = ctx.measureText(suspBadgeText).width + 16;
        const badgeH = 18;
        const badgeY = Math.max(0, by - labelHeight - badgeH - 3);

        ctx.fillStyle = 'rgba(11, 31, 51, 0.95)';
        ctx.fillRect(bx, badgeY, badgeW, badgeH);
        ctx.strokeStyle = badgeColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, badgeY, badgeW, badgeH);
        ctx.fillStyle = badgeColor;
        ctx.fillRect(bx, badgeY, 3, badgeH);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(suspBadgeText, bx + 8, badgeY + 13);
      }

      // Night-Time Movement Badge (e.g., NIGHT MOVEMENT · TRK#41 · L:42.1 · D:0.045)
      const matchingNM = nightMoves.find((n: any) => n.track_id === det.track_id);
      if (matchingNM) {
        const nmBadgeText = `NIGHT MOVEMENT · ${matchingNM.track_label || `TRK#${det.track_id}`} · Luma ${matchingNM.avg_luma} · Disp ${matchingNM.displacement}`;
        const nmBadgeColor = '#38BDF8'; // Sky blue / cyan within IBVAP palette
        ctx.font = 'bold 10px monospace';
        const badgeW = ctx.measureText(nmBadgeText).width + 16;
        const badgeH = 18;
        const badgeOffset = matchingSusp ? (labelHeight + 36 + 6) : (labelHeight + 18 + 3);
        const badgeY = Math.max(0, by - badgeOffset);

        ctx.fillStyle = 'rgba(11, 31, 51, 0.95)';
        ctx.fillRect(bx, badgeY, badgeW, badgeH);
        ctx.strokeStyle = nmBadgeColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, badgeY, badgeW, badgeH);
        ctx.fillStyle = nmBadgeColor;
        ctx.fillRect(bx, badgeY, 3, badgeH);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(nmBadgeText, bx + 8, badgeY + 13);
      }

      ctx.restore();
    });


    // 3. Draw vehicle bounding boxes — amber (#F59E0B), distinct from person overlays
    vdets.forEach((det: any) => {
      const nb = det.bounding_box;
      if (!nb) return;
      const bx = nb.x * W;
      const by = nb.y * H;
      const bw = nb.width * W;
      const bh = nb.height * H;
      if (bw < 2 || bh < 2) return;

      const vClass = (det.vehicle_class || det.class || 'vehicle').toUpperCase();
      const label = det.track_label || `VTRK#${det.track_id}`;
      const conf = det.confidence || 0;
      const dir = det.direction && det.direction !== 'unknown' ? ` · ${det.direction}` : '';

      ctx.save();
      ctx.strokeStyle = '#F59E0B'; // amber — IBVAP vehicle colour
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);

      const line1v = `${label} · ${vClass}`;
      const line2v = `CONF: ${Math.round(conf * 100)}%${dir}`;
      const line3v = det.plate_text && det.plate_stable
        ? `${det.plate_text} · ${Math.round((det.plate_confidence || 0) * 100)}% ${det.format_valid ? '(IND)' : ''}`
        : 'PLATE NOT CONFIRMED';

      ctx.fillStyle = 'rgba(11, 31, 51, 0.9)';
      const tw = Math.max(
        ctx.measureText(line1v).width,
        ctx.measureText(line2v).width,
        ctx.measureText(line3v).width
      ) + 20;
      const lh = 42;
      ctx.fillRect(bx, Math.max(0, by - lh), tw, lh);
      ctx.fillStyle = det.plate_stable ? (det.format_valid ? '#10B981' : '#F59E0B') : '#F59E0B';
      ctx.fillRect(bx, Math.max(0, by - lh), tw, 3);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(line1v, bx + 6, Math.max(12, by - 28));
      ctx.fillStyle = '#FDE68A';
      ctx.fillText(line2v, bx + 6, Math.max(22, by - 16));
      ctx.fillStyle = det.plate_stable ? (det.format_valid ? '#34D399' : '#FBBF24') : '#94A3B8';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(line3v, bx + 6, Math.max(34, by - 4));
      ctx.restore();
    });
  }, [zonePolygon]);

  // ── Run Real-Time Frame Inference (Webcam loop) ────────────────────────────
  const runFrameInference = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !isMountedRef.current) return;

    // Guard: video must have actual frame data and dimensions (img element for MJPEG)
    const isVideoEl = 'readyState' in video;
    const vW = (video as any).videoWidth || (video as HTMLImageElement).naturalWidth;
    const vH = (video as any).videoHeight || (video as HTMLImageElement).naturalHeight;
    if ((isVideoEl && (video as any).readyState < HTMLMediaElement.HAVE_CURRENT_DATA) || vW === 0 || vH === 0) {
      return;
    }

    // Guard: skip if a previous request is still in-flight
    if (isInferenceInFlightRef.current) return;

    if (networkStatus === 'offline') {
      if (!wasPausedForNetworkRef.current) {
        console.log("[IBVAP] Live surveillance inference paused: backend OFFLINE");
        wasPausedForNetworkRef.current = true;
      }
      return;
    }

    if (wasPausedForNetworkRef.current) {
      console.log("[IBVAP] Live surveillance inference resumed: backend ONLINE");
      wasPausedForNetworkRef.current = false;
    }

    // Mark in-flight immediately before async encoding
    isInferenceInFlightRef.current = true;
    const seq = ++seqCounterRef.current;
    const isDebugLog = seq <= 3 || seq % 50 === 0;

    if (isDebugLog) {
      console.log(`[INFERENCE #${seq}] 1. tick | video=${vW}x${vH}`);
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = vW;
    tempCanvas.height = vH;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) {
      isInferenceInFlightRef.current = false;
      return;
    }

    tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    tempCanvas.toBlob(async (blob) => {
      if (!blob || blob.size < 100) {
        if (isDebugLog) console.warn(`[INFERENCE #${seq}] Empty blob generated`);
        isInferenceInFlightRef.current = false;
        return;
      }

      if (isDebugLog) {
        console.log(`[INFERENCE #${seq}] 2. blob generated: ${blob.size} bytes | dispatching detect-frame`);
      }

      const startTime = performance.now();
      const camId = (activeCamera as any).camera_id || activeCamera.id;

      try {
        const res = await ibvapApi.runWebcamInference(camId, blob, 0.25);
        if (!isMountedRef.current) return;

        const now = performance.now();
        const latency = Math.round(now - startTime);
        setInferenceLatency(latency);

        // Compute REAL rolling window inference FPS (5-second window)
        inferenceTimestampsRef.current.push(now);
        inferenceTimestampsRef.current = inferenceTimestampsRef.current.filter(t => now - t <= 5000);
        const windowSec = Math.min(5, Math.max(1, (now - inferenceTimestampsRef.current[0]) / 1000));
        const rollingFps = Math.max(1, Math.round(inferenceTimestampsRef.current.length / windowSec));
        setWebcamFPS(rollingFps);

        const dets = res.detections || [];
        const count = dets.length;
        setPersonCount(count);
        setRealDetections(dets);

        const vdets = res.vehicle_detections || [];
        setVehicleCount(vdets.length);
        setVehicleDetections(vdets);

        const suspActs = res.suspicious_activities || [];
        setSuspiciousActivities(suspActs);

        const nightMoves = res.night_movements || [];
        setNightMovements(nightMoves);

        const secEvents = res.security_events || [];
        if (secEvents.length > 0) {
          setLiveSecurityEvents(secEvents);
        }

        setRealTracks(dets.map((d: any) => ({
          track_id: d.track_id != null ? d.track_id : Math.floor(Math.random() * 1000),
          confidence_max: d.confidence,
          fine_class: d.class,
          face: d.face
        })));

        setLastDetectionTime(new Date().toLocaleTimeString());

        if (isDebugLog) {
          console.log(`[INFERENCE #${seq}] 3. response: ${latency}ms | persons=${count} vehicles=${vdets.length} susp=${suspActs.length} nm=${nightMoves.length} FPS=${rollingFps}`);
        }

        const hasCreatedIncidents = (res.incidents_created_count || 0) > 0;
        if (!hasCreatedIncidents) setEvidenceUploaded(false);

        if (hasCreatedIncidents) {
          setWebcamStatus('ALERT');
          const alertNow = Date.now();
          if (!isAlertingRef.current || (alertNow - lastAlertTimeRef.current > 30000)) {
            isAlertingRef.current = true;
            lastAlertTimeRef.current = alertNow;
            drawDetections(dets, vdets, suspActs, nightMoves);
            const incId = (res.incident_ids && res.incident_ids.length > 0) ? res.incident_ids[0] : undefined;
            setTimeout(() => captureAndUploadEvidence(count, dets, incId), 100);
          }
        } else if (count === 0) {
          setWebcamStatus('NO HUMAN DETECTED');
          isAlertingRef.current = false;
        } else {
          setWebcamStatus('NORMAL');
          isAlertingRef.current = false;
        }

        drawDetections(dets, vdets, suspActs, nightMoves);

      } catch (err) {
        console.warn(`[INFERENCE #${seq}] Frame inference failed:`, err);
      } finally {
        isInferenceInFlightRef.current = false;
      }
    }, 'image/jpeg', 0.85);
  }, [activeCamera, drawDetections, captureAndUploadEvidence, networkStatus]);

  // ── Fix Stale Closure for runFrameInference ───────────────────────────────
  const runFrameInferenceRef = useRef(runFrameInference);
  useEffect(() => {
    runFrameInferenceRef.current = runFrameInference;
  }, [runFrameInference]);

  // ── START / STOP LIVE TEST handlers ────────────────────────────────────────
  const handleStartLiveTest = async () => {
    setCameraError(null);
    setLiveTestStarted(true);
    // The useEffect on [liveTestStarted] will handle webcam + inference startup
    try {
      await ibvapApi.updateCameraInferenceAutoStart(activeCamera.id, true);
      updateCamera(activeCamera.id, { autoStartInference: true });
    } catch (err) {
      console.warn("Failed to persist auto-start preference in DB:", err);
    }
  };

  const handleStopLiveTest = async () => {
    setLiveTestStarted(false);
    stopWebcam();
    if (inferenceIntervalRef.current) {
      clearInterval(inferenceIntervalRef.current);
      inferenceIntervalRef.current = null;
    }
    setIsDetecting(false);
    setWebcamFPS(0);
    setInferenceLatency(0);
    inferenceTimestampsRef.current = [];
    setRealDetections([]);
    setRealTracks([]);
    setPersonCount(0);
    setVehicleCount(0);
    setVehicleDetections([]);
    setSuspiciousActivities([]);
    setNightMovements([]);
    setLiveSecurityEvents([]);
    setWebcamStatus('NO HUMAN DETECTED');

    setCameraError(null);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    try {
      await ibvapApi.updateCameraInferenceAutoStart(activeCamera.id, false);
      updateCamera(activeCamera.id, { autoStartInference: false });
    } catch (err) {
      console.warn("Failed to persist auto-start preference in DB:", err);
    }
  };


  // ── Full cleanup on component unmount ────────────────────────────────────
  // The feedSource useEffect already has a cleanup return, but this
  // unconditional cleanup covers any edge-case unmount path.
  useEffect(() => {
    return () => {
      if (inferenceIntervalRef.current) {
        clearInterval(inferenceIntervalRef.current);
        inferenceIntervalRef.current = null;
      }
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(t => t.stop());
        webcamStreamRef.current = null;
      }
    };
  }, []);

  // ── Animation Loop for Simulated/Uploaded Video Overlays ──────────────────
  // Removed requestAnimationFrame batch synchronization.
  // Bounding boxes are now rendered immediately upon the live frame HTTP response.

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeCamera) {
      stopWebcam();
      const url = URL.createObjectURL(file);
      setUploadedVideoUrl(url);
      setFeedSource('UPLOADED');
      if (videoRef.current && 'srcObject' in videoRef.current) {
        (videoRef.current as HTMLVideoElement).srcObject = null;
        (videoRef.current as HTMLVideoElement).src = url;
        (videoRef.current as HTMLVideoElement).play().catch(() => {});
      }
      try {
        const detectId = (activeCamera as any).camera_id || activeCamera.id;
        const uploadRes = await ibvapApi.uploadVideo(file, detectId);
        await ibvapApi.processCameraVideo(detectId, uploadRes.video_id);
        
        setIsDetecting(true);
        if (inferenceIntervalRef.current) {
          clearInterval(inferenceIntervalRef.current);
        }
        inferenceIntervalRef.current = setInterval(() => {
          if (runFrameInferenceRef.current) runFrameInferenceRef.current();
        }, 180);
      } catch (err: any) {
        console.warn('Failed to upload MP4:', err);
      }
    }
  };

  // runRealYoloDetection was fully removed in favor of real-time runFrameInference.

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
              onChange={(e) => handleSourceChange(e.target.value as any)}
            >
              <option value="WEBCAM">Real Live Webcam</option>
              <option value="SIMULATED">Simulated File Stream</option>
            </select>

             <span className={`px-2 py-0.5 rounded text-xs font-bold ${
               activeCamera.status?.toUpperCase() === 'ONLINE' ? 'bg-[#10B981]/10 text-[#10B981]' :
               activeCamera.status?.toUpperCase() === 'DEGRADED' ? 'bg-[#F59E0B]/10 text-[#F59E0B]' : 'bg-slate-100 text-slate-500'
             }`}>
               {activeCamera.status?.toUpperCase()}
             </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="px-4 py-2 bg-white border border-[var(--border-color)] hover:bg-slate-50 text-[var(--text-primary)] text-sm font-semibold rounded shadow-sm cursor-pointer transition-colors flex items-center gap-2">
            <Upload className="w-4 h-4" /> Upload MP4
            <input type="file" accept="video/mp4" onChange={handleFileUpload} className="hidden" />
          </label>
          <button
            onClick={liveTestStarted ? handleStopLiveTest : handleStartLiveTest}
            className={`px-5 py-2.5 text-white text-sm font-bold rounded-lg shadow-md flex items-center gap-2.5 transition-all duration-200 ${
              liveTestStarted
                ? 'bg-[#D92D20] hover:bg-[#b02017] shadow-red-200/50'
                : 'bg-[#1F5F8B] hover:bg-[#0F2742] shadow-sky-200/50'
            }`}
          >
            <Radio className={`w-4 h-4 ${liveTestStarted ? 'animate-pulse' : ''}`} />
            {liveTestStarted ? 'STOP LIVE TEST' : 'START LIVE TEST'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-[24px]">

        {/* Left: Main Video Viewport */}
        <div className="lg:w-[68%] flex flex-col gap-[24px]">
          <div className="relative bg-black rounded-lg overflow-hidden shadow-sm border border-[var(--border-color)]">
            
            {cameraError ? (
              <div className="w-full h-[550px] flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 p-6">
                <div className="w-16 h-16 rounded-full bg-orange-500/10 flex items-center justify-center mb-5 border border-orange-500/20">
                  <AlertTriangle className="w-8 h-8 text-orange-400" />
                </div>
                <span className="text-sm font-bold tracking-wider uppercase text-orange-400 text-center max-w-md">{cameraError}</span>
                <p className="text-xs text-slate-500 mt-2 text-center max-w-sm">Please check your camera connection and browser permissions, then try again.</p>
                <button
                  onClick={handleStartLiveTest}
                  className="mt-5 px-5 py-2 bg-[#1F5F8B] text-white rounded-lg text-xs font-bold hover:bg-[#0F2742] transition-colors shadow-md"
                >
                  RETRY
                </button>
              </div>
            ) : !liveTestStarted ? (
              /* ── STANDBY STATE: Camera OFF until user clicks START ── */
              <div className="w-full h-[550px] flex flex-col items-center justify-center bg-gradient-to-b from-slate-950 to-slate-900 p-6">
                <div className="w-20 h-20 rounded-full bg-slate-800/80 flex items-center justify-center mb-6 border border-slate-700/50 shadow-lg">
                  <CameraIcon className="w-9 h-9 text-slate-500" />
                </div>
                <h3 className="text-lg font-bold text-slate-300 tracking-wide mb-1">CAMERA STANDBY</h3>
                <p className="text-xs text-slate-500 mb-1 font-mono">
                  {(activeCamera as any).camera_id || activeCamera.id} • {activeCamera.sector}
                </p>
                <div className="flex items-center gap-2 mb-6">
                  <span className="w-2 h-2 rounded-full bg-slate-600"></span>
                  <span className="text-xs text-slate-500 font-semibold tracking-wider">CAMERA OFF</span>
                </div>
                <p className="text-xs text-slate-600 mb-5 text-center max-w-xs">
                  The camera is currently disabled. Click below to start the live surveillance feed and AI inference.
                </p>
                <button
                  onClick={handleStartLiveTest}
                  className="px-6 py-2.5 bg-[#1F5F8B] hover:bg-[#0F2742] text-white text-sm font-bold rounded-lg shadow-lg shadow-sky-900/30 transition-all duration-200 flex items-center gap-2.5 hover:scale-[1.02]"
                >
                  <Play className="w-4 h-4" />
                  START LIVE TEST
                </button>
              </div>
            ) : (() => {
              const simUrl = feedSource === 'SIMULATED' ? (ibvapApi.getVideoUrlForCamera(activeCamera) || '') : null;
              const isMjpeg = simUrl?.includes('/stream');
              return (
                <>
                  {isMjpeg ? (
                    <img
                      ref={(el) => { (videoRef as any).current = el; }}
                      src={simUrl || undefined}
                      className="w-full h-[550px] object-cover"
                      onError={() => setCameraError('RTSP stream unavailable — camera may be offline or unreachable.')}
                      alt="RTSP camera feed"
                    />
                  ) : (
                    <video
                      key={feedSource === 'UPLOADED' ? 'uploaded' : `${activeCameraId}_${simUrl || ''}`}
                      ref={(el) => { (videoRef as any).current = el; }}
                      src={feedSource === 'UPLOADED' && uploadedVideoUrl ? uploadedVideoUrl : (simUrl ?? undefined)}
                      crossOrigin="anonymous"
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-[550px] object-cover"
                    />
                  )}
                  <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />
                </>
              );
            })()}

            <div className="absolute top-4 left-4 flex gap-2 z-20">
              <span className="px-3 py-1.5 bg-black/70 backdrop-blur-sm text-white text-xs font-semibold rounded shadow-sm flex items-center gap-2 border border-white/10">
                <Radio className="w-3.5 h-3.5 text-[#D92D20] animate-pulse" /> LIVE STREAM
              </span>
              {(feedSource === 'WEBCAM' || realDetections.length > 0) && (
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
                {feedSource === 'WEBCAM' && webcamConnecting && (
                  <span className="text-yellow-400 animate-pulse">CONNECTING...</span>
                )}
                {feedSource === 'WEBCAM' && webcamActive && !webcamConnecting && (
                  <>
                    <span className="text-[#93C5FD]">WEBCAM ONLINE</span>
                    <span className={webcamFPS > 0 ? 'text-emerald-400' : 'text-slate-400'}>
                      {isDetecting ? `${webcamFPS} FPS` : 'IDLE'}
                    </span>
                    {isDetecting && <span className="text-slate-300">LATENCY: {inferenceLatency}ms</span>}
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
          {(feedSource === 'WEBCAM' || realDetections.length > 0) && (
            <div className={`p-[16px] rounded-lg border flex justify-between items-center text-sm font-semibold transition-all duration-300 ${
              webcamStatus === 'ALERT' ? 'bg-red-50 border-red-200 text-[#D92D20]' :
              webcamStatus === 'NORMAL' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
              'bg-slate-50 border-slate-200 text-slate-500'
            }`}>
              <div className="flex items-center gap-2">
                {webcamStatus === 'ALERT' ? <ShieldAlert className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                <span className="uppercase tracking-wide font-mono">
                  {webcamStatus === 'ALERT' ? 'UNKNOWN PERSON DETECTED — ALERT' :
                   (webcamStatus === 'NORMAL' && personCount > 0) ? `${personCount} PERSON${personCount !== 1 ? 'S' : ''} DETECTED — NORMAL` :
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
                      <span className="text-slate-500 font-semibold">VEHICLE COUNT</span>
                      <span className="font-bold text-amber-600">{vehicleCount}</span>
                    </div>
                    <div className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-100 rounded text-xs font-mono">
                      <span className="text-slate-500 font-semibold">AI INFERENCE</span>
                      <span className={`font-bold ${isDetecting ? 'text-emerald-500' : 'text-slate-400'}`}>
                        {isDetecting ? 'ACTIVE' : 'IDLE'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* UNIFIED SUBJECT INTELLIGENCE (Phase 4) */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                      Unified Subject Intelligence
                    </h3>
                    <span className="text-[11px] font-mono font-bold text-[#1F5F8B] bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                      {((liveSecurityEvents.length > 0
                        ? liveSecurityEvents
                        : securityEvents.filter(e => (e.camera_id === ((activeCamera as any).camera_id || activeCamera.id) || e.camera_id === activeCameraId) && e.status === 'active')
                      )).length} ACTIVE
                    </span>
                  </div>

                  {(() => {
                    const activeSubjectEvents = liveSecurityEvents.length > 0
                      ? liveSecurityEvents
                      : securityEvents.filter(e => (e.camera_id === ((activeCamera as any).camera_id || activeCamera.id) || e.camera_id === activeCameraId) && e.status === 'active');

                    if (activeSubjectEvents.length === 0) {
                      return (
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-500 font-mono text-center">
                          No correlated subjects currently active on this camera.
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        {activeSubjectEvents.map((ev: any) => {
                          const isHighOrCritical = ev.threat_level === 'high' || ev.threat_level === 'critical';
                          const isMedium = ev.threat_level === 'medium';
                          return (
                            <div
                              key={ev.event_id || ev.id}
                              className={`p-3.5 rounded-lg border transition-all ${
                                isHighOrCritical
                                  ? 'bg-red-50/70 border-red-200 shadow-sm'
                                  : isMedium
                                  ? 'bg-amber-50/70 border-amber-200 shadow-sm'
                                  : 'bg-slate-50 border-slate-200 shadow-sm'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-sm text-slate-900">
                                    {ev.track_label || `TRK#${ev.track_id}`}
                                  </span>
                                  <span className="text-slate-400">—</span>
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                    ev.face_info?.person_name
                                      ? 'bg-blue-100 text-blue-700'
                                      : ev.threat_reason?.includes('Unknown')
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-slate-200 text-slate-700'
                                  }`}>
                                    {ev.face_info?.person_name
                                      ? `KNOWN (${ev.face_info.person_name})`
                                      : ev.threat_reason?.includes('Unknown')
                                      ? 'UNKNOWN'
                                      : (ev.face_info?.identity_status || 'FACE_UNAVAILABLE')}
                                  </span>
                                </div>
                                <span className={`text-xs font-bold px-2.5 py-0.5 rounded uppercase font-mono ${
                                  ev.threat_level === 'critical'
                                    ? 'bg-[#D92D20] text-white animate-pulse'
                                    : ev.threat_level === 'high'
                                    ? 'bg-[#D92D20] text-white'
                                    : ev.threat_level === 'medium'
                                    ? 'bg-[#F59E0B] text-white'
                                    : 'bg-[#10B981] text-white'
                                }`}>
                                  THREAT: {ev.threat_level?.toUpperCase()}
                                </span>
                              </div>

                              <div className="mt-2 text-xs font-mono text-slate-600">
                                <span className="font-semibold text-slate-500">Camera: </span>
                                {ev.camera_name || ev.camera_id}
                              </div>

                              {ev.contributing_signals && ev.contributing_signals.length > 0 && (
                                <div className="mt-2">
                                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                    Signals:
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {ev.contributing_signals.map((sig: string, sIdx: number) => (
                                      <span
                                        key={sIdx}
                                        className="text-[11px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700"
                                      >
                                        • {sig.replace(/_/g, ' ')}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] font-mono text-slate-500">
                                <div>First: {ev.first_seen ? new Date(ev.first_seen).toLocaleTimeString() : 'N/A'}</div>
                                <div>Last: {ev.last_seen ? new Date(ev.last_seen).toLocaleTimeString() : 'N/A'}</div>
                              </div>

                              <div className="mt-2.5 flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                                  <span className="text-slate-400 font-medium">C2:</span>
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    c2Status?.enabled && c2Status.connected
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                      : c2Status?.enabled
                                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                      : 'bg-slate-100 text-slate-500 border border-slate-200'
                                  }`}>
                                    {c2Status?.enabled ? (c2Status.connected ? 'ACKNOWLEDGED' : 'PENDING') : 'NOT DISPATCHED'}
                                  </span>
                                </div>
                                <button
                                  onClick={() => setActivePage('sentinel-query')}
                                  className="px-3 py-1 bg-[#1F5F8B] hover:bg-[#0F2742] text-white text-xs font-bold rounded shadow-sm transition-colors cursor-pointer"
                                >
                                  Investigate
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {webcamStatus === 'ALERT' && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Active Alerts</h3>
                    <div className="p-3 bg-red-50 border border-red-100 rounded flex items-start gap-3 animate-pulse">
                      <AlertTriangle className="w-5 h-5 text-[#D92D20] shrink-0 mt-0.5" />
                      <div>
                        <div className="text-sm font-bold text-[#D92D20]">UNKNOWN PERSON DETECTED</div>
                        {evidenceUploaded ? (
                          <div className="text-xs text-[#D92D20]/80 mt-1">Automatic evidence captured and logged. Threat level: ALERT.</div>
                        ) : (
                          <div className="text-xs text-[#D92D20]/80 mt-1">Capturing evidence... Threat level: ALERT.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {suspiciousActivities.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Suspicious Behaviors</h3>
                    <div className="space-y-2">
                      {suspiciousActivities.map((s, idx) => (
                        <div key={idx} className="p-3 bg-amber-50 border border-amber-200 rounded flex items-start justify-between">
                          <div className="flex items-start gap-2.5">
                            <ShieldAlert className={`w-4 h-4 shrink-0 mt-0.5 ${s.severity === 'HIGH' ? 'text-red-600' : 'text-amber-600'}`} />
                            <div>
                              <div className="text-xs font-bold text-slate-800">
                                {s.activity_type.replace(/_/g, ' ')} · {s.track_label}
                              </div>
                              <div className="text-[11px] text-slate-600 mt-0.5">{s.description}</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end shrink-0 ml-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              s.severity === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {s.severity}
                            </span>
                            <span className="text-[11px] font-mono text-slate-600 mt-1">{s.duration_sec}s</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {nightMovements.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Night-Time Movements</h3>
                    <div className="space-y-2">
                      {nightMovements.map((n, idx) => (
                        <div key={idx} className="p-3 bg-sky-50 border border-sky-200 rounded flex items-start justify-between">
                          <div className="flex items-start gap-2.5">
                            <Activity className="w-4 h-4 shrink-0 mt-0.5 text-sky-600" />
                            <div>
                              <div className="text-xs font-bold text-slate-800">
                                NIGHT MOVEMENT · {n.track_label}
                              </div>
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                Luma: {n.avg_luma} · Dark: {(n.dark_pixel_ratio * 100).toFixed(1)}% · Disp: {n.displacement}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end shrink-0 ml-2">
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                              HIGH
                            </span>
                            <span className="text-[11px] font-mono text-slate-600 mt-1">Path: {n.path_length}</span>
                          </div>
                        </div>
                      ))}
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
                        <div className="flex flex-col">
                          <span className="font-semibold capitalize text-slate-800">
                            {d.class} {d.track_id != null ? `#TRK#${d.track_id}` : `#${i + 1}`}
                          </span>
                          {d.face && (
                            <span className={`text-[10px] mt-0.5 ${d.face.recognized ? 'text-blue-600 font-semibold' : 'text-slate-400'}`}>
                              {d.face.recognized
                                ? `👤 KNOWN · ${d.face.confidence_level || d.face.confidenceLevel || 'HIGH'}: ${d.face.name} (${Math.round(d.face.confidence * 100)}%)`
                                : '👤 UNKNOWN --'}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="font-bold text-[#10B981]">{(d.confidence * 100).toFixed(0)}%</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'tracking' && (
              <div className="space-y-2">
                {realTracks.length === 0 && vehicleDetections.length === 0 ? (
                  <div className="text-center text-sm text-[var(--text-muted)] py-8 font-mono">No active tracks.</div>
                ) : (
                  <>
                    {realTracks.map((t, idx) => (
                      <div key={idx} className="p-2.5 border border-slate-200 rounded bg-slate-50 space-y-1 font-mono text-xs">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-1">
                          <span className="font-bold text-[#1F5F8B]">TRACK-00{t.track_id}</span>
                          <span className="font-bold text-emerald-500">{(t.confidence_max * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>CLASS: {t.fine_class}</span>
                          <span>STATUS: ACTIVE</span>
                        </div>
                        {t.face && (
                          <div className={`text-[10px] pt-1 border-t border-slate-100 font-semibold ${t.face.recognized ? 'text-blue-600' : 'text-slate-400'}`}>
                            {t.face.recognized
                              ? `👤 KNOWN · ${t.face.confidence_level || t.face.confidenceLevel || 'HIGH'}: ${t.face.name} (${Math.round(t.face.confidence * 100)}%)`
                              : '👤 UNKNOWN --'}
                          </div>
                        )}
                      </div>
                    ))}
                    {vehicleDetections.map((vd, idx) => (
                      <div key={`v_${idx}`} className="p-2.5 border border-amber-200 rounded bg-amber-50/50 space-y-1 font-mono text-xs">
                        <div className="flex justify-between items-center border-b border-amber-100 pb-1">
                          <span className="font-bold text-amber-700">VTRK#{vd.track_id}</span>
                          <span className="font-bold text-amber-600">{Math.round(vd.confidence * 100)}%</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>CLASS: {vd.vehicle_class || 'Vehicle'}</span>
                          <span>DIR: {vd.direction}</span>
                        </div>
                        {vd.plate_text && (
                          <div className="flex justify-between items-center pt-1 border-t border-amber-100 mt-1">
                            <span className="font-bold text-slate-800 tracking-wider bg-white px-2 py-0.5 border border-slate-300 rounded shadow-xs">{vd.plate_text}</span>
                            <span className={`text-[10px] font-bold ${vd.format_valid ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {vd.plate_stable ? 'STABLE' : 'READING...'}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
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
                <div className="flex justify-between"><span>C2 Integration:</span> <span>{c2Status?.enabled ? (c2Status.connected ? 'Connected (Outbound Active)' : 'Enabled (Standby)') : 'Disabled (Autonomous Edge Mode)'}</span></div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
