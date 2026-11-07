import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Circle, ShieldCheck, ArrowRight } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { formatDate, cn } from '../../lib/utils';

// The pieces of the checks UI that other pages show too: the status chip and
// the health tile (the dashboard and the CEO roll-up read the same score).
// Kept apart from ChecksPage so those pages do not load the whole checks page.

export const STATUS_STYLE = {
  green:   { icon: CheckCircle2, chip: 'bg-brand-50 text-brand-700 ring-brand-200' },
  amber:   { icon: AlertTriangle, chip: 'bg-amber-50 text-amber-800 ring-amber-200' },
  red:     { icon: XCircle, chip: 'bg-red-50 text-red-700 ring-red-200' },
  skipped: { icon: MinusCircle, chip: 'bg-surface-100 text-surface-600 ring-surface-200' },
  none:    { icon: Circle, chip: 'bg-surface-50 text-surface-500 ring-surface-200' },
};
export const statusOf = (r) => (!r ? 'none' : r.detail?.skipped ? 'skipped' : r.status);

export function StatusChip({ status }) {
  const { t } = useT();
  const s = STATUS_STYLE[status] || STATUS_STYLE.none;
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', s.chip)}>
      <Icon size={13} aria-hidden="true" /> {t(`checks.status.${status}`)}
    </span>
  );
}

// The score, its three counts and when it was computed. With `to`, the tile
// ends in a link to the checks page (the dashboard's version).
export function HealthTile({ health, runAt, className, to }) {
  const { t } = useT();
  const tone = health?.score == null ? 'text-surface-400' : health.score >= 90 ? 'text-brand-700' : health.score >= 60 ? 'text-amber-700' : 'text-red-700';
  return (
    <div className={cn('card p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('checks.health')}</p>
          <p className={cn('stat-value mt-1 tabular-nums', tone)}>{health?.score == null ? '—' : health.score}</p>
          <p className="text-xs text-surface-500 mt-1">
            {health?.score == null ? t('checks.healthNone') : t('checks.healthOf', { green: health.green, amber: health.amber, red: health.red })}
          </p>
          <p className="text-xs text-surface-500 mt-1">{runAt ? t('checks.lastRun', { when: formatDate(runAt, 'dd MMM yyyy, HH:mm') }) : t('checks.never')}</p>
        </div>
        <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          <ShieldCheck size={20} aria-hidden="true" />
        </div>
      </div>
      {to && (
        <Link to={to} className="mt-3 inline-flex items-center gap-1 text-sm text-brand-700 hover:text-brand-800 font-medium min-h-[44px]">
          {t('checks.open')} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
