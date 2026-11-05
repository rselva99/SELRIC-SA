import { Link } from 'react-router-dom';
import { ChevronRight, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n/I18nContext';
import Spinner from '../../components/ui/Spinner';
import {
  monogram, EVENT_BY_KEY, formatNum, toDate, isActive, pregnancyMonths, gestationMonths,
  expectedCalving, daysBetween, todayISO, GROUP_ORDER,
} from './lib';

// The pieces every Ganadería page is built from — the corral notebook's own
// look: paper, ink, ear tags, and clay for what is due.

// ── Chapa (ear tag) ─────────────────────────────────────────────────────────
// The animal's mark as it hangs from the ear: a tag with the punched slot at
// the top and the chapa number below it. The colour says what the animal is;
// a closed card (sold, died) goes grey. No chapa → the name's two letters.
const TAG_TONE = {
  vaca: 'bg-finca-green text-white', cerda: 'bg-finca-green text-white',
  toro: 'bg-finca-forest text-white', verraco: 'bg-finca-forest text-white',
  vaquilla: 'bg-finca-teal text-white', novillo: 'bg-finca-teal text-white', engorde: 'bg-finca-teal text-white',
  ternero: 'bg-finca-amber text-finca-amberInk', ternera: 'bg-finca-amber text-finca-amberInk', lechon: 'bg-finca-amber text-finca-amberInk',
};
// The top padding (about a fifth of the width) keeps the number clear of the
// slot. It is in pixels: a percentage would be read off the parent's width.
const TAG_SIZE = {
  sm: { box: 'w-[30px] h-[34px] pt-[7px]', radius: '6px 6px 11px 11px', slot: 'w-[11px] h-[3px] top-[5px]', text: ['text-[12px]', 'text-[11px]', 'text-[10px]', 'text-[9px]'] },
  md: { box: 'w-[44px] h-[50px] pt-[10px]', radius: '8px 8px 14px 14px', slot: 'w-[15px] h-[4px] top-[7px]', text: ['text-[17px]', 'text-[15px]', 'text-[13px]', 'text-[11px]'] },
  lg: { box: 'w-[68px] h-[76px] pt-[15px]', radius: '11px 11px 20px 20px', slot: 'w-[22px] h-[6px] top-[10px]', text: ['text-[26px]', 'text-[23px]', 'text-[20px]', 'text-[16px]'] },
};

export function ChapaTag({ animal, size = 'md', className }) {
  const { t } = useT();
  const s = TAG_SIZE[size] || TAG_SIZE.md;
  const tag = String(animal?.tag || '').trim();
  const shown = tag ? tag.slice(0, 6) : monogram(animal?.name);
  const len = shown.length;
  const text = s.text[len <= 2 ? 0 : len === 3 ? 1 : len === 4 ? 2 : 3];
  const tone = animal && !isActive(animal) ? 'bg-finca-lineSoft text-finca-ink2' : TAG_TONE[animal?.category] || 'bg-finca-green text-white';
  return (
    <span className={cn('relative shrink-0 inline-flex items-center justify-center font-bold tabular-nums leading-none tracking-tight', s.box, tone, className)} style={{ borderRadius: s.radius }}>
      <span className={cn('absolute inset-x-0 mx-auto rounded-full bg-black/20', s.slot)} aria-hidden="true" />
      {tag ? <><span className="sr-only">{t('lv.fields.tag')} </span><span className={text}>{shown}</span></> : <span className={text} aria-hidden="true">{shown}</span>}
    </span>
  );
}

// The fierro as the notebook writes it: "AB/12".
export function BrandChip({ brand, className }) {
  if (!brand) return null;
  return (
    <span className={cn('inline-flex items-center h-6 px-1.5 rounded-md border border-finca-amberInk/40 text-finca-amberInk bg-finca-surface font-mono text-[11px] font-semibold tracking-wider', className)}>
      {brand}
    </span>
  );
}

const STATUS_PILL = {
  activo: 'bg-finca-greenSoft text-finca-green',
  vendido: 'bg-finca-amber text-finca-amberInk',
  muerto: 'bg-finca-lineSoft text-finca-ink',
  historico: 'bg-finca-lineSoft text-finca-ink2',
};
export function StatusBadge({ status, className }) {
  const { t } = useT();
  return <span className={cn('inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold', STATUS_PILL[status] || STATUS_PILL.historico, className)}>{t(`lv.status.${status}`)}</span>;
}

export function FlagChip({ flag, className }) {
  const { t } = useT();
  const strong = flag === 'vender' || flag === 'mal_parto' || flag === 'mala_madre' || flag === 'por_confirmar';
  return (
    <span className={cn('inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold', strong ? 'bg-finca-claySoft text-finca-clayText' : 'bg-finca-lineSoft text-finca-ink2', className)}>
      {t(`lv.flags.${flag}`)}
    </span>
  );
}

// ── Numbers ─────────────────────────────────────────────────────────────────
// A big serif number with its label under it. A link or button when it leads
// somewhere.
export function Kpi({ label, value, sub, to, onClick, className }) {
  const body = (
    <>
      <div className="font-display text-[26px] md:text-[30px] leading-none text-finca-ink tabular-nums truncate">{value}</div>
      <div className="text-[13px] font-medium text-finca-ink2 mt-2">{label}</div>
      {sub && <div className="text-[12px] text-finca-ink2 mt-0.5 truncate">{sub}</div>}
    </>
  );
  const cls = cn('block rounded-2xl bg-finca-surface border border-finca-line shadow-finca px-4 py-3.5 text-left min-w-0', (to || onClick) && 'hover:border-finca-field transition-colors', className);
  if (to) return <Link to={to} className={cls}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{body}</button>;
  return <div className={cls}>{body}</div>;
}

// ── Event marks ─────────────────────────────────────────────────────────────
// Families share a colour: calving green, the reproductive checks teal, milk
// blue, weights and money straw, health and bad calvings clay, the rest ink.
const EVENT_TONE = {
  parto: 'bg-finca-greenSoft text-finca-green',
  palpacion: 'bg-finca-tealSoft text-finca-teal', servicio: 'bg-finca-tealSoft text-finca-teal', celo: 'bg-finca-tealSoft text-finca-teal',
  leche: 'bg-finca-leche text-finca-lecheInk',
  peso: 'bg-finca-amber text-finca-amberInk', destete: 'bg-finca-amber text-finca-amberInk', venta: 'bg-finca-amber text-finca-amberInk',
  vacuna: 'bg-finca-claySoft text-finca-clayText', salud: 'bg-finca-claySoft text-finca-clayText', mal_parto: 'bg-finca-claySoft text-finca-clayText',
  muerte: 'bg-finca-lineSoft text-finca-ink', traslado: 'bg-finca-lineSoft text-finca-ink2', nota: 'bg-finca-lineSoft text-finca-ink2',
};
const ICON_SIZE = { sm: ['w-7 h-7 rounded-lg', 14], md: ['w-9 h-9 rounded-xl', 17], lg: ['w-11 h-11 rounded-xl', 21] };

export function EventIcon({ type, size = 'md', className }) {
  const def = EVENT_BY_KEY[type];
  const [box, px] = ICON_SIZE[size] || ICON_SIZE.md;
  const Icon = def?.icon;
  return (
    <span className={cn('shrink-0 flex items-center justify-center', box, EVENT_TONE[type] || EVENT_TONE.nota, className)} aria-hidden="true">
      {Icon && <Icon size={px} />}
    </span>
  );
}

// One line that says what an event was: "Ternera · Cría de Golondrina" /
// "Preñada, 6 meses" / "412 kg".
export function eventSummary(ev, t, byId) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'parto': {
      const calf = d.calf_id ? byId?.[d.calf_id] : null;
      const sex = d.calf_sex ? t(d.calf_sex === 'M' ? 'lv.calfMale' : 'lv.calfFemale') : '';
      return [sex, d.calf_dead ? t('lv.reg.calfDead') : calf?.name].filter(Boolean).join(' · ');
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

// tn() fills only {n}; this is the same choice of the `…One` form when the
// string needs other values too.
export function tcount(t, key, n, vars = {}) {
  return t(n === 1 ? `${key}One` : key, { n, ...vars });
}

// "3 vacas" / "1 vaca" — the category's own singular and plural.
export function countCat(n, category, t) {
  return `${n} ${t(n === 1 ? `lv.category.${category}` : `lv.categoryPlural.${category}`).toLowerCase()}`;
}

// ── Page furniture ──────────────────────────────────────────────────────────
export function PageTitle({ children, sub, action }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[30px] md:text-[36px] leading-tight text-finca-ink">{children}</h1>
        {sub && <p className="text-[14px] text-finca-ink2 mt-0.5">{sub}</p>}
      </div>
      {action && <div className="shrink-0 flex gap-2">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, count, action, className }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 mb-3', className)}>
      <h2 className="font-display text-[22px] leading-tight text-finca-ink flex items-center gap-2">
        {children}
        {count > 0 && <span className="inline-flex items-center justify-center min-w-[26px] h-[26px] px-2 rounded-full bg-finca-clay text-white font-body text-[13px] font-bold tabular-nums">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function Card({ children, className, as: Tag = 'section' }) {
  return <Tag className={cn('rounded-2xl bg-finca-surface border border-finca-line shadow-finca', className)}>{children}</Tag>;
}

export function Loading() {
  const { t } = useT();
  return <div className="flex items-center gap-3 text-finca-ink2 text-sm py-6"><Spinner size="sm" /> {t('common.loading')}</div>;
}

export function LoadFailed() {
  const { t } = useT();
  return <Card className="p-6 text-sm text-finca-clayText">{t('lv.loadFailed')}</Card>;
}

// Buttons. Clay is for the one thing to do; the rest are paper.
export const btnClay = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-[14px] bg-finca-clay text-white text-[16px] font-semibold hover:bg-finca-clayText active:bg-finca-clayText disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
export const btnPaper = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-[14px] bg-finca-surface text-finca-ink text-[16px] font-semibold border border-finca-field/60 hover:border-finca-field hover:bg-finca-lineSoft disabled:opacity-50 transition-colors';
export const btnForest = 'inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-[14px] bg-finca-forest text-white text-[16px] font-semibold hover:bg-finca-green disabled:opacity-50 transition-colors';
export const fieldCls = 'w-full min-h-[48px] px-4 rounded-[12px] bg-finca-surface border border-finca-field text-[16px] text-finca-ink placeholder:text-finca-ink2/70 focus:outline-none focus:ring-2 focus:ring-finca-green/30 focus:border-finca-green';
export const labelCls = 'block text-[13px] font-semibold text-finca-ink2 mb-1.5';

// ── Chips ───────────────────────────────────────────────────────────────────
// A 36 px pill with a 44 px tap area. Every filter is a chip; none is a select.
export function Chip({ on, onClick, children, count, className, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'relative shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-[14px] font-medium whitespace-nowrap transition-colors',
        "before:content-[''] before:absolute before:-inset-y-1 before:inset-x-0",
        on ? 'bg-finca-forest border-finca-forest text-white' : 'bg-finca-surface border-finca-line text-finca-ink hover:border-finca-field',
        className,
      )}
      {...rest}
    >
      {children}
      {count != null && <span className={cn('tabular-nums text-[13px]', on ? 'text-finca-mist' : 'text-finca-ink2')}>{count}</span>}
    </button>
  );
}

// The row scrolls sideways on a phone, edge to edge, with the fade on the right.
export function ChipRow({ label, children, className }) {
  return (
    <div role="group" aria-label={label} className={cn('chip-row -mx-4 pl-4 pr-8 sm:-mx-6 sm:pl-6 md:mx-0 md:pl-0 py-1', className)}>
      {children}
    </div>
  );
}

// ── Pregnancy ───────────────────────────────────────────────────────────────
// A 9-month track (4 for a sow) filled to today, and "7 m · pare 24 nov".
// The fill turns clay within 45 days of the calving and once it is late.
export function PregnancyBar({ animal, today = todayISO(), size = 'sm', className }) {
  const { t, locale } = useT();
  const months = pregnancyMonths(animal, today);
  if (months == null) return null;
  const cells = Math.round(gestationMonths(animal));
  const due = expectedCalving(animal);
  const days = due ? daysBetween(today, due) : null;
  const late = days != null && days < 0;
  const soon = days != null && days <= 45;
  const fill = Math.min(1, months / cells);
  const m = Math.min(Math.round(months), cells);
  const date = due ? fmtDate(due, locale, { day: 'numeric', month: 'short' }) : null;
  const label = late ? t('lv.preg.late', { date }) : date ? t('lv.preg.label', { m, date }) : t('lv.preg.months', { m });
  return (
    <div className={cn('min-w-0', className)}>
      <div className={cn('flex gap-[2px]', size === 'md' ? 'h-[8px]' : 'h-[6px]')} aria-hidden="true">
        {Array.from({ length: cells }, (_, i) => {
          const part = Math.max(0, Math.min(1, fill * cells - i));
          return (
            <span key={i} className="flex-1 rounded-[2px] bg-finca-lineSoft overflow-hidden">
              <span className={cn('block h-full', soon ? 'bg-finca-clay' : 'bg-finca-green')} style={{ width: `${part * 100}%` }} />
            </span>
          );
        })}
      </div>
      <div className={cn('mt-1 font-semibold tabular-nums truncate', size === 'md' ? 'text-[14px]' : 'text-[12px]', late || soon ? 'text-finca-clayText' : 'text-finca-ink')}>{label}</div>
    </div>
  );
}

// ── Hoy te toca ─────────────────────────────────────────────────────────────
// One thing to do. The whole row is the link; the clay edge says "yours".
export function NeedsYouRow({ to, lead, title, sub }) {
  return (
    <Link to={to} className="flex items-center gap-3 min-h-[64px] pl-3 pr-2 py-2.5 rounded-2xl bg-finca-surface border border-finca-line border-l-[5px] border-l-finca-clay shadow-finca hover:bg-finca-lineSoft/50 transition-colors">
      {lead}
      <span className="flex-1 min-w-0">
        <span className="block text-[16px] leading-snug font-semibold text-finca-ink line-clamp-2">{title}</span>
        {sub && <span className="block text-[13px] text-finca-ink2 truncate">{sub}</span>}
      </span>
      <ChevronRight size={20} className="shrink-0 text-finca-ink2" aria-hidden="true" />
    </Link>
  );
}

// The section: up to `max` rows, the total beside the title only when there
// is something to do, and a plain line when there is nothing.
export function NeedsYouList({ items, max = 5 }) {
  const { t, tn } = useT();
  return (
    <section aria-labelledby="lv-needs-you">
      <SectionTitle count={items.length}><span id="lv-needs-you">{t('lv.need.title')}</span></SectionTitle>
      {items.length === 0 ? (
        <Card className="flex items-center gap-3 px-4 py-4">
          <CheckCircle2 size={24} className="shrink-0 text-finca-green" aria-hidden="true" />
          <div>
            <div className="text-[16px] font-semibold text-finca-ink" data-testid="lv-nothing-due">{t('lv.need.empty')}</div>
            <div className="text-[13px] text-finca-ink2">{t('lv.need.emptySub')}</div>
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, max).map(({ key, ...row }) => <li key={key}><NeedsYouRow {...row} /></li>)}
          {items.length > max && <li className="text-[13px] text-finca-ink2 px-1">{tn('lv.need.more', items.length - max)}</li>}
        </ul>
      )}
    </section>
  );
}

// ── Milk ────────────────────────────────────────────────────────────────────
// Daily litres as plain bars, today's the darkest. Each bar names its day and
// litres on hover; the whole chart reads as one sentence to a screen reader.
export function MilkBars({ series, height = 56, labels = false, valueOnLast = false, summary, className }) {
  const { locale } = useT();
  const max = Math.max(0, ...series.map((d) => d.liters));
  const last = series.length - 1;
  return (
    <div className={cn('min-w-0', className)}>
      <div role="img" aria-label={summary} className="relative flex items-end gap-[3px]" style={{ height }}>
        {series.map((d, i) => (
          <div key={d.date} className="flex-1 h-full flex flex-col justify-end min-w-0" title={`${fmtDate(d.date, locale, { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatNum(d.liters)} L`}>
            {valueOnLast && i === last && d.liters > 0 && <div className="text-[12px] font-semibold text-finca-lecheInk text-center tabular-nums mb-0.5">{formatNum(d.liters, 0)} L</div>}
            <div
              className={cn('w-full rounded-t-[4px]', i === last ? 'bg-finca-lecheInk' : 'bg-finca-lecheInk/55')}
              style={{ height: max > 0 && d.liters > 0 ? `${Math.max(6, (d.liters / max) * (valueOnLast ? 78 : 100))}%` : '2px' }}
            />
          </div>
        ))}
      </div>
      {labels && (
        <div className="flex gap-[3px] mt-1" aria-hidden="true">
          {series.map((d) => (
            <div key={d.date} className="flex-1 text-center text-[11px] text-finca-ink2 tabular-nums">{toDate(d.date)?.getDate()}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Lots ────────────────────────────────────────────────────────────────────
// The mix of a lot as one bar: cows, young stock, calves, bulls. The counts
// are always written next to it, so the colours are never the only clue.
const GROUP_FILL = { hembras: 'bg-finca-green', jovenes: 'bg-finca-mist', crias: 'bg-finca-straw', machos: 'bg-finca-forest' };

export function LotBar({ groups, total, className }) {
  if (!total) return <div className={cn('h-2 rounded-full bg-finca-lineSoft', className)} />;
  return (
    <div className={cn('flex h-2 gap-[2px] rounded-full overflow-hidden bg-finca-lineSoft', className)} aria-hidden="true">
      {GROUP_ORDER.filter((g) => groups[g] > 0).map((g) => (
        <span key={g} className={GROUP_FILL[g]} style={{ width: `${(groups[g] / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function GroupLegend({ groups, className }) {
  const { tn } = useT();
  const parts = GROUP_ORDER.filter((g) => groups[g] > 0);
  if (!parts.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-finca-ink2', className)}>
      {parts.map((g) => (
        <span key={g} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn('w-2 h-2 rounded-full', GROUP_FILL[g])} aria-hidden="true" />
          {tn(`lv.group.${g}`, groups[g])}
        </span>
      ))}
    </div>
  );
}
