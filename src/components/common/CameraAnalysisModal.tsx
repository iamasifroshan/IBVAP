import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Square, ShieldAlert, X, Crosshair, Shield, Zap, Clock, Loader2, AlertCircle, Car, User
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Camera } from '../../types';
import { ibvapApi } from '../../services/apiClient';
import { API_BASE_URL } from '../../services/apiConfig';

interface CameraAnalysisModalProps {
  camera: Camera;
  videoUrl: string;
  onClose: () => void;
}

type StageState = 'idle' | 'processing' | 'complete' | 'alert' | 'error';
interface PipelineStage { id: string; label: string; sublabel: string; state: StageState; }

interface TimelineEvent {
  type: 'detection' | 'vehicle' | 'zone_entry' | 'alert';
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

  const [status, setStatus] = useState<'READY' | 'ANALYZING' | 'HUMAN DETECTED' | 'VEHICLE DETECTED' | 'NO HUMANS DETECTED' | 'ERROR'>('READY');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [incidentFiled, setIncidentFiled] = useState(false);
  const [humansDetected, setHumansDetected] = useState(0);
  const [vehiclesDetected, setVehiclesDetected] = useState(0);
  const [tracksCount, setTracksCount] = useState(0);
  const [maxConfidence, setMaxConfidence] = useState<number | null>(null);
  const [framesAnalyzed, setFramesAnalyzed] = useState(0);
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('00:00');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [zonePolygon, setZonePolygon] = useState<ZonePolygon | null>(null);
  const [recognizedPersonName, setRecognizedPersonName] = useState<string | null>(null);
  const [isInferencing, setIsInferencing] = useState(false);

  const [stages, setStages] = useState<PipelineStage[]>([
    { id: 'detection',    label: 'DETECTION',    sublabel: 'YOLOv8 Classification', state: 'idle' },
    { id: 'zone',         label: 'ZONE CHECK',   sublabel: 'Persistent ID',         state: 'idle' },
    { id: 'smartalert',   label: 'SMARTALERT',   sublabel: 'Temporal Filter',       state: 'idle' },
    { id: 'borderthreat', label: 'BORDERTHREAT', sublabel: 'Explainable Score',     state: 'idle' },
    { id: 'evidence',     label: 'EVIDENCE',     sublabel: 'Local Storage',         state: 'idle' },
  ]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const inferenceIntervalRef = useRef<any>(null);
  const isInFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const realPersonsRef = useRef<any[]>([]);
  const realVehiclesRef = useRef<any[]>([]);
  const lastAlertTimeRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  // Ref to avoid stale closure in setInterval (mirrors LiveSurveillancePage pattern)
  const runFrameInferenceRef = useRef<() => void>(() => {});

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const setStageState = (id: string, state: StageState) =>
    setStages(prev => prev.map(s => s.id === id ? { ...s, state } : s));

  // Fetch zone polygon on mount specifically for this camera
  useEffect(() => {
    isMountedRef.current = true;
    const cameraId = (camera as any).camera_id || camera.id;
    const host = API_BASE_URL.replace('/api/v1', '').replace(/\/$/, '');
    fetch(`${host}/api/v1/zones`)
      .then(r => r.json())
      .then((zones: any[]) => {
        if (!isMountedRef.current) return;
        const zone = zones.find((z: any) =>
          z.camera_id === cameraId || z.camera_id === camera.id
        );
        if (zone?.polygon_coordinates?.length >= 3) {
          const raw = zone.polygon_coordinates as { x: number; y: number }[];
          const maxCoord = Math.max(...raw.map(p => Math.max(p.x, p.y)));
          const scale = maxCoord > 1.0 ? 100.0 : 1.0;
          setZonePolygon({
            name: zone.name || camera.activeZone || 'Restricted Zone',
            points: raw.map(p => ({ x: p.x / scale, y: p.y / scale })),
          });
        } else {
          setZonePolygon(null);
        }
      })
      .catch(() => {
        if (isMountedRef.current) setZonePolygon(null);
      });

    return () => {
      isMountedRef.current = false;
      if (inferenceIntervalRef.current) {
        clearInterval(inferenceIntervalRef.current);
        inferenceIntervalRef.current = null;
      }
    };
  }, [camera]);

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

    const persons = realPersonsRef.current;
    const vehicles = realVehiclesRef.current;

    // ── 1. Render all Person Bounding Boxes ───────────────────────────────────
    persons.forEach((det: any, idx: number) => {
      const bb = det.bounding_box || det.bbox;
      if (!bb) return;
      const bx = bb.x * W;
      const by = bb.y * H;
      const bw = bb.width * W;
      const bh = bb.height * H;
      if (bw < 2 || bh < 2) return;

      const tid = det.track_id;
      const yoloConf = Math.round((det.confidence || 0) * 100);
      const face = det.face;
      const identityStatus = det.identity_status || face?.identity_status || (face?.recognized ? 'KNOWN' : (det.face_detected ? 'UNKNOWN' : 'FACE_UNAVAILABLE'));

      let label = tid != null ? `TRK#${String(tid).padStart(4,'0')}` : `PERSON #${idx+1}`;
      let subLabel = `YOLO: ${yoloConf}%`;
      let isKnown = false;

      if (identityStatus === 'KNOWN' && (face?.recognized || det.recognized || det.person_name)) {
        const name = (det.person_name || face?.name || 'KNOWN').toUpperCase();
        const confLevel = face?.confidence_level || 'HIGH';
        const sfaceConf = Math.round((det.recognition_confidence || face?.recognition_confidence || face?.confidence || 0) * 100);
        label = `TRK#${tid ?? String(idx+1).padStart(4,'0')} · KNOWN (${confLevel})`;
        subLabel = `${name} · SFACE: ${sfaceConf}%`;
        isKnown = true;
      } else if (identityStatus === 'UNKNOWN' || det.face_detected) {
        const faceDetConf = Math.round((det.face_detection_confidence || face?.face_detection_confidence || 0) * 100);
        label = `TRK#${tid ?? String(idx+1).padStart(4,'0')} · UNKNOWN`;
        subLabel = faceDetConf > 0 ? `YUNET: ${faceDetConf}% · YOLO: ${yoloConf}%` : `YOLO: ${yoloConf}%`;
      } else if (identityStatus === 'FACE_PROCESSING_ERROR') {
        label = `TRK#${tid ?? String(idx+1).padStart(4,'0')} · FACE_ERROR`;
        subLabel = `YOLO: ${yoloConf}%`;
      } else {
        label = `TRK#${tid ?? String(idx+1).padStart(4,'0')} · FACE_UNAVAILABLE`;
        subLabel = `YOLO: ${yoloConf}%`;
      }

      ctx.save();
      const strokeColor = isKnown ? '#10B981' : '#E53E3E';
      const shadowColor = isKnown ? 'rgba(16,185,129,0.7)' : 'rgba(220,30,30,0.7)';
      const cornerColor = isKnown ? '#6EE7B7' : '#FC8181';
      const labelBg = isKnown ? 'rgba(16,185,129,0.92)' : 'rgba(197,30,30,0.92)';

      ctx.shadowBlur = 8;
      ctx.shadowColor = shadowColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur = 0;

      // Corner ticks
      const tick = Math.min(12, bw*0.15, bh*0.1);
      ctx.strokeStyle = cornerColor;
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
      const blockW = Math.max(lw1, lw2) + 14;
      const blockH = 32;
      const lx = Math.max(0, Math.min(bx, W - blockW));
      const ly = Math.max(0, by - blockH - 2);

      ctx.fillStyle = labelBg;
      ctx.fillRect(lx, ly, blockW, blockH);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(label, lx+6, ly+12);
      ctx.fillStyle = isKnown ? 'rgba(209,250,229,0.95)' : 'rgba(255,200,200,0.95)';
      ctx.font = '9px monospace';
      ctx.fillText(subLabel, lx+6, ly+25);
      ctx.restore();
    });

    // ── 2. Render all Vehicle Bounding Boxes (Amber) ───────────────────────────
    vehicles.forEach((det: any, idx: number) => {
      const bb = det.bounding_box || det.bbox;
      if (!bb) return;
      const bx = bb.x * W;
      const by = bb.y * H;
      const bw = bb.width * W;
      const bh = bb.height * H;
      if (bw < 2 || bh < 2) return;

      const vClass = (det.vehicle_class || det.class || 'vehicle').toUpperCase();
      const vTrack = det.track_label || (det.track_id != null ? `VTRK#${String(det.track_id).padStart(4,'0')}` : `VEHICLE #${idx+1}`);
      const vConf = Math.round((det.confidence || 0) * 100);

      const label = `${vTrack} · ${vClass}`;
      const subLabel = det.plate_text ? `PLATE: ${det.plate_text} · ${vConf}%` : `YOLO: ${vConf}%`;

      ctx.save();
      const strokeColor = '#F59E0B';
      const shadowColor = 'rgba(245,158,11,0.7)';
      const cornerColor = '#FDE68A';
      const labelBg = 'rgba(180,83,9,0.92)';

      ctx.shadowBlur = 8;
      ctx.shadowColor = shadowColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur = 0;

      const tick = Math.min(12, bw*0.15, bh*0.1);
      ctx.strokeStyle = cornerColor;
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
      const blockW = Math.max(lw1, lw2) + 14;
      const blockH = 32;
      const lx = Math.max(0, Math.min(bx, W - blockW));
      const ly = Math.max(0, by - blockH - 2);

      ctx.fillStyle = labelBg;
      ctx.fillRect(lx, ly, blockW, blockH);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(label, lx+6, ly+12);
      ctx.fillStyle = 'rgba(254,243,199,0.95)';
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
        const cTime = 'currentTime' in video ? (video as any).currentTime : ((Date.now() - startTimeRef.current) / 1000);
        const duration = 'duration' in video ? (video as any).duration : 1;
        setCurrentTimeStr(formatTime(cTime));
        setProgressPct((cTime / (duration || 1)) * 100);
      }
      drawOverlay();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawOverlay]);

  // ── Frame inference step ──────────────────────────────────────────────────
  // NOTE: every exit path resets isInFlightRef so the next tick is never blocked.
  const runFrameInference = useCallback(() => {
    console.log('[MODAL DEBUG] tick');
    const video = videoRef.current;
    if (!video || !isMountedRef.current) return;

    // Skip if a previous request is still in-flight
    if (isInFlightRef.current) {
      console.debug('[CAMERA_ANALYSIS] IN_FLIGHT_SKIP');
      return;
    }

    console.log(`[MODAL DEBUG] videoReady=${video.readyState}`);
    console.log(`[MODAL DEBUG] videoSize=${video.videoWidth}x${video.videoHeight}`);

    const W = (video as any).videoWidth ?? (video as any).naturalWidth ?? 0;
    const H = (video as any).videoHeight ?? (video as any).naturalHeight ?? 0;
    const camId = (camera as any).camera_id || camera.id;

    console.log(`[CAMERA_ANALYSIS] FRAME_CAPTURE_START cam=${camId} video=${W}x${H} readyState=${video.readyState}`);

    // Video must have at least one decoded frame and real dimensions
    if (
      (video instanceof HTMLVideoElement && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) ||
      W === 0 ||
      H === 0
    ) {
      // Try to resume playback if the video has stalled
      if (video instanceof HTMLVideoElement && video.paused && !video.ended) {
        video.play().catch(() => {});
      }
      return;
    }

    console.log('[MODAL DEBUG] captureStart');
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = W;
    tempCanvas.height = H;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    }
    console.log('[CAMERA_ANALYSIS] TO_BLOB_START');

    try {
      tempCanvas.toBlob(async (blob) => {
        if (!blob || blob.size < 100) {
          console.warn('[CAMERA_ANALYSIS] FRAME_CAPTURE_FAILED blob=null or too small');
          isInFlightRef.current = false;
          return;
        }
        if (!isMountedRef.current) {
          isInFlightRef.current = false;
          return;
        }

        console.log(`[MODAL DEBUG] blobSize=${blob.size}`);
        console.log(`[MODAL DEBUG] requestStart`);
        console.log(`[MODAL DEBUG] requestUrl=/api/v1/cameras/${camId}/detect-frame`);

        try {
          const res = await ibvapApi.runWebcamInference(camId, blob, 0.25);
          console.log(`[MODAL DEBUG] responseStatus=200`);
          console.log(`[MODAL DEBUG] responseBody=${JSON.stringify(res).substring(0, 200)}`);
          if (!isMountedRef.current) { isInFlightRef.current = false; return; }

          const persons = res.detections || [];
          const vehicles = res.vehicle_detections || [];

          console.log(`[CAMERA_ANALYSIS] RESPONSE_JSON_SUMMARY`, Object.keys(res).join(', '));
          console.log(`[CAMERA_ANALYSIS] RESPONSE_PARSED persons=${persons.length} vehicles=${vehicles.length} raw_persons_field_exists=${'detections' in res} raw_vehicles_field_exists=${'vehicle_detections' in res}`);
          
          if (persons.length === 0 && vehicles.length === 0) {
            console.log(`[CAMERA_ANALYSIS] RAW_PAYLOAD:`, JSON.stringify(res).substring(0, 500));
          }

          realPersonsRef.current = persons;
          realVehiclesRef.current = vehicles;

          const pCount = persons.length;
          const vCount = vehicles.length;
          setHumansDetected(pCount);
          setVehiclesDetected(vCount);

          const activeTrackIds = new Set<string>();
          persons.forEach((d: any) => { if (d.track_id != null) activeTrackIds.add(`P_${d.track_id}`); });
          vehicles.forEach((v: any) => { if (v.track_id != null) activeTrackIds.add(`V_${v.track_id}`); });
          setTracksCount(activeTrackIds.size || pCount + vCount);

          setFramesAnalyzed(prev => prev + 1);
          const elapsed = startTimeRef.current > 0 ? ((Date.now() - startTimeRef.current) / 1000).toFixed(1) : '0.0';
          setElapsedSec(parseFloat(elapsed));

          const confValues = [...persons.map((d: any) => d.confidence || 0), ...vehicles.map((v: any) => v.confidence || 0)];
          const maxC = confValues.length > 0 ? Math.max(...confValues) : null;
          setMaxConfidence(maxC);

          // Identify any recognized person (track-specific: only if that track's face matched)
          const recognizedPerson = (persons as any[]).find((d: any) =>
            d.identity_status === 'KNOWN' && (d.face?.recognized || d.recognized)
          );
          if (recognizedPerson) {
            const recName = (recognizedPerson as any).person_name || (recognizedPerson as any).face?.name || 'KNOWN';
            const recConf = Math.round((
              (recognizedPerson as any).recognition_confidence ||
              (recognizedPerson as any).face?.recognition_confidence ||
              (recognizedPerson as any).face?.confidence || 0
            ) * 100);
            setRecognizedPersonName(`${recName} (${recConf}%)`);
          } else {
            setRecognizedPersonName(null);
          }

          const hasIncidents = (res.incidents_created_count || 0) > 0;
          setStageState('detection', 'complete');
          setStageState('zone', hasIncidents ? 'alert' : 'complete');
          setStageState('smartalert', hasIncidents ? 'alert' : 'complete');
          setStageState('borderthreat', hasIncidents ? 'alert' : 'complete');
          setStageState('evidence', hasIncidents ? 'alert' : 'complete');

          if (pCount > 0) {
            setStatus('HUMAN DETECTED');
          } else if (vCount > 0) {
            setStatus('VEHICLE DETECTED');
          } else {
            setStatus('NO HUMANS DETECTED');
          }

          console.log('[MODAL DEBUG] stateUpdate');
          // Add timeline event (deduplicated within 1.5s)
          if (pCount > 0 || vCount > 0) {
            const vTime = 'currentTime' in video ? (video as any).currentTime : ((Date.now() - startTimeRef.current) / 1000);
            const timeLabel = formatTime(vTime || 0);
            const evType: 'detection' | 'vehicle' | 'alert' =
              hasIncidents ? 'alert' : (pCount > 0 ? 'detection' : 'vehicle');
            setTimeline(prev => {
              const last = prev[prev.length - 1];
              const desc = `${pCount} Human(s)${vCount > 0 ? `, ${vCount} Vehicle(s)` : ''} detected`;
              if (last && Math.abs(last.timestampSec - (vTime || 0)) < 1.5 && last.description === desc) {
                return prev;
              }
              return [...prev, {
                type: evType,
                timeStr: timeLabel,
                timestampSec: vTime || 0,
                trackId: persons[0]?.track_id || (vehicles[0] as any)?.track_id || null,
                description: desc,
                confidence: maxC || undefined,
              }].slice(-20);
            });
          }

          console.log('[MODAL DEBUG] inferenceComplete');

        } catch (err: any) {
          console.log(`[MODAL DEBUG] ERROR=${err?.message || err}`);
        } finally {
          isInFlightRef.current = false;
        }
      }, 'image/jpeg', 0.85);
    } catch (err: any) {
      console.error('[CAMERA_ANALYSIS] TO_BLOB_SYNC_ERROR: Canvas might be tainted', err);
      isInFlightRef.current = false;
    }
  }, [camera, zonePolygon]);

  // ── Keep ref in sync with latest closure (avoids stale interval) ──────────
  useEffect(() => {
    runFrameInferenceRef.current = runFrameInference;
  }, [runFrameInference]);

  const startAnalysis = () => {
    setErrorMessage('');
    setIncidentFiled(false);
    setStatus('ANALYZING');
    setIsInferencing(true);
    setTimeline([]);
    setFramesAnalyzed(0);
    setElapsedSec(0);
    realPersonsRef.current = [];
    realVehiclesRef.current = [];
    isInFlightRef.current = false; // ensure clean start
    startTimeRef.current = Date.now();
    setStages(prev => prev.map(s => ({ ...s, state: 'processing' })));

    const video = videoRef.current;
    if (video) {
      if ('currentTime' in video) {
        (video as any).currentTime = 0;
      }
      if (typeof (video as any).play === 'function') {
        (video as any).play().catch((e: any) => console.warn('[CAMERA_ANALYSIS] VIDEO_PLAY_REJECTED', e));
      }
    }

    // Always clear any existing interval before starting a new one
    if (inferenceIntervalRef.current) {
      clearInterval(inferenceIntervalRef.current);
      inferenceIntervalRef.current = null;
    }

    console.log('[CAMERA_ANALYSIS] MODAL_OPEN inference started');
    // Use ref to avoid stale closure — mirrors LiveSurveillancePage pattern
    inferenceIntervalRef.current = setInterval(() => {
      console.log('[CAMERA_ANALYSIS] INTERVAL_TICK');
      runFrameInferenceRef.current();
    }, 300); // 300ms ≈ ~3fps, reliable and avoids request flooding
  };

  const stopAnalysis = () => {
    if (inferenceIntervalRef.current) {
      clearInterval(inferenceIntervalRef.current);
      inferenceIntervalRef.current = null;
    }
    setIsInferencing(false);
    setStatus('READY');
    realPersonsRef.current = [];
    realVehiclesRef.current = [];
    setHumansDetected(0);
    setVehiclesDetected(0);
    setTracksCount(0);
    setMaxConfidence(null);
    setRecognizedPersonName(null);
    setTimeline([]);
    setStages(prev => prev.map(s => ({ ...s, state: 'idle' })));
    if (videoRef.current) {
      if (typeof (videoRef.current as any).pause === 'function') {
        (videoRef.current as any).pause();
      }
      if ('currentTime' in videoRef.current) {
        (videoRef.current as any).currentTime = 0;
      }
    }
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleFileIncident = () => {
    if (incidentFiled) return;
    setIncidentFiled(true);
    addIncident({
      id: `INC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
      sector: camera.sector,
      cameraName: camera.name,
      cameraId: (camera as any).camera_id || camera.id,
      outpost: camera.outpost,
      objectType: humansDetected > 0 ? 'human' : 'vehicle',
      persistentId: `MANUAL-${Date.now()}`,
      threatScore: 85,
      severity: 'high',
      explainableReason: `${humansDetected} human(s) and ${vehiclesDetected} vehicle(s) manually verified at ${currentTimeStr}.`,
      environmentalCondition: 'normal',
      aiReliability: camera.aiReliability || 92,
      visibilityScore: camera.visibilityScore || 85,
      status: 'active',
      snapshotUrl: '',
      zoneName: zonePolygon?.name || camera.activeZone || 'Restricted Zone',
      loiteringDurationSec: 0,
      speedKmh: 0,
      direction: 'Unknown',
      smartAlertConfirmed: false,
      syncedToCloud: false,
      threatFactors: [{ category: 'Manual Operator Verification', scoreContribution: 95, description: 'Object verified by operator' }],
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
    idle: 'IDLE', processing: 'PROCESSING', complete: 'COMPLETE', alert: 'ALERT', error: 'ERROR'
  };
  const timelineColorMap: Record<string, string> = {
    detection:  'text-[#1F5F8B] bg-blue-50 border-blue-200',
    vehicle:    'text-amber-700 bg-amber-50 border-amber-200',
    zone_entry: 'text-amber-700 bg-amber-50 border-amber-200',
    alert:      'text-[#D92D20] bg-red-50 border-red-200',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-3">
      <div className={`bg-white w-full max-w-[1300px] rounded-xl shadow-2xl flex flex-col border-2 overflow-hidden transition-colors duration-300 ${
        status === 'HUMAN DETECTED' ? 'border-[#D92D20]' :
        status === 'VEHICLE DETECTED' ? 'border-amber-500' :
        status === 'ERROR' ? 'border-orange-300' : 'border-[#1F5F8B]/30'
      }`} style={{ maxHeight: '94vh' }}>

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1F5F8B]/10 flex items-center justify-center text-[#1F5F8B]">
              <Crosshair className="w-4.5 h-4.5 text-[#1F5F8B]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-heading font-bold text-base text-slate-900 tracking-wide uppercase">CAMERA ANALYSIS</span>
                <span className="text-slate-300">|</span>
                <span className="text-xs font-mono font-bold text-[#1F5F8B]">{(camera as any).camera_id || camera.id}</span>
              </div>
              <p className="text-[12px] text-slate-500 font-body">{camera.name} · {camera.sector} · {camera.outpost}</p>
            </div>
          </div>
          <button
            onClick={() => { stopAnalysis(); onClose(); }}
            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 5-Stage Pipeline Status Blocks */}
        <div className="px-5 py-2.5 bg-slate-100/70 border-b border-slate-200 grid grid-cols-5 gap-2 shrink-0">
          {stages.map(st => {
            const sc = stageColors[st.state] || stageColors.idle;
            return (
              <div key={st.id} className={`px-2.5 py-1.5 rounded-lg border flex flex-col justify-between ${sc.bg} ${sc.border}`}>
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="text-[10px] font-bold text-slate-700 tracking-wide">{st.label}</span>
                  <div className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${st.state === 'processing' ? 'animate-ping' : ''}`} />
                    <span className={`text-[8px] font-bold uppercase ${sc.text}`}>{stageLabelMap[st.state]}</span>
                  </div>
                </div>
                <div className="text-[9px] text-slate-500 truncate">{st.sublabel}</div>
              </div>
            );
          })}
        </div>

        {/* Main Body */}
        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">

          {/* Video + Canvas */}
          <div className="lg:w-[70%] bg-black relative flex items-center justify-center shrink-0" style={{ minHeight: '380px' }}>
            {videoUrl && videoUrl.includes('/stream') ? (
              <img
                ref={(el) => {
                  if (el) (videoRef as any).current = el; // Hack to allow canvas drawImage
                }}
                src={videoUrl}
                crossOrigin="anonymous"
                className="w-full h-full object-contain"
                style={{ maxHeight: '500px' }}
                onError={(e) => {
                  setErrorMessage(`Camera stream unavailable: ${videoUrl}`);
                  setStatus('ERROR');
                }}
              />
            ) : (
              <video
                ref={(el) => {
                  (videoRef as any).current = el;
                  if (el && !(el as any)._listenersAttached) {
                    (el as any)._listenersAttached = true;
                    const logEvent = (e: Event) => {
                      console.log(`[VIDEO_EVENT] ${e.type}`, {
                        networkState: el.networkState,
                        readyState: el.readyState,
                        currentSrc: el.currentSrc,
                        videoWidth: el.videoWidth,
                        videoHeight: el.videoHeight,
                        error: el.error ? { code: el.error.code, message: el.error.message } : null
                      });
                    };
                    ['loadstart','loadedmetadata','loadeddata','canplay','canplaythrough','play','error','abort','stalled','suspend','emptied'].forEach(evt => {
                      el.addEventListener(evt, logEvent);
                    });
                  }
                }}
                src={videoUrl ? `${videoUrl}?cors=1` : undefined}
                crossOrigin="anonymous"
                className="w-full h-full object-contain"
                style={{ maxHeight: '500px' }}
                autoPlay muted loop playsInline preload="auto"
                onError={(e) => {
                  const target = e.target as HTMLVideoElement;
                  setErrorMessage(`Video failed to load: ${videoUrl}`);
                  setStatus('ERROR');
                }}
              />
            )}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

            {status === 'ANALYZING' && framesAnalyzed === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                <Loader2 className="w-12 h-12 text-[#60A5FA] animate-spin mb-3" />
                <span className="text-white font-bold tracking-widest text-sm">Initializing YOLO + ByteTrack + SFace…</span>
                <span className="text-slate-300 text-xs mt-2 font-mono">Running live continuous frame inference</span>
              </div>
            )}

            <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-2.5 py-1 bg-black/70 rounded text-[10px] font-mono border border-white/10">
                <span className={`w-1.5 h-1.5 rounded-full ${isInferencing ? 'bg-[#10B981] animate-pulse' : 'bg-slate-400'}`} />
                <span className="text-white font-semibold">{(camera as any).camera_id || camera.id}</span>
              </div>
              {zonePolygon && (
                <div className="px-2.5 py-1 bg-black/60 text-[9px] font-mono text-cyan-300 rounded border border-cyan-500/30">
                  ZONE ACTIVE: {zonePolygon.name.toUpperCase()}
                </div>
              )}
            </div>

            {(humansDetected > 0 || vehiclesDetected > 0) && (
              <div className="absolute bottom-3 right-3 bg-black/85 text-white rounded p-2 text-[10px] font-mono space-y-0.5 border border-white/20 z-10 shadow-lg">
                <div><span className="text-slate-400">HUMANS:</span> <span className="text-[#FC8181] font-bold">{humansDetected}</span></div>
                <div><span className="text-slate-400">VEHICLES:</span> <span className="text-[#FDE68A] font-bold">{vehiclesDetected}</span></div>
                <div><span className="text-slate-400">TRACKS:</span> <span className="text-[#93C5FD] font-bold">{tracksCount}</span></div>
                {maxConfidence !== null && <div><span className="text-slate-400">MAX YOLO:</span> <span className="text-emerald-400 font-bold">{Math.round(maxConfidence*100)}%</span></div>}
                {elapsedSec !== null && <div><span className="text-slate-400">ELAPSED:</span> <span className="font-bold">{elapsedSec}s</span></div>}
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="lg:w-[30%] border-l border-slate-200 flex flex-col bg-white overflow-hidden">

            {/* Status */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 shrink-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">System Status</div>
              <div className={`px-3 py-2 rounded-lg border font-bold text-xs tracking-wide text-center uppercase transition-colors duration-200 ${
                status === 'READY'              ? 'bg-slate-100 text-slate-500 border-slate-200' :
                status === 'ANALYZING'          ? 'bg-blue-50 text-[#1F5F8B] border-blue-200 animate-pulse' :
                status === 'HUMAN DETECTED'     ? 'bg-red-50 text-[#D92D20] border-red-200' :
                status === 'VEHICLE DETECTED'   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                status === 'NO HUMANS DETECTED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                  'bg-orange-50 text-orange-700 border-orange-200'
              }`}>{status}</div>

              {recognizedPersonName && (
                <div className="mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded flex items-center justify-between text-[11px]">
                  <span className="text-emerald-800 font-bold flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-emerald-600" /> KNOWN MATCH:
                  </span>
                  <span className="text-emerald-700 font-mono font-bold">{recognizedPersonName}</span>
                </div>
              )}

              {status === 'ERROR' && errorMessage && (
                <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-[10px] text-orange-700 flex gap-1.5">
                  <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span className="break-all">{errorMessage}</span>
                </div>
              )}
            </div>

            {/* Stats (4-grid: Humans, Vehicles, Tracks, Max Conf) */}
            <div className="p-3 border-b border-slate-100 shrink-0">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-red-50 border border-red-100 rounded-lg p-2">
                  <div className="text-2xl font-bold text-[#D92D20]">{humansDetected}</div>
                  <div className="text-[9px] text-[#D92D20]/70 font-semibold uppercase">Humans</div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-2">
                  <div className="text-2xl font-bold text-amber-700">{vehiclesDetected}</div>
                  <div className="text-[9px] text-amber-700/70 font-semibold uppercase">Vehicles</div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-2">
                  <div className="text-2xl font-bold text-[#1F5F8B]">{tracksCount}</div>
                  <div className="text-[9px] text-[#1F5F8B]/70 font-semibold uppercase">Tracks</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2">
                  <div className="text-lg font-bold text-emerald-700">
                    {maxConfidence !== null ? `${Math.round(maxConfidence*100)}%` : '—'}
                  </div>
                  <div className="text-[9px] text-emerald-700/70 font-semibold uppercase">Max YOLO Conf</div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto p-3">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Detection Timeline
              </div>
              {timeline.length === 0 ? (
                <div className="text-[11px] text-slate-400 italic py-2">
                  {status === 'READY' ? 'Click Run YOLO Inference to start real-time analysis.' :
                   status === 'ANALYZING' ? 'Processing live feed…' : 'No events recorded.'}
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
                          {ev.type === 'vehicle' && '🚗 '}
                          {ev.type === 'zone_entry' && '⚠ '}
                          {ev.type === 'alert' && '🔴 '}
                          {ev.description}
                        </span>
                        <span className="font-mono shrink-0 font-bold">{ev.timeStr}</span>
                      </div>
                      {ev.trackId != null && <div className="text-[9px] opacity-70 mt-0.5">Track #{String(ev.trackId).padStart(4,'0')}</div>}
                      {ev.confidence != null && <div className="text-[9px] opacity-70">Conf: {Math.round(ev.confidence*100)}%</div>}
                      {ev.zoneName && <div className="text-[9px] opacity-70 font-semibold">{ev.zoneName}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="p-3 border-t border-slate-200 space-y-2 shrink-0 bg-slate-50">
              {humansDetected > 0 && (
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
                disabled={isInferencing}
                className="w-full py-2.5 bg-[#1F5F8B] hover:bg-[#0F2742] text-white font-bold rounded text-xs tracking-wider uppercase flex justify-center items-center gap-2 disabled:opacity-50"
              >
                {isInferencing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing Feed…</>
                  : <><Zap className="w-4 h-4" /> Run YOLO Inference</>}
              </button>
              <button
                onClick={stopAnalysis}
                disabled={status === 'READY' && !isInferencing}
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
              {framesAnalyzed} frames analyzed · {elapsedSec}s elapsed
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
