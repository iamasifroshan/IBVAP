import React from 'react';
import { AlertTriangle, Loader2, Inbox, RefreshCw, XCircle } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No Data Found',
  description = 'No records match the active criteria or filter constraints.',
  action
}) => (
  <div className="p-12 text-center flex flex-col items-center justify-center border border-dashed border-slate-800 rounded-lg bg-[#0F172A]/50 font-mono">
    <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 mb-3">
      <Inbox className="w-6 h-6" />
    </div>
    <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-1">{title}</h4>
    <p className="text-xs text-slate-400 max-w-sm mb-4 font-sans">{description}</p>
    {action}
  </div>
);

export const LoadingState: React.FC<{ message?: string }> = ({ message = 'Processing Border Data Stream...' }) => (
  <div className="p-12 text-center flex flex-col items-center justify-center font-mono text-xs">
    <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
    <span className="text-slate-300 tracking-wider uppercase">{message}</span>
  </div>
);

export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({
  message = 'Failed to connect to edge AI stream processor.',
  onRetry
}) => (
  <div className="p-8 border border-red-500/30 bg-red-500/5 rounded-lg text-center flex flex-col items-center font-mono">
    <XCircle className="w-8 h-8 text-red-400 mb-2" />
    <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1">Stream Error Detected</h4>
    <p className="text-xs text-slate-300 max-w-md mb-4 font-sans">{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 rounded text-xs flex items-center gap-1.5 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Retry Stream Connection
      </button>
    )}
  </div>
);

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'warning'
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0F172A] border border-slate-700 rounded-lg max-w-md w-full p-5 font-mono text-xs shadow-2xl">
        <div className="flex items-center gap-3 mb-3">
          <div className={`p-2 rounded ${variant === 'danger' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">{title}</h3>
        </div>
        <p className="text-slate-300 font-sans mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2 font-mono">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-1.5 rounded font-bold transition-colors ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
