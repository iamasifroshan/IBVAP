import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Database,
  SlidersHorizontal,
  CheckCircle,
  User,
  Camera as CameraIcon,
  MapPin,
  Clock,
  Download,
  Copy,
  Check,
  X,
  Crosshair,
  Car,
  Shield,
  Loader2,
  AlertTriangle,
  Flame,
  Radio,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RotateCcw,
  Sparkles,
  Eye,
  ArrowRight,
  Layers,
  Zap,
  Activity
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { parseSentinelQuery, searchIncidentVault } from '../../services/sentinelQueryEngine';
import type { StructuredSearchFilters } from '../../services/sentinelQueryEngine';
import { ibvapApi } from '../../services/apiClient';
import { Incident, ANPRObservation, UnifiedSecurityEvent } from '../../types';
import { resolveImageUrl } from '../../utils/imageUtils';
import { parseUTCTimestamp } from '../../utils/timestampUtils';

// ── IST Date/Time Formatters ─────────────────────────────────
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
  return `${dateStr} ${timeStr} IST`;
}

function formatTimeOnlyIST(ts: string | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return '—';
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDateOnlyIST(ts: string | undefined): string {
  const d = parseUTCTimestamp(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Unified Search Item Type ─────────────────────────────────
export type SearchResultType = 'incident' | 'anpr' | 'security_event';

export interface UnifiedSearchResult {
  id: string;
  resultType: SearchResultType;
  title: string;
  cameraId: string;
  cameraName: string;
  sector: string;
  trackId: string;
  isVehicleTrack: boolean;
  severity: string;
  threatScore: number;
  timestamp: string;
  explainableReason: string;
  snapshotUrl?: string;
  incidentData?: Incident;
  anprData?: ANPRObservation;
  securityEventData?: UnifiedSecurityEvent;
}

export const SentinelQueryPage: React.FC = () => {
  const { 
    incidents, 
    cameras, 
    securityEvents,
    setActivePage, 
    setSelectedIncident,
    setActiveCameraId 
  } = useApp();

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>('Show people who entered Sector B between 10 PM and midnight.');
  const [submittedQuery, setSubmittedQuery] = useState<string>('Show people who entered Sector B between 10 PM and midnight.');
  const [activeCategory, setActiveCategory] = useState<'all' | 'incident' | 'anpr' | 'security_event'>('all');
  const [selectedCameraFilter, setSelectedCameraFilter] = useState<string>('all');
  const [selectedSectorFilter, setSelectedSectorFilter] = useState<string>('all');
  const [selectedSeverityFilter, setSelectedSeverityFilter] = useState<string>('all');
  const [selectedTargetClass, setSelectedTargetClass] = useState<string>('all');
  
  // Results & Inspector State
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [anprResults, setAnprResults] = useState<ANPRObservation[]>([]);
  const [selectedResult, setSelectedResult] = useState<UnifiedSearchResult | null>(null);
  const [activeFilters, setActiveFilters] = useState<StructuredSearchFilters>(() => 
    parseSentinelQuery('Show people who entered Sector B between 10 PM and midnight.')
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);

  // Quick Query Shortcuts
  const queryShortcuts = [
    { label: 'UNKNOWN PERSON', query: 'Show unidentified people near restricted fence' },
    { label: 'CRITICAL EVENTS', query: 'Show all critical threat events' },
    { label: 'NIGHT MOVEMENT', query: 'Show night movement detections across cameras' },
    { label: 'SUSPICIOUS LOITERING', query: 'Find suspicious loitering and unusual stop' },
    { label: 'ANPR OBSERVATIONS', query: 'Search for vehicle observations and license plates' },
    { label: 'SECTOR B PATROL', query: 'Show people who entered Sector B between 10 PM and midnight.' }
  ];

  // Copy Identifier Helper
  const handleCopy = (text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Query Execution ──────────────────────────────────────────
  const executeQuery = async (queryText: string) => {
    const trimmed = queryText.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setSubmittedQuery(trimmed);
    setCurrentPage(1);

    try {
      // 1. NLP parsing and backend Sentinel query
      const { filters } = await ibvapApi.querySentinelAI(trimmed, incidents);
      setActiveFilters(filters);

      // 2. Fetch real ANPR observations if query implies vehicle or license plate
      const qLower = trimmed.toLowerCase();
      const isVehicleOrPlate = 
        qLower.includes('plate') || 
        qLower.includes('anpr') || 
        qLower.includes('vehicle') || 
        qLower.includes('car') || 
        qLower.includes('truck') ||
        qLower.includes('vtrk') ||
        filters.extractedObject?.toLowerCase() === 'vehicle';

      if (isVehicleOrPlate) {
        try {
          const potentialPlate = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          const plateParam = potentialPlate.length >= 4 && !potentialPlate.includes('SHOW') ? potentialPlate : undefined;
          const anprData = await ibvapApi.searchAnprRecords({
            limit: 50,
            plate: plateParam
          });
          setAnprResults(anprData || []);
        } catch (e) {
          console.warn('[SentinelQuery] ANPR search failed:', e);
          setAnprResults([]);
        }
      } else {
        setAnprResults([]);
      }
    } catch (err) {
      console.warn('[SentinelQuery] Live API query error, using deterministic local parser:', err);
      const parsed = parseSentinelQuery(trimmed);
      setActiveFilters(parsed);
      setAnprResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Run initial query on mount
  useEffect(() => {
    executeQuery(searchQuery);
  }, []);

  // ── Unified Search Results Compilation ───────────────────────
  const allCompiledResults = useMemo<UnifiedSearchResult[]>(() => {
    const list: UnifiedSearchResult[] = [];

    // 1. Compile Incidents via searchIncidentVault or fallback
    const matchedInc = searchIncidentVault(incidents, activeFilters);
    matchedInc.forEach(inc => {
      const isVeh = inc.objectType === 'vehicle';
      const trk = inc.persistentId || (inc as any).track_id || (isVeh ? 'VTRK#1' : 'TRK#1');
      list.push({
        id: inc.id,
        resultType: 'incident',
        title: inc.explainableReason || 'Border security automated perimeter capture',
        cameraId: inc.cameraId || 'BORDER-CAM-07',
        cameraName: inc.cameraName || inc.cameraId || 'BORDER-CAM-07',
        sector: inc.sector || 'Sector B',
        trackId: trk,
        isVehicleTrack: isVeh || trk.startsWith('VTRK'),
        severity: (inc.severity || 'high').toLowerCase(),
        threatScore: inc.threatScore || 75,
        timestamp: inc.timestamp,
        explainableReason: inc.explainableReason || 'Perimeter activity recorded in ledger',
        snapshotUrl: inc.snapshotUrl,
        incidentData: inc
      });
    });

    // 2. Compile ANPR Observations
    anprResults.forEach(obs => {
      list.push({
        id: obs.anpr_id,
        resultType: 'anpr',
        title: `ANPR Plate Observation: ${obs.plate_text} (${(obs.vehicle_class || 'Vehicle').toUpperCase()})`,
        cameraId: obs.camera_id,
        cameraName: obs.camera_id,
        sector: 'Sector A',
        trackId: obs.vehicle_track_label || `VTRK#${obs.vehicle_track_id}`,
        isVehicleTrack: true,
        severity: obs.format_valid ? 'low' : 'medium',
        threatScore: obs.format_valid ? 15 : 45,
        timestamp: obs.last_seen || obs.first_seen,
        explainableReason: `ANPR detection on ${obs.camera_id}. Plate: ${obs.plate_text}. OCR Confidence: ${(obs.confidence * 100).toFixed(1)}%. Verification: ${obs.format_valid ? 'Verified' : 'NOT VERIFIED'}. Direction: ${obs.direction || 'transit'}.`,
        snapshotUrl: '',
        anprData: obs
      });
    });

    // 3. Compile Security Events if explicitly searched or relevant
    if (submittedQuery.toLowerCase().includes('security') || submittedQuery.toLowerCase().includes('correlated') || activeCategory === 'security_event') {
      securityEvents.forEach(evt => {
        const isVeh = evt.subject_type === 'vehicle';
        list.push({
          id: evt.event_id || evt.id,
          resultType: 'security_event',
          title: evt.threat_reason || 'Cross-sensor correlated threat episode',
          cameraId: evt.camera_id,
          cameraName: evt.camera_name || evt.camera_id,
          sector: 'Border Perimeter',
          trackId: evt.track_label || (isVeh ? `VTRK#${evt.track_id}` : `TRK#${evt.track_id}`),
          isVehicleTrack: isVeh,
          severity: (evt.threat_level || 'medium').toLowerCase(),
          threatScore: evt.threat_score || 50,
          timestamp: evt.last_seen || evt.first_seen || evt.created_at,
          explainableReason: evt.threat_reason || 'Correlated cross-sensor security episode',
          snapshotUrl: evt.snapshot_url,
          securityEventData: evt
        });
      });
    }

    return list;
  }, [incidents, activeFilters, anprResults, securityEvents, submittedQuery, activeCategory]);

  // ── Scoped Filter Options ────────────────────────────────────
  const availableCameras = useMemo(() => {
    const set = new Set<string>();
    cameras.forEach(c => set.add(c.id));
    allCompiledResults.forEach(r => set.add(r.cameraId));
    return Array.from(set).filter(Boolean).sort();
  }, [cameras, allCompiledResults]);

  const availableSectors = useMemo(() => {
    const set = new Set<string>();
    incidents.forEach(i => { if (i.sector) set.add(i.sector); });
    allCompiledResults.forEach(r => { if (r.sector) set.add(r.sector); });
    return Array.from(set).filter(Boolean).sort();
  }, [incidents, allCompiledResults]);

  // ── Apply Interactive Scoped Filters ─────────────────────────
  const filteredResults = useMemo(() => {
    return allCompiledResults.filter(item => {
      // 1. Category Filter Tab
      if (activeCategory !== 'all' && item.resultType !== activeCategory) {
        return false;
      }

      // 2. Camera Filter
      if (selectedCameraFilter !== 'all') {
        if (item.cameraId.toUpperCase() !== selectedCameraFilter.toUpperCase()) {
          return false;
        }
      }

      // 3. Sector Filter
      if (selectedSectorFilter !== 'all') {
        if (item.sector.toLowerCase() !== selectedSectorFilter.toLowerCase()) {
          return false;
        }
      }

      // 4. Severity Filter
      if (selectedSeverityFilter !== 'all') {
        const s = item.severity.toLowerCase();
        if (selectedSeverityFilter === 'critical' && s !== 'critical' && s !== 'high') return false;
        if (selectedSeverityFilter === 'medium' && s !== 'medium') return false;
        if (selectedSeverityFilter === 'low' && s !== 'low') return false;
      }

      // 5. Target Class
      if (selectedTargetClass !== 'all') {
        if (selectedTargetClass === 'vehicle' && !item.isVehicleTrack) return false;
        if (selectedTargetClass === 'human' && item.isVehicleTrack) return false;
      }

      return true;
    });
  }, [allCompiledResults, activeCategory, selectedCameraFilter, selectedSectorFilter, selectedSeverityFilter, selectedTargetClass]);

  // Category counts for tabs
  const categoryCounts = useMemo(() => {
    return {
      all: allCompiledResults.length,
      incident: allCompiledResults.filter(r => r.resultType === 'incident').length,
      anpr: allCompiledResults.filter(r => r.resultType === 'anpr').length,
      security_event: allCompiledResults.filter(r => r.resultType === 'security_event').length,
    };
  }, [allCompiledResults]);

  // Active filter badge count
  const activeFiltersCount = useMemo(() => {
    let cnt = 0;
    if (selectedCameraFilter !== 'all') cnt++;
    if (selectedSectorFilter !== 'all') cnt++;
    if (selectedSeverityFilter !== 'all') cnt++;
    if (selectedTargetClass !== 'all') cnt++;
    return cnt;
  }, [selectedCameraFilter, selectedSectorFilter, selectedSeverityFilter, selectedTargetClass]);

  // Auto-select first result if current selection invalid
  useEffect(() => {
    if (filteredResults.length > 0) {
      if (!selectedResult || !filteredResults.some(r => r.id === selectedResult.id)) {
        setSelectedResult(filteredResults[0]);
      }
    } else {
      setSelectedResult(null);
    }
  }, [filteredResults, selectedResult]);

  // Reset Filters
  const handleResetFilters = () => {
    setSelectedCameraFilter('all');
    setSelectedSectorFilter('all');
    setSelectedSeverityFilter('all');
    setSelectedTargetClass('all');
    setActiveCategory('all');
    setCurrentPage(1);
  };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredResults.length / itemsPerPage));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedResults = useMemo(() => {
    const start = (currentPageSafe - 1) * itemsPerPage;
    return filteredResults.slice(start, start + itemsPerPage);
  }, [filteredResults, currentPageSafe, itemsPerPage]);

  // Export Results to CSV
  const handleExportCSV = () => {
    if (filteredResults.length === 0) return;
    const headers = ['Result Type', 'Identifier', 'Camera', 'Sector', 'Track ID', 'Severity', 'Threat Score', 'Timestamp (IST)', 'Details'];
    const rows = filteredResults.map(r => [
      r.resultType.toUpperCase(),
      r.id,
      r.cameraName,
      r.sector,
      r.trackId,
      r.severity.toUpperCase(),
      r.threatScore,
      formatFullPrecisionIST(r.timestamp),
      `"${r.explainableReason.replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `SENTINEL_QUERY_REPORT_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Severity Badge Component
  const renderSeverityBadge = (severity: string) => {
    const s = severity.toLowerCase();
    if (s === 'critical' || s === 'high') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-red-600 text-white">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
          HIGH
        </span>
      );
    }
    if (s === 'medium') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-amber-500 text-white">
          <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
          MEDIUM
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-sky-600 text-white">
        <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
        LOW
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden space-y-2.5 select-none font-sans">
      
      {/* ── SECTION 1: Standard IBVAP Page Header ── */}
      <div className="shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-2 pb-0.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg border border-sky-200 bg-sky-50 flex items-center justify-center shrink-0 text-[#1F5F8B] shadow-2xs">
            <SlidersHorizontal className="w-4 h-4 text-[#1F5F8B]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-[#0B192C] tracking-tight">
                Sentinel Query
              </h1>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-[#0A192F] text-white tracking-wider">
                AI
              </span>
            </div>
            <p className="text-xs text-slate-500 font-normal">
              Search and correlate operational security intelligence across incidents, tracks, evidence, ANPR and behavioral events.
            </p>
          </div>
        </div>

        {/* Query Engine Status & Real Incidents Count & Export */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded text-xs shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">QUERY ENGINE:</span>
            <span className="font-mono font-bold text-emerald-700 text-[11px]">READY</span>
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded text-xs shadow-2xs">
            <span className="font-mono font-bold text-slate-900 text-[11px]">{incidents.length}</span>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">INCIDENTS INDEXED</span>
          </div>

          <button 
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 rounded text-xs font-semibold text-slate-700 shadow-2xs transition-colors cursor-pointer"
            title="Export CSV report of all query results"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* ── SECTION 2: Compact Search Input & Shortcuts ── */}
      <div className="shrink-0 bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 shadow-2xs space-y-2.5">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            executeQuery(searchQuery);
          }}
          className="flex items-center gap-2.5"
        >
          <div className="relative flex-1 flex items-center h-12 px-4 bg-slate-50 border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-[#1F5F8B]/30 focus-within:border-[#1F5F8B] transition-all">
            <Search className="w-5 h-5 text-slate-400 shrink-0 mr-3 pointer-events-none" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ask about incidents, tracks (TRK# / VTRK#), plates, cameras, or natural language query..."
              className="w-full bg-transparent border-0 outline-none text-sm sm:text-[15px] text-slate-900 placeholder-slate-400 focus:ring-0 p-0 font-normal"
            />
            {searchQuery && (
              <button 
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-slate-400 hover:text-slate-600 p-1 shrink-0 ml-1.5"
                title="Clear query input"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button 
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="h-12 px-5 bg-[#1F5F8B] hover:bg-[#184B6E] text-white rounded-lg text-sm font-semibold flex items-center gap-2 shadow-2xs transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
          >
            {isSearching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <span>Execute Query</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Structured Query Shortcuts */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-[#1F5F8B]" />
            Shortcuts:
          </span>
          {queryShortcuts.map((sc, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setSearchQuery(sc.query);
                executeQuery(sc.query);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                submittedQuery === sc.query
                  ? 'bg-blue-50 text-[#1F5F8B] border-[#1F5F8B]/40 font-semibold'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {sc.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── SECTION 3: Compact Filter Bar ── */}
      <div className="shrink-0 bg-white border border-slate-200 rounded-lg p-2 shadow-2xs space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          
          {/* Category Tabs */}
          <div className="flex items-center gap-1 border-r border-slate-200 pr-2">
            {[
              { id: 'all', label: 'All Intelligence', count: categoryCounts.all },
              { id: 'incident', label: 'Incidents', count: categoryCounts.incident },
              { id: 'anpr', label: 'ANPR / Vehicles', count: categoryCounts.anpr },
              { id: 'security_event', label: 'Security Events', count: categoryCounts.security_event },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setActiveCategory(tab.id as any); setCurrentPage(1); }}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer ${
                  activeCategory === tab.id
                    ? 'bg-[#0B192C] text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1 py-0.2 rounded text-[10px] font-mono ${
                  activeCategory === tab.id ? 'bg-slate-700 text-slate-200' : 'bg-slate-200 text-slate-600'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Granular Scope Selectors */}
          <div className="flex items-center gap-1.5 flex-wrap flex-1 justify-end">
            
            {/* Camera Selector */}
            <div className="w-32 h-7">
              <select
                value={selectedCameraFilter}
                onChange={(e) => { setSelectedCameraFilter(e.target.value); setCurrentPage(1); }}
                className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B]"
              >
                <option value="all">Camera: All</option>
                {availableCameras.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Sector Selector */}
            <div className="w-32 h-7">
              <select
                value={selectedSectorFilter}
                onChange={(e) => { setSelectedSectorFilter(e.target.value); setCurrentPage(1); }}
                className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B]"
              >
                <option value="all">Sector: All</option>
                {availableSectors.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Severity Selector */}
            <div className="w-28 h-7">
              <select
                value={selectedSeverityFilter}
                onChange={(e) => { setSelectedSeverityFilter(e.target.value); setCurrentPage(1); }}
                className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B]"
              >
                <option value="all">Severity: All</option>
                <option value="critical">Critical / High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            {/* Target Class Selector */}
            <div className="w-28 h-7">
              <select
                value={selectedTargetClass}
                onChange={(e) => { setSelectedTargetClass(e.target.value); setCurrentPage(1); }}
                className="w-full h-full bg-slate-50 border border-slate-200 rounded px-2 text-xs font-medium text-slate-700 focus:outline-none focus:border-[#1F5F8B]"
              >
                <option value="all">Target: All</option>
                <option value="human">Humans (TRK#)</option>
                <option value="vehicle">Vehicles (VTRK#)</option>
              </select>
            </div>

            {/* Clear Button */}
            {(activeFiltersCount > 0 || activeCategory !== 'all') && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="h-7 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="Reset filters"
              >
                <RotateCcw className="w-3 h-3 text-slate-500" />
                <span>Clear</span>
              </button>
            )}

          </div>

        </div>

        {/* Query Scope & Details Bar */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span>
              Query Scope: <strong className="text-slate-800 font-mono">"{submittedQuery}"</strong>
            </span>
            <span className="text-slate-300">•</span>
            <span>
              Results: <strong className="text-slate-900 font-mono">{filteredResults.length}</strong> matching records
            </span>
            {activeFilters.validated && activeFilters.confidence > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono">
                <CheckCircle className="w-3 h-3 text-emerald-600" />
                <span>NLP Parsed ({activeFilters.confidence}%)</span>
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-slate-400 hidden sm:block">
            TIMEZONE: ASIA/KOLKATA (IST)
          </div>
        </div>
      </div>

      {/* ── SECTION 4: Compact Dual-Panel Layout ── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-2.5 overflow-hidden">
        
        {/* ── LEFT PANEL: Compact Result Register (7 Columns) ── */}
        <div className="lg:col-span-7 xl:col-span-7 flex flex-col h-full min-h-0 bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden">
          
          {/* Register Header */}
          <div className="shrink-0 px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-800 tracking-wider uppercase">
                INVESTIGATION REGISTER
              </span>
              <span className="px-1.5 py-0.2 rounded bg-slate-200 text-[10px] font-mono font-bold text-slate-700">
                {filteredResults.length}
              </span>
            </div>
            <div className="text-xs font-mono text-slate-500">
              PAGE {currentPageSafe} OF {totalPages}
            </div>
          </div>

          {/* Result Rows (Scrollable Area) */}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 focus:outline-none">
            {filteredResults.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                  <Shield className="w-4 h-4" />
                </div>
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  No Matching Intelligence Records
                </div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Zero records found for query "{submittedQuery}". Adjust filters, plate number, or track ID.
                </p>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 rounded text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs mt-2 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Reset Filters
                </button>
              </div>
            ) : (
              paginatedResults.map((item) => {
                const isSelected = selectedResult?.id === item.id;
                const imageUrl = resolveImageUrl(item.snapshotUrl);
                const timeIST = formatTimeOnlyIST(item.timestamp);
                const dateIST = formatDateOnlyIST(item.timestamp);

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedResult(item)}
                    className={`px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between gap-3 border-l-4 min-h-[64px] ${
                      isSelected 
                        ? 'border-l-[#1F5F8B] bg-sky-50/40 ring-1 ring-[#1F5F8B]/20' 
                        : 'border-l-transparent hover:bg-slate-50/80 hover:border-l-slate-300'
                    }`}
                  >
                    {/* Left: Compact Thumbnail & Info */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-[66px] h-[48px] rounded-md overflow-hidden shrink-0 bg-slate-950 border border-slate-200 relative shadow-2xs flex items-center justify-center">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : item.isVehicleTrack ? (
                          <Car className="w-5 h-5 text-amber-500" />
                        ) : (
                          <User className="w-5 h-5 text-sky-400" />
                        )}
                        <div className="absolute bottom-0 inset-x-0 bg-black/75 px-1 py-0.5 text-[8px] font-mono text-white/90 text-center truncate uppercase">
                          {item.resultType.replace('_', ' ')}
                        </div>
                      </div>

                      {/* Info Summary */}
                      <div className="min-w-0 space-y-1 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[13px] font-bold text-slate-900 tracking-tight truncate max-w-[160px] sm:max-w-[210px]" title={item.id}>
                            {item.id}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                            item.isVehicleTrack 
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : 'bg-sky-50 text-sky-800 border border-sky-200'
                          }`}>
                            {item.trackId}
                          </span>
                          {renderSeverityBadge(item.severity)}
                        </div>

                        <p className="text-xs text-slate-600 font-normal line-clamp-1 truncate max-w-lg" title={item.title}>
                          {item.title}
                        </p>

                        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                          <span className="text-slate-600 font-medium">{item.cameraName}</span>
                          <span>•</span>
                          <span>{item.sector}</span>
                          <span>•</span>
                          <span>{dateIST} {timeIST}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Threat Score & Selection Arrow */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] font-mono font-semibold text-slate-400 uppercase">THREAT</div>
                        <div className="text-sm sm:text-base font-bold font-mono text-red-600">
                          {item.threatScore}
                        </div>
                      </div>
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isSelected ? 'text-[#1F5F8B] translate-x-0.5' : 'text-slate-300'}`} />
                    </div>

                  </div>
                );
              })
            )}
          </div>

          {/* Register Pagination Footer */}
          <div className="shrink-0 px-3 py-1.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <div>
              Showing <strong className="font-mono text-slate-900">{filteredResults.length === 0 ? 0 : (currentPageSafe - 1) * itemsPerPage + 1}</strong> to <strong className="font-mono text-slate-900">{Math.min(currentPageSafe * itemsPerPage, filteredResults.length)}</strong> of <strong className="font-mono text-slate-900">{filteredResults.length}</strong>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentPageSafe === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="w-5 h-5 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed shadow-2xs cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>

              <span className="font-mono text-xs text-slate-700 px-1">
                {currentPageSafe} / {totalPages}
              </span>

              <button
                type="button"
                disabled={currentPageSafe === totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="w-5 h-5 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed shadow-2xs cursor-pointer"
                title="Next page"
              >
                <ChevronRight className="w-3 h-3" />
              </button>

              <div className="flex items-center gap-1 ml-2 text-[10px] text-slate-500">
                <span>Rows:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                  className="h-5 px-1 border border-slate-200 rounded text-xs text-slate-700 bg-white font-mono focus:outline-none focus:border-[#1F5F8B]"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>
          </div>

        </div>

        {/* ── RIGHT PANEL: Compact Inspector (5 Columns) ── */}
        <div className="lg:col-span-5 xl:col-span-5 flex flex-col h-full min-h-0 bg-white rounded-lg border border-slate-200 shadow-2xs overflow-y-auto">
          {selectedResult ? (
            <div className="p-3 space-y-2.5">
              
              {/* Identity Header */}
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                <div className="space-y-0.5 min-w-0 flex-1 mr-2">
                  <div className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                    TARGET IDENTIFIER
                  </div>
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-xs sm:text-sm font-bold font-mono text-slate-900 truncate" title={selectedResult.id}>
                      {selectedResult.id}
                    </h2>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(selectedResult.id, e)}
                      className="p-0.5 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                      title={copiedId === selectedResult.id ? "Copied!" : "Copy Identifier"}
                    >
                      {copiedId === selectedResult.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] font-bold uppercase">
                    {selectedResult.resultType.replace('_', ' ')}
                  </span>
                  {renderSeverityBadge(selectedResult.severity)}
                </div>
              </div>

              {/* Evidence Snapshot Viewport */}
              <div className="space-y-1">
                <div className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                  <span>EVIDENCE SNAPSHOT</span>
                  <span className="text-slate-400">{selectedResult.cameraName}</span>
                </div>

                <div className="w-full aspect-video max-h-48 rounded overflow-hidden bg-slate-950 border border-slate-200 relative group shadow-2xs">
                  {selectedResult.snapshotUrl ? (
                    <>
                      <img 
                        src={resolveImageUrl(selectedResult.snapshotUrl)} 
                        alt={selectedResult.id}
                        className="w-full h-full object-cover"
                      />
                      {/* Expand Action */}
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedResult.incidentData) {
                            setSelectedIncident(selectedResult.incidentData);
                          }
                        }}
                        className="absolute top-1.5 right-1.5 p-1 rounded bg-black/70 hover:bg-black/90 text-white backdrop-blur-xs transition-colors shadow-2xs cursor-pointer"
                        title="Open Full Evidence Modal"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs gap-1 bg-slate-900">
                      <CameraIcon className="w-5 h-5 text-slate-600" />
                      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                        EVIDENCE IMAGE UNAVAILABLE
                      </span>
                      <span className="text-[9px] text-slate-500">
                        {selectedResult.resultType === 'anpr' ? 'ANPR Telemetry Record Only' : 'No camera snapshot in local storage'}
                      </span>
                    </div>
                  )}

                  {/* Overlay IST timestamp */}
                  <div className="absolute bottom-0 inset-x-0 bg-black/80 px-2 py-0.5 flex items-center justify-between text-[9px] font-mono text-white/90">
                    <span>{formatFullPrecisionIST(selectedResult.timestamp)}</span>
                    <span className="text-sky-400 font-bold">{selectedResult.trackId}</span>
                  </div>
                </div>
              </div>

              {/* ── Correlation Information (Compact presentation) ── */}
              <div className="p-2 rounded bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="text-[9px] font-mono font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                  <Layers className="w-3 h-3 text-[#1F5F8B]" />
                  <span>CORRELATED CHAIN</span>
                </div>

                <div className="flex items-center justify-between text-xs font-mono py-0.5 px-2 bg-white border border-slate-200 rounded">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-slate-400 uppercase">TRACK:</span>
                    <strong className="text-[#1F5F8B]">{selectedResult.trackId}</strong>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-slate-400 uppercase">CAMERA:</span>
                    <strong className="text-slate-800">{selectedResult.cameraId}</strong>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-slate-400 uppercase">THREAT:</span>
                    <strong className="text-red-600">{selectedResult.threatScore}/100</strong>
                  </div>
                </div>
              </div>

              {/* ANPR Telemetry Card if ANPR result */}
              {selectedResult.anprData && (
                <div className="p-2 rounded bg-amber-50/50 border border-amber-200 space-y-1">
                  <div className="text-[9px] font-mono font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1">
                    <Car className="w-3 h-3 text-amber-600" />
                    <span>ANPR TELEMETRY</span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-xs font-mono pt-0.5">
                    <div>
                      <span className="text-slate-400 block text-[9px]">PLATE:</span>
                      <strong className="text-slate-900 font-bold text-xs tracking-wider">
                        {selectedResult.anprData.plate_text}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">OCR CONFIDENCE:</span>
                      <strong className="text-emerald-700 font-bold">
                        {(selectedResult.anprData.confidence * 100).toFixed(1)}%
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">CLASS:</span>
                      <strong className="text-slate-800 capitalize">
                        {selectedResult.anprData.vehicle_class || 'Car'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[9px]">STATUS:</span>
                      <strong className={selectedResult.anprData.format_valid ? "text-emerald-700" : "text-amber-700"}>
                        {selectedResult.anprData.format_valid ? "VALID" : "UNVERIFIED"}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Security Event Signals if Security Event */}
              {selectedResult.securityEventData && (
                <div className="p-2 rounded bg-blue-50/50 border border-blue-200 space-y-1">
                  <div className="text-[9px] font-mono font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1">
                    <Zap className="w-3 h-3 text-blue-600" />
                    <span>CONTRIBUTING SIGNALS</span>
                  </div>

                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {selectedResult.securityEventData.contributing_signals?.map((sig, i) => (
                      <span key={i} className="px-1.5 py-0.2 bg-white border border-blue-200 text-blue-800 font-mono text-[9px] rounded font-semibold">
                        {sig.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Explanation & Reason */}
              <div className="space-y-0.5">
                <div className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-wider">
                  EXPLANATION & REASON
                </div>
                <div className="p-2 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed font-sans">
                  {selectedResult.explainableReason}
                </div>
              </div>

              {/* Location & Sector Metadata */}
              <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                <div className="p-1.5 bg-slate-50 border border-slate-200 rounded">
                  <span className="text-[9px] text-slate-400 block uppercase">SECTOR</span>
                  <strong className="text-slate-800">{selectedResult.sector}</strong>
                </div>
                <div className="p-1.5 bg-slate-50 border border-slate-200 rounded">
                  <span className="text-[9px] text-slate-400 block uppercase">CAMERA</span>
                  <strong className="text-slate-800">{selectedResult.cameraName}</strong>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-1.5 border-t border-slate-100 flex flex-col gap-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedResult.incidentData) {
                        setSelectedIncident(selectedResult.incidentData);
                        setActivePage('incidents');
                      } else {
                        setActivePage('incidents');
                      }
                    }}
                    className="px-2.5 py-1.5 bg-[#1F5F8B] hover:bg-[#184B6E] text-white rounded text-xs font-semibold flex items-center justify-center gap-1 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>OPEN IN REGISTER</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveCameraId(selectedResult.cameraId);
                      setActivePage('live-surveillance');
                    }}
                    className="px-2.5 py-1.5 bg-[#0B192C] hover:bg-slate-800 text-white rounded text-xs font-semibold flex items-center justify-center gap-1 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5 text-sky-400" />
                    <span>VIEW LIVE CAMERA</span>
                  </button>
                </div>

                {selectedResult.snapshotUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedResult.incidentData) {
                        setSelectedIncident(selectedResult.incidentData);
                      }
                    }}
                    className="w-full px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded text-xs font-semibold flex items-center justify-center gap-1 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#1F5F8B]" />
                    <span>OPEN FULL EVIDENCE SNAPSHOT</span>
                  </button>
                )}
              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-1.5">
              <Crosshair className="w-6 h-6 text-slate-300" />
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Select a Result to Inspect
              </div>
              <p className="text-[11px] text-slate-400 max-w-xs">
                Click any incident, vehicle track, or plate observation from the register to review intelligence.
              </p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
