import React from 'react';

interface BadgeProps {
  variant: 'critical' | 'high' | 'medium' | 'low' | 'online' | 'offline' | 'degraded' | 'syncing' | 'verified' | 'false_alarm' | 'investigating' | 'active' | 'CONFIGURED' | 'CONNECTING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'ERROR';
  children: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ variant, children, icon, size = 'sm' }) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-800 border-red-200',
    high: 'bg-orange-100 text-orange-800 border-orange-200',
    medium: 'bg-amber-100 text-amber-800 border-amber-200',
    low: 'bg-blue-100 text-blue-800 border-blue-200',
    online: 'bg-green-100 text-green-800 border-green-200',
    offline: 'bg-slate-100 text-slate-700 border-slate-300',
    degraded: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    syncing: 'bg-indigo-100 text-indigo-800 border-indigo-200 animate-pulse',
    verified: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    false_alarm: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
    investigating: 'bg-purple-100 text-purple-800 border-purple-200',
    active: 'bg-red-100 text-red-800 border-red-300 font-bold',
    CONFIGURED: 'bg-blue-100 text-blue-800 border-blue-200',
    CONNECTING: 'bg-amber-100 text-amber-800 border-amber-200 animate-pulse',
    ONLINE: 'bg-green-100 text-green-800 border-green-200',
    DEGRADED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    OFFLINE: 'bg-slate-100 text-slate-700 border-slate-300',
    ERROR: 'bg-red-100 text-red-800 border-red-200'
  };

  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs font-semibold' : 'px-3 py-1 text-sm font-semibold';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border ${sizeClass} ${styles[variant] || styles.low}`}>
      {icon && <span className="w-3.5 h-3.5 flex items-center justify-center">{icon}</span>}
      {children}
    </span>
  );
};
