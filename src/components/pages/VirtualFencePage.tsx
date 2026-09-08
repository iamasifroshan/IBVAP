import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Maximize2, Save, Plus, Edit3, Trash2, MousePointer, Crosshair,
  Camera, Shield, AlertTriangle, Check, X, ToggleLeft, ToggleRight,
  Minus, ChevronRight, MapPin, Clock, RefreshCw, Layers
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ibvapApi } from '../../services/apiClient';
import { VirtualZone } from '../../types';

// ── Centralized Timestamp Formatter (IST) ─────────────────────────────────
const formatTimestamp = (raw: string | Date | undefined | null): string => {
  if (!raw) return '—';
  try {
    const date = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(date.getTime())) return String(raw);
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'Asia/Kolkata', timeZoneName: 'short'
    }).format(date);
  } catch { return String(raw); }
};

type ZoneDrawType = 'restricted_fence' | 'buffer_zone' | 'outpost_perimeter';
type DrawMode = 'none' | 'draw-zone' | 'draw-fence' | 'edit';

interface ZoneOverlay {
  id: string;
  name: string;
  type: ZoneDrawType;
  points: { x: number; y: number }[];
  cameraId: string;
  sector: string;
  active: boolean;
  sensitivity: number;
  loiteringLimitSec: number;
  minThreatThreshold: number;
  createdAt?: string;
  updatedAt?: string;
  // Detection rules
  humanDetection: boolean;
  vehicleDetection: boolean;
  animalDetection: boolean;
  personThreshold: number;
  alertSeverity: 'critical' | 'high' | 'medium' | 'low';
}

const ZONE_COLORS: Record<ZoneDrawType, { fill: string; stroke: string; label: string }> = {
  restricted_fence: { fill: 'rgba(217, 45, 32, 0.12)', stroke: '#D92D20', label: 'RESTRICTED ZONE' },
  buffer_zone:      { fill: 'rgba(245, 158, 11, 0.12)', stroke: '#F59E0B', label: 'WARNING ZONE' },
  outpost_perimeter:{ fill: 'rgba(0, 200, 200, 0.10)',  stroke: '#06B6D4', label: 'SAFE ZONE' },
};

export const VirtualFencePage: React.FC = () => {
  const { cameras, zones: appZones } = useApp();

  // Page state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<ZoneOverlay[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState(cameras[0]?.id || 'BORDER-CAM-07');
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [newZoneType, setNewZoneType] = useState<ZoneDrawType>('restricted_fence');
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragPointIdx, setDragPointIdx] = useState<number | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const selectedCamera = cameras.find(c => c.id === selectedCameraId) || cameras[0];
  const selectedZone = overlays.find(z => z.id === selectedZoneId) || null;

  // ── Load zones from backend ────────────────────────────────────────────────
  const loadZones = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const backendZones = await ibvapApi.getZones();
      const mapped: ZoneOverlay[] = (backendZones || []).map((z: any) => ({
        id: z.id,
        name: z.name,
        type: z.type || z.zone_type || 'restricted_fence',
        points: z.points || z.polygon_coordinates || [
          { x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 80 }, { x: 10, y: 80 }
        ],
        cameraId: z.camera_id || z.cameraId || 'BORDER-CAM-07',
        sector: z.sector || 'Sector B',
        active: z.active !== undefined ? z.active : (z.enabled !== undefined ? z.enabled : true),
        sensitivity: z.sensitivity || 90,
        loiteringLimitSec: z.loiteringLimitSec || z.loitering_limit_sec || 15,
        minThreatThreshold: z.minThreatThreshold || z.min_threat_threshold || 60,
        createdAt: z.created_at || z.createdAt || new Date().toISOString(),
        updatedAt: z.updated_at || z.updatedAt || new Date().toISOString(),
        humanDetection: true,
        vehicleDetection: false,
        animalDetection: false,
        personThreshold: 1,
        alertSeverity: z.severity || (z.type === 'restricted_fence' ? 'critical' : z.type === 'buffer_zone' ? 'high' : 'medium'),
      }));
      setOverlays(mapped);
      if (mapped.length > 0 && !selectedZoneId) {
        setSelectedZoneId(mapped[0].id);
      }
    } catch (err: any) {
      console.warn('Failed to load zones:', err);
      setError('Unable to load zone configuration.');
    } finally {
      setLoading(false);
    }
  }, [selectedZoneId]);

  useEffect(() => { loadZones(); }, []);

  // ── Canvas click handler (draw mode) ───────────────────────────────────────
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drawMode === 'none' || drawMode === 'edit') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setDrawingPoints(prev => [...prev, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }]);
  };

  // ── Finish drawing and show name dialog ────────────────────────────────────
  const finishDrawing = () => {
    if (drawingPoints.length < 3) return;
    setShowCreateDialog(true);
  };

  // ── Save new zone ──────────────────────────────────────────────────────────
  const saveNewZone = async () => {
    if (!newZoneName.trim()) return;
    setSaving(true);
    const newZone: ZoneOverlay = {
      id: `ZONE-${Date.now()}`,
      name: newZoneName.trim(),
      type: newZoneType,
      points: drawingPoints,
      cameraId: selectedCameraId,
      sector: selectedCamera?.sector || 'Sector B',
      active: true,
      sensitivity: 90,
      loiteringLimitSec: 15,
      minThreatThreshold: 60,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      humanDetection: true,
      vehicleDetection: false,
      animalDetection: false,
      personThreshold: 1,
      alertSeverity: newZoneType === 'restricted_fence' ? 'critical' : newZoneType === 'buffer_zone' ? 'high' : 'medium',
    };

    try {
      await ibvapApi.createZone({
        name: newZone.name,
        sector: newZone.sector,
        type: newZone.type,
        sensitivity: newZone.sensitivity,
        minThreatThreshold: newZone.minThreatThreshold,
        loiteringLimitSec: newZone.loiteringLimitSec,
        active: true,
        points: newZone.points,
      });
    } catch { /* continue with local state */ }

    setOverlays(prev => [...prev, newZone]);
    setSelectedZoneId(newZone.id);
    setDrawingPoints([]);
    setDrawMode('none');
    setShowCreateDialog(false);
    setNewZoneName('');
    setSaving(false);
  };

  // ── Delete zone ────────────────────────────────────────────────────────────
  const confirmDeleteZone = async (id: string) => {
    try { await ibvapApi.deleteZone(id); } catch { /* continue locally */ }
    setOverlays(prev => prev.filter(z => z.id !== id));
    if (selectedZoneId === id) setSelectedZoneId(overlays.find(z => z.id !== id)?.id || null);
    setDeleteConfirmId(null);
  };

  // ── Save existing zones changes ─────────────────────────────────────────────
  const saveChanges = async () => {
    setSaving(true);
    try {
      await Promise.all(
        overlays.map(async (zone) => {
          await ibvapApi.updateZone(zone.id, {
            id: zone.id,
            name: zone.name,
            sector: zone.sector,
            type: zone.type,
            sensitivity: zone.sensitivity,
            minThreatThreshold: zone.minThreatThreshold,
            loiteringLimitSec: zone.loiteringLimitSec,
            active: zone.active,
            points: zone.points,
            humanDetection: zone.humanDetection,
            vehicleDetection: zone.vehicleDetection,
            animalDetection: zone.animalDetection,
            personThreshold: zone.personThreshold,
            alertSeverity: zone.alertSeverity,
          } as any);
        })
      );
      await loadZones();
    } catch (err) {
      console.warn('Failed to save zones:', err);
    } finally {
      setSaving(false);
    }
  };

  // ── Edit mode: drag points ─────────────────────────────────────────────────
  const handleMouseDown = (zoneId: string, pointIdx: number) => {
    if (drawMode !== 'edit') return;
    setSelectedZoneId(zoneId);
    setDragPointIdx(pointIdx);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drawMode !== 'edit' || dragPointIdx === null || !selectedZoneId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    setOverlays(prev => prev.map(z => {
      if (z.id !== selectedZoneId) return z;
      const pts = [...z.points];
      pts[dragPointIdx] = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
      return { ...z, points: pts, updatedAt: new Date().toISOString() };
    }));
  };

  const handleMouseUp = () => { setDragPointIdx(null); };

  // ── Update detection rule toggle ───────────────────────────────────────────
  const toggleDetectionRule = (field: 'humanDetection' | 'vehicleDetection' | 'animalDetection') => {
    if (!selectedZoneId) return;
    setOverlays(prev => prev.map(z =>
      z.id === selectedZoneId ? { ...z, [field]: !z[field], updatedAt: new Date().toISOString() } : z
    ));
  };

  const adjustThreshold = (delta: number) => {
    if (!selectedZoneId) return;
    setOverlays(prev => prev.map(z =>
      z.id === selectedZoneId ? { ...z, personThreshold: Math.max(1, Math.min(10, z.personThreshold + delta)), updatedAt: new Date().toISOString() } : z
    ));
  };

  // ── Camera zones filtered ──────────────────────────────────────────────────
  const cameraZones = overlays.filter(z => z.cameraId === selectedCameraId || z.cameraId === selectedCamera?.id);

  // ── Video source ───────────────────────────────────────────────────────────
  const videoSrc = ibvapApi.getVideoUrlForCamera?.(selectedCamera) || selectedCamera?.streamUrl || '';

  // ── Severity color helper ──────────────────────────────────────────────────
  const severityColor = (s: string) => {
    if (s === 'critical') return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' };
    if (s === 'high') return { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' };
    if (s === 'medium') return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' };
    return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' };
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-[24px]">

      {/* ── HEADER ──────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl sm:text-2xl lg:text-[28px] font-bold text-[#0B1F33] tracking-tight">Zones & Virtual Fence</h1>
          <p className="text-[13px] sm:text-[14px] text-slate-500 mt-1 font-body">
            Configure, monitor, and manage restricted surveillance zones and AI-powered virtual fence boundaries.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setDrawMode('draw-zone'); setDrawingPoints([]); setNewZoneType('restricted_fence'); }}
            className="px-4 py-2.5 bg-[#1F5F8B] hover:bg-[#0F2742] text-white text-[13px] font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" /> Create Zone
          </button>
          <button
            onClick={saveChanges}
            disabled={saving}
            className="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-[#0B1F33] text-[13px] font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
          </button>
        </div>
      </div>

      {/* ── ERROR STATE ─────────────────────────────────────────── */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span className="text-red-700 text-sm font-medium">{error}</span>
          <button onClick={loadZones} className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold rounded transition-colors flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      )}

      {/* ── LOADING STATE ───────────────────────────────────────── */}
      {loading && !error && (
        <div className="p-8 bg-white border border-slate-200 rounded-lg text-center">
          <div className="inline-block w-6 h-6 border-2 border-[#1F5F8B] border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-500 font-medium">Loading zone configuration...</p>
        </div>
      )}

      {/* ── MAIN CONTENT ────────────────────────────────────────── */}
      {!loading && (
        <div className="flex flex-col lg:flex-row gap-[20px]">

          {/* ── LEFT COLUMN (70%) ─────────────────────────────────── */}
          <div className="lg:w-[70%] flex flex-col gap-[20px]">

            {/* Zone Configuration Canvas Card */}
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">

              {/* Canvas Header / Toolbar */}
              <div className="px-[16px] py-[12px] border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">Camera:</span>
                  <select
                    className="bg-white border border-slate-200 text-[#0B1F33] rounded px-3 py-1.5 text-[13px] font-semibold focus:outline-none focus:border-[#1F5F8B] shadow-sm"
                    value={selectedCameraId}
                    onChange={(e) => { setSelectedCameraId(e.target.value); setDrawMode('none'); setDrawingPoints([]); }}
                  >
                    {cameras.map(cam => (
                      <option key={cam.id} value={cam.id}>{cam.name} — {cam.sector}</option>
                    ))}
                  </select>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${
                    selectedCamera?.status === 'online'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}>
                    ● {selectedCamera?.status?.toUpperCase() || 'UNKNOWN'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {[
                    { mode: 'draw-zone' as DrawMode, icon: <Crosshair className="w-3.5 h-3.5" />, label: 'Draw Zone' },
                    { mode: 'draw-fence' as DrawMode, icon: <Layers className="w-3.5 h-3.5" />, label: 'Draw Fence' },
                    { mode: 'edit' as DrawMode, icon: <Edit3 className="w-3.5 h-3.5" />, label: 'Edit' },
                  ].map(btn => (
                    <button
                      key={btn.mode}
                      onClick={() => {
                        if (drawMode === btn.mode) { setDrawMode('none'); setDrawingPoints([]); }
                        else { setDrawMode(btn.mode); setDrawingPoints([]); if (btn.mode === 'draw-fence') setNewZoneType('outpost_perimeter'); }
                      }}
                      className={`px-3 py-1.5 text-[11px] font-semibold rounded border flex items-center gap-1.5 transition-colors ${
                        drawMode === btn.mode
                          ? 'bg-[#1F5F8B] text-white border-[#1F5F8B]'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-[#1F5F8B] hover:text-[#1F5F8B]'
                      }`}
                    >
                      {btn.icon} {btn.label}
                    </button>
                  ))}
                  <button
                    onClick={() => { if (selectedZoneId) setDeleteConfirmId(selectedZoneId); }}
                    disabled={!selectedZoneId}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded border bg-white text-red-500 border-slate-200 hover:border-red-300 hover:bg-red-50 flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>

              {/* Draw mode instructions */}
              {drawMode !== 'none' && (
                <div className={`px-[16px] py-[8px] text-[12px] font-semibold flex items-center justify-between ${
                  drawMode === 'edit' ? 'bg-amber-50 text-amber-700 border-b border-amber-100' : 'bg-cyan-50 text-cyan-700 border-b border-cyan-100'
                }`}>
                  <span>
                    {drawMode === 'edit'
                      ? '🖱 EDIT MODE — Drag anchor points to reposition zone vertices.'
                      : `🖱 DRAWING MODE — Click on the camera view to place polygon points. (${drawingPoints.length} point${drawingPoints.length !== 1 ? 's' : ''} placed)`
                    }
                  </span>
                  <div className="flex items-center gap-2">
                    {drawMode !== 'edit' && drawingPoints.length >= 3 && (
                      <button onClick={finishDrawing} className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold rounded transition-colors">
                        ✓ Finish
                      </button>
                    )}
                    {drawMode !== 'edit' && (
                      <select
                        value={newZoneType}
                        onChange={(e) => setNewZoneType(e.target.value as ZoneDrawType)}
                        className="text-[10px] px-2 py-1 border border-cyan-200 rounded bg-white text-cyan-700 font-bold"
                      >
                        <option value="restricted_fence">Restricted</option>
                        <option value="buffer_zone">Warning</option>
                        <option value="outpost_perimeter">Safe / Fence</option>
                      </select>
                    )}
                    <button
                      onClick={() => { setDrawMode('none'); setDrawingPoints([]); }}
                      className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-600 text-[10px] font-bold rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Camera Viewport + Zone Overlays */}
              <div
                ref={canvasRef}
                className="relative bg-[#0A0F1A] select-none"
                style={{ cursor: drawMode === 'draw-zone' || drawMode === 'draw-fence' ? 'crosshair' : drawMode === 'edit' ? 'grab' : 'default' }}
                onClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <video
                  src={videoSrc}
                  autoPlay loop muted playsInline
                  className="w-full object-cover opacity-80"
                  style={{ height: '460px' }}
                />

                {/* SVG Zone Overlays */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {cameraZones.map(zone => {
                    const cfg = ZONE_COLORS[zone.type] || ZONE_COLORS.restricted_fence;
                    const pts = zone.points.map(p => `${p.x},${p.y}`).join(' ');
                    const isSelected = zone.id === selectedZoneId;
                    return (
                      <g key={zone.id}>
                        <polygon
                          points={pts}
                          fill={cfg.fill}
                          stroke={isSelected ? '#FFFFFF' : cfg.stroke}
                          strokeWidth={isSelected ? '0.6' : '0.35'}
                          strokeDasharray={zone.type === 'outpost_perimeter' ? '1.5 1' : 'none'}
                          style={{ pointerEvents: 'all', cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); setSelectedZoneId(zone.id); }}
                        />
                        {/* Zone label */}
                        <text
                          x={zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length}
                          y={Math.min(...zone.points.map(p => p.y)) + 3.5}
                          fill={cfg.stroke}
                          fontSize="2.2"
                          fontWeight="bold"
                          textAnchor="middle"
                          fontFamily="monospace"
                          style={{ pointerEvents: 'none' }}
                        >
                          {cfg.label}
                        </text>
                      </g>
                    );
                  })}

                  {/* Drawing preview */}
                  {drawingPoints.length >= 2 && (
                    <polyline
                      points={drawingPoints.map(p => `${p.x},${p.y}`).join(' ')}
                      fill="none"
                      stroke="#00D4FF"
                      strokeWidth="0.4"
                      strokeDasharray="1 0.5"
                    />
                  )}
                </svg>

                {/* Draggable anchor points (edit mode) */}
                {drawMode === 'edit' && cameraZones.map(zone => {
                  const cfg = ZONE_COLORS[zone.type] || ZONE_COLORS.restricted_fence;
                  return zone.points.map((pt, idx) => (
                    <div
                      key={`${zone.id}-pt-${idx}`}
                      className="absolute w-3 h-3 rounded-full border-2 z-10"
                      style={{
                        left: `${pt.x}%`, top: `${pt.y}%`,
                        transform: 'translate(-50%, -50%)',
                        backgroundColor: zone.id === selectedZoneId ? '#FFFFFF' : cfg.stroke,
                        borderColor: cfg.stroke,
                        cursor: 'grab',
                        pointerEvents: 'all',
                      }}
                      onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(zone.id, idx); }}
                    />
                  ));
                })}

                {/* Drawing anchor points */}
                {drawingPoints.map((pt, idx) => (
                  <div
                    key={`draw-pt-${idx}`}
                    className="absolute w-2.5 h-2.5 rounded-full bg-cyan-400 border-2 border-white z-10"
                    style={{ left: `${pt.x}%`, top: `${pt.y}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}
                  />
                ))}
              </div>
            </div>

            {/* ── ACTIVE ZONES LIST ──────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
              <div className="px-[16px] py-[12px] border-b border-slate-100 flex items-center justify-between">
                <span className="text-[12px] font-bold text-[#0B1F33] uppercase tracking-wider flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#1F5F8B]" /> Active Zones
                </span>
                <span className="text-[11px] text-slate-400 font-mono">{overlays.length} zone{overlays.length !== 1 ? 's' : ''} configured</span>
              </div>

              {overlays.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No zones configured. Use <b>Create Zone</b> to draw your first restricted boundary.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {overlays.map(zone => {
                    const cfg = ZONE_COLORS[zone.type] || ZONE_COLORS.restricted_fence;
                    const isSelected = zone.id === selectedZoneId;
                    return (
                      <div
                        key={zone.id}
                        onClick={() => setSelectedZoneId(zone.id)}
                        className={`px-[16px] py-[14px] flex items-center justify-between cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-3 h-3 rounded-full shrink-0 border"
                            style={{ backgroundColor: cfg.stroke, borderColor: cfg.stroke }}
                          />
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-[#0B1F33] truncate">{zone.name}</div>
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5">{zone.cameraId} • {zone.sector}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                            zone.type === 'restricted_fence' ? 'bg-red-50 text-red-600 border-red-200' :
                            zone.type === 'buffer_zone' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                            'bg-cyan-50 text-cyan-600 border-cyan-200'
                          }`}>
                            {zone.type === 'restricted_fence' ? 'Restricted' : zone.type === 'buffer_zone' ? 'Warning' : 'Safe Zone'}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            zone.active ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'
                          }`}>
                            {zone.active ? 'ACTIVE' : 'INACTIVE'}
                          </span>

                          {/* Delete confirm inline */}
                          {deleteConfirmId === zone.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => { e.stopPropagation(); confirmDeleteZone(zone.id); }} className="p-1 bg-red-500 hover:bg-red-600 text-white rounded transition-colors">
                                <Check className="w-3 h-3" />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }} className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded transition-colors">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(zone.id); }}
                              className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN (30%) ────────────────────────────────── */}
          <div className="lg:w-[30%] flex flex-col gap-[20px]">

            {/* ── Zone Details Card ──────────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
              <div className="px-[16px] py-[12px] border-b border-slate-100">
                <span className="text-[12px] font-bold text-[#0B1F33] uppercase tracking-wider">Zone Details</span>
              </div>

              {!selectedZone ? (
                <div className="p-[20px] text-center">
                  <MapPin className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                  <p className="text-[13px] text-slate-400 leading-relaxed">
                    No zone selected. Select a zone on the surveillance view to inspect or edit its configuration.
                  </p>
                </div>
              ) : (
                <div className="p-[16px] space-y-[14px]">
                  {[
                    { label: 'Zone Name', value: selectedZone.name, bold: true },
                    { label: 'Zone Type', value: selectedZone.type === 'restricted_fence' ? 'Restricted' : selectedZone.type === 'buffer_zone' ? 'Warning' : 'Safe / Perimeter' },
                    { label: 'Camera', value: selectedZone.cameraId, mono: true },
                    { label: 'Sector', value: selectedZone.sector },
                    { label: 'Status', value: selectedZone.active ? 'ACTIVE' : 'INACTIVE', color: selectedZone.active ? '#059669' : '#94A3B8' },
                    { label: 'Created', value: formatTimestamp(selectedZone.createdAt) },
                    { label: 'Last Modified', value: formatTimestamp(selectedZone.updatedAt) },
                    { label: 'Detection Rule', value: 'Trigger alert when human enters zone' },
                    { label: 'Alert Severity', value: selectedZone.alertSeverity.toUpperCase() },
                  ].map((row, i) => (
                    <div key={i} className="flex justify-between items-start gap-2">
                      <span className="text-[12px] text-slate-400 font-medium shrink-0">{row.label}</span>
                      <span
                        className={`text-[13px] font-semibold text-right ${row.mono ? 'font-mono' : ''} ${row.bold ? 'text-[#0B1F33]' : ''}`}
                        style={{ color: row.color || (row.bold ? '#0B1F33' : '#374151') }}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}

                  {/* Sensitivity slider */}
                  <div className="pt-2 border-t border-slate-100">
                    <div className="flex justify-between mb-1.5">
                      <span className="text-[12px] text-slate-400 font-medium">Sensitivity</span>
                      <span className="text-[13px] text-[#1F5F8B] font-bold">{selectedZone.sensitivity}%</span>
                    </div>
                    <input
                      type="range" min="50" max="100"
                      value={selectedZone.sensitivity}
                      onChange={(e) => setOverlays(prev => prev.map(z =>
                        z.id === selectedZoneId ? { ...z, sensitivity: Number(e.target.value), updatedAt: new Date().toISOString() } : z
                      ))}
                      className="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-[#1F5F8B]"
                    />
                  </div>

                  {/* Loitering limit */}
                  <div>
                    <div className="flex justify-between mb-1.5">
                      <span className="text-[12px] text-slate-400 font-medium">Loitering Limit</span>
                      <span className="text-[13px] text-amber-600 font-bold">{selectedZone.loiteringLimitSec}s</span>
                    </div>
                    <input
                      type="range" min="5" max="60"
                      value={selectedZone.loiteringLimitSec}
                      onChange={(e) => setOverlays(prev => prev.map(z =>
                        z.id === selectedZoneId ? { ...z, loiteringLimitSec: Number(e.target.value), updatedAt: new Date().toISOString() } : z
                      ))}
                      className="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-amber-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Detection Rules Card ───────────────────────────────── */}
            {selectedZone && (
              <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-[16px] py-[12px] border-b border-slate-100">
                  <span className="text-[12px] font-bold text-[#0B1F33] uppercase tracking-wider">Detection Rules</span>
                </div>
                <div className="p-[16px] space-y-[16px]">
                  {/* Toggle rows */}
                  {[
                    { label: 'Human Detection', field: 'humanDetection' as const, val: selectedZone.humanDetection },
                    { label: 'Vehicle Detection', field: 'vehicleDetection' as const, val: selectedZone.vehicleDetection },
                    { label: 'Animal Detection', field: 'animalDetection' as const, val: selectedZone.animalDetection },
                  ].map(row => (
                    <div key={row.field} className="flex items-center justify-between">
                      <span className="text-[13px] text-slate-600 font-medium">{row.label}</span>
                      <button onClick={() => toggleDetectionRule(row.field)} className="transition-colors">
                        {row.val
                          ? <ToggleRight className="w-7 h-7 text-emerald-500" />
                          : <ToggleLeft className="w-7 h-7 text-slate-300" />
                        }
                      </button>
                    </div>
                  ))}

                  {/* Person count threshold */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-[13px] text-slate-600 font-medium">Person Count Threshold</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => adjustThreshold(-1)}
                        className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-500"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-8 text-center text-[15px] font-bold text-[#0B1F33] font-mono">{selectedZone.personThreshold}</span>
                      <button
                        onClick={() => adjustThreshold(1)}
                        className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-500"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Rule explanation */}
                  <div className="p-3 bg-slate-50 border border-slate-100 rounded text-[11px] text-slate-500 leading-relaxed">
                    If more than <b className="text-[#0B1F33]">{selectedZone.personThreshold}</b> person{selectedZone.personThreshold !== 1 ? 's' : ''} {selectedZone.personThreshold === 1 ? 'is' : 'are'} detected inside this <b className="text-[#0B1F33]">{selectedZone.type === 'restricted_fence' ? 'restricted' : selectedZone.type === 'buffer_zone' ? 'warning' : 'monitored'}</b> zone, an incident alert will be generated and evidence captured automatically.
                  </div>

                  {/* Alert severity selector */}
                  <div>
                    <span className="text-[12px] text-slate-400 font-medium block mb-2">Alert Severity</span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(['critical', 'high', 'medium', 'low'] as const).map(s => {
                        const sc = severityColor(s);
                        const isActive = selectedZone.alertSeverity === s;
                        return (
                          <button
                            key={s}
                            onClick={() => setOverlays(prev => prev.map(z =>
                              z.id === selectedZoneId ? { ...z, alertSeverity: s, updatedAt: new Date().toISOString() } : z
                            ))}
                            className={`py-1.5 text-[10px] font-bold uppercase rounded border transition-colors ${
                              isActive
                                ? `${sc.bg} ${sc.text} ${sc.border} ring-1 ring-offset-1`
                                : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CREATE ZONE DIALOG ────────────────────────────────── */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md p-[24px] space-y-5">
            <div>
              <h3 className="text-[18px] font-bold text-[#0B1F33]">Create New Zone</h3>
              <p className="text-[13px] text-slate-500 mt-1">
                {drawingPoints.length} anchor points placed on {selectedCamera?.name || selectedCameraId}.
              </p>
            </div>
            <div>
              <label className="text-[12px] text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Zone Name</label>
              <input
                type="text"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                placeholder="e.g. Sector B Restricted Zone Alpha"
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] text-[#0B1F33] focus:outline-none focus:border-[#1F5F8B] focus:ring-1 focus:ring-[#1F5F8B]/30"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[12px] text-slate-500 font-semibold uppercase tracking-wider block mb-1.5">Zone Type</label>
              <select
                value={newZoneType}
                onChange={(e) => setNewZoneType(e.target.value as ZoneDrawType)}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] text-[#0B1F33] focus:outline-none focus:border-[#1F5F8B]"
              >
                <option value="restricted_fence">Restricted Zone</option>
                <option value="buffer_zone">Warning Zone</option>
                <option value="outpost_perimeter">Safe Zone / Virtual Fence</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={saveNewZone}
                disabled={!newZoneName.trim() || saving}
                className="flex-1 py-2.5 bg-[#1F5F8B] hover:bg-[#0F2742] text-white text-[13px] font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Create Zone'}
              </button>
              <button
                onClick={() => { setShowCreateDialog(false); setDrawingPoints([]); setDrawMode('none'); }}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[13px] font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
