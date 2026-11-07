import { useMemo } from 'react';
import { useT } from '../../i18n/I18nContext';
import { ChartCard, MonthLines, MonthBars, NamedBars, Waterfall, useChartTheme, money, moneyShort, percent, count, monthLong } from '../../components/charts';
import {
  lastMonths, pnlByMonth, cashByMonth, revenueByCategory, expenseMix, salesTaxByMonth,
  merchantFeesByMonth, checkPool, cashBridge, waterfallBars, CHECK_STATUSES,
} from '../../lib/series';

// The dashboard's charts: twelve months of the books, read from the rows the
// page already loaded. Every figure comes from src/lib/series.js, which builds
// on finance.js, so a chart says what the reports say.
//   full    — the full accounting package: adds the cash bridge, sales tax,
//             card fees and the check pool (Simple workspaces keep no
//             statements, payables or checks)
//   show(k) — the portal's dashboard switches: 'chart' (profit and cash,
//             sales by account) and 'breakdown' (expense mix)

export default function DashboardCharts({ transactions, categories, statements = [], checks = [], full, show = () => true, endMonth }) {
  const { t, locale } = useT();
  const th = useChartTheme();
  const months = useMemo(() => lastMonths(endMonth, 12), [endMonth]);
  const usd = (v) => money(v, locale);
  const usdShort = (v) => moneyShort(v, locale);
  // The month in progress is marked: its figures are the month so far.
  const mon = (m) => (m === endMonth ? `${monthLong(m, locale)} · ${t('charts.soFar')}` : monthLong(m, locale));
  const k = (key) => t(`dash.charts.${key}`);

  const s = useMemo(() => {
    const pnl = pnlByMonth(transactions, categories, months);
    const cash = cashByMonth(transactions, months);
    return {
      pnl,
      cash,
      pnlCash: months.map((m, i) => ({ month: m, net: pnl[i].net, cash: cash[i].net })),
      revenue: revenueByCategory(pnl, 3),
      mix: expenseMix(pnl, 7),
      tax: salesTaxByMonth(transactions, months),
      fees: merchantFeesByMonth(transactions, categories, months),
      pool: checkPool(checks),
      bridge: cashBridge(transactions, categories, statements, months),
    };
  }, [transactions, categories, statements, checks, months]);

  const any = (rows, f) => rows.some((r) => Math.abs(f(r) || 0) > 0.005);
  const other = t('charts.other');
  const revSeries = [
    ...s.revenue.keys.map((key, i) => ({ key, label: key, color: th.series[i] })),
    ...(s.revenue.hasOther ? [{ key: '__other', label: other, color: th.other }] : []),
  ];
  const bridgeBars = waterfallBars(s.bridge, (key) => t(`dash.charts.bridge.steps.${key}`));
  // A status the app does not know yet shows as stored.
  const statusLabel = (st) => (CHECK_STATUSES.includes(st) ? t(`dash.charts.checkPool.status.${st}`) : st);
  const monthCol = { key: 'month', label: t('charts.month'), left: true, fmt: mon };

  const cards = [];
  if (show('chart')) {
    cards.push(
      <ChartCard key="pnlCash" title={k('pnlCash.title')} hint={k('pnlCash.hint')} summary={k('pnlCash.summary')}
        empty={!any(s.pnlCash, (r) => r.net) && !any(s.pnlCash, (r) => r.cash)} emptyText={k('pnlCash.empty')}
        legend={[{ label: k('pnlCash.net'), color: th.series[0], kind: 'line' }, { label: k('pnlCash.cash'), color: th.series[1], kind: 'line' }]}
        table={{ cols: [monthCol, { key: 'net', label: k('pnlCash.net'), fmt: usd }, { key: 'cash', label: k('pnlCash.cash'), fmt: usd }], rows: s.pnlCash }}>
        <MonthLines data={s.pnlCash} locale={locale} titleOf={mon} fmtAxis={usdShort} fmtValue={usd}
          series={[{ key: 'net', label: k('pnlCash.net'), color: th.series[0] }, { key: 'cash', label: k('pnlCash.cash'), color: th.series[1] }]} />
      </ChartCard>,
      <ChartCard key="revenue" title={k('revenue.title')} hint={k('revenue.hint')} summary={k('revenue.summary')}
        empty={!revSeries.length} emptyText={k('revenue.empty')}
        legend={revSeries.map((x) => ({ label: x.label, color: x.color }))}
        table={{ cols: [monthCol, ...revSeries.map((x) => ({ key: x.key, label: x.label, fmt: usd }))], rows: s.revenue.rows }}>
        <MonthBars data={s.revenue.rows} series={revSeries} stacked locale={locale} titleOf={mon} fmtAxis={usdShort} fmtValue={usd} />
      </ChartCard>,
    );
  }
  if (full) {
    cards.push(
      <ChartCard key="bridge" title={k('bridge.title')} hint={s.bridge.opening == null ? k('bridge.hintNoOpening') : k('bridge.hint')} summary={k('bridge.summary')}
        empty={!s.bridge.steps.length} emptyText={k('bridge.empty')} height={Math.max(220, bridgeBars.length * 30)}
        legend={[{ label: k('bridge.in'), color: th.up }, { label: k('bridge.out'), color: th.down }, { label: k('bridge.balance'), color: th.total }]}
        table={{ cols: [{ key: 'name', label: k('bridge.step'), left: true }, { key: 'value', label: k('bridge.change'), fmt: usd }], rows: bridgeBars }}>
        <Waterfall bars={bridgeBars} valueName={k('bridge.change')} fmtAxis={usdShort} fmtValue={usd} />
      </ChartCard>,
    );
  }
  if (show('breakdown')) {
    const mix = s.mix.map((x) => ({ label: x.name === '__other' ? other : x.name, value: x.value, color: x.name === '__other' ? th.other : undefined }));
    cards.push(
      <ChartCard key="mix" title={k('expenseMix.title')} hint={k('expenseMix.hint')} summary={k('expenseMix.summary')}
        empty={!mix.length} emptyText={k('expenseMix.empty')} height={Math.max(200, mix.length * 30)}
        table={{ cols: [{ key: 'label', label: k('expenseMix.account'), left: true }, { key: 'value', label: k('expenseMix.amount'), fmt: usd }], rows: mix }}>
        <NamedBars data={mix} color={th.series[0]} valueName={k('expenseMix.amount')} fmtAxis={usdShort} fmtValue={usd} />
      </ChartCard>,
    );
  }
  if (full) {
    const feeLine = (label, payload) => { const r = payload?.[0]?.payload; return r?.rate == null ? null : `${percent(r.rate, locale)} ${k('fees.ofCardSales')} (${usd(r.cardSales)})`; };
    cards.push(
      <ChartCard key="tax" title={k('salesTax.title')} hint={k('salesTax.hint')} summary={k('salesTax.summary')}
        empty={!any(s.tax, (r) => r.collected) && !any(s.tax, (r) => r.remitted)} emptyText={k('salesTax.empty')}
        legend={[{ label: k('salesTax.collected'), color: th.series[0] }, { label: k('salesTax.remitted'), color: th.series[1] }]}
        table={{ cols: [monthCol, { key: 'collected', label: k('salesTax.collected'), fmt: usd }, { key: 'remitted', label: k('salesTax.remitted'), fmt: usd }, { key: 'owed', label: k('salesTax.owed'), fmt: usd }], rows: s.tax }}>
        <MonthBars data={s.tax} locale={locale} titleOf={mon} fmtAxis={usdShort} fmtValue={usd}
          series={[{ key: 'collected', label: k('salesTax.collected'), color: th.series[0] }, { key: 'remitted', label: k('salesTax.remitted'), color: th.series[1] }]} />
      </ChartCard>,
      <ChartCard key="fees" title={k('fees.title')} hint={k('fees.hint')} summary={k('fees.summary')}
        empty={!any(s.fees, (r) => r.fees)} emptyText={k('fees.empty')}
        table={{ cols: [monthCol, { key: 'fees', label: k('fees.fees'), fmt: usd }, { key: 'cardSales', label: k('fees.cardSales'), fmt: usd }, { key: 'rate', label: k('fees.rate'), fmt: (v) => percent(v, locale) }], rows: s.fees }}>
        <MonthLines data={s.fees} locale={locale} titleOf={mon} fmtAxis={usdShort} fmtValue={usd} zero={false} extra={feeLine}
          series={[{ key: 'fees', label: k('fees.fees'), color: th.series[1] }]} />
      </ChartCard>,
    );
    const pool = s.pool.map((x) => ({ label: statusLabel(x.status), value: x.amount, count: x.count }));
    cards.push(
      <ChartCard key="pool" title={k('checkPool.title')} hint={k('checkPool.hint')} summary={k('checkPool.summary')}
        empty={!pool.length} emptyText={k('checkPool.empty')} height={Math.max(160, pool.length * 34)}
        table={{ cols: [{ key: 'label', label: k('checkPool.statusCol'), left: true }, { key: 'count', label: k('checkPool.count'), fmt: (v) => count(v, locale) }, { key: 'value', label: k('checkPool.amount'), fmt: usd }], rows: pool }}>
        <NamedBars data={pool} color={th.series[1]} valueName={k('checkPool.amount')} fmtAxis={usdShort} fmtValue={usd} labelWidth={110}
          extra={(label, payload) => { const r = payload?.[0]?.payload; return r ? t('dash.charts.checkPool.nChecks', { n: count(r.count, locale) }) : null; }} />
      </ChartCard>,
    );
  }
  if (!cards.length) return null;
  return (
    <section aria-label={k('section')} className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
      {cards}
    </section>
  );
}
