import React from 'react';

interface CardProps {
  title?: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  glow?: 'cyan' | 'critical' | 'high' | 'none'; // Kept for backward compatibility but ignored visually
  headerBadge?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  action,
  children,
  className = '',
  glow = 'none',
  headerBadge
}) => {
  return (
    <div className={`tactical-card flex flex-col ${className}`}>
      {(title || action || headerBadge) && (
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-white rounded-t-lg">
          <div className="flex items-center gap-3">
            {typeof title === 'string' ? (
              <h3 className="text-base font-semibold text-[#0B1F33]">{title}</h3>
            ) : (
              title
            )}
            {headerBadge}
            {subtitle && <span className="text-sm text-slate-500 font-medium">({subtitle})</span>}
          </div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="p-5 flex-1 bg-white rounded-b-lg">{children}</div>
    </div>
  );
};
