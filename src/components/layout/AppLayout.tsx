import React from 'react';
import { useApp } from '../../context/AppContext';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { Footer } from './Footer';
import { CommandOverviewPage } from '../pages/CommandOverviewPage';
import { LiveSurveillancePage } from '../pages/LiveSurveillancePage';
import { IncidentsPage } from '../pages/IncidentsPage';
import { SentinelQueryPage } from '../pages/SentinelQueryPage';
import { EnviroVisionPage } from '../pages/EnviroVisionPage';
import { EdgeGuardPage } from '../pages/EdgeGuardPage';
import { CameraManagementPage } from '../pages/CameraManagementPage';
import { VirtualFencePage } from '../pages/VirtualFencePage';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { SystemSettingsPage } from '../pages/SystemSettingsPage';
import { SystemVerificationPage } from '../pages/SystemVerificationPage';
import { TrainingCenterPage } from '../pages/TrainingCenterPage';
import { FaceRecognitionPage } from '../pages/FaceRecognitionPage';
import { EvidenceModal } from '../common/EvidenceModal';
import { ExplainableThreatModal } from '../common/ExplainableThreatModal';

export const AppLayout: React.FC = () => {
  const { 
    activePage, 
    selectedIncident, 
    setSelectedIncident, 
    explainableIncident, 
    setExplainableIncident,
    sidebarOpen
  } = useApp();

  const renderActivePage = () => {
    switch (activePage) {
      case 'command-overview':
        return <CommandOverviewPage />;
      case 'live-surveillance':
        return <LiveSurveillancePage />;
      case 'incidents':
        return <IncidentsPage />;
      case 'sentinel-query':
        return <SentinelQueryPage />;
      case 'enviro-vision':
        return <EnviroVisionPage />;
      case 'edge-guard':
        return <EdgeGuardPage />;
      case 'camera-management':
        return <CameraManagementPage />;
      case 'virtual-fence':
        return <VirtualFencePage />;
      case 'analytics':
        return <AnalyticsPage />;
      case 'settings':
        return <SystemSettingsPage />;
      case 'system-verification':
        return <SystemVerificationPage />;
      case 'ai-training-center':
        return <TrainingCenterPage />;
      case 'face-recognition':
        return <FaceRecognitionPage />;
      default:
        return <CommandOverviewPage />;
    }
  };

  return (
    <div className="h-screen bg-[#F4F7FB] text-[#1E293B] flex flex-col font-sans overflow-hidden">
      
      {/* ── Top Government Command Header ── */}
      <TopBar />

      {/* ── Main Layout: Sidebar + Full-Width Content Canvas ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        
        {/* Collapsible Left Sidebar Rail / Drawer */}
        <Sidebar />

        {/* Dynamic Page Content View */}
        <main className={`flex-1 min-h-0 flex flex-col ${activePage === 'incidents' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className={`w-full px-4 sm:px-6 max-w-[1920px] mx-auto flex-1 ${activePage === 'incidents' ? 'flex flex-col h-full overflow-hidden py-3 min-h-0' : 'py-4 md:py-5 shrink-0'}`}>
            {renderActivePage()}
          </div>

          {/* ── Official Footer ── */}
          {activePage !== 'incidents' && <Footer />}
        </main>
      </div>

      {/* Global Evidence Snapshot Modal */}
      <EvidenceModal 
        incident={selectedIncident} 
        onClose={() => setSelectedIncident(null)} 
      />

      {/* Global Explainable Threat Factor Audit Modal */}
      <ExplainableThreatModal 
        incident={explainableIncident} 
        onClose={() => setExplainableIncident(null)} 
      />

    </div>
  );
};
