import { CartesianGrid, XAxis, YAxis } from 'recharts';
import { monthShort } from './theme';

// Axes and grid for the shared charts. They are functions that return
// recharts elements and are called as {monthAxis(th, locale)} — never rendered
// as <MonthAxis />: recharts finds its axes by element type and silently
// ignores a wrapper component. Hairline grid, no axis lines, muted ticks.

const tick = (th) => ({ fontSize: 11, fill: th.text });

export const grid = (th) => <CartesianGrid vertical={false} stroke={th.grid} strokeWidth={1} />;
export const gridX = (th) => <CartesianGrid horizontal={false} stroke={th.grid} strokeWidth={1} />;

export const monthAxis = (th, locale, p = {}) => (
  <XAxis dataKey="month" tickFormatter={(v) => monthShort(v, locale)} tick={tick(th)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} {...p} />
);
export const numAxis = (th, format, p = {}) => (
  <YAxis tickFormatter={(v) => format(v)} tick={tick(th)} tickLine={false} axisLine={false} width={52} {...p} />
);
// Horizontal bars (layout="vertical"): the number along X, the names down Y.
export const numAxisX = (th, format, p = {}) => (
  <XAxis type="number" tickFormatter={(v) => format(v)} tick={tick(th)} tickLine={false} axisLine={false} {...p} />
);
export const catAxisY = (th, p = {}) => (
  <YAxis type="category" dataKey="label" tick={tick(th)} tickLine={false} axisLine={false} width={120} interval={0} {...p} />
);
export const catAxisX = (th, p = {}) => (
  <XAxis type="category" dataKey="label" tick={tick(th)} tickLine={false} axisLine={false} interval={0} {...p} />
);

// One tooltip for every chart: the value strong, the series name after it,
// keyed by a short stroke of the series colour. `title` turns the hovered
// label into the heading; `fmt` (or per-key `fmts`) formats each value.
export function ChartTooltip({ active, payload, label, th, title = (l) => l, fmt = (v) => v, fmts = {}, extra }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null && !p.hide && p.dataKey !== '__base');
  return (
    <div className="rounded-lg border px-3 py-2 shadow-card text-xs" style={{ background: th.surface, borderColor: th.border, color: th.ink }}>
      <div className="mb-1" style={{ color: th.text }}>{title(label, payload)}</div>
      {rows.map((p) => {
        const f = fmts[p.dataKey] || fmt;
        const v = Array.isArray(p.value) ? f(p.payload?.value ?? p.value[1] - p.value[0]) : f(p.value, p);
        const color = p.payload?.__color || (p.stroke && p.stroke !== 'none' ? p.stroke : p.fill || p.color);
        return (
          <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: color }} />
            <span className="font-semibold tabular-nums">{v}</span>
            <span style={{ color: th.text }}>{p.name}</span>
          </div>
        );
      })}
      {extra && <div className="mt-1" style={{ color: th.text }}>{extra(label, payload)}</div>}
    </div>
  );
}

export function Swatch({ kind = 'rect', color }) {
  if (kind === 'line') return <span aria-hidden="true" className="inline-block w-4 h-0.5 rounded" style={{ background: color }} />;
  return <span aria-hidden="true" className="inline-block w-3 h-2.5 rounded-sm" style={{ background: color }} />;
}
