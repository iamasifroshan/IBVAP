import React from 'react';
import { 
  LayoutDashboard, 
  Video, 
  ShieldAlert, 
  Search, 
  CloudFog, 
  HardDrive, 
  Camera, 
  Maximize2, 
  BarChart3, 
  Settings,
  Sparkles,
  Zap
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PageId } from '../../types';

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export const Sidebar: React.FC = () => {
  const { activePage, setActivePage, incidents, syncQueue } = useApp();

  const activeAlertCount = incidents.filter(i => i.status === 'active').length;
  const pendingSyncCount = syncQueue.filter(i => i.status === 'unsynced').length;

  const navGroups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { id: 'command-overview', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
        { id: 'live-surveillance', label: 'Live Surveillance', icon: <Video className="w-5 h-5" /> },
        { id: 'incidents', label: 'Incidents', icon: <ShieldAlert className="w-5 h-5" />, badge: activeAlertCount > 0 ? activeAlertCount : undefined }
      ]
    },
    {
      title: 'AI & Analysis',
      items: [
        { id: 'sentinel-query', label: 'Investigation', icon: <Search className="w-5 h-5" /> },
        { id: 'enviro-vision', label: 'Environment Analysis', icon: <CloudFog className="w-5 h-5" /> },
        { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-5 h-5" /> }
      ]
    },
    {
      title: 'Operations',
      items: [
        { id: 'edge-guard', label: 'Edge Operations', icon: <HardDrive className="w-5 h-5" />, badge: pendingSyncCount > 0 ? pendingSyncCount : undefined },
        { id: 'camera-management', label: 'Camera Management', icon: <Camera className="w-5 h-5" /> },
        { id: 'virtual-fence', label: 'Zones & Virtual Fence', icon: <Maximize2 className="w-5 h-5" /> }
      ]
    },
    {
      title: 'System',
      items: [
        { id: 'ai-training-center', label: 'AI Training Center', icon: <Sparkles className="w-5 h-5" /> },
        { id: 'settings', label: 'System Settings', icon: <Settings className="w-5 h-5" /> },
        { id: 'system-verification', label: 'System Verification', icon: <Zap className="w-5 h-5" /> }
      ]
    }
  ];

  return (
    <aside className="w-[260px] bg-white border-r border-[var(--border-color)] flex flex-col shrink-0 select-none shadow-sm z-10 hidden md:flex">
      
      {/* Main Navigation Links */}
      <nav className="flex-1 px-4 py-6 space-y-6 overflow-y-auto">
        {navGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="space-y-1">
            <h3 className="px-3 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActivePage(item.id)}
                    className={`w-full flex items-center justify-between px-3 h-11 rounded-md text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-[#1F5F8B]/10 text-[#0F2742] border-l-4 border-[#1F5F8B]'
                        : 'text-[var(--text-primary)] hover:text-[#0F2742] hover:bg-[#F8FAFC] border-l-4 border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={isActive ? 'text-[#1F5F8B]' : 'text-[var(--text-muted)]'}>
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                    </div>

                    {item.badge !== undefined && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        isActive ? 'bg-[#1F5F8B] text-white' : 'bg-[#D92D20] text-white'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

    </aside>
  );
};
