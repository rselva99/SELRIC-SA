import { useId, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { useChartTheme } from './theme';
import { Swatch } from './parts';

// A chart with its table twin, its legend and its empty state.
//   title, hint   the heading and one line on how to read it
//   legend        [{ label, color, kind: 'rect' | 'line' }] — shown for two or more series
//   table         { cols: [{ key, label, fmt, left }], rows } — the same numbers as a table
//   empty         true → no chart, the empty line instead (emptyText or the default)
//   summary       what the chart shows, for screen readers (the chart is role="img")
// The children are the chart itself (a ResponsiveContainer fills `height`).
export default function ChartCard({ title, hint, legend = [], table, empty = false, emptyText, height = 240, summary, right, className = '', children }) {
  const { t } = useT();
  const th = useChartTheme();
  const [view, setView] = useState('chart');
  const id = useId();
  const asTable = view === 'table' && table && !empty;
  return (
    <figure aria-labelledby={`${id}-title`} className={`rounded-xl border p-4 sm:p-5 min-w-0 ${className}`} style={{ background: th.surface, borderColor: th.border }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="font-medium leading-snug" style={{ color: th.ink }}>{title}</h3>
          {hint && <p className="mt-0.5 text-xs leading-snug max-w-[60ch]" style={{ color: th.text }}>{hint}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {right}
          {table && !empty && (
            <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: th.border }} role="group" aria-label={title}>
              {[['chart', BarChart3, t('charts.showChart')], ['table', Table2, t('charts.showTable')]].map(([k, Icon, label]) => (
                <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k} aria-label={label} title={label}
                  className="w-9 h-9 flex items-center justify-center"
                  style={{ background: view === k ? th.empty : 'transparent', color: view === k ? th.ink : th.text }}>
                  <Icon size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {legend.length > 1 && !empty && !asTable && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: th.text }} aria-label={t('charts.legend')}>
          {legend.map((l) => <li key={l.label} className="inline-flex items-center gap-1.5"><Swatch kind={l.kind} color={l.color} />{l.label}</li>)}
        </ul>
      )}

      {empty ? (
        <div role="note" className="mt-3 flex items-center justify-center rounded-lg px-6 text-center text-sm" style={{ height: Math.min(height, 160), background: th.empty, color: th.text }}>
          {emptyText || t('charts.empty')}
        </div>
      ) : asTable ? (
        <div className="mt-3 max-h-80 overflow-auto rounded-lg border" style={{ borderColor: th.border }}>
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 text-[10px] uppercase tracking-wide" style={{ background: th.empty, color: th.text }}>
              <tr>{table.cols.map((c) => <th key={c.key} scope="col" className={`px-2.5 py-1.5 font-semibold ${c.left ? 'text-left' : 'text-right'}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t" style={{ borderColor: th.border }}>
                  {table.cols.map((c) => (
                    <td key={c.key} className={`px-2.5 py-1.5 ${c.left ? 'text-left' : 'text-right font-mono'}`} style={{ color: th.ink }}>
                      {r[c.key] == null ? '—' : c.fmt ? c.fmt(r[c.key], r) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={summary || title} className="mt-3" style={{ height }}>{children}</div>
      )}
    </figure>
  );
}
