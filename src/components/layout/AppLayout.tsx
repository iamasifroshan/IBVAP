import React from 'react';
import { useApp } from '../../context/AppContext';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { LiveDemoController } from '../common/LiveDemoController';
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
    setExplainableIncident 
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
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-primary)] flex flex-col font-sans">
      
      {/* Top Operational Status Bar */}
      <TopBar />

      {/* Real Live Demo Controller Bar */}
      <LiveDemoController />

      {/* Main Body Shell */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar Navigation */}
        <Sidebar />

        {/* Dynamic Page Content View */}
        <main className="flex-1 overflow-y-auto">
          {/* Max-width container for content area with 32px padding on desktop */}
          <div className="max-w-[1600px] mx-auto w-full p-4 md:p-8">
            {renderActivePage()}
          </div>
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
