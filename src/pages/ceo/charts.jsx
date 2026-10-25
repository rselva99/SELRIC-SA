import { useState } from 'react';
import { CartesianGrid, XAxis, YAxis } from 'recharts';
import { Table2, LineChart as LineIcon } from 'lucide-react';

// The pieces every chart on the CEO pages is built from, so they read as one
// system: one palette, one tooltip, one card with a table twin.
//
// Colours were run through a colour-vision validator against a white surface:
// the three segment hues clear every check as a set; the gray is the
// de-emphasis tone for context series and is never used as an identity.
export const C = {
  brand: '#2f8a63',   // SelRic; US · Business; the base case
  blue:  '#1971c2',   // Nicaragua · Business
  clay:  '#c2562a',   // Nicaragua · Ganadería
  ink:   '#212529',   // actuals — the thing that is real
  gray:  '#adb5bd',   // context: plan ceilings, competitors, other scenarios
  grayL: '#dee2e6',
  amber: '#f59f00',   // status only: a capped month, an overdue date
  red:   '#e03131',
  grid:  '#e9ecef',
  text:  '#868e96',
};
export const SEG = [
  { key: 'usB', label: 'US · Business',          color: C.brand },
  { key: 'niB', label: 'Nicaragua · Business',   color: C.blue },
  { key: 'niG', label: 'Nicaragua · Ganadería',  color: C.clay },
];

export const usd  = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
export const usdK = (n) => (Math.abs(n) >= 1000 ? (n < 0 ? '−$' : '$') + (Math.abs(n) / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1) + 'K' : usd(n));
export const num  = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct  = (x, d = 0) => (x == null ? '—' : (x * 100).toFixed(d) + '%');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const mon  = (label) => (label ? `${MON[Number(label.slice(5, 7)) - 1]} ${label.slice(2, 4)}` : '');
export const nowLabel = () => new Date().toISOString().slice(0, 7);

// Shared axis and grid elements — called as functions ({MonthAxis()}), not
// rendered as components, because recharts finds its axes by element type.
// Hairline solid grid, no axis lines, muted ticks.
export const tick = { fontSize: 11, fill: C.text };
export const Grid = () => <CartesianGrid vertical={false} stroke={C.grid} strokeWidth={1} />;
export const MonthAxis = (p = {}) => <XAxis dataKey="label" tickFormatter={(v) => mon(v)} tick={tick} tickLine={false} axisLine={false} interval={5} minTickGap={16} {...p} />;
export const NumAxis = ({ fmt = num, width = 44, ...p } = {}) => <YAxis tickFormatter={(v) => fmt(v)} tick={tick} tickLine={false} axisLine={false} width={width} {...p} />;
// For horizontal bars (layout="vertical"): the number runs along X, the category down Y.
export const NumAxisX = ({ fmt = num, ...p } = {}) => <XAxis type="number" tickFormatter={(v) => fmt(v)} tick={tick} tickLine={false} axisLine={false} {...p} />;
export const CatAxisY = ({ width = 170, ...p } = {}) => <YAxis type="category" dataKey="name" tick={tick} tickLine={false} axisLine={false} width={width} interval={0} {...p} />;

// One tooltip for every chart. The value is the strong element; the series
// name follows it, keyed by a short stroke of the series colour.
export function Tip({ active, payload, label, title = mon, fmt = num, fmts = {} }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null && !p.hide);
  return (
    <div className="rounded-lg border border-surface-200 bg-white px-3 py-2 shadow-card text-xs">
      <div className="text-surface-500 mb-1">{title(label)}</div>
      {rows.map((p) => {
        const f = fmts[p.dataKey] || fmt;
        const v = Array.isArray(p.value) ? `${f(p.value[0])} – ${f(p.value[1])}` : f(p.value);
        return (
          <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: p.stroke && p.stroke !== 'none' ? p.stroke : p.fill || p.color }} />
            <span className="font-semibold text-surface-900 tabular-nums">{v}</span>
            <span className="text-surface-500">{p.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function Swatch({ kind, color }) {
  if (kind === 'line') return <span className="inline-block w-4 h-0.5 rounded" style={{ background: color }} />;
  if (kind === 'dot') return <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />;
  if (kind === 'band') return <span className="inline-block w-4 h-2.5 rounded-sm" style={{ background: color, opacity: 0.25 }} />;
  return <span className="inline-block w-3 h-2.5 rounded-sm" style={{ background: color }} />;
}

// A chart with its table twin. `table` is { cols: [{ key, label, fmt, right }], rows }.
// The legend is always rendered when there are two or more series.
export function ChartCard({ id, title, hint, legend = [], table, height = 260, children, right, className = '' }) {
  const [view, setView] = useState('chart');
  return (
    <section id={id} className={`rounded-xl border border-surface-200 bg-white p-4 scroll-mt-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-surface-900">{title}</div>
          {hint && <div className="mt-0.5 text-xs text-surface-500 leading-snug max-w-[60ch]">{hint}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {right}
          {table && (
            <div className="inline-flex rounded-lg border border-surface-200 overflow-hidden">
              {[['chart', LineIcon, 'Chart'], ['table', Table2, 'Table']].map(([k, Icon, l]) => (
                <button key={k} type="button" onClick={() => setView(k)} aria-label={l} title={l}
                  className={`px-2 py-1 ${view === k ? 'bg-surface-100 text-surface-900' : 'text-surface-400 hover:text-surface-700'}`}><Icon size={14} /></button>
              ))}
            </div>
          )}
        </div>
      </div>
      {legend.length > 1 && view === 'chart' && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-surface-600">
          {legend.map((l) => <span key={l.label} className="inline-flex items-center gap-1.5"><Swatch kind={l.kind || 'rect'} color={l.color} />{l.label}</span>)}
        </div>
      )}
      {view === 'chart' ? (
        <div className="mt-3" style={{ height }}>{children}</div>
      ) : (
        <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-surface-100">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-surface-50 text-[10px] uppercase tracking-wide text-surface-500">
              <tr>{table.cols.map((c) => <th key={c.key} className={`px-2.5 py-1.5 font-semibold ${c.right === false ? 'text-left' : 'text-right'}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-surface-100">
                  {table.cols.map((c) => <td key={c.key} className={`px-2.5 py-1.5 ${c.right === false ? 'text-left text-surface-800' : 'text-right font-mono text-surface-700'}`}>{r[c.key] == null ? '—' : (c.fmt || num)(r[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
