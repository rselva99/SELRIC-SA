import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { monthLong, useChartTheme } from './theme';
import { ChartTooltip, catAxisY, grid, gridX, monthAxis, numAxis, numAxisX } from './parts';

// The five shapes the Business and Ganadería charts are drawn with. Each
// fills its ChartCard; colours come from the theme, numbers are formatted by
// the caller (fmtAxis for ticks, fmtValue for the tooltip). Animation is off:
// the charts appear drawn, and nothing moves for people who asked for less
// motion.

const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };
const trim = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// Lines over months. series: [{ key, label, color }]; titleOf(month) heads
// the tooltip (default: the month in full). `axis(th)` swaps the month axis
// for another one from ./parts (dayAxis for weeks), called as a function.
export function MonthLines({ data, series, locale, fmtAxis, fmtValue, extra, zero = true, titleOf, axis, dots = false }) {
  const th = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={MARGIN}>
        {grid(th)}
        {axis ? axis(th) : monthAxis(th, locale)}
        {numAxis(th, fmtAxis)}
        {zero && <ReferenceLine y={0} stroke={th.text} strokeOpacity={0.35} />}
        <Tooltip cursor={{ stroke: th.grid }} content={<ChartTooltip th={th} title={titleOf || ((l) => monthLong(l, locale))} fmt={fmtValue} extra={extra} />} />
        {series.map((s) => (
          <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
            dot={dots ? { r: 4, strokeWidth: 2, stroke: th.surface, fill: s.color } : false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: th.surface }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Bars over months, side by side or stacked. Stacked segments are parted by a
// hairline of the surface colour, and only the top one is rounded. `integers`
// keeps the ticks on whole numbers, for counts.
export function MonthBars({ data, series, stacked = false, locale, fmtAxis, fmtValue, extra, titleOf, integers = false }) {
  const th = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={MARGIN} barGap={2} barCategoryGap="22%">
        {grid(th)}
        {monthAxis(th, locale)}
        {numAxis(th, fmtAxis, integers ? { allowDecimals: false, width: 32 } : {})}
        <Tooltip cursor={{ fill: th.cursor }} content={<ChartTooltip th={th} title={titleOf || ((l) => monthLong(l, locale))} fmt={fmtValue} extra={extra} />} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={stacked ? 32 : 18} isAnimationActive={false}
            stackId={stacked ? 'stack' : undefined}
            stroke={stacked ? th.surface : undefined} strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Horizontal bars for named things (accounts, statuses): the name down the
// side, the amount along. data: [{ label, value }].
export function NamedBars({ data, color, valueName, fmtAxis, fmtValue, labelWidth = 132, extra }) {
  const th = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="24%">
        {gridX(th)}
        {numAxisX(th, fmtAxis)}
        {catAxisY(th, { width: labelWidth, tickFormatter: (v) => trim(v, Math.floor(labelWidth / 6.5)) })}
        <Tooltip cursor={{ fill: th.cursor }} content={<ChartTooltip th={th} fmt={fmtValue} extra={extra} />} />
        <Bar dataKey="value" name={valueName} fill={color || th.series[0]} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.label} fill={d.color || color || th.series[0]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Horizontal stacked bars for named things made of parts (a lot and its
// cows, young stock, calves, bulls). data: [{ label, [series.key]: n }].
// Segments are parted by a hairline of the surface; only the last is rounded.
export function NamedStack({ data, series, fmtAxis, fmtValue, labelWidth = 120, extra }) {
  const th = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="24%">
        {gridX(th)}
        {numAxisX(th, fmtAxis, { allowDecimals: false })}
        {catAxisY(th, { width: labelWidth, tickFormatter: (v) => trim(v, Math.floor(labelWidth / 6.5)) })}
        <Tooltip cursor={{ fill: th.cursor }} content={<ChartTooltip th={th} fmt={fmtValue} extra={extra} />} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId="stack" maxBarSize={22} isAnimationActive={false}
            stroke={th.surface} strokeWidth={1} radius={i === series.length - 1 ? [0, 4, 4, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// A waterfall laid out top to bottom, like a bridge statement: each bar
// spans [low, high] of the running balance; balances are drawn in the total
// tone, money in in `up`, money out in `down`.
// bars: [{ key, name, range: [low, high], value, kind: 'total' | 'up' | 'down' }].
export function Waterfall({ bars, valueName, fmtAxis, fmtValue, labelWidth = 132 }) {
  const th = useChartTheme();
  const data = bars.map((b) => ({ ...b, label: b.name, __color: th[b.kind] }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barCategoryGap="20%">
        {gridX(th)}
        {numAxisX(th, fmtAxis, { domain: ['auto', 'auto'] })}
        {catAxisY(th, { width: labelWidth, tickFormatter: (v) => trim(v, Math.floor(labelWidth / 6.5)) })}
        <ReferenceLine x={0} stroke={th.text} strokeOpacity={0.35} />
        <Tooltip cursor={{ fill: th.cursor }} content={<ChartTooltip th={th} fmt={fmtValue} />} />
        <Bar dataKey="range" name={valueName} radius={3} maxBarSize={22} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.key} fill={d.__color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
