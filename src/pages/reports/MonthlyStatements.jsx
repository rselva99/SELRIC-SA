import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { balanceSheet, cashBridge, lastMonths, pnlByMonth } from '../../lib/series';
import { balanceSheetSheet, cashBridgeSheet, pnlByMonthSheet } from '../../lib/reportWorkbooks';
import { downloadWorkbook } from '../../lib/workbook';
// theme.js, not the charts index: this page draws no chart, so recharts stays out of its chunk.
import { money, monthLong, monthShort } from '../../components/charts/theme';
import { useT } from '../../i18n/I18nContext';
import Spinner from '../../components/ui/Spinner';

// Three statements for the period picked above them on the Reports page:
//   P&L by month  — the year through the selected month (or the whole year),
//                   on the accrual or the cash basis;
//   Balance sheet — at the end of the selected month (or the year), never
//                   later than today;
//   Cash bridge   — the bank from opening to closing over the selected period.
// The figures come from series.js, on the same finance.js aggregators the PDF
// reports use, and each one downloads as a workbook whose totals are formulas
// (reportWorkbooks.js). Nothing here writes.

const pad = (n) => String(n).padStart(2, '0');
const TABS = ['pnl', 'bs', 'bridge'];
// The months a file covers, for its name: 2026-11, or 2026-01_to_2026-11.
const spanOf = (months) => (months.length === 1 ? months[0] : `${months[0]}_to_${months.at(-1)}`);

export default function MonthlyStatements({ categories, year, month, isFullYear }) {
  const { t, locale } = useT();
  const k = (key, vars) => t(`rep.monthly.${key}`, vars);
  const usd = (v) => money(v, locale);

  const [tab, setTab] = useState('pnl');
  const [basis, setBasis] = useState('accrual');
  const [rows, setRows] = useState(null);
  const [statements, setStatements] = useState([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // The months shown, the balance sheet's date and the bridge's window. A
  // period that has not started yet has no months; the current one stops at
  // today.
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const scope = useMemo(() => {
    const endMonth = isFullYear ? `${year}-12` : `${year}-${pad(month + 1)}`;
    const capped = endMonth > thisMonth ? thisMonth : endMonth;
    const ytd = capped < `${year}-01` ? [] : lastMonths(capped, Number(capped.slice(5, 7)));
    const period = isFullYear ? ytd : ytd.filter((m) => m === endMonth);
    const last = new Date(Date.UTC(Number(capped.slice(0, 4)), Number(capped.slice(5, 7)), 0)).toISOString().slice(0, 10);
    return { ytd, period, asOf: last > today ? today : last };
  }, [year, month, isFullYear, thisMonth, today]);

  // Every live row up to the end of the year (the balance sheet needs all of
  // history), and the year's statements for the bridge's opening and closing
  // balances. Loaded once per year; moving between months reuses them.
  useEffect(() => {
    let cancelled = false;
    const end = `${year}-12-31` > today ? today : `${year}-12-31`;
    setRows(null);
    setFailed(false);
    Promise.all([
      fetchAll(supabase.from('transactions').select('*').lte('date', end).eq('voided', false).order('date', { ascending: true })),
      supabase.from('bank_statements').select('id, period_start, period_end, statement_totals').gte('period_end', `${year}-01-01`).lte('period_start', end)
        .then(({ data }) => data || [], () => []),
    ]).then(([tx, st]) => {
      if (cancelled) return;
      setRows(tx || []);
      setStatements(st);
    }, () => { if (!cancelled) { setRows([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [year, today]);

  const built = useMemo(() => {
    if (!rows) return null;
    return {
      pnl: pnlByMonth(rows, categories, scope.ytd, { basis }),
      bs: balanceSheet(rows, categories, scope.asOf),
      bridge: cashBridge(rows, categories, statements, scope.period),
    };
  }, [rows, statements, categories, scope, basis]);

  const rangeOf = (months) => (months.length === 1 ? monthLong(months[0], locale)
    : k('range', { from: monthLong(months[0], locale), to: monthLong(months.at(-1), locale) }));
  const dateLong = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const stepLabel = (key) => t(`dash.charts.bridge.steps.${key}`);

  // The workbook for the open tab, labelled in the reader's language.
  const download = async () => {
    if (!built || busy) return;
    setBusy(true);
    try {
      let sheet, file;
      if (tab === 'pnl') {
        sheet = pnlByMonthSheet(built.pnl, {
          sheet: k('tabs.pnl'), title: k('pnlTitle', { period: rangeOf(scope.ytd), basis: k(basis).toLowerCase() }),
          account: k('account'), total: t('rep.total'), revenue: t('rep.revenue'), expenses: t('rep.expenses'),
          totalRevenue: k('totalRevenue'), totalExpenses: k('totalExpenses'), netIncome: k('netIncome'),
          month: (m) => monthShort(m, locale),
        });
        file = `PnL_by_month_${spanOf(scope.ytd)}_${basis}.xlsx`;
      } else if (tab === 'bs') {
        sheet = balanceSheetSheet(built.bs, {
          sheet: k('tabs.bs'), title: k('bsTitle', { date: dateLong(scope.asOf) }),
          section: t('rep.section'), account: k('account'), amount: k('amount'),
          assets: k('assets'), liabilities: k('liabilities'), equity: k('equity'),
          totalAssets: k('totalAssets'), totalLiabilities: k('totalLiabilities'), totalEquity: k('totalEquity'),
          retained: k('retained'), netIncome: k('netIncomeYear'), liabilitiesAndEquity: k('liabilitiesAndEquity'), check: k('check'),
        });
        file = `Balance_sheet_${scope.asOf}.xlsx`;
      } else {
        sheet = cashBridgeSheet(built.bridge, {
          sheet: k('tabs.bridge'), title: k('bridgeTitle', { period: rangeOf(scope.period) }),
          step: k('step'), amount: k('amount'), balance: k('balance'),
          opening: stepLabel('opening'), closing: stepLabel('closing'), net: stepLabel('net'),
          printed: k('printed'), difference: k('difference'), stepLabel,
        });
        file = `Cash_bridge_${spanOf(scope.period)}.xlsx`;
      }
      await downloadWorkbook([sheet], file);
    } catch {
      toast.error(k('downloadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const empty = !(tab === 'bridge' ? scope.period : scope.ytd).length;

  return (
    <section className="card p-4 sm:p-5 mb-6 min-w-0" aria-labelledby="monthly-statements-title">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 id="monthly-statements-title" className="font-display text-lg">{k('title')}</h2>
          <p className="text-sm text-surface-500 mt-0.5">{k('subtitle')}</p>
        </div>
        <button type="button" onClick={download} disabled={!built || busy || empty}
          className="btn-secondary flex items-center justify-center gap-2 text-sm min-h-[44px] shrink-0">
          <Download size={16} aria-hidden="true" /> {busy ? k('preparing') : k('download')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Full width on a phone, three equal parts; a long label (Spanish)
            wraps onto two short lines rather than pushing the row wider. */}
        <div className="flex w-full sm:w-auto rounded-lg border border-surface-200 overflow-hidden" role="group" aria-label={k('title')}>
          {TABS.map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
              className={`flex-1 sm:flex-none px-2 sm:px-3 py-1 min-h-[44px] text-sm leading-tight ${tab === key ? 'bg-surface-100 text-surface-900 font-medium' : 'text-surface-600'}`}>
              {k(`tabs.${key}`)}
            </button>
          ))}
        </div>
        {tab === 'pnl' && (
          <div className="inline-flex rounded-lg border border-surface-200 overflow-hidden" role="group" aria-label={k('basis')}>
            {['accrual', 'cash'].map((b) => (
              <button key={b} type="button" onClick={() => setBasis(b)} aria-pressed={basis === b}
                className={`px-3 min-h-[44px] text-sm ${basis === b ? 'bg-surface-100 text-surface-900 font-medium' : 'text-surface-600'}`}>
                {k(b)}
              </button>
            ))}
          </div>
        )}
      </div>

      {failed && <p className="text-sm text-red-600 mb-3" role="alert">{k('loadFailed')}</p>}
      {!built ? (
        <div className="py-10 flex justify-center"><Spinner /></div>
      ) : empty ? (
        <p className="text-sm text-surface-500 py-6" role="note">{t('rep.nothingInPeriod')}</p>
      ) : tab === 'pnl' ? (
        <PnlTable pnl={built.pnl} k={k} t={t} usd={usd} locale={locale}
          note={`${k(basis === 'cash' ? 'cashHint' : 'accrualHint')} ${isFullYear ? '' : k('ytdNote', { month: monthLong(scope.ytd.at(-1), locale) })}`.trim()} />
      ) : tab === 'bs' ? (
        <BalanceTable bs={built.bs} k={k} t={t} usd={usd} asOf={dateLong(scope.asOf)} />
      ) : (
        <BridgeTable bridge={built.bridge} k={k} usd={usd} stepLabel={stepLabel} />
      )}
    </section>
  );
}

const th = 'px-3 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider whitespace-nowrap';
const td = 'px-3 py-1.5 text-right tabular-nums whitespace-nowrap';
const rowHead = 'px-3 py-1.5 text-left sticky left-0 bg-white whitespace-nowrap';

// A two-column statement reads better at the width of a page than stretched
// across a wide screen; the month grid uses all the room it gets.
function Scroll({ children, label, narrow = false }) {
  return (
    <div className={`overflow-x-auto -mx-4 sm:mx-0 border-y sm:border sm:rounded-lg border-surface-100 ${narrow ? 'sm:max-w-2xl' : ''}`} role="region" aria-label={label} tabIndex={0}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function PnlTable({ pnl, k, t, usd, locale, note }) {
  const months = pnl.map((p) => p.month);
  const names = (key) => {
    const seen = new Map();
    for (const p of pnl) for (const [a, v] of Object.entries(p[key])) seen.set(a, (seen.get(a) || 0) + v);
    return [...seen].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  };
  const sumRow = (vals) => vals.reduce((s, v) => s + v, 0);
  const block = (key, label, totalLabel) => {
    const accounts = names(key);
    const totals = pnl.map((p) => accounts.reduce((s, a) => s + (p[key][a] || 0), 0));
    return { key, label, totalLabel, accounts, totals };
  };
  const rev = block('revenueBy', t('rep.revenue'), k('totalRevenue'));
  const exp = block('expenseBy', t('rep.expenses'), k('totalExpenses'));
  const net = months.map((_, i) => rev.totals[i] - exp.totals[i]);
  return (
    <>
      <p className="text-xs text-surface-500 mb-2">{note}</p>
      <Scroll label={k('tabs.pnl')}>
        <thead>
          <tr className="border-b border-surface-100">
            <th scope="col" className={`${th} text-left sticky left-0 bg-white`}>{k('account')}</th>
            {months.map((m) => <th key={m} scope="col" className={`${th} text-right`}>{monthShort(m, locale)}</th>)}
            <th scope="col" className={`${th} text-right`}>{t('rep.total')}</th>
          </tr>
        </thead>
        {[rev, exp].map((b) => (
          <tbody key={b.key}>
            <tr><th scope="rowgroup" colSpan={months.length + 2} className="px-3 pt-3 pb-1 text-left font-medium text-surface-700">{b.label}</th></tr>
            {b.accounts.map((a) => {
              const vals = pnl.map((p) => p[b.key][a] || 0);
              return (
                <tr key={a} className="border-t border-surface-50">
                  <th scope="row" className={`${rowHead} font-normal text-surface-700`}>{a}</th>
                  {vals.map((v, i) => <td key={months[i]} className={td}>{v ? usd(v) : '—'}</td>)}
                  <td className={`${td} font-medium`}>{usd(sumRow(vals))}</td>
                </tr>
              );
            })}
            <tr className="border-t border-surface-200 font-medium">
              <th scope="row" className={`${rowHead} font-medium`}>{b.totalLabel}</th>
              {b.totals.map((v, i) => <td key={months[i]} className={td}>{usd(v)}</td>)}
              <td className={td}>{usd(sumRow(b.totals))}</td>
            </tr>
          </tbody>
        ))}
        <tbody>
          <tr className="border-t-2 border-surface-300 font-semibold">
            <th scope="row" className={`${rowHead} font-semibold`}>{k('netIncome')}</th>
            {net.map((v, i) => <td key={months[i]} className={`${td} ${v < 0 ? 'text-red-600' : ''}`}>{usd(v)}</td>)}
            <td className={`${td} ${sumRow(net) < 0 ? 'text-red-600' : ''}`}>{usd(sumRow(net))}</td>
          </tr>
        </tbody>
      </Scroll>
    </>
  );
}

function BalanceTable({ bs, k, t, usd, asOf }) {
  const parts = [
    ['assets', bs.assets, 'totalAssets', bs.totalAssets],
    ['liabilities', bs.liabilities, 'totalLiabilities', bs.totalLiabilities],
    ['equity', bs.equity, 'totalEquity', bs.totalEquity],
  ];
  const balanced = Math.abs(bs.difference) < 0.01;
  return (
    <>
      <p className="text-xs text-surface-500 mb-2">{k('asOf', { date: asOf })} · {k('bsNote')}</p>
      <Scroll label={k('tabs.bs')} narrow>
        <thead>
          <tr className="border-b border-surface-100">
            <th scope="col" className={`${th} text-left`}>{k('account')}</th>
            <th scope="col" className={`${th} text-right`}>{k('amount')}</th>
          </tr>
        </thead>
        {parts.map(([key, list, totalKey, total]) => (
          <tbody key={key}>
            <tr><th scope="rowgroup" colSpan={2} className="px-3 pt-3 pb-1 text-left font-medium text-surface-700">{k(key)}</th></tr>
            {list.map((x) => (
              <tr key={x.account ?? x.key} className="border-t border-surface-50">
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-surface-700">{x.account ?? k(x.key === 'netIncome' ? 'netIncomeYear' : x.key)}</th>
                <td className={td}>{usd(x.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-surface-200 font-medium">
              <th scope="row" className="px-3 py-1.5 text-left font-medium">{k(totalKey)}</th>
              <td className={td}>{usd(total)}</td>
            </tr>
          </tbody>
        ))}
        <tbody>
          <tr className="border-t-2 border-surface-300 font-semibold">
            <th scope="row" className="px-3 py-1.5 text-left font-semibold">{k('liabilitiesAndEquity')}</th>
            <td className={td}>{usd(bs.totalLiabilities + bs.totalEquity)}</td>
          </tr>
        </tbody>
      </Scroll>
      <p className={`text-sm mt-3 ${balanced ? 'text-green-700' : 'text-amber-700'}`} role="status">
        {balanced ? k('balanced') : <>{k('off', { amount: usd(Math.abs(bs.difference)) })} <Link to="/checks" className="underline">{t('checks.open')}</Link></>}
      </p>
    </>
  );
}

function BridgeTable({ bridge, k, usd, stepLabel }) {
  let level = bridge.opening ?? 0;
  const lines = bridge.steps.map((s) => { level += s.delta; return { ...s, balance: level }; });
  const end = bridge.opening == null ? bridge.net : bridge.closing;
  const diff = bridge.opening != null && bridge.printedClosing != null ? end - bridge.printedClosing : null;
  return (
    <>
      {bridge.opening == null && <p className="text-xs text-surface-500 mb-2">{k('noOpening')}</p>}
      <Scroll label={k('tabs.bridge')} narrow>
        <thead>
          <tr className="border-b border-surface-100">
            <th scope="col" className={`${th} text-left`}>{k('step')}</th>
            <th scope="col" className={`${th} text-right`}>{k('amount')}</th>
            <th scope="col" className={`${th} text-right`}>{k('balance')}</th>
          </tr>
        </thead>
        <tbody>
          {bridge.opening != null && (
            <tr className="font-medium">
              <th scope="row" className="px-3 py-1.5 text-left font-medium">{stepLabel('opening')}</th>
              <td className={td} />
              <td className={td}>{usd(bridge.opening)}</td>
            </tr>
          )}
          {lines.map((s) => (
            <tr key={s.key} className="border-t border-surface-50">
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-surface-700">{stepLabel(s.key)}</th>
              <td className={`${td} ${s.delta < 0 ? 'text-red-600' : 'text-green-700'}`}>{usd(s.delta)}</td>
              <td className={td}>{bridge.opening == null ? '' : usd(s.balance)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-surface-300 font-semibold">
            <th scope="row" className="px-3 py-1.5 text-left font-semibold">{stepLabel(bridge.opening == null ? 'net' : 'closing')}</th>
            <td className={td}>{bridge.opening == null ? usd(end) : ''}</td>
            <td className={td}>{bridge.opening == null ? '' : usd(end)}</td>
          </tr>
          {diff != null && (
            <tr className="border-t border-surface-100">
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-surface-700">{k('printed')}</th>
              <td className={td} />
              <td className={td}>{usd(bridge.printedClosing)}</td>
            </tr>
          )}
        </tbody>
      </Scroll>
      {diff != null && (
        <p className={`text-sm mt-3 ${Math.abs(diff) < 0.01 ? 'text-green-700' : 'text-amber-700'}`} role="status">
          {Math.abs(diff) < 0.01 ? k('ties') : k('doesNotTie', { amount: usd(Math.abs(diff)) })}
        </p>
      )}
    </>
  );
}
