import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n/I18nContext';

// The app's overlay, shared by every program. It renders into document.body
// through a portal, so no page wrapper (a transform, an overflow) can clip it
// or scroll it away.
//
//   <Sheet>        full screen on a phone; on ≥ 768 px a panel (560 px unless
//                  `size` says otherwise) with a sticky header and footer.
//   <ActionSheet>  a short list of actions, from the bottom on a phone.
//
// Escape and a tap on the backdrop close the top sheet only. Focus moves into
// the sheet, Tab stays inside it, and it goes back where it was on close.
//
// `tone` is the program's skin: 'finca' (Ganadería's paper and ink) or
// 'business' (white and surface grays). The behaviour is the same.

const stack = [];          // open sheets, newest last
let locks = 0;             // body scroll lock, shared by every open sheet

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TONES = {
  finca: {
    backdrop: 'bg-finca-ink/40',
    panel: 'bg-finca-paper text-finca-ink md:rounded-[18px]',
    bar: 'bg-finca-surface border-finca-line',
    title: 'text-[22px] truncate',
    subtitle: 'text-[13px] text-finca-ink2 truncate',
    icon: 'text-finca-ink2 hover:bg-finca-lineSoft hover:text-finca-ink',
    back: 'text-finca-ink hover:bg-finca-lineSoft',
    body: 'px-4 py-4',
    list: 'bg-finca-surface text-finca-ink rounded-t-[18px] md:rounded-[18px]',
    listSubtitle: 'text-[13px] text-finca-ink2',
    action: 'text-finca-ink hover:bg-finca-lineSoft',
    actionIcon: 'text-finca-ink2',
    danger: 'text-finca-clayText hover:bg-finca-claySoft',
    hint: 'text-finca-ink2',
    active: 'bg-finca-lineSoft',
    cancel: 'text-finca-ink2 hover:bg-finca-lineSoft',
    labels: { back: 'lv.shell.back', close: 'lv.shell.close' },
  },
  business: {
    backdrop: 'bg-black/40',
    panel: 'bg-white text-surface-900 md:rounded-xl',
    bar: 'bg-white border-surface-200',
    title: 'text-lg',
    subtitle: 'text-sm text-surface-500 leading-snug mt-0.5',
    icon: 'text-surface-500 hover:bg-surface-100 hover:text-surface-700',
    back: 'text-surface-700 hover:bg-surface-100',
    body: 'px-4 sm:px-6 py-5',
    list: 'bg-white text-surface-900 rounded-t-xl md:rounded-xl',
    listSubtitle: 'text-sm text-surface-500',
    action: 'text-surface-800 hover:bg-surface-100',
    actionIcon: 'text-surface-500',
    danger: 'text-red-700 hover:bg-red-50',
    hint: 'text-surface-500',
    active: 'bg-surface-100',
    cancel: 'text-surface-500 hover:bg-surface-100',
    labels: { back: 'common.back', close: 'common.close' },
  },
};

// Desktop widths. Ganadería uses the default; Business dialogs keep the
// widths their old modal gave them.
const SIZES = { sm: 'md:max-w-md', md: 'md:max-w-[560px]', lg: 'md:max-w-2xl', xl: 'md:max-w-4xl', full: 'md:max-w-6xl' };

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
    // else the panel itself, after the content has rendered. A field that
    // took focus on its own (autoFocus) keeps it.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
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

export function Sheet({ open, onClose, title, subtitle, onBack, children, footer, className, bodyClassName, tone = 'business', size = 'md' }) {
  const { t } = useT();
  const panelRef = useRef(null);
  const titleId = useId();
  useSheetBehaviour(open, onClose, panelRef);
  if (!open) return null;
  const s = TONES[tone] || TONES.business;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex md:items-center md:justify-center md:p-6">
      <div className={cn('absolute inset-0 hidden md:block', s.backdrop)} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex flex-col w-full h-full outline-none animate-rise',
          'md:h-auto md:max-h-[88vh] md:shadow-modal md:overflow-hidden',
          SIZES[size] || SIZES.md,
          s.panel,
          className,
        )}
      >
        <header className={cn('shrink-0 flex items-center gap-2 px-2 md:px-3 py-2 border-b', s.bar)}>
          {onBack ? (
            <button type="button" onClick={onBack} className={cn('w-11 h-11 shrink-0 rounded-xl flex items-center justify-center', s.back)} aria-label={t(s.labels.back)}>
              <ChevronLeft size={22} />
            </button>
          ) : <span className="w-2 shrink-0" />}
          <div className="flex-1 min-w-0 py-1">
            <h2 id={titleId} className={cn('font-display leading-tight', s.title)}>{title}</h2>
            {subtitle && <div className={s.subtitle}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className={cn('w-11 h-11 shrink-0 rounded-xl flex items-center justify-center', s.icon)} aria-label={t(s.labels.close)}>
            <X size={22} />
          </button>
        </header>
        <div className={cn('flex-1 min-h-0 overflow-y-auto', s.body, bodyClassName)}>
          {children}
        </div>
        {footer && (
          <footer className={cn('shrink-0 px-4 pt-3 pb-safe md:pb-3 border-t', s.bar)}>
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
export function ActionSheet({ open, onClose, title, subtitle, actions = [], children, tone = 'business' }) {
  const { t } = useT();
  const panelRef = useRef(null);
  const titleId = useId();
  useSheetBehaviour(open, onClose, panelRef);
  if (!open) return null;
  const s = TONES[tone] || TONES.business;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end md:items-center md:justify-center md:p-6">
      <div className={cn('absolute inset-0', s.backdrop)} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('relative w-full md:max-w-[420px] max-h-[85vh] overflow-y-auto shadow-modal outline-none animate-rise pb-safe md:pb-2', s.list)}
      >
        <div className="px-5 pt-4 pb-2">
          <h2 id={titleId} className="font-display text-[20px] leading-tight">{title}</h2>
          {subtitle && <div className={cn('mt-0.5', s.listSubtitle)}>{subtitle}</div>}
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
                  a.danger ? s.danger : s.action,
                  a.active && s.active,
                )}
              >
                {a.icon && <a.icon size={20} className={a.danger ? undefined : s.actionIcon} />}
                <span className="flex-1">{a.label}</span>
                {a.hint && <span className={cn('text-[13px] font-normal', s.hint)}>{a.hint}</span>}
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={onClose} className={cn('w-full min-h-[52px] px-3 rounded-xl text-[16px] font-medium', s.cancel)}>
              {t('common.cancel')}
            </button>
          </li>
        </ul>
      </div>
    </div>,
    document.body,
  );
}
