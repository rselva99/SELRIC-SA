import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export default function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'relative w-full bg-white rounded-xl shadow-modal animate-scale-in max-h-[90vh] flex flex-col',
          sizes[size]
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-start justify-between gap-4 px-6 py-4 border-b border-surface-200">
          <div className="min-w-0">
            <h2 className="font-display text-lg leading-tight">{title}</h2>
            {description && <p className="text-sm text-surface-500 mt-1 leading-snug">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 -mr-1.5 p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {/* Footer: stays put while the body scrolls, so the primary action is always reachable. */}
        {footer && (
          <div className="shrink-0 px-6 py-3.5 border-t border-surface-200 bg-surface-50 rounded-b-xl">{footer}</div>
        )}
      </div>
    </div>
  );
}
