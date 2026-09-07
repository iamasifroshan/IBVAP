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
  Zap,
  UserCheck,
  X,
  Menu,
  MoreHorizontal
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PageId } from '../../types';
import { GovernmentEmblem } from '../common/GovernmentEmblem';

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
}

export const Sidebar: React.FC = () => {
  const {
    activePage,
    setActivePage,
    incidents,
    syncQueue,
    sidebarOpen,
    setSidebarOpen,
    toggleSidebar
  } = useApp();

  const activeAlertCount = incidents.filter(i => i.status === 'active').length || incidents.length;
  const pendingSyncCount = syncQueue.filter(i => i.status === 'unsynced').length;

  const primaryItems: NavItem[] = [
    { id: 'command-overview', label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
    { id: 'live-surveillance', label: 'Live Surveillance', icon: <Video className="w-5 h-5" /> },
    { id: 'incidents', label: 'Incidents', icon: <ShieldAlert className="w-5 h-5" />, badge: activeAlertCount > 0 ? activeAlertCount : undefined },
    { id: 'face-recognition', label: 'Known Persons', icon: <UserCheck className="w-5 h-5" /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> }
  ];

  const secondaryItems: NavItem[] = [
    { id: 'camera-management', label: 'Camera Management', icon: <Camera className="w-4 h-4" /> },
    { id: 'virtual-fence', label: 'Zones & Virtual Fence', icon: <Maximize2 className="w-4 h-4" /> },
    { id: 'sentinel-query', label: 'Investigation', icon: <Search className="w-4 h-4" /> },
    { id: 'edge-guard', label: 'Edge Operations', icon: <HardDrive className="w-4 h-4" /> },
    { id: 'enviro-vision', label: 'Environment Analysis', icon: <CloudFog className="w-4 h-4" /> },
    { id: 'system-verification', label: 'System Verification', icon: <Zap className="w-4 h-4" /> }
  ];

  const handleNavClick = (id: PageId) => {
    setActivePage(id);
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-200"
          aria-hidden="true"
        />
      )}

      {/* Collapsible Sidebar */}
      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-50 flex flex-col shrink-0 select-none bg-[#0B1A2F] text-slate-200 border-r border-[#1E3A5F]/80 shadow-2xl lg:shadow-none transition-all duration-200 ease-in-out overflow-hidden ${
          sidebarOpen ? 'w-[240px]' : 'w-0 lg:w-[56px]'
        }`}
      >
        {/* Top Header — Hamburger toggle inside sidebar */}
        {sidebarOpen ? (
          <div className="h-[52px] px-4 border-b border-[#1E3A5F] flex items-center justify-between bg-[#081526] shrink-0">
            <div className="flex items-center gap-2.5">
              <button
                onClick={toggleSidebar}
                className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                title="Collapse sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex flex-col">
                <span className="font-black text-sm tracking-wider text-white font-mono leading-none">
                  IBVAP
                </span>
                <span className="text-[9px] text-sky-300 font-semibold tracking-tight mt-0.5 truncate max-w-[140px]">
                  Border Video Analytics
                </span>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="h-[52px] flex items-center justify-center border-b border-[#1E3A5F] bg-[#081526] shrink-0">
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              title="Expand navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto py-3 px-2 space-y-4">

          {/* Core Menu Items */}
          <div className="space-y-0.5">
            {primaryItems.map((item) => {
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  title={!sidebarOpen ? item.label : undefined}
                  className={`w-full flex items-center rounded-lg transition-all duration-150 relative ${
                    sidebarOpen
                      ? 'px-3 h-10 justify-between text-[13px] font-semibold'
                      : 'w-10 h-10 mx-auto justify-center'
                  } ${
                    isActive
                      ? 'bg-[#1E3A5F] text-white border-l-[3px] border-sky-400 shadow-sm font-bold'
                      : 'text-slate-300 hover:text-white hover:bg-white/5 border-l-[3px] border-transparent font-medium'
                  }`}
                >
                  <div className={`flex items-center ${sidebarOpen ? 'gap-3' : 'justify-center'}`}>
                    <span className={isActive ? 'text-sky-400' : 'text-slate-400 group-hover:text-white'}>
                      {item.icon}
                    </span>
                    {sidebarOpen && <span className="truncate">{item.label}</span>}
                  </div>

                  {item.badge !== undefined && (
                    <span
                      className={`rounded-full text-[10px] font-bold flex items-center justify-center ${
                        sidebarOpen ? 'px-2 py-0.5' : 'absolute -top-1 -right-1 w-4 h-4'
                      } ${isActive ? 'bg-sky-500 text-white' : 'bg-red-600 text-white'}`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-[#1E3A5F]/70 my-2" />

          {/* MORE MODULES */}
          <div className="space-y-0.5">
            {sidebarOpen ? (
              <div className="px-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">
                MORE MODULES
              </div>
            ) : (
              <div className="flex justify-center py-1">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="text-slate-500 hover:text-slate-300 transition-colors p-1"
                  title="Expand for more modules"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>
            )}

            {secondaryItems.map((item) => {
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  title={!sidebarOpen ? item.label : undefined}
                  className={`w-full flex items-center rounded-lg transition-all duration-150 relative ${
                    sidebarOpen
                      ? 'px-3 h-9 justify-between text-xs font-semibold'
                      : 'w-10 h-9 mx-auto justify-center'
                  } ${
                    isActive
                      ? 'bg-[#1E3A5F] text-white border-l-[3px] border-sky-400 shadow-sm font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5 border-l-[3px] border-transparent font-medium'
                  }`}
                >
                  <div className={`flex items-center ${sidebarOpen ? 'gap-3' : 'justify-center'}`}>
                    <span className={isActive ? 'text-sky-400' : 'text-slate-400'}>
                      {item.icon}
                    </span>
                    {sidebarOpen && <span className="truncate">{item.label}</span>}
                  </div>

                  {item.badge !== undefined && (
                    <span
                      className={`rounded-full text-[10px] font-bold flex items-center justify-center ${
                        sidebarOpen ? 'px-1.5 py-0.5' : 'absolute -top-1 -right-1 w-4 h-4'
                      } bg-amber-500 text-black`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

        </div>

        {/* Footer */}
        {sidebarOpen && (
          <div className="p-3 border-t border-[#1E3A5F] bg-[#081526] text-[10px] text-slate-400 flex items-center justify-between shrink-0 font-mono">
            <span>GOV-OPERATIONS-NODE</span>
            <span className="text-emerald-400 flex items-center gap-1 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> ACTIVE
            </span>
          </div>
        )}
      </aside>
    </>
  );
};
