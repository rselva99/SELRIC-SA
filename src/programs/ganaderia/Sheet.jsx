import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n/I18nContext';

// The Ganadería overlay. It renders into document.body through a portal, so
// no page wrapper (a transform, an overflow) can clip it or scroll it away.
//
//   <Sheet>        full screen on a phone; on ≥ 768 px a 560 px panel with a
//                  sticky header and footer.
//   <ActionSheet>  a short list of actions, from the bottom on a phone.
//
// Escape and a tap on the backdrop close the top sheet only. Focus moves into
// the sheet, Tab stays inside it, and it goes back where it was on close.

const stack = [];          // open sheets, newest last
let locks = 0;             // body scroll lock, shared by every open sheet

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useSheetBehaviour(open, onClose, panelRef) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const token = {};
    stack.push(token);
    const before = document.activeElement;
    if (locks++ === 0) document.body.style.overflow = 'hidden';

    // Focus the first field or button the sheet marks with data-autofocus,
    // else the panel itself, after the content has rendered.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector('[data-autofocus]') || panel;
      target.focus({ preventScroll: true });
    });

    function onKey(e) {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) { e.preventDefault(); panel.focus(); return; }
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      if (--locks === 0) document.body.style.overflow = '';
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [open, panelRef]);
}

export function Sheet({ open, onClose, title, subtitle, onBack, children, footer, className, bodyClassName }) {
  const { t } = useT();
  const panelRef = useRef(null);
  const titleId = useId();
  useSheetBehaviour(open, onClose, panelRef);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex md:items-center md:justify-center md:p-6">
      <div className="absolute inset-0 bg-finca-ink/40 hidden md:block" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex flex-col w-full h-full bg-finca-paper text-finca-ink outline-none animate-rise',
          'md:h-auto md:max-h-[88vh] md:max-w-[560px] md:rounded-[18px] md:shadow-modal md:overflow-hidden',
          className,
        )}
      >
        <header className="shrink-0 flex items-center gap-2 px-2 md:px-3 py-2 bg-finca-surface border-b border-finca-line">
          {onBack ? (
            <button type="button" onClick={onBack} className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-finca-ink hover:bg-finca-lineSoft" aria-label={t('lv.shell.back')}>
              <ChevronLeft size={22} />
            </button>
          ) : <span className="w-2 shrink-0" />}
          <div className="flex-1 min-w-0 py-1">
            <h2 id={titleId} className="font-display text-[22px] leading-tight truncate">{title}</h2>
            {subtitle && <div className="text-[13px] text-finca-ink2 truncate">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-finca-ink2 hover:bg-finca-lineSoft hover:text-finca-ink" aria-label={t('lv.shell.close')}>
            <X size={22} />
          </button>
        </header>
        <div className={cn('flex-1 min-h-0 overflow-y-auto px-4 py-4', bodyClassName)}>
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 px-4 pt-3 pb-safe md:pb-3 bg-finca-surface border-t border-finca-line">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

// actions: [{ key, label, icon, onClick, danger, disabled }]. Each closes the
// sheet first unless it says `keepOpen`.
export function ActionSheet({ open, onClose, title, subtitle, actions = [], children }) {
  const { t } = useT();
  const panelRef = useRef(null);
  const titleId = useId();
  useSheetBehaviour(open, onClose, panelRef);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end md:items-center md:justify-center md:p-6">
      <div className="absolute inset-0 bg-finca-ink/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full md:max-w-[420px] max-h-[85vh] overflow-y-auto bg-finca-surface text-finca-ink rounded-t-[18px] md:rounded-[18px] shadow-modal outline-none animate-rise pb-safe md:pb-2"
      >
        <div className="px-5 pt-4 pb-2">
          <h2 id={titleId} className="font-display text-[20px] leading-tight">{title}</h2>
          {subtitle && <div className="text-[13px] text-finca-ink2 mt-0.5">{subtitle}</div>}
        </div>
        {children && <div className="px-5 pb-2">{children}</div>}
        <ul className="px-2 pb-1">
          {actions.map((a) => (
            <li key={a.key}>
              <button
                type="button"
                disabled={a.disabled}
                data-autofocus={a.autoFocus ? '' : undefined}
                onClick={() => { if (!a.keepOpen) onClose(); a.onClick?.(); }}
                className={cn(
                  'w-full min-h-[52px] flex items-center gap-3 px-3 rounded-xl text-left text-[16px] font-medium disabled:opacity-50',
                  a.danger ? 'text-finca-clayText hover:bg-finca-claySoft' : 'text-finca-ink hover:bg-finca-lineSoft',
                  a.active && 'bg-finca-lineSoft',
                )}
              >
                {a.icon && <a.icon size={20} className={a.danger ? 'text-finca-clayText' : 'text-finca-ink2'} />}
                <span className="flex-1">{a.label}</span>
                {a.hint && <span className="text-[13px] text-finca-ink2 font-normal">{a.hint}</span>}
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={onClose} className="w-full min-h-[52px] px-3 rounded-xl text-[16px] font-medium text-finca-ink2 hover:bg-finca-lineSoft">
              {t('common.cancel')}
            </button>
          </li>
        </ul>
      </div>
    </div>,
    document.body,
  );
}
