import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Search, 
  Filter, 
  Eye,
  CheckCircle2,
  X,
  ChevronLeft,
  ChevronRight,
  List
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Badge } from '../common/Badge';
import { ThreatScoreBadge } from '../common/ThreatScoreBadge';
import { EmptyState } from '../common/StateComponents';
import { formatTimestampIST } from '../../utils/timestampUtils';


export const IncidentsPage: React.FC = () => {
  const { 
    incidents, 
    setSelectedIncident, 
    setExplainableIncident,
  } = useApp();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const filteredIncidents = incidents.filter(inc => {
    const matchesSearch = inc.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.sector.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inc.cameraName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesSeverity = selectedSeverity === 'all' || inc.severity === selectedSeverity;
    const matchesStatus = selectedStatus === 'all' || inc.status === selectedStatus;

    return matchesSearch && matchesSeverity && matchesStatus;
  });

  const totalPages = Math.ceil(filteredIncidents.length / itemsPerPage);
  const paginatedIncidents = filteredIncidents.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getSeverityColor = (severity: string) => {
    switch(severity) {
      case 'critical': return 'bg-[#D92D20] text-white';
      case 'high': return 'bg-[#F59E0B] text-white';
      case 'medium': return 'bg-[#F59E0B]/20 text-[#F59E0B]';
      case 'low': return 'bg-[#1F5F8B]/20 text-[#1F5F8B]';
      default: return 'bg-slate-100 text-slate-500';
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'active': return 'text-[#D92D20]';
      case 'verified': return 'text-[#10B981]';
      case 'investigating': return 'text-[#F59E0B]';
      case 'false_alarm': return 'text-[var(--text-muted)]';
      default: return 'text-slate-500';
    }
  };

  const activeFiltersCount = (selectedSeverity !== 'all' ? 1 : 0) + (selectedStatus !== 'all' ? 1 : 0);

  return (
    <div className="space-y-[24px]">
      
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-semibold text-[var(--primary-navy)]">Incidents</h1>
        <p className="text-[15px] text-[var(--text-muted)] mt-1">Search and review detected security events.</p>
      </div>

      {/* Toolbar */}
      <div className="bg-white p-[20px] rounded-lg border border-[var(--border-color)] shadow-sm space-y-4">
        
        <div className="flex flex-col md:flex-row gap-4 justify-between">
          
          {/* Search */}
          <div className="relative flex-1 max-w-2xl">
            <Search className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by ID, camera, or sector..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white text-[var(--text-primary)] pl-10 pr-4 py-2 border border-[var(--border-color)] rounded focus:outline-none focus:border-[#1F5F8B] transition-colors"
            />
          </div>

          {/* Filter Toggle */}
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 border rounded font-medium transition-colors ${showFilters || activeFiltersCount > 0 ? 'bg-blue-50 border-blue-200 text-[#1F5F8B]' : 'bg-white border-[var(--border-color)] text-[var(--text-primary)] hover:bg-slate-50'}`}
          >
            <Filter className="w-4 h-4" /> 
            Filters {activeFiltersCount > 0 && <span className="bg-[#1F5F8B] text-white text-xs px-2 py-0.5 rounded-full">{activeFiltersCount}</span>}
          </button>
        </div>

        {/* Filter Dropdowns */}
        {showFilters && (
          <div className="flex flex-wrap gap-4 pt-4 border-t border-[var(--border-color)]">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Severity</label>
              <select
                value={selectedSeverity}
                onChange={(e) => setSelectedSeverity(e.target.value)}
                className="bg-white text-[var(--text-primary)] px-3 py-2 border border-[var(--border-color)] rounded focus:outline-none focus:border-[#1F5F8B] min-w-[200px]"
              >
                <option value="all">All Threat Levels</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-white text-[var(--text-primary)] px-3 py-2 border border-[var(--border-color)] rounded focus:outline-none focus:border-[#1F5F8B] min-w-[200px]"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="investigating">Investigating</option>
                <option value="verified">Verified Threat</option>
                <option value="false_alarm">False Alarm</option>
              </select>
            </div>
          </div>
        )}

        {/* Active Filter Chips */}
        {activeFiltersCount > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {selectedSeverity !== 'all' && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-[var(--text-primary)] text-sm rounded-full border border-slate-200">
                <span className="text-[var(--text-muted)]">Severity:</span> <span className="font-semibold capitalize">{selectedSeverity}</span>
                <X className="w-3.5 h-3.5 ml-1 cursor-pointer hover:text-red-500" onClick={() => setSelectedSeverity('all')} />
              </div>
            )}
            {selectedStatus !== 'all' && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-[var(--text-primary)] text-sm rounded-full border border-slate-200">
                <span className="text-[var(--text-muted)]">Status:</span> <span className="font-semibold capitalize">{selectedStatus.replace('_', ' ')}</span>
                <X className="w-3.5 h-3.5 ml-1 cursor-pointer hover:text-red-500" onClick={() => setSelectedStatus('all')} />
              </div>
            )}
            <button onClick={() => { setSelectedSeverity('all'); setSelectedStatus('all'); }} className="text-sm text-[#1F5F8B] hover:underline ml-2">Clear all</button>
          </div>
        )}

      </div>

      {/* Main Table */}
      {filteredIncidents.length === 0 ? (
        <EmptyState 
          title="No Incidents Found" 
          description="Try adjusting your search query or filters."
        />
      ) : (
        <div className="bg-white border border-[var(--border-color)] rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-[var(--border-color)]">
                  <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider">Severity</th>
                  <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider">Incident</th>
                  <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider">Camera</th>
                  <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider">Sector</th>
                  <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider">Target</th>
                  <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider text-center">Threat Score</th>
                  <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                  <th className="p-[20px] font-semibold text-[13px] text-[var(--text-muted)] uppercase tracking-wider text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {paginatedIncidents.map((inc) => (
                  <tr key={inc.id} className="hover:bg-slate-50/50 transition-colors group">
                    
                    <td className="p-[20px]">
                      <span className={`px-2.5 py-1 text-xs font-bold uppercase tracking-wider rounded ${getSeverityColor(inc.severity)}`}>
                        {inc.severity}
                      </span>
                    </td>

                    <td className="p-[20px]">
                      <div className="font-semibold text-[var(--primary-navy)]">{inc.id}</div>
                      <div className="text-[13px] text-[var(--text-muted)]">{formatTimestampIST(inc.timestamp)}</div>
                    </td>

                    <td className="p-[20px]">
                      <div className="font-medium text-[var(--text-primary)]">{inc.cameraName}</div>
                      <div className="text-[13px] text-[var(--text-muted)] font-mono">{inc.cameraId}</div>
                    </td>

                    <td className="p-[20px]">
                      <div className="font-medium text-[var(--text-primary)]">{inc.sector}</div>
                    </td>

                    <td className="p-[20px]">
                      <div className="font-medium text-[var(--primary-navy)] capitalize">{inc.objectType}</div>
                      <div className="text-[13px] text-[var(--text-muted)]">ID: {inc.persistentId}</div>
                    </td>

                    <td className="p-[20px] text-center">
                      <ThreatScoreBadge 
                        score={inc.threatScore} 
                        incident={inc} 
                        onExplain={(item) => setExplainableIncident(item)} 
                      />
                    </td>

                    <td className="p-[20px]">
                      <div className={`font-semibold text-[14px] capitalize flex items-center gap-1.5 ${getStatusColor(inc.status)}`}>
                        {inc.status === 'verified' && <CheckCircle2 className="w-4 h-4" />}
                        {inc.status === 'active' && <ShieldAlert className="w-4 h-4" />}
                        {inc.status.replace('_', ' ')}
                      </div>
                    </td>

                    <td className="p-[20px] text-right">
                      <button
                        onClick={() => setSelectedIncident(inc)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[var(--border-color)] text-[var(--text-primary)] text-sm font-medium rounded hover:bg-slate-50 hover:text-[#1F5F8B] transition-colors"
                      >
                        <Eye className="w-4 h-4" /> View
                      </button>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-[20px] border-t border-[var(--border-color)] flex items-center justify-between bg-slate-50/50">
              <span className="text-[14px] text-[var(--text-muted)]">
                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredIncidents.length)} of {filteredIncidents.length} entries
              </span>
              <div className="flex gap-2">
                <button 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}
                  className="p-1.5 border border-[var(--border-color)] rounded bg-white text-[var(--text-primary)] hover:bg-slate-50 disabled:opacity-50"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button 
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}
                  className="p-1.5 border border-[var(--border-color)] rounded bg-white text-[var(--text-primary)] hover:bg-slate-50 disabled:opacity-50"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
};
