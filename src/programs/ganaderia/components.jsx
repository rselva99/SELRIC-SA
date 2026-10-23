import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n/I18nContext';
import { monogram, STATUS_TONE, EVENT_BY_KEY, formatNum, toDate } from './lib';

// Small pieces every Ganadería page uses.

// Two-letter tile. Bulls and calves get their own tint so a list reads at a glance.
export function AnimalAvatar({ animal, size = 'md', className }) {
  const sizes = { sm: 'w-8 h-8 text-[11px] rounded-lg', md: 'w-10 h-10 text-xs rounded-xl', lg: 'w-14 h-14 text-lg rounded-2xl' };
  const tone = animal?.species === 'porcino'
    ? 'bg-clay-50 text-clay-700'
    : animal?.sex === 'M'
      ? 'bg-amber-50 text-amber-800'
      : animal?.category === 'ternera'
        ? 'bg-blue-50 text-blue-700'
        : 'bg-ranch-50 text-ranch-700';
  return (
    <span className={cn('shrink-0 flex items-center justify-center font-bold tracking-wide', sizes[size], tone, className)}>
      {monogram(animal?.name)}
    </span>
  );
}

// The brand (fierro) as the notebook writes it: "TO/SR".
export function BrandChip({ brand, className }) {
  if (!brand) return null;
  return (
    <span className={cn('inline-flex items-center h-5 px-1.5 rounded border border-amber-700/60 text-amber-800 font-mono text-[11px] font-semibold tracking-wider bg-white', className)}>
      {brand}
    </span>
  );
}

export function StatusBadge({ status }) {
  const { t } = useT();
  const tone = STATUS_TONE[status] || 'muted';
  const cls = tone === 'green' ? 'badge-green' : tone === 'amber' ? 'badge-amber' : tone === 'red' ? 'badge-red' : 'badge bg-surface-100 text-surface-600';
  return <span className={cls}>{t(`lv.status.${status}`)}</span>;
}

export function FlagChip({ flag }) {
  const { t } = useT();
  const strong = flag === 'vender' || flag === 'mal_parto' || flag === 'mala_madre';
  return (
    <span className={cn('badge', strong ? 'bg-red-50 text-red-700' : 'bg-surface-100 text-surface-600')}>
      {t(`lv.flags.${flag}`)}
    </span>
  );
}

// Big number with a tone bar on the left — the Batavia KPI card.
export function Kpi({ label, value, sub, tone = 'ranch', to, onClick, className }) {
  const bars = { ranch: 'bg-ranch-500', amber: 'bg-accent-amber', red: 'bg-accent-red', blue: 'bg-accent-blue', muted: 'bg-surface-400' };
  const body = (
    <>
      <span className={cn('absolute left-0 top-4 bottom-4 w-[3px] rounded-r', bars[tone] || bars.ranch)} />
      <div className="font-display text-[28px] leading-none text-surface-900 tabular-nums">{value}</div>
      <div className="text-[13px] font-medium text-surface-600 mt-1.5">{label}</div>
      {sub && <div className="text-xs text-surface-500 mt-0.5 truncate">{sub}</div>}
    </>
  );
  const cls = cn('card relative overflow-hidden px-5 py-4 text-left min-w-0', (to || onClick) && 'hover:shadow-card-hover hover:border-surface-300 transition-all', className);
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

// The icon tile for an event type, in its tone.
export function EventIcon({ type, size = 'md', className }) {
  const def = EVENT_BY_KEY[type];
  const tones = {
    green: 'bg-ranch-50 text-ranch-700', blue: 'bg-blue-50 text-blue-700', amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700', sand: 'bg-amber-100 text-amber-900', muted: 'bg-surface-100 text-surface-600',
  };
  const sizes = { sm: 'w-7 h-7 rounded-lg', md: 'w-9 h-9 rounded-lg', lg: 'w-11 h-11 rounded-xl' };
  const Icon = def?.icon;
  return (
    <span className={cn('shrink-0 flex items-center justify-center', sizes[size], tones[def?.tone] || tones.muted, className)}>
      {Icon && <Icon size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />}
    </span>
  );
}

// One line that says what an event was: "Parto · ternera" / "Palpación · preñada, 6 meses" / "Peso · 412 kg".
export function eventSummary(ev, t, byId) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'parto': {
      const calf = d.calf_id ? byId?.[d.calf_id] : null;
      const sex = d.calf_sex ? t(d.calf_sex === 'M' ? 'lv.calfMale' : 'lv.calfFemale') : '';
      return [sex, calf?.name].filter(Boolean).join(' · ');
    }
    case 'palpacion': {
      if (d.result === 'S') {
        const m = d.months != null ? t('lv.monthsPregnant', { n: formatNum(d.months) }) : d.months_text ? `${t('lv.months')}: ${d.months_text}` : '';
        return [t('lv.pregnant'), m].filter(Boolean).join(', ');
      }
      return t('lv.notPregnant');
    }
    case 'peso':    return d.kg != null ? `${formatNum(d.kg)} kg` : '';
    case 'destete': return d.kg != null ? `${formatNum(d.kg)} kg` : '';
    case 'leche':   return [d.liters != null ? `${formatNum(d.liters)} L` : '', d.shift ? t(`lv.shift.${d.shift}`) : ''].filter(Boolean).join(' · ');
    case 'vacuna':  return [d.product, d.dose].filter(Boolean).join(' · ');
    case 'salud':   return [d.reason, d.product].filter(Boolean).join(' · ');
    case 'servicio': {
      const sire = d.sire_id ? byId?.[d.sire_id]?.name : d.sire;
      return [d.kind ? t(`lv.serviceKind.${d.kind}`) : '', sire].filter(Boolean).join(' · ');
    }
    case 'venta':   return [d.buyer, d.price != null && d.price !== '' ? `${d.currency === 'USD' ? 'US$' : 'C$'} ${formatNum(d.price, 2)}` : ''].filter(Boolean).join(' · ');
    case 'muerte':  return d.cause || '';
    case 'traslado': return d.lot ? `→ ${d.lot}` : '';
    default: return '';
  }
}

export function fmtDate(iso, locale, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = toDate(iso);
  return d ? d.toLocaleDateString(locale, opts) : '—';
}

export function SectionTitle({ children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}
