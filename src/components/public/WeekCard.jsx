import { Check } from 'lucide-react';

// "This week at …" — the illustrative dashboard card used in the hero of the
// home page and of every program page. `week` = { title, business, rows:
// [[label, value, note]], footer, badge } from translations; `tone` = the
// program's dark background class; `animate` posts the lines in once on load.
export default function WeekCard({ week, tone = 'bg-brand-950', animate = true, compact = false, className = '' }) {
  const rows = compact ? week.rows.slice(0, 3) : week.rows;
  return (
    <figure className={`${tone} text-white rounded-2xl ${compact ? 'p-5' : 'p-6 sm:p-7'} shadow-modal ${className}`} aria-label={`${week.title} — ${week.business}`}>
      <div className="flex items-baseline justify-between gap-4">
        <figcaption className={`font-display ${compact ? 'text-lg' : 'text-xl'}`}>{week.title}</figcaption>
        <span className="text-xs text-white/60 truncate">{week.business}</span>
      </div>

      <dl className="mt-3">
        {rows.map(([label, value, note], i) => (
          <div
            key={label}
            className={`${animate ? 'week-row' : ''} flex items-baseline justify-between gap-4 ${compact ? 'py-2' : 'py-3'} border-t border-white/10`}
            style={animate ? { animationDelay: `${0.25 + i * 0.16}s` } : undefined}
          >
            <dt className="min-w-0">
              <div className={`${compact ? 'text-sm' : 'text-[15px]'} text-white/90`}>{label}</div>
              <div className={`text-xs mt-0.5 ${i === 1 ? 'text-white/80' : i === 4 ? 'text-amber-300' : 'text-white/55'}`}>{note}</div>
            </dt>
            <dd className={`font-mono ${compact ? 'text-sm' : 'text-[15px] sm:text-base'} text-white shrink-0`}>{value}</dd>
          </div>
        ))}
        {!compact && (
          <div className={`${animate ? 'week-row' : ''} flex items-center justify-between gap-4 pt-4 mt-1 border-t border-white/20`} style={animate ? { animationDelay: '1.3s' } : undefined}>
            <dt className="text-sm text-white/70">{week.footer}</dt>
            <dd className="inline-flex items-center gap-1 rounded-full bg-white/15 text-white text-xs px-2 py-0.5 shrink-0">
              <Check size={12} /> {week.badge}
            </dd>
          </div>
        )}
      </dl>
    </figure>
  );
}
