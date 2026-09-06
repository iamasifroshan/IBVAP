import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  ArrowRight, 
  Database,
  HelpCircle,
  SlidersHorizontal,
  CheckCircle,
  User,
  Camera,
  MapPin,
  Clock,
  FileText,
  BarChart3,
  Flame,
  LayoutGrid,
  List,
  Download,
  Copy,
  Check,
  X,
  Crosshair,
  Car,
  Shield,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { parseSentinelQuery, searchIncidentVault } from '../../services/sentinelQueryEngine';
import type { StructuredSearchFilters } from '../../services/sentinelQueryEngine';
import { ibvapApi } from '../../services/apiClient';
import { API_BASE_URL } from '../../services/apiConfig';
import { IncidentDetailModal } from '../common/IncidentDetailModal';
import { Incident } from '../../types';

// Helper to resolve backend image URLs
const resolveSnapshotUrl = (url?: string) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  const apiHost = API_BASE_URL.replace('/api/v1', '').replace(/\/$/, '');
  return `${apiHost}${url.startsWith('/') ? '' : '/'}${url}`;
};

// Format timestamp for card image overlay: "05 Sept 2026 22:29:37"
function formatCardOverlayTime(ts: string | Date | undefined): string {
  if (!ts) return '05 Sept 2026 22:29:37';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
    return `${day} ${time}`;
  } catch {
    return String(ts);
  }
}

// Generates an operational headline for the card title matching military/border security style
function getIncidentHeadline(inc: any): string {
  const reason = (inc.explainableReason || inc.explainable_reason || '').toLowerCase();
  const obj = (inc.objectType || inc.object_type || 'human').toLowerCase();
  
  if (obj === 'vehicle') {
    if (reason.includes('fog')) return 'Vehicle intrusion detected during fog';
    if (reason.includes('approaching') || reason.includes('road') || reason.includes('corridor')) return 'Vehicle approaching border road';
    if (reason.includes('stationary') || reason.includes('trench')) return 'Unregistered vehicle stationary near wire';
    return 'Unregistered vehicle detected';
  } else {
    if (reason.includes('loitering')) return 'Person loitering near restricted zone';
    if (reason.includes('checkpoint') || reason.includes('curfew')) return 'Unauthorized subject near checkpoint';
    if (reason.includes('eastern')) return 'Critical boundary breach in eastern sector';
    if (reason.includes('fence') || reason.includes('crossing') || reason.includes('intruder')) return 'Unidentified person near border fence';
    return 'Unidentified human activity detected';
  }
}

export const SentinelQueryPage: React.FC = () => {
  const { incidents } = useApp();

  const [queryInput, setQueryInput] = useState<string>('Show people who entered Sector B between 10 PM and midnight.');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [executionTimeSec, setExecutionTimeSec] = useState<string>('1.2s');
  const [activeFilters, setActiveFilters] = useState<StructuredSearchFilters>(
    parseSentinelQuery('Show people who entered Sector B between 10 PM and midnight.')
  );
  const [matchedIncidents, setMatchedIncidents] = useState<Incident[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<string>('time_desc');
  const [selectedModalIncident, setSelectedModalIncident] = useState<Incident | null>(null);
  const [showQueryTips, setShowQueryTips] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const presetQueries = [
    'Show people who entered Sector B between 10 PM and midnight.',
    'Show high-risk events from Camera 7 yesterday.',
    'Find vehicle intrusions during fog.',
    'Show all critical events from the eastern sector last night.',
    'Find people near the northern checkpoint after 2 AM.',
    'Search for license plate MH12DE1433'
  ];

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExecuteQuery = async (textToRun: string) => {
    const trimmed = textToRun.trim();
    if (!trimmed) return;

    setIsProcessing(true);
    const startT = performance.now();

    try {
      const { filters, results } = await ibvapApi.querySentinelAI(trimmed, incidents);
      setActiveFilters(filters);
      
      let finalResults = results || [];

      // If it looks like a vehicle or plate query, try fetching ANPR matches
      const isVehicleOrPlateQuery = 
        filters.extractedObject?.toLowerCase() === 'vehicle' || 
        trimmed.toLowerCase().includes('plate') || 
        trimmed.toLowerCase().includes('license') || 
        trimmed.toLowerCase().includes('car');

      if (isVehicleOrPlateQuery) {
        try {
          // Extract potential plate text (alphanumeric only)
          const potentialPlate = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          const plateParam = potentialPlate.length >= 4 ? potentialPlate : undefined;

          const anprRecords = await ibvapApi.searchAnprRecords({
            limit: 20,
            plate: plateParam,
            vehicle_class: filters.extractedObject?.toLowerCase() === 'vehicle' ? undefined : undefined
          });

          // Convert ANPR observations to incident format for display
          const anprAsIncidents = anprRecords.map(rec => ({
            id: rec.anpr_id,
            timestamp: rec.last_seen,
            objectType: 'vehicle',
            cameraId: rec.camera_id,
            cameraName: rec.camera_id,
            sector: 'Border Control',
            severity: rec.format_valid ? 'low' : 'medium',
            threatScore: rec.format_valid ? 10 : 40,
            status: 'resolved',
            explainableReason: `ANPR Log: ${rec.plate_text} (Valid Format: ${rec.format_valid ? 'Yes' : 'No'})`,
            snapshotUrl: '', 
            isAnpr: true,
            anprData: rec,
          } as any));

          finalResults = [...finalResults, ...anprAsIncidents];
        } catch (e) {
          console.warn("ANPR Search integration failed:", e);
        }
      }

      setMatchedIncidents(finalResults);
    } catch (err) {
      console.error("SentinelQuery API call failed, falling back to local vault:", err);
      const parsed = parseSentinelQuery(trimmed);
      setActiveFilters(parsed);
      const localResults = searchIncidentVault(incidents, parsed);
      setMatchedIncidents(localResults || []);
    } finally {
      const duration = ((performance.now() - startT) / 1000).toFixed(1);
      setExecutionTimeSec(`${Math.max(0.3, parseFloat(duration))}s`);
      setIsProcessing(false);
    }
  };

  // Run initial query on mount
  useEffect(() => {
    handleExecuteQuery(queryInput);
  }, []);

  // Sorted incidents list
  const sortedIncidents = useMemo(() => {
    return [...matchedIncidents].sort((a, b) => {
      if (sortBy === 'time_desc') {
        return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
      }
      if (sortBy === 'time_asc') {
        return new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
      }
      if (sortBy === 'score_desc') {
        return (b.threatScore || 0) - (a.threatScore || 0);
      }
      if (sortBy === 'score_asc') {
        return (a.threatScore || 0) - (b.threatScore || 0);
      }
      return 0;
    });
  }, [matchedIncidents, sortBy]);

  // Export Results to CSV
  const handleExportCSV = () => {
    if (sortedIncidents.length === 0) return;
    const headers = ['Incident ID', 'Target Type', 'Camera', 'Sector', 'Date & Time', 'Threat Score', 'Severity', 'Reason'];
    const rows = sortedIncidents.map(inc => [
      `"${inc.id}"`,
      `"${inc.objectType}"`,
      `"${inc.cameraName || inc.cameraId}"`,
      `"${inc.sector}"`,
      `"${inc.timestamp}"`,
      inc.threatScore,
      `"${inc.severity}"`,
      `"${(inc.explainableReason || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `SentinelQuery_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-[1800px] mx-auto pb-12 font-sans">
      
      {/* ── 1. PAGE HEADER ── */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg border border-slate-200 bg-white shadow-2xs flex items-center justify-center text-[#1F5F8B]">
            <SlidersHorizontal className="w-5 h-5 text-[#1F5F8B]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[24px] font-bold text-[#0B192C] tracking-tight">
                SentinelQuery AI
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#0A192F] text-white tracking-wider">
                AI
              </span>
            </div>
            <p className="text-[13px] text-slate-500">
              Natural-language incident investigation. Convert plain officer queries into structured database filters.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-end md:self-auto">
          <div className="px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] flex items-center gap-1.5 shadow-2xs">
            <Database className="w-3.5 h-3.5 text-[#137333]" />
            <span>REAL INCIDENTS ONLY</span>
          </div>

          <button
            type="button"
            onClick={() => setShowQueryTips(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            <span>Query Tips</span>
          </button>
        </div>
      </div>

      {/* ── 2. SEARCH COMMAND CARD (ENLARGED & SPACIOUS) ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-4">
        {/* Input Row */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleExecuteQuery(queryInput);
          }}
          className="flex flex-col sm:flex-row gap-3.5 items-start"
        >
          <div className="relative flex-1 w-full">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Ask about incidents in natural language..."
              style={{ paddingLeft: '52px' }}
              className="w-full bg-white text-slate-900 pr-10 py-3.5 border border-slate-300 rounded-xl text-[15px] font-normal shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#1F5F8B]/20 focus:border-[#1F5F8B] transition-all"
            />
            {queryInput && (
              <button
                type="button"
                onClick={() => setQueryInput('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                title="Clear input"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-col items-center w-full sm:w-auto">
            <button
              type="submit"
              disabled={isProcessing || !queryInput.trim()}
              className="w-full sm:w-auto px-7 py-3.5 bg-[#0B5C9E] hover:bg-[#094A80] text-white font-bold rounded-xl text-[14px] flex items-center justify-center gap-2 shadow-xs transition-colors disabled:opacity-60 shrink-0 min-h-[48px]"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <span>Execute Search</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
            <span className="text-[10px] text-slate-400 mt-1 font-medium select-none hidden sm:block">
              Press Enter to search
            </span>
          </div>
        </form>

        {/* Suggested Queries Pills Only (Examples and Header Label Removed) */}
        <div className="flex flex-wrap gap-2 pt-1">
          {presetQueries.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setQueryInput(preset);
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer text-left border ${
                queryInput === preset
                  ? 'bg-[#E1EFFB] text-[#0B5C9E] border-[#0B5C9E]/40 font-semibold shadow-2xs'
                  : 'bg-[#EBF4FA] hover:bg-[#DCEBF6] text-[#1B5987] border-[#C5DFF2]'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* ── 3. INTERPRETED SEARCH FILTERS BAR (MORE SPACE & BREATHING ROOM) ── */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-[#0B192C] font-bold text-[15px]">
            <SlidersHorizontal className="w-4 h-4 text-[#1F5F8B]" />
            <span>Interpreted Search Filters</span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {activeFilters.validated ? (
              <>
                <span className="text-emerald-700 font-semibold flex items-center gap-1.5 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/80">
                  <CheckCircle className="w-4 h-4 text-emerald-600 fill-emerald-100" />
                  <span>NLP Parsed Successfully</span>
                </span>
                <span className="text-slate-500 font-medium bg-slate-50 px-3 py-1 rounded-full border border-slate-200">
                  Confidence: <strong className="text-slate-800">{activeFilters.confidence}%</strong>
                </span>
              </>
            ) : (
              <span className="text-amber-700 font-semibold flex items-center gap-1.5 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Query Ambiguous</span>
              </span>
            )}
          </div>
        </div>

        {/* 6-Column Segmented Matrix with generous padding and larger icons */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-slate-200">
            {/* 1. OBJECT */}
            <div className="p-4 sm:p-5 min-h-[82px] flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#EBF4FA] flex items-center justify-center text-[#1B5987] shrink-0 shadow-2xs">
                {String(activeFilters.extractedObject).toLowerCase() === 'vehicle' ? (
                  <Car className="w-5 h-5" />
                ) : (
                  <User className="w-5 h-5" />
                )}
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">OBJECT</span>
                <span className="text-[14px] font-bold text-slate-900 capitalize truncate block">
                  {activeFilters.extractedObject || 'Human'}
                </span>
              </div>
            </div>

            {/* 2. CAMERA */}
            <div className="p-4 sm:p-5 min-h-[82px] flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#EBF4FA] flex items-center justify-center text-[#1B5987] shrink-0 shadow-2xs">
                <Camera className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">CAMERA</span>
                <span className="text-[14px] font-bold text-slate-900 truncate block" title={activeFilters.extractedCamera}>
                  {activeFilters.extractedCamera || 'All Cameras'}
                </span>
              </div>
            </div>

            {/* 3. SECTOR */}
            <div className="p-4 sm:p-5 min-h-[82px] flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#EBF4FA] flex items-center justify-center text-[#1B5987] shrink-0 shadow-2xs">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">SECTOR</span>
                <span className="text-[14px] font-bold text-slate-900 truncate block">
                  {activeFilters.extractedSector || 'Sector B'}
                </span>
              </div>
            </div>

            {/* 4. TIME WINDOW */}
            <div className="p-4 sm:p-5 min-h-[82px] flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#EBF4FA] flex items-center justify-center text-[#1B5987] shrink-0 shadow-2xs">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">TIME WINDOW</span>
                <span className="text-[14px] font-bold text-slate-900 truncate block" title={activeFilters.extractedTimeRange}>
                  {activeFilters.extractedTimeRange || '22:00 – 00:00 UTC'}
                </span>
              </div>
            </div>

            {/* 5. EVENT TYPE */}
            <div className="p-4 sm:p-5 min-h-[82px] flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#EBF4FA] flex items-center justify-center text-[#1B5987] shrink-0 shadow-2xs">
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">EVENT TYPE</span>
                <span className="text-[14px] font-bold text-slate-900 truncate block">
                  {activeFilters.extractedEventType || 'Security Incident'}
                </span>
              </div>
            </div>

            {/* 6. THREAT FILTER */}
            <div className="p-4 sm:p-5 min-h-[82px] flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#EBF4FA] flex items-center justify-center text-[#1B5987] shrink-0 shadow-2xs">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-0.5">THREAT FILTER</span>
                <span className="text-[14px] font-bold text-slate-900 truncate block">
                  {activeFilters.extractedThreat || 'All Scores'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 4. SEARCH RESULTS TOOLBAR ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-3">
        <div className="flex items-center gap-2.5">
          <Search className="w-4 h-4 text-[#1F5F8B]" />
          <h2 className="font-bold text-sm text-[#0B192C]">Search Results</h2>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#0B5C9E] text-white">
            {sortedIncidents.length} {sortedIncidents.length === 1 ? 'Match' : 'Matches'}
          </span>
          <span className="text-xs text-slate-400">
            Query executed in {executionTimeSec}
          </span>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-auto">
          {/* Sort Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 font-medium focus:outline-none shadow-2xs cursor-pointer"
          >
            <option value="time_desc">Sort by: Time (Newest)</option>
            <option value="time_asc">Sort by: Time (Oldest)</option>
            <option value="score_desc">Sort by: Threat (Highest)</option>
            <option value="score_asc">Sort by: Threat (Lowest)</option>
          </select>

          {/* Grid / List View Toggle */}
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                viewMode === 'grid'
                  ? 'bg-[#0B5C9E] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Grid</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors border-l border-slate-300 ${
                viewMode === 'list'
                  ? 'bg-[#0B5C9E] text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>List</span>
            </button>
          </div>

          {/* Export Button */}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={sortedIncidents.length === 0}
            className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* ── 5. RESULTS DISPLAY AREA ── */}
      {isProcessing ? (
        <div className="py-20 bg-white rounded-xl border border-slate-200 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#0B5C9E]" />
          <div className="text-center space-y-1">
            <p className="text-sm font-bold text-[#0B192C]">Analyzing natural-language query...</p>
            <p className="text-xs text-slate-500">Querying live EdgeGuard incident database in real-time</p>
          </div>
        </div>
      ) : sortedIncidents.length === 0 ? (
        /* Zero Matching Results State */
        <div className="py-16 bg-white rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center px-4 space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
            <Shield className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[#0B192C] uppercase tracking-wide">
            NO MATCHING INCIDENTS
          </h3>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            No records in the database match your exact interpreted criteria ({activeFilters.extractedObject} in {activeFilters.extractedSector} • {activeFilters.extractedTimeRange}).
          </p>
          <span className="text-[11px] text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-200">
            Zero simulated records. Try broadening your query or selecting another sector.
          </span>
        </div>
      ) : viewMode === 'grid' ? (
        /* ── Grid View: Exactly 4 Cards Per Row (Desktop) ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {sortedIncidents.map((inc) => {
            const isVehicle = inc.objectType === 'vehicle';
            const sev = (inc.severity || 'high').toLowerCase();
            const isCritical = sev === 'critical';
            const isHigh = sev === 'high' || isCritical;
            const fullIncidentId = (inc as any).incidentId || (inc as any).incident_id || inc.id;
            const trackId = (inc as any).persistentId || (inc as any).track_id || 'TRK#1';
            const cameraName = inc.cameraName || inc.cameraId || 'BORDER-CAM-07';
            const resolvedUrl = resolveSnapshotUrl(inc.snapshotUrl);
            const isBroken = brokenImages[inc.id] || !resolvedUrl;
            const isCopied = copiedId === fullIncidentId;

            return (
              <div 
                key={inc.id}
                className="bg-white rounded-xl border border-slate-200 shadow-2xs hover:shadow-md transition-all overflow-hidden flex flex-col group"
              >
                {/* Image Top Area */}
                <div className="relative aspect-[16/10] bg-slate-950 overflow-hidden flex items-center justify-center">
                  {!isBroken ? (
                    <img
                      src={resolvedUrl}
                      alt={getIncidentHeadline(inc)}
                      className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                      onError={() => {
                        setBrokenImages(prev => ({ ...prev, [inc.id]: true }));
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-slate-900 gap-1 p-3">
                      <Camera className="w-6 h-6 text-slate-500" />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-300">
                        NO EVIDENCE IMAGE
                      </span>
                    </div>
                  )}

                  {/* Top-Left Camera Badge */}
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/75 backdrop-blur-xs text-[10px] font-mono font-bold text-white tracking-wider border border-white/10">
                    {cameraName}
                  </div>

                  {/* Top-Right Severity Badge */}
                  <div className={`absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1 shadow-xs ${
                    isCritical
                      ? 'bg-[#DC2626]'
                      : isHigh
                      ? 'bg-[#DC2626]'
                      : 'bg-[#D97706]'
                  }`}>
                    <Flame className="w-3 h-3 text-white" />
                    <span>{isCritical ? 'HIGH' : isHigh ? 'HIGH' : 'MEDIUM'}</span>
                  </div>

                  {/* Bottom-Left Timestamp Badge */}
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/75 backdrop-blur-xs text-[10px] font-mono text-white/95 border border-white/10">
                    {formatCardOverlayTime(inc.timestamp)}
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
                  <div className="space-y-1">
                    {/* Headline */}
                    <h3 className="text-[13px] font-bold text-[#0B192C] leading-snug line-clamp-1" title={getIncidentHeadline(inc)}>
                      {getIncidentHeadline(inc)}
                    </h3>

                    {/* ID Row with Copy */}
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                      <span>ID:</span>
                      <span className="truncate max-w-[170px]" title={fullIncidentId}>
                        {fullIncidentId}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleCopyId(fullIncidentId, e)}
                        className="text-slate-400 hover:text-slate-700 transition-colors p-0.5 shrink-0"
                        title={isCopied ? "Copied!" : "Copy Full ID"}
                      >
                        {isCopied ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>

                    {/* Target, Track ID, Sector Badges */}
                    <div className="flex items-center gap-3 text-xs text-slate-600 pt-1">
                      <span className="flex items-center gap-1">
                        {isVehicle ? (
                          <>
                            <Car className="w-3.5 h-3.5 text-slate-500" />
                            <span>Vehicle</span>
                          </>
                        ) : (
                          <>
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            <span>Human</span>
                          </>
                        )}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
                        <Crosshair className="w-3 h-3 text-slate-400" />
                        <span>{trackId}</span>
                      </span>
                      <span className="flex items-center gap-1 text-slate-500">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>{inc.sector || 'Sector B'}</span>
                      </span>
                    </div>
                  </div>

                  {/* Card Footer: Threat Score & View Details */}
                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500 font-medium">Threat Score:</span>
                      <strong className="text-red-600 font-bold">
                        {inc.threatScore} / 100
                      </strong>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        isCritical
                          ? 'bg-red-50 text-red-600 border border-red-200'
                          : isHigh
                          ? 'bg-red-50 text-red-600 border border-red-200'
                          : 'bg-amber-50 text-amber-600 border border-amber-200'
                      }`}>
                        {isCritical ? 'CRITICAL' : isHigh ? 'CRITICAL' : 'MEDIUM'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedModalIncident(inc)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md border border-[#B8D8F0] bg-[#F0F7FD] hover:bg-[#E1EFFB] text-[#1B5987] flex items-center gap-1 transition-colors shrink-0"
                    >
                      <span>View Details</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      ) : (
        /* ── List View ── */
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden divide-y divide-slate-200">
          {sortedIncidents.map((inc) => {
            const isVehicle = inc.objectType === 'vehicle';
            const fullIncidentId = (inc as any).incidentId || (inc as any).incident_id || inc.id;
            const resolvedUrl = resolveSnapshotUrl(inc.snapshotUrl);
            const isBroken = brokenImages[inc.id] || !resolvedUrl;

            return (
              <div 
                key={inc.id}
                className="p-3.5 sm:p-4 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-20 h-14 rounded-lg bg-slate-900 overflow-hidden shrink-0 border border-slate-200 relative">
                    {!isBroken ? (
                      <img src={resolvedUrl} alt="Snapshot" className="w-full h-full object-cover" onError={() => setBrokenImages(p => ({ ...p, [inc.id]: true }))} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-500">
                        <Camera className="w-4 h-4" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-[#0B192C] truncate">
                        {getIncidentHeadline(inc)}
                      </span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                        inc.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {inc.severity}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono">
                      <span>ID: {fullIncidentId.slice(0, 16)}...</span>
                      <span>{inc.cameraName || inc.cameraId}</span>
                      <span>{inc.sector}</span>
                      <span>{isVehicle ? 'Vehicle' : 'Human'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 self-end sm:self-auto shrink-0">
                  <div className="text-right text-xs">
                    <span className="text-slate-400 block font-mono text-[10px]">
                      {formatCardOverlayTime(inc.timestamp)}
                    </span>
                    <strong className="text-red-600 font-bold text-sm">
                      {inc.threatScore} / 100
                    </strong>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedModalIncident(inc)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md border border-[#B8D8F0] bg-[#F0F7FD] hover:bg-[#E1EFFB] text-[#1B5987] flex items-center gap-1 transition-colors"
                  >
                    <span>View Details</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 6. QUERY TIPS MODAL ── */}
      {showQueryTips && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 bg-[#0B192C] text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-sky-400" />
                <h3 className="font-bold text-sm">SentinelQuery AI — Officer Query Tips</h3>
              </div>
              <button 
                type="button" 
                onClick={() => setShowQueryTips(false)} 
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700">
              <p className="leading-relaxed">
                SentinelQuery AI converts natural-language queries directly into structured parameters for the live database. Use plain English queries with any combination of the following:
              </p>

              <div className="space-y-2.5">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <strong className="text-[#0B192C] block mb-1">1. Target Class:</strong>
                  <span className="text-slate-600">people, human, intruder, vehicle, car, 4x4, truck, animal, etc.</span>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <strong className="text-[#0B192C] block mb-1">2. Camera or Location:</strong>
                  <span className="text-slate-600">Camera 7, BORDER-CAM-07, Sector B, northern checkpoint, eastern sector.</span>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <strong className="text-[#0B192C] block mb-1">3. Time Windows & Dates:</strong>
                  <span className="text-slate-600">between 10 PM and midnight, after 2 AM, yesterday, last night, today.</span>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <strong className="text-[#0B192C] block mb-1">4. Environmental Conditions:</strong>
                  <span className="text-slate-600">during fog, in the rain, at night, dust storm.</span>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <strong className="text-[#0B192C] block mb-1">5. Threat Severity:</strong>
                  <span className="text-slate-600">high-risk, critical, medium, score above 75.</span>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowQueryTips(false)}
                  className="px-4 py-2 bg-[#0B5C9E] text-white rounded-lg font-semibold hover:bg-[#094A80] transition-colors"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 7. INCIDENT DETAIL MODAL (Selected Incident) ── */}
      {selectedModalIncident && (
        <IncidentDetailModal 
          incident={selectedModalIncident} 
          onClose={() => setSelectedModalIncident(null)} 
        />
      )}

    </div>
  );
};
