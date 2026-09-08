import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Shield, 
  Search, 
  Filter, 
  Eye, 
  ChevronRight, 
  ChevronLeft, 
  Download, 
  Copy, 
  Check, 
  X, 
  AlertTriangle, 
  Activity, 
  FileText, 
  Calendar, 
  Clock, 
  Camera as CameraIcon,
  CheckCircle2,
  User,
  Car,
  Maximize2,
  RotateCcw,
  Video,
  Radio,
  ExternalLink,
  SlidersHorizontal
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Incident } from '../../types';
import { parseUTCTimestamp } from '../../utils/timestampUtils';
import { resolveImageUrl } from '../../utils/imageUtils';

/**
 * Format timestamp to "05 Sep 2026"
 */
function formatDateIST(ts: string | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format timestamp to "21:07:32 IST"
 */
function formatTimeIST(ts: string | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return '—';
  const timeStr = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${timeStr} IST`;
}

/**
 * Format timestamp with full precision: "05 Sep 2026, 21:07:32 IST"
 */
function formatFullPrecisionIST(ts: string | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return '—';
  const dateStr = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${dateStr}, ${timeStr} IST`;
}

/**
 * Overlay timestamp: "05 Sep 2026 21:07:32 IST"
 */
function formatOverlayTimestamp(ts: string | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return '—';
  const dateStr = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${dateStr} ${timeStr} IST`;
}

/**
 * Compact thumbnail with graceful fallback
 */
const IncidentRowThumbnail: React.FC<{
  imageUrl: string;
  incidentId: string;
  overlayTs: string;
}> = ({ imageUrl, incidentId, overlayTs }) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [imageUrl]);

  return (
    <div className="w-[88px] h-[62px] sm:w-[106px] sm:h-[72px] rounded-lg overflow-hidden shrink-0 bg-slate-950 border border-slate-200 relative shadow-2xs">
      {imageUrl && !hasError ? (
        <img 
          src={imageUrl} 
          alt={`Incident ${incidentId.slice(0, 8)}`} 
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-[10px] gap-0.5 bg-slate-900">
          <CameraIcon className="w-4 h-4 text-slate-500" />
          <span className="font-mono">NO EVIDENCE</span>
        </div>
      )}

      {/* Timestamp Overlay */}
      <div className="absolute bottom-0 inset-x-0 bg-black/75 px-1 py-0.5 text-[9.5px] font-mono text-white/90 truncate text-center">
        {overlayTs.split(' ').slice(3).join(' ') || overlayTs}
      </div>
    </div>
  );
};

/**
 * Investigation Evidence Viewport with tactical HUD and fallback
 */
const EvidenceViewport: React.FC<{
  snapshotUrl?: string;
  timestamp?: string;
  cameraName?: string;
  trackId?: string;
  incidentId?: string;
  onExpand: () => void;
}> = ({ snapshotUrl, timestamp, cameraName, trackId, incidentId, onExpand }) => {
  const [hasError, setHasError] = useState(false);
  const imageUrl = resolveImageUrl(snapshotUrl);

  useEffect(() => {
    setHasError(false);
  }, [snapshotUrl]);

  const hasValidImage = Boolean(imageUrl && !hasError);

  return (
    <div className="w-full aspect-video rounded-lg overflow-hidden border border-slate-700/60 bg-slate-950 shadow-inner relative group flex flex-col">
      {hasValidImage ? (
        <>
          <img
            src={imageUrl}
            alt={`Captured evidence for ${incidentId || 'incident'}`}
            className="w-full h-full object-cover"
            onError={() => setHasError(true)}
          />

          {/* Top HUD Metadata Overlay */}
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/80 backdrop-blur-xs border border-white/10 text-[10px] font-mono text-white/90">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>{cameraName || 'CAM-STREAM'}</span>
              <span className="text-white/40">|</span>
              <span>{trackId || 'TRK#1'}</span>
            </div>

            <div className="px-2 py-0.5 rounded bg-black/80 backdrop-blur-xs border border-white/10 text-[10px] font-mono text-amber-300">
              EVIDENCE RECORD
            </div>
          </div>

          {/* Bottom HUD Metadata & Expand Action */}
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2.5 flex items-center justify-between text-white">
            <div className="space-y-0.5">
              <div className="text-[10px] font-mono text-white/90 drop-shadow-xs flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-sky-400" />
                <span>{formatOverlayTimestamp(timestamp)}</span>
              </div>
              <div className="text-[9px] font-mono text-slate-400 truncate max-w-xs">
                REF: {incidentId || 'INC-ID'}
              </div>
            </div>

            <button
              onClick={onExpand}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-600/90 hover:bg-sky-600 text-white text-[11px] font-semibold transition-colors shadow-xs"
              title="Expand Full Evidence Modal"
            >
              <Maximize2 className="w-3 h-3" />
              <span>VIEW FULL EVIDENCE</span>
            </button>
          </div>
        </>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-center p-6 bg-slate-950 text-slate-400 space-y-2">
          <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
            <CameraIcon className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <div className="font-mono text-xs font-bold text-slate-300 tracking-wider uppercase">
              EVIDENCE NOT AVAILABLE
            </div>
            <div className="text-[11px] text-slate-500">
              Historical record retained in database registry.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const IncidentsPage: React.FC = () => {
  const { 
    incidents, 
    securityEvents,
    setSelectedIncident,
    updateIncidentStatus,
    setActivePage
  } = useApp();

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedCamera, setSelectedCamera] = useState<string>('all');
  const [selectedSector, setSelectedSector] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');

  // Pagination (Default 10 records per page)
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Selected incident in investigation panel
  const [selectedIncidentDetail, setSelectedIncidentDetail] = useState<Incident | null>(null);

  // UI state
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [showFalseAlarmModal, setShowFalseAlarmModal] = useState<boolean>(false);

  // Dynamic filter options derived from real incidents
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    incidents.forEach(inc => {
      const t = inc.eventType || (inc as any).event_type;
      if (t) types.add(t);
    });
    return Array.from(types).sort();
  }, [incidents]);

  const availableCameras = useMemo(() => {
    const cams = new Set<string>();
    incidents.forEach(inc => {
      const c = inc.cameraName || inc.cameraId;
      if (c) cams.add(c);
    });
    return Array.from(cams).sort();
  }, [incidents]);

  const availableSectors = useMemo(() => {
    const secs = new Set<string>();
    incidents.forEach(inc => {
      if (inc.sector) secs.add(inc.sector);
    });
    return Array.from(secs).sort();
  }, [incidents]);

  // Auto-select first incident on mount
  useEffect(() => {
    if (!selectedIncidentDetail && incidents.length > 0) {
      setSelectedIncidentDetail(incidents[0]);
    }
  }, [incidents, selectedIncidentDetail]);

  // Keep selected incident synced if status changes
  useEffect(() => {
    if (selectedIncidentDetail) {
      const updated = incidents.find(i => i.id === selectedIncidentDetail.id);
      if (updated && updated.status !== selectedIncidentDetail.status) {
        setSelectedIncidentDetail(updated);
      }
    }
  }, [incidents, selectedIncidentDetail]);

  // Copy helper
  const handleCopy = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // Investigate workflow: real navigation to Sentinel Query
  const handleInvestigate = (inc: Incident) => {
    const trk = inc.persistentId || (inc as any).track_id || 'TRK#1';
    setActionNotice(`Routing to Sentinel Investigation for Track ${trk}...`);
    setTimeout(() => {
      setActivePage('sentinel-query');
    }, 300);
  };

  // False Alarm confirmation workflow
  const handleConfirmFalseAlarm = () => {
    if (!selectedIncidentDetail) return;
    updateIncidentStatus(selectedIncidentDetail.id, 'false_alarm');
    setShowFalseAlarmModal(false);
    setActionNotice(`Incident ${selectedIncidentDetail.id.slice(0, 12)} marked as FALSE ALARM`);
    setTimeout(() => setActionNotice(null), 3000);
  };

  // Export filtered incidents to CSV
  const handleExportCSV = () => {
    if (filteredIncidents.length === 0) return;
    const headers = [
      'Incident ID', 
      'Timestamp (IST)', 
      'Camera', 
      'Sector', 
      'Target Type', 
      'Track ID', 
      'Threat Score', 
      'Threat Level', 
      'Status'
    ];
    const rows = filteredIncidents.map(inc => [
      inc.id,
      formatFullPrecisionIST(inc.timestamp),
      inc.cameraName || inc.cameraId,
      inc.sector,
      inc.objectType,
      inc.persistentId || (inc as any).track_id || 'TRK#1',
      inc.threatScore,
      (inc as any).threat_level || inc.severity,
      inc.status
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `ibvap_incident_register_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Reset all filters
  const handleResetFilters = () => {
    setSearchTerm('');
    setSelectedSeverity('all');
    setSelectedType('all');
    setSelectedCamera('all');
    setSelectedSector('all');
    setSelectedDateFilter('all');
    setCurrentPage(1);
  };

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm.trim() !== '') count++;
    if (selectedSeverity !== 'all') count++;
    if (selectedType !== 'all') count++;
    if (selectedCamera !== 'all') count++;
    if (selectedSector !== 'all') count++;
    if (selectedDateFilter !== 'all') count++;
    return count;
  }, [searchTerm, selectedSeverity, selectedType, selectedCamera, selectedSector, selectedDateFilter]);

  // Real filtering logic
  const filteredIncidents = useMemo(() => {
    return incidents.filter(inc => {
      const q = searchTerm.toLowerCase().trim();
      const trackId = String(inc.persistentId || (inc as any).track_id || '').toLowerCase();
      const cameraId = String(inc.cameraId || '').toLowerCase();
      const cameraName = String(inc.cameraName || '').toLowerCase();
      const sector = String(inc.sector || '').toLowerCase();
      const incId = String(inc.id || '').toLowerCase();

      const matchesSearch = !q || 
        incId.includes(q) || 
        trackId.includes(q) || 
        cameraId.includes(q) || 
        cameraName.includes(q) || 
        sector.includes(q);

      const matchesSeverity = selectedSeverity === 'all' || 
        inc.severity?.toLowerCase() === selectedSeverity.toLowerCase() ||
        (inc as any).threat_level?.toLowerCase() === selectedSeverity.toLowerCase();

      const matchesType = selectedType === 'all' || 
        (inc.eventType || (inc as any).event_type) === selectedType;

      const matchesCamera = selectedCamera === 'all' || 
        (inc.cameraName || inc.cameraId) === selectedCamera;

      const matchesSector = selectedSector === 'all' || 
        inc.sector === selectedSector;

      // Date filter
      let matchesDate = true;
      if (selectedDateFilter !== 'all') {
        const d = parseUTCTimestamp(inc.timestamp);
        if (d) {
          const now = new Date();
          const diffDays = (now.getTime() - d.getTime()) / (1000 * 3600 * 24);
          if (selectedDateFilter === 'today') matchesDate = diffDays <= 1.5;
          else if (selectedDateFilter === 'last7') matchesDate = diffDays <= 7.5;
          else if (selectedDateFilter === 'last30') matchesDate = diffDays <= 30.5;
        }
      }

      // Preserve existing demo list filter rule: only incidents with retrievable evidence in register list
      const snap = inc.snapshotUrl || (inc as any).snapshot_url;
      if (!snap || typeof snap !== 'string' || snap.trim() === '') return false;

      return matchesSearch && matchesSeverity && matchesType && matchesCamera && matchesSector && matchesDate;
    });
  }, [incidents, searchTerm, selectedSeverity, selectedType, selectedCamera, selectedSector, selectedDateFilter]);

  // ── Operational Metadata Indicators (Real data mappings) ──
  // 1. RECORDED EVENTS: total incidents returned by existing incident data source after applying current page/filter semantics
  const totalEventsCount = filteredIncidents.length;

  // 2. ACTIVE THREATS: incidents/security events whose existing real status indicates an active/current threat
  const activeThreatsCount = useMemo(() => {
    // Primary: Active security threats from unified intelligence stream in AppContext
    if (securityEvents && securityEvents.length > 0) {
      if (selectedCamera !== 'all') {
        return securityEvents.filter(e => 
          e.status === 'active' && (e.camera_id === selectedCamera || e.camera_name === selectedCamera)
        ).length;
      }
      return securityEvents.filter(e => e.status === 'active').length;
    }
    // Fallback: Active threat incidents from current register
    return filteredIncidents.filter(i => 
      (i.status === 'active' || i.status === 'investigating') && 
      (i.severity === 'critical' || i.severity === 'high' || (i as any).threat_level === 'critical' || (i as any).threat_level === 'high')
    ).length;
  }, [securityEvents, selectedCamera, filteredIncidents]);

  // 3. EVIDENCE-BACKED: incidents that have valid physical evidence according to existing evidence/image validation logic
  const evidenceBackedCount = useMemo(() => {
    return filteredIncidents.filter(i => {
      const snap = i.snapshotUrl || (i as any).snapshot_url;
      const resolved = resolveImageUrl(snap);
      return Boolean(resolved && resolved.trim().length > 0);
    }).length;
  }, [filteredIncidents]);

  // Keep pagination in bounds
  const totalPages = Math.max(1, Math.ceil(filteredIncidents.length / itemsPerPage));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedIncidents = useMemo(() => {
    const start = (currentPageSafe - 1) * itemsPerPage;
    return filteredIncidents.slice(start, start + itemsPerPage);
  }, [filteredIncidents, currentPageSafe, itemsPerPage]);

  // Severity visual badge
  const renderSeverityBadge = (severity: string | undefined, threatLevel?: string) => {
    const s = (severity || threatLevel || 'high').toLowerCase();
    if (s === 'critical' || s === 'high') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-red-600 text-white">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
          HIGH
        </span>
      );
    }
    if (s === 'medium') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-amber-500 text-white">
          <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
          MEDIUM
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-sky-600 text-white">
        <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
        LOW
      </span>
    );
  };

  // Status visual badge
  const renderStatusBadge = (status: string) => {
    const st = (status || 'active').toLowerCase();
    if (st === 'active') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          ACTIVE
        </span>
      );
    }
    if (st === 'false_alarm') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 border border-slate-200 line-through">
          FALSE ALARM
        </span>
      );
    }
    if (st === 'investigating') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
          INVESTIGATING
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
        VERIFIED
      </span>
    );
  };

  // Vehicle identification helper
  const isVehicleIncident = (inc: Incident | null) => {
    if (!inc) return false;
    const type = ((inc.objectType || (inc as any).object_type || '') as string).toLowerCase();
    if (type === 'vehicle') return true;
    const snap = String(inc.snapshotUrl || '').toLowerCase();
    if (snap.includes('4a0c533b') || snap.includes('truck') || snap.includes('vehicle')) return true;
    return false;
  };

  // Real rationale lines for Threat Assessment
  const getIncidentReasons = (inc: Incident): string[] => {
    const reasons: string[] = [];

    // 1. Threat factors from real analysis
    if (inc.threatFactors && inc.threatFactors.length > 0) {
      inc.threatFactors.forEach(f => {
        if (f.description && !reasons.includes(f.description)) {
          reasons.push(f.description);
        }
      });
    }

    // 2. Explainable reason
    if (inc.explainableReason && !reasons.includes(inc.explainableReason)) {
      reasons.push(inc.explainableReason);
    }

    // 3. Identity condition
    if (!inc.faceRecognized || !inc.personName || inc.personName === 'UNKNOWN') {
      if (!isVehicleIncident(inc) && !reasons.some(r => r.toLowerCase().includes('identity'))) {
        reasons.push('Unidentified subject / Unknown identity');
      }
    } else if (inc.personName && inc.personName !== 'UNKNOWN') {
      reasons.push(`Known profile match: ${inc.personName}`);
    }

    // 4. Zone activity
    if (inc.zoneName && !reasons.some(r => r.includes(inc.zoneName))) {
      reasons.push(`Restricted zone perimeter: ${inc.zoneName}`);
    }

    // 5. Environmental condition
    if (inc.environmentalCondition === 'night' || inc.environmentalCondition === 'low_light') {
      reasons.push('Low-visibility / Night movement conditions');
    }

    // Fallback if none exist
    if (reasons.length === 0) {
      reasons.push('Restricted zone perimeter intrusion');
      reasons.push('Automated boundary breach alert');
    }

    return reasons;
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden space-y-2.5 select-none">

      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="fixed top-20 right-6 z-50 bg-[#0D1F3C] text-white px-4 py-2.5 rounded-lg shadow-xl border border-blue-400/40 text-xs font-semibold flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* ── SECTION 1: Operational Header ── */}
      <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-2.5 pb-0.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded bg-slate-900 border border-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
            <Shield className="w-4.5 h-4.5 text-sky-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-xl sm:text-2xl lg:text-[28px] font-bold text-slate-900 tracking-tight uppercase">
                INCIDENT MANAGEMENT
              </h1>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono font-bold text-slate-600">
                REGISTER v1.0
              </span>
            </div>
            <p className="text-[13px] sm:text-[14px] text-slate-500 font-medium font-body">
              Border Security Event Register • Evidence-backed Intelligence
            </p>
          </div>
        </div>

        {/* Compact Operational Indicators + Export Action */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded text-xs shadow-2xs">
            <span className="font-mono font-bold text-slate-900">{totalEventsCount}</span>
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">RECORDED EVENTS</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded text-xs shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            <span className="font-mono font-bold text-red-600">{activeThreatsCount}</span>
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">ACTIVE THREATS</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded text-xs shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span className="font-mono font-bold text-emerald-700">{evidenceBackedCount}</span>
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">EVIDENCE-BACKED</span>
          </div>

          <button 
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold transition-colors shadow-2xs"
            title="Export register to CSV"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>EXPORT REGISTER</span>
          </button>
        </div>
      </div>

      {/* ── SECTION 2: Filter & Search Investigation Toolbar ── */}
      <div className="shrink-0 bg-white border border-slate-200 rounded-lg p-2.5 shadow-2xs space-y-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          
          {/* Search Box */}
          <div className="flex items-center flex-1 min-w-[240px] h-9 sm:h-10 px-3 bg-slate-50 border border-slate-200 rounded focus-within:ring-1 focus-within:ring-[#1F5F8B] focus-within:border-[#1F5F8B] transition-all">
            <Search className="w-4 h-4 text-slate-400 shrink-0 mr-2 pointer-events-none" />
            <input 
              type="text"
              placeholder="Search by Incident ID, Track ID, Camera, or Sector..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full bg-transparent border-0 outline-none text-[13px] sm:text-[14px] text-slate-800 placeholder-slate-400 focus:ring-0 p-0 font-body"
            />
            {searchTerm && (
              <button 
                onClick={() => { setSearchTerm(''); setCurrentPage(1); }} 
                className="text-slate-400 hover:text-slate-600 p-0.5 shrink-0 ml-1"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Severity Dropdown */}
          <div className="w-36 h-9 sm:h-10">
            <select
              value={selectedSeverity}
              onChange={(e) => { setSelectedSeverity(e.target.value); setCurrentPage(1); }}
              className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2.5 text-[13px] sm:text-[14px] font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B] font-body"
            >
              <option value="all">Severity: All</option>
              <option value="critical">Critical / High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Incident Type Dropdown */}
          <div className="w-44 h-9 sm:h-10">
            <select
              value={selectedType}
              onChange={(e) => { setSelectedType(e.target.value); setCurrentPage(1); }}
              className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2.5 text-[13px] sm:text-[14px] font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B] font-body"
            >
              <option value="all">Type: All Events</option>
              {availableTypes.map(t => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Camera Dropdown */}
          <div className="w-40 h-9 sm:h-10">
            <select
              value={selectedCamera}
              onChange={(e) => { setSelectedCamera(e.target.value); setCurrentPage(1); }}
              className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2.5 text-[13px] sm:text-[14px] font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B] font-body"
            >
              <option value="all">Camera: All</option>
              {availableCameras.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Sector Dropdown */}
          <div className="w-36 h-9 sm:h-10">
            <select
              value={selectedSector}
              onChange={(e) => { setSelectedSector(e.target.value); setCurrentPage(1); }}
              className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2.5 text-[13px] sm:text-[14px] font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B] font-body"
            >
              <option value="all">Sector: All</option>
              {availableSectors.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Date Filter Dropdown */}
          <div className="w-36 h-9 sm:h-10">
            <select
              value={selectedDateFilter}
              onChange={(e) => { setSelectedDateFilter(e.target.value); setCurrentPage(1); }}
              className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2.5 text-[13px] sm:text-[14px] font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B] font-body"
            >
              <option value="all">Date: All</option>
              <option value="today">Today</option>
              <option value="last7">Last 7 Days</option>
              <option value="last30">Last 30 Days</option>
            </select>
          </div>

          {/* Clear Filters Button */}
          {activeFiltersCount > 0 && (
            <button
              onClick={handleResetFilters}
              className="h-9 sm:h-10 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[13px] font-semibold flex items-center gap-1.5 transition-colors font-body"
              title="Reset all filters"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span>CLEAR</span>
            </button>
          )}

        </div>

        {/* Status Bar showing counts & active filters */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
          <div className="flex items-center gap-2 flex-wrap">
            <span>
              Showing <strong className="text-slate-800 font-mono">{filteredIncidents.length}</strong> incident{filteredIncidents.length === 1 ? '' : 's'} matching criteria
            </span>
            {activeFiltersCount > 0 && (
              <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded border border-blue-200">
                {activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''} active
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-slate-400 hidden sm:block">
            TIMEZONE: ASIA/KOLKATA (IST)
          </div>
        </div>
      </div>

      {/* ── SECTION 3: Main Two-Panel Investigation Workspace ── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">

        {/* ── LEFT PANEL: Dense Incident Register (7 Columns) ── */}
        <div className="lg:col-span-7 xl:col-span-7 flex flex-col h-full min-h-0 bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden">
          
          {/* Register Panel Header */}
          <div className="shrink-0 px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-800 tracking-wider uppercase">
                INCIDENT REGISTER
              </span>
              <span className="px-1.5 py-0.2 rounded bg-slate-200 text-[10px] font-mono font-bold text-slate-700">
                {filteredIncidents.length}
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500">
              PAGE {currentPageSafe} OF {totalPages}
            </div>
          </div>

          {/* Register Rows (Scrollable Area) */}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 focus:outline-none">
            {filteredIncidents.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                  <Search className="w-5 h-5" />
                </div>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  NO INCIDENTS MATCH CURRENT FILTERS
                </div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Adjust severity, camera, sector, or search term to view security events.
                </p>
                {activeFiltersCount > 0 && (
                  <button
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs mt-2"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset Filters
                  </button>
                )}
              </div>
            ) : (
              paginatedIncidents.map((inc) => {
                const isSelected = selectedIncidentDetail?.id === inc.id;
                const imageUrl = resolveImageUrl(inc.snapshotUrl);
                const isVehicle = isVehicleIncident(inc);
                const trackDisplay = inc.persistentId || (inc as any).track_id || 'TRK#1';
                const timeIST = formatTimeIST(inc.timestamp);
                const dateIST = formatDateIST(inc.timestamp);
                const overlayTs = formatOverlayTimestamp(inc.timestamp);
                const eventTypeName = (inc.eventType || (inc as any).event_type || 'RESTRICTED_ZONE_BREACH').replace(/_/g, ' ');

                return (
                  <div
                    key={inc.id}
                    onClick={() => setSelectedIncidentDetail(inc)}
                    className={`p-4 sm:p-[18px] transition-colors cursor-pointer flex items-center justify-between gap-3.5 border-l-4 min-h-[92px] ${
                      isSelected 
                        ? 'border-l-[#1F5F8B] bg-sky-50/30 ring-1 ring-[#1F5F8B]/20' 
                        : 'border-l-transparent hover:bg-slate-50/90 hover:border-l-slate-300'
                    }`}
                  >
                    {/* Left: Compact Thumbnail (+10%) */}
                    <IncidentRowThumbnail 
                      imageUrl={imageUrl} 
                      incidentId={inc.id} 
                      overlayTs={overlayTs} 
                    />

                    {/* Middle: Structured Operational Metadata */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      
                      {/* Row 1: Severity + Event Type + Track ID + Short ID */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {renderSeverityBadge(inc.severity, (inc as any).threat_level)}

                        <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                          {eventTypeName}
                        </span>

                        <span className="font-mono text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
                          {trackDisplay}
                        </span>

                        <div className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-600">
                          {isVehicle ? <Car className="w-3.5 h-3.5 text-slate-600" /> : <User className="w-3.5 h-3.5 text-slate-600" />}
                          <span className="capitalize">{isVehicle ? 'Vehicle' : 'Human'}</span>
                        </div>
                      </div>

                      {/* Row 2: Camera + Sector + Zone */}
                      <div className="text-[13px] text-slate-600 flex items-center gap-2 truncate">
                        <span className="text-[11px] uppercase font-bold text-slate-400">CAM:</span>
                        <span className="font-mono font-semibold text-slate-900">{inc.cameraName || inc.cameraId}</span>
                        <span className="text-slate-300">•</span>
                        <span className="text-[11px] uppercase font-bold text-slate-400">SECTOR:</span>
                        <span className="font-medium text-slate-800">{inc.sector}</span>
                        {inc.zoneName && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-500 truncate text-xs">{inc.zoneName}</span>
                          </>
                        )}
                      </div>

                      {/* Row 3: Reason / Explanation snippet */}
                      <div className="text-xs text-slate-500 truncate">
                        {inc.explainableReason || 'Automated perimeter security intrusion detected'}
                      </div>
                    </div>

                    {/* Right: Timestamp + Threat Score + Status */}
                    <div className="flex flex-col items-end justify-center shrink-0 space-y-1 text-right pl-2">
                      <div className="font-mono text-[13.5px] font-bold text-slate-900">
                        {timeIST}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {dateIST}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {inc.threatScore}/100
                        </span>
                        {renderStatusBadge(inc.status)}
                      </div>
                    </div>

                  </div>
                );
              })
            )}
          </div>

          {/* Register Footer / Pagination */}
          <div className="shrink-0 px-3 py-2 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
            <div className="text-[11px]">
              Showing <span className="font-mono font-bold">{(currentPageSafe - 1) * itemsPerPage + 1}</span> to <span className="font-mono font-bold">{Math.min(currentPageSafe * itemsPerPage, filteredIncidents.length)}</span> of <span className="font-mono font-bold">{filteredIncidents.length}</span> records
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={currentPageSafe === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="w-6 h-6 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed shadow-2xs"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
                Math.max(0, currentPageSafe - 3),
                Math.min(totalPages, currentPageSafe + 2)
              ).map((pageNum) => (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-6 h-6 rounded text-xs font-mono font-bold transition-all shadow-2xs ${
                    pageNum === currentPageSafe
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {pageNum}
                </button>
              ))}

              <button
                disabled={currentPageSafe === totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="w-6 h-6 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed shadow-2xs"
                title="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-1 ml-2 text-[11px] text-slate-500">
                <span>Rows:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                  className="h-6 px-1 border border-slate-200 rounded text-xs text-slate-700 bg-white font-mono focus:outline-none focus:border-[#1F5F8B]"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </div>

        </div>

        {/* ── RIGHT PANEL: Incident Details + Evidence Investigation (5 Columns) ── */}
        <div className="lg:col-span-5 xl:col-span-5 flex flex-col h-full min-h-0 bg-white rounded-lg border border-slate-200 shadow-2xs overflow-y-auto">
          {selectedIncidentDetail ? (
            <div className="p-3.5 space-y-3.5">

              {/* Panel Header */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="space-y-0.5">
                  <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                    INVESTIGATION WORKSTATION
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900">
                      {selectedIncidentDetail.id}
                    </span>
                    <button
                      onClick={() => handleCopy(selectedIncidentDetail.id)}
                      className="p-1 text-slate-400 hover:text-slate-800 transition-colors rounded hover:bg-slate-100"
                      title="Copy Incident ID"
                    >
                      {copiedId === selectedIncidentDetail.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {renderSeverityBadge(selectedIncidentDetail.severity, (selectedIncidentDetail as any).threat_level)}
                  {renderStatusBadge(selectedIncidentDetail.status)}
                </div>
              </div>

              {/* Physical Evidence Inspection Viewport */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">
                  <span>PHYSICAL EVIDENCE</span>
                  <span>EVID: {selectedIncidentDetail.id.slice(0, 12)}</span>
                </div>

                <EvidenceViewport
                  snapshotUrl={selectedIncidentDetail.snapshotUrl}
                  timestamp={selectedIncidentDetail.timestamp}
                  cameraName={selectedIncidentDetail.cameraName || selectedIncidentDetail.cameraId}
                  trackId={selectedIncidentDetail.persistentId || (selectedIncidentDetail as any).track_id || 'TRK#1'}
                  incidentId={selectedIncidentDetail.id}
                  onExpand={() => setSelectedIncident(selectedIncidentDetail)}
                />
              </div>

              {/* Aligned Incident Details Grid */}
              <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  INCIDENT PARAMETERS
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs bg-slate-50/80 p-2.5 rounded border border-slate-200/80">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">INCIDENT TYPE</div>
                    <div className="font-semibold text-slate-800 text-[11px] truncate">
                      {(selectedIncidentDetail.eventType || (selectedIncidentDetail as any).event_type || 'RESTRICTED_ZONE_BREACH').replace(/_/g, ' ')}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">THREAT SCORE</div>
                    <div className="font-mono font-bold text-red-600 text-[11px]">
                      {selectedIncidentDetail.threatScore} / 100 ({selectedIncidentDetail.severity?.toUpperCase() || 'HIGH'})
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">CAMERA</div>
                    <div className="font-mono font-semibold text-slate-800 text-[11px] truncate">
                      {selectedIncidentDetail.cameraName || selectedIncidentDetail.cameraId}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">SECTOR</div>
                    <div className="font-medium text-slate-800 text-[11px]">
                      {selectedIncidentDetail.sector}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">TRACK ID</div>
                    <div className="font-mono font-bold text-sky-700 text-[11px]">
                      {selectedIncidentDetail.persistentId || (selectedIncidentDetail as any).track_id || 'TRK#1'}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">TARGET TYPE</div>
                    <div className="font-semibold text-slate-800 text-[11px] capitalize">
                      {isVehicleIncident(selectedIncidentDetail) ? 'Vehicle' : 'Human'}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">IDENTITY STATUS</div>
                    <div className="font-mono text-[11px] font-semibold text-slate-800">
                      {selectedIncidentDetail.personName && selectedIncidentDetail.personName !== 'UNKNOWN' 
                        ? selectedIncidentDetail.personName 
                        : 'UNKNOWN'}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase">DETECTED TIME</div>
                    <div className="font-mono text-[11px] text-slate-800 truncate">
                      {formatFullPrecisionIST(selectedIncidentDetail.timestamp)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Threat Assessment & Reasons */}
              <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  <span>THREAT ASSESSMENT</span>
                  <span className="text-red-600 font-mono font-bold">
                    SCORE: {selectedIncidentDetail.threatScore}/100
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded p-2.5 space-y-1.5 shadow-2xs">
                  <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    ASSESSMENT REASONS
                  </div>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {getIncidentReasons(selectedIncidentDetail).map((reason, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-red-500 font-bold leading-tight">•</span>
                        <span className="text-[11px] font-medium leading-relaxed">{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Factual Investigation Lifecycle / Event Timeline */}
              <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  EVENT LIFECYCLE
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-start gap-2 text-[11px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0"></div>
                    <div className="space-y-0.5">
                      <div className="font-mono text-slate-800 font-semibold">
                        {formatFullPrecisionIST(selectedIncidentDetail.timestamp)}
                      </div>
                      <div className="text-slate-500">
                        TRACK ACQUIRED on camera <span className="font-mono font-semibold text-slate-700">{selectedIncidentDetail.cameraName || selectedIncidentDetail.cameraId}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 text-[11px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></div>
                    <div className="space-y-0.5">
                      <div className="font-mono text-slate-800 font-semibold">
                        CLASSIFICATION: {isVehicleIncident(selectedIncidentDetail) ? 'VEHICLE CORRIDOR' : 'HUMAN INTRUSION'}
                      </div>
                      <div className="text-slate-500">
                        Assigned identifier <span className="font-mono font-semibold text-slate-700">{selectedIncidentDetail.persistentId || 'TRK#1'}</span> in {selectedIncidentDetail.sector}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 text-[11px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0"></div>
                    <div className="space-y-0.5">
                      <div className="font-mono text-slate-800 font-semibold">
                        THREAT EVALUATION: {selectedIncidentDetail.threatScore}/100 ({selectedIncidentDetail.severity?.toUpperCase() || 'HIGH'})
                      </div>
                      <div className="text-slate-500">
                        Incident record generated and archived with snapshot evidence
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Operator Action Bar */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  INVESTIGATION ACTIONS
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleInvestigate(selectedIncidentDetail)}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors shadow-2xs"
                  >
                    <Activity className="w-3.5 h-3.5 text-sky-400" />
                    <span>SENTINEL QUERY</span>
                  </button>

                  <button
                    onClick={() => setActivePage('live-surveillance')}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold text-xs transition-colors shadow-2xs"
                  >
                    <Video className="w-3.5 h-3.5 text-slate-600" />
                    <span>VIEW CAMERA</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSelectedIncident(selectedIncidentDetail)}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 font-semibold text-xs transition-colors shadow-2xs"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>FULL EVIDENCE</span>
                  </button>

                  <button
                    onClick={() => setShowFalseAlarmModal(true)}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-semibold text-xs transition-colors shadow-2xs"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>FALSE ALARM</span>
                  </button>
                </div>
              </div>

            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-2">
              <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                <FileText className="w-6 h-6" />
              </div>
              <div className="font-mono text-xs font-bold text-slate-700 uppercase tracking-wider">
                SELECT AN INCIDENT
              </div>
              <p className="text-xs text-slate-500 max-w-xs">
                Select an incident from the register to inspect its details and evidence.
              </p>
            </div>
          )}
        </div>

      </div>

      {/* ── False Alarm Confirmation Modal ── */}
      {showFalseAlarmModal && selectedIncidentDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xs p-4 animate-fade-in">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-tight">
                  Mark as False Alarm?
                </h3>
                <p className="font-mono text-xs text-slate-500">{selectedIncidentDetail.id}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to mark this incident as a <strong>False Alarm</strong>? 
              This will update the central database record and suppress downstream security dispatches.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowFalseAlarmModal(false)}
                className="px-3.5 py-1.5 rounded border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmFalseAlarm}
                className="px-3.5 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                Confirm False Alarm
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
