import { useMemo } from 'react';
import { useT } from '../../i18n/I18nContext';
import ChartCard from '../../components/charts/ChartCard';
import { MonthBars, MonthLines, NamedStack } from '../../components/charts/charts';
import { THEMES, ChartThemeName, count, dayShort, monthLong } from '../../components/charts/theme';
import { dayAxis } from '../../components/charts/parts';
import { GROUP_ORDER, lotComposition, calvingsByMonth, milkPerCow, formatNum, todayISO } from './lib';

// The herd's charts, drawn with the shared chart system on the finca's paper
// (the `finca` chart theme). Inicio shows two of them; Informes shows all
// three. recharts comes with this file only, so both pages load it after
// their numbers.

const FINCA = THEMES.finca;
// The lot mix keeps one hue per kind of animal everywhere it is drawn (the
// bars on Inicio use the same through GROUP_COLOR in ./components).
const GROUP_SERIES = GROUP_ORDER.map((g, i) => ({ key: g, color: FINCA.series[i] }));

function Finca({ children }) {
  return <ChartThemeName.Provider value="finca">{children}</ChartThemeName.Provider>;
}

const cardCls = 'rounded-2xl shadow-finca';

// Active animals per lot, stacked by kind. A lot is one bar, so the chart
// grows with the number of lots.
export function HerdByLotChart({ animals }) {
  const { t, locale } = useT();
  const lots = useMemo(() => lotComposition(animals), [animals]);
  const series = GROUP_SERIES.map((s) => ({ ...s, label: t(`lv.groupName.${s.key}`) }));
  const data = lots.map((l) => ({ label: l.lot || t('lv.noLot'), ...l.groups, total: l.total }));
  const total = lots.reduce((s, l) => s + l.total, 0);
  const n = (v) => count(v, locale);
  return (
    <Finca>
      <ChartCard className={cardCls} title={t('lv.reports.byLot')} hint={t('lv.reports.byLotHint')}
        legend={series.map((s) => ({ label: s.label, color: s.color }))}
        table={{
          cols: [{ key: 'label', label: t('lv.reports.lot'), left: true }, ...series.map((s) => ({ key: s.key, label: s.label, fmt: n })), { key: 'total', label: t('lv.reports.total'), fmt: n }],
          rows: data,
        }}
        empty={!data.length} emptyText={t('lv.home.noAnimals')} height={Math.max(120, data.length * 34 + 28)}
        summary={t('lv.reports.byLotSummary', { n: total, lots: data.length })}>
        <NamedStack data={data} series={series} fmtAxis={n} fmtValue={n} labelWidth={104} />
      </ChartCard>
    </Finca>
  );
}

// Calvings by month: the year behind as recorded, the months ahead as
// expected from the pregnancy checks.
export function CalvingsChart({ animals, events, today = todayISO() }) {
  const { t, locale } = useT();
  const data = useMemo(() => calvingsByMonth(animals, events, today), [animals, events, today]);
  const recorded = data.reduce((s, d) => s + (d.recorded || 0), 0);
  const expected = data.reduce((s, d) => s + (d.expected || 0), 0);
  const series = [
    { key: 'recorded', label: t('lv.reports.recorded'), color: FINCA.series[0] },
    { key: 'expected', label: t('lv.reports.expected'), color: FINCA.series[2] },
  ];
  const n = (v) => count(v, locale);
  return (
    <Finca>
      <ChartCard className={cardCls} title={t('lv.reports.calvings')} hint={t('lv.reports.calvingsHint')}
        legend={series.map((s) => ({ label: s.label, color: s.color }))}
        table={{
          cols: [{ key: 'month', label: t('lv.reports.month'), left: true, fmt: (m) => monthLong(m, locale) }, ...series.map((s) => ({ key: s.key, label: s.label, fmt: n }))],
          rows: data,
        }}
        empty={recorded + expected === 0} emptyText={t('lv.reports.calvingsNone')} height={220}
        summary={t('lv.reports.calvingsSummary', { recorded, expected })}>
        <MonthBars data={data} series={series} stacked integers locale={locale} fmtAxis={n} fmtValue={n} />
      </ChartCard>
    </Finca>
  );
}

// Litres per cow per milking day, week by week for twelve weeks.
export function MilkPerCowChart({ events, today = todayISO() }) {
  const { t, locale } = useT();
  const data = useMemo(() => milkPerCow(events, 12, today), [events, today]);
  const latest = [...data].reverse().find((d) => d.perCow != null);
  const litres = (v) => `${formatNum(v)} L`;
  return (
    <Finca>
      <ChartCard className={cardCls} title={t('lv.reports.milk')} hint={t('lv.reports.milkHint')}
        table={{
          cols: [
            { key: 'date', label: t('lv.reports.week'), left: true, fmt: (d) => dayShort(d, locale) },
            { key: 'perCow', label: t('lv.reports.perCow'), fmt: (v) => formatNum(v) },
            { key: 'liters', label: t('lv.reports.liters'), fmt: (v) => formatNum(v, 0) },
            { key: 'cows', label: t('lv.reports.cows'), fmt: (v) => count(v, locale) },
          ],
          rows: data,
        }}
        empty={!latest} emptyText={t('lv.reports.milkNone')} height={220}
        summary={t('lv.reports.milkSummary', { l: formatNum(latest?.perCow) })}>
        <MonthLines data={data} series={[{ key: 'perCow', label: t('lv.reports.perCow'), color: FINCA.series[1] }]}
          locale={locale} zero={false} dots axis={(th) => dayAxis(th, locale)}
          titleOf={(d) => t('lv.reports.weekOf', { date: dayShort(d, locale) })}
          fmtAxis={(v) => formatNum(v, 0)} fmtValue={litres} />
      </ChartCard>
    </Finca>
  );
}

// Inicio's pair: calvings, and milk per cow where there are cows.
export default function HomeCharts({ animals, events, today, hasCows }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
      <CalvingsChart animals={animals} events={events} today={today} />
      {hasCows && <MilkPerCowChart events={events} today={today} />}
    </div>
  );
}
