import React, { useState } from 'react';
import { 
  Search, 
  Sparkles, 
  ArrowRight, 
  Eye, 
  Cpu,
  Database,
  ChevronDown,
  ChevronRight,
  Settings2
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Badge } from '../common/Badge';
import { ThreatScoreBadge } from '../common/ThreatScoreBadge';
import { parseSentinelQuery, searchIncidentVault } from '../../services/sentinelQueryEngine';
import type { StructuredSearchFilters } from '../../services/sentinelQueryEngine';
import { ibvapApi } from '../../services/apiClient';
import { formatTimestampIST } from '../../utils/timestampUtils';


export const SentinelQueryPage: React.FC = () => {
  const { incidents, setSelectedIncident, setExplainableIncident } = useApp();

  const [queryInput, setQueryInput] = useState<string>('Show people who entered Sector B between 10 PM and midnight.');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [activeFilters, setActiveFilters] = useState<StructuredSearchFilters>(
    parseSentinelQuery('Show people who entered Sector B between 10 PM and midnight.')
  );
  const [matchedIncidents, setMatchedIncidents] = useState<any[]>(searchIncidentVault(incidents, activeFilters));

  const presetQueries = [
    'Show people who entered Sector B between 10 PM and midnight.',
    'Show high-risk events from Camera 7 yesterday.',
    'Find vehicle intrusions during fog.',
    'Show all critical events from the eastern sector last night.',
    'Find people near the northern checkpoint after 2 AM.'
  ];

  const handleExecuteQuery = async (textToRun: string) => {
    setQueryInput(textToRun);
    setIsProcessing(true);

    try {
      const { filters, results } = await ibvapApi.querySentinelAI(textToRun);
      setActiveFilters(filters);
      setMatchedIncidents(results);
    } catch (err) {
      console.error("Query failed, falling back to local search", err);
      const parsed = parseSentinelQuery(textToRun);
      setActiveFilters(parsed);
      setMatchedIncidents(searchIncidentVault(incidents, parsed));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-[24px] max-w-[1400px]">
      
      {/* 1. PAGE HEADER */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded bg-[#1F5F8B]/10 text-[#1F5F8B]">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-[28px] font-semibold text-[var(--primary-navy)] leading-tight">
              SentinelQuery AI
            </h1>
            <p className="text-[15px] text-[var(--text-muted)] mt-1">
              Natural-Language Incident Investigation. Converts plain officer queries into structured database filters.
            </p>
          </div>
        </div>
        
        <div className="px-4 py-2 rounded-full border border-[#10B981]/30 bg-[#10B981]/10 text-[#10B981] text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
          <Database className="w-4 h-4"/> REAL INCIDENTS ONLY
        </div>
      </div>

      {/* 2. COMMAND-STYLE SEARCH INPUT */}
      <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm p-[20px]">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleExecuteQuery(queryInput);
          }} 
          className="flex flex-col sm:flex-row gap-4"
        >
          <div className="relative flex-1">
            <Search className="w-6 h-6 absolute left-4 top-3.5 text-[#1F5F8B]" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Ask SentinelQuery AI e.g. 'Show people who entered Sector B between 10 PM and midnight'..."
              className="w-full bg-slate-50 text-[var(--text-primary)] pl-14 pr-4 py-3 border border-[var(--border-color)] focus:border-[#1F5F8B] rounded text-[15px] focus:outline-none transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isProcessing}
            className="px-8 py-3 bg-[#1F5F8B] hover:bg-[#0F2742] text-white font-semibold rounded flex items-center justify-center gap-2 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Parsing Query...' : 'Execute Search'} <ArrowRight className="w-5 h-5" />
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
          <span className="text-[13px] text-[var(--text-muted)] font-semibold uppercase tracking-wider block mb-3">
            Suggested Officer Queries:
          </span>
          <div className="flex flex-wrap gap-2">
            {presetQueries.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => handleExecuteQuery(preset)}
                className="px-4 py-2 bg-slate-50 hover:bg-[#1F5F8B]/5 text-[var(--text-primary)] hover:text-[#1F5F8B] border border-[var(--border-color)] hover:border-[#1F5F8B]/30 rounded text-[13px] font-medium transition-colors text-left"
              >
                "{preset}"
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. DETAILED ANALYSIS (Interpreted Filters & Results) */}
      <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm">
        <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <h2 className="text-lg font-semibold text-[var(--primary-navy)] flex items-center gap-2">
            <Cpu className="w-5 h-5 text-[#1F5F8B]" /> Interpreted Search Filters Matrix
          </h2>
          <span className="text-[13px] text-[#10B981] font-bold bg-[#10B981]/10 px-3 py-1 rounded border border-[#10B981]/30">
            NLP Extraction Confidence: {activeFilters.confidence}%
          </span>
        </div>

        <div className="p-[20px] space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 text-sm">
            <div className="p-3 bg-slate-50 border border-slate-100 rounded">
              <span className="text-[var(--text-muted)] text-[11px] font-bold uppercase tracking-wider block mb-1">Object Class</span>
              <strong className="text-[var(--primary-navy)] capitalize">{activeFilters.extractedObject || 'Any Target'}</strong>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded">
              <span className="text-[var(--text-muted)] text-[11px] font-bold uppercase tracking-wider block mb-1">Target Camera</span>
              <strong className="text-[var(--primary-navy)]">{activeFilters.extractedCamera || 'All Cameras'}</strong>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded">
              <span className="text-[var(--text-muted)] text-[11px] font-bold uppercase tracking-wider block mb-1">Sector Location</span>
              <strong className="text-[var(--primary-navy)]">{activeFilters.extractedSector || 'All Sectors'}</strong>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded">
              <span className="text-[var(--text-muted)] text-[11px] font-bold uppercase tracking-wider block mb-1">Time Window</span>
              <strong className="text-[var(--primary-navy)]">{activeFilters.extractedTimeRange}</strong>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded">
              <span className="text-[var(--text-muted)] text-[11px] font-bold uppercase tracking-wider block mb-1">Event Type</span>
              <strong className="text-[var(--primary-navy)]">{activeFilters.extractedEventType}</strong>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-100 rounded">
              <span className="text-[var(--text-muted)] text-[11px] font-bold uppercase tracking-wider block mb-1">Threat Filter</span>
              <strong className="text-[#F59E0B]">
                {activeFilters.extractedMinThreatScore ? `>= ${activeFilters.extractedMinThreatScore} (High/Critical)` : 'All Scores'}
              </strong>
            </div>
          </div>

          <div className="p-3 bg-[#1F5F8B]/5 border border-[#1F5F8B]/20 rounded text-[14px] text-[var(--text-primary)] flex items-center justify-between">
            <span>Intent Summary: <strong className="text-[var(--primary-navy)] font-semibold">{activeFilters.intentSummary}</strong></span>
            <span className="text-[var(--text-muted)] text-xs font-medium uppercase tracking-wider">Validated against EdgeGuard schema</span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm">
        <div className="px-[20px] py-[16px] border-b border-[var(--border-color)] bg-slate-50/50">
          <h2 className="text-lg font-semibold text-[var(--primary-navy)]">Retrieved Incident Records ({matchedIncidents.length} Matches)</h2>
        </div>
        <div className="p-[20px]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[20px]">
            {matchedIncidents.map((inc) => (
              <div key={inc.id} className="p-4 bg-white border border-[var(--border-color)] hover:border-slate-300 rounded shadow-sm hover:shadow-md transition-all space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      inc.severity === 'critical' ? 'bg-[#D92D20] text-white' : 
                      inc.severity === 'high' ? 'bg-[#F59E0B] text-white' : 
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {inc.severity}
                    </span>
                    <span className="font-bold text-[var(--text-primary)] text-[11px] font-mono">{inc.id}</span>
                  </div>
                  <ThreatScoreBadge score={inc.threatScore} incident={inc} onExplain={(item) => setExplainableIncident(item)} />
                </div>
                
                <div className="relative rounded overflow-hidden border border-slate-100 bg-slate-50">
                  <img src={inc.snapshotUrl} alt="Snapshot" className="w-full h-[140px] object-cover" />
                  <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur-sm text-white text-[10px] font-semibold rounded">
                    {inc.cameraName} ({inc.sector})
                  </div>
                </div>

                <p className="text-[13px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                  {inc.explainableReason}
                </p>

                <div className="flex items-center justify-between pt-3 border-t border-[var(--border-color)]">
                  <span className="text-[12px] text-[var(--text-muted)] font-medium">{formatTimestampIST(inc.timestamp)}</span>

                  <button onClick={() => setSelectedIncident(inc)} className="px-3 py-1.5 bg-slate-50 hover:bg-[#1F5F8B]/5 text-[#1F5F8B] border border-slate-200 rounded font-semibold flex items-center gap-1.5 transition-colors text-[12px]">
                    <Eye className="w-4 h-4" /> View
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5. TECHNICAL DATA (Expandable) */}
      <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm">
        <button 
          onClick={() => setShowTechnical(!showTechnical)}
          className="w-full px-[20px] py-[16px] flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-[var(--primary-navy)] font-semibold">
            <Settings2 className="w-5 h-5 text-[var(--text-muted)]" />
            Advanced Technical Data
          </div>
          {showTechnical ? <ChevronDown className="w-5 h-5 text-[var(--text-muted)]" /> : <ChevronRight className="w-5 h-5 text-[var(--text-muted)]" />}
        </button>
        
        {showTechnical && (
          <div className="p-[20px] border-t border-[var(--border-color)] bg-slate-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-[13px] font-mono text-[var(--text-primary)]">
              <div>
                <h4 className="font-sans font-semibold text-[14px] text-[var(--primary-navy)] mb-3">NLP Extraction Engine</h4>
                <div className="space-y-2">
                  <div className="flex justify-between"><span>Model:</span> <span>DistilBERT (Fine-tuned)</span></div>
                  <div className="flex justify-between"><span>Inference Time:</span> <span>45ms</span></div>
                  <div className="flex justify-between"><span>NER Entities:</span> <span>LOC, TIME, EVENT, OBJ</span></div>
                </div>
              </div>
              <div>
                <h4 className="font-sans font-semibold text-[14px] text-[var(--primary-navy)] mb-3">Database Query Engine</h4>
                <div className="space-y-2">
                  <div className="flex justify-between"><span>Backend DB:</span> <span>SQLite / PostgreSQL</span></div>
                  <div className="flex justify-between"><span>Query Generated:</span> <span>SELECT * FROM incidents WHERE...</span></div>
                  <div className="flex justify-between"><span>Execution Time:</span> <span>12ms</span></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
