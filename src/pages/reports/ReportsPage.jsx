import { useState, useMemo, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useData } from '../../contexts/DataContext';
import { generatePnLPdf, generateBalanceSheetPdf, generateIncomeStatementPdf, generateAuditorPackagePdf } from '../../lib/reports';
import { aggregateForPnL } from '../../lib/finance';
import { buildBookBSSnapshot } from '../../lib/bookBalanceSheet';
import { formatCurrency, formatDate, formatStatementPeriod } from '../../lib/utils';
import { fetchAllStatementsWithTotals } from '../../lib/statementTotals';
import { FileText } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Download, Eye, BarChart3, Scale, TrendingUp, Calendar, FileCheck2,
} from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const FETCH_BATCH = 1000;            // Supabase per-request row limit

export default function ReportsPage() {
  const { categories } = useData();

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [isFullYear, setIsFullYear]       = useState(false);   // Full-Year scope
  const [selectedYear, setSelectedYear]   = useState(now.getFullYear());
  const [transactions, setTransactions]   = useState([]);
  const [sourceDocs, setSourceDocs]       = useState([]);
  const [sourceDocsState, setSourceDocsState] = useState('loading');
  const [sourceDocsShowAll, setSourceDocsShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let start, end;
    if (isFullYear) {
      start = `${selectedYear}-01-01`;
      end   = `${selectedYear}-12-31`;
    } else {
      const m  = selectedMonth + 1;
      start    = `${selectedYear}-${String(m).padStart(2, '0')}-01`;
      end      = `${selectedYear}-${String(m).padStart(2, '0')}-${new Date(selectedYear, m, 0).getDate()}`;
    }
    // Supabase caps a single request at 1000 rows. Page through with .range()
    // so the Full-Year scope (which can exceed the cap) returns the complete
    // set. Monthly scopes are usually well under 1000 but the same loop is
    // harmless and keeps both branches consistent.
    //
    // STABLE-PAGINATION TIEBREAKER. .order('date') alone is non-deterministic
    // across .range() calls when many rows share the same date — rows near a
    // page boundary can silently duplicate or drop. .order('id') is appended
    // as the unique tiebreaker. See src/lib/fetchAll.js header and
    // ~/Documents/SELRIC-ALARM-NI-DRIFT.md (Jul 12 2026) for the incident.
    (async () => {
      const out = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .gte('date', start).lte('date', end).eq('voided', false)
          .order('date', { ascending: true })
          .order('id',   { ascending: true })
          .range(from, from + FETCH_BATCH - 1);
        if (error || !data) break;
        out.push(...data);
        if (data.length < FETCH_BATCH) break;
        from += FETCH_BATCH;
      }
      if (!cancelled) setTransactions(out);
    })();
    return () => { cancelled = true; };
  }, [selectedMonth, selectedYear, isFullYear]);

  // Source documents — every bank statement plus its PDF-pull totals.
  // Single fetch on mount; the section is informational so we don't
  // re-pull on every period change.
  useEffect(() => {
    let cancelled = false;
    setSourceDocsState('loading');
    fetchAllStatementsWithTotals()
      .then(rows => { if (!cancelled) { setSourceDocs(rows); setSourceDocsState('ready'); } })
      .catch(() => { if (!cancelled) setSourceDocsState('error'); });
    return () => { cancelled = true; };
  }, []);
  const [generating, setGenerating] = useState('');

  // transactions is already filtered to the selected period by the useEffect above
  const periodTxns = transactions;

  const summary = useMemo(() => {
    const agg = aggregateForPnL(periodTxns, categories);
    return {
      revenue:  agg.totalRevenue,
      expenses: agg.totalExpenses,
      netProfit: agg.totalRevenue - agg.totalExpenses,
      expensesByCategory: agg.expenses.map(e => [e.account, e.amount]),
      txnCount: periodTxns.length,
    };
  }, [periodTxns, categories]);

  const periodLabel = isFullYear
    ? `Full Year ${selectedYear}`
    : `${MONTHS[selectedMonth]} ${selectedYear}`;

  // Source documents filter: statements whose [period_start, period_end]
  // range overlaps the selected month (or the whole year in Full Year mode).
  // NULL-period statements only appear in the All-statements view.
  const periodBounds = useMemo(() => {
    if (isFullYear) {
      return { start: `${selectedYear}-01-01`, end: `${selectedYear}-12-31` };
    }
    const m = selectedMonth + 1;
    const start = `${selectedYear}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(selectedYear, m, 0).getDate();
    const end   = `${selectedYear}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }, [selectedMonth, selectedYear, isFullYear]);

  const visibleSourceDocs = useMemo(() => {
    if (sourceDocsShowAll) return sourceDocs;
    const { start, end } = periodBounds;
    // Overlap: statement.period_start <= month_end AND statement.period_end >= month_start.
    return sourceDocs.filter(s => {
      if (!s.period_start || !s.period_end) return false;
      return s.period_start <= end && s.period_end >= start;
    });
  }, [sourceDocs, sourceDocsShowAll, periodBounds]);

  const sourceDocsSummary = useMemo(() => {
    let debits = 0, credits = 0;
    for (const s of visibleSourceDocs) {
      debits  += Number(s.totals?.debits)  || 0;
      credits += Number(s.totals?.credits) || 0;
    }
    return { count: visibleSourceDocs.length, debits, credits };
  }, [visibleSourceDocs]);

  function buildPdf(type) {
    const data = { transactions: periodTxns, period: periodLabel, categories };
    if (type === 'pnl') return generatePnLPdf(data);
    if (type === 'balance') return generateBalanceSheetPdf(data);
    return generateIncomeStatementPdf(data);
  }

  // Build the Book BS snapshot for the auditor-package year PDF. Mirrors the
  // BookBalanceSheetPage.handleDownloadPdf flow: prefers the stored snapshot
  // when the year is locked, otherwise rebuilds live from current book_bs_*
  // tables. Returns null when no book_bs_lines exist for the year.
  async function fetchBookBSSnapshot(year, transactions) {
    const { data: stmt } = await supabase
      .from('book_bs_statements')
      .select('*')
      .eq('year', year)
      .maybeSingle();
    if (stmt?.status === 'locked' && stmt?.snapshot) return stmt.snapshot;

    const { data: lines } = await supabase.from('book_bs_lines').select('*').eq('year', year);
    if (!lines || !lines.length) return null;
    const lineIds = lines.map(l => l.id);
    const [
      { data: mappings },
      { data: adjustments },
      { data: assetMappings },
      { data: assets },
    ] = await Promise.all([
      supabase.from('book_bs_line_mappings').select('*').in('line_id', lineIds),
      supabase.from('book_bs_line_adjustments').select('*').in('line_id', lineIds),
      supabase.from('book_bs_line_asset_mappings').select('*').in('line_id', lineIds),
      supabase.from('assets').select('id, name, asset_class, asset_type, in_service_date, life_years, cost, status, retired_date'),
    ]);
    const groupBy = (rows) => {
      const out = {};
      for (const r of rows || []) (out[r.line_id] = out[r.line_id] || []).push(r);
      return out;
    };
    return buildBookBSSnapshot({
      year,
      lines,
      mappingsByLineId:      groupBy(mappings),
      adjustmentsByLineId:   groupBy(adjustments),
      transactions,
      assets:                assets || [],
      assetMappingsByLineId: groupBy(assetMappings),
      categories,
    });
  }

  async function buildAuditorPdf() {
    // Posted-only basis (matches the audit-trail spec). voided already filtered
    // out at fetch time, so a single .posted check covers it.
    const postedOnly = periodTxns.filter(t => t?.posted);
    const scope = isFullYear ? 'year' : 'month';
    const bookBSSnapshot = scope === 'year'
      ? await fetchBookBSSnapshot(selectedYear, postedOnly)
      : null;
    return generateAuditorPackagePdf({
      scope,
      year:           selectedYear,
      month:          isFullYear ? null : selectedMonth,
      periodLabel,
      transactions:   postedOnly,
      categories,
      bookBSSnapshot,
    });
  }

  async function handleAuditorDownload() {
    setGenerating('auditor-dl');
    try {
      const pdf = await buildAuditorPdf();
      const filename = isFullYear
        ? `Auditor_Package_FY${selectedYear}.pdf`
        : `Auditor_Package_${MONTHS_SHORT[selectedMonth]}${selectedYear}.pdf`;
      pdf.save(filename);
      toast.success('Auditor package downloaded');
    } catch (err) {
      console.error('auditor pdf failed', err);
      toast.error('Failed to generate auditor package');
    } finally {
      setGenerating('');
    }
  }

  async function handleAuditorPreview() {
    setGenerating('auditor-view');
    try {
      const pdf = await buildAuditorPdf();
      const blobUrl = pdf.output('bloburl');
      window.open(blobUrl, '_blank');
    } catch (err) {
      console.error('auditor pdf preview failed', err);
      toast.error('Failed to generate auditor package preview');
    } finally {
      setGenerating('');
    }
  }

  // Download filenames intentionally carry the report name, not a brand
  // prefix. Period gets underscores so it round-trips through Finder /
  // Explorer cleanly.
  const FILENAME_PREFIX = {
    pnl:     'PnL',
    balance: 'Balance_Sheet',
    income:  'Income_Statement',
  };

  async function handleDownload(type) {
    setGenerating(type + '-dl');
    try {
      const pdf = buildPdf(type);
      const prefix = FILENAME_PREFIX[type] || 'Report';
      pdf.save(`${prefix}_${periodLabel.replace(/\s+/g, '_')}.pdf`);
      toast.success('Report downloaded');
    } catch (err) {
      toast.error('Failed to generate report');
      console.error(err);
    } finally {
      setGenerating('');
    }
  }

  async function handlePreview(type) {
    setGenerating(type + '-view');
    try {
      const pdf = buildPdf(type);
      const blobUrl = pdf.output('bloburl');
      window.open(blobUrl, '_blank');
    } catch (err) {
      toast.error('Failed to generate preview');
      console.error(err);
    } finally {
      setGenerating('');
    }
  }

  const reports = [
    {
      id: 'pnl',
      title: 'Profit & Loss',
      description: 'Revenue, expenses, and net profit for the period',
      icon: BarChart3,
      color: 'bg-brand-50 text-brand-600',
    },
    {
      id: 'balance',
      title: 'Balance Sheet',
      description: 'Assets, liabilities, and equity snapshot',
      icon: Scale,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      id: 'income',
      title: 'Income Statement',
      description: 'Detailed income and expense breakdown',
      icon: TrendingUp,
      color: 'bg-purple-50 text-purple-600',
    },
  ];

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Financial Reports</h1>
          <p className="text-surface-500 text-sm mt-0.5">Generate and download professional financial reports</p>
        </div>
      </div>

      {/* Period Selector */}
      <div className="card p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar size={18} className="text-surface-400" />
          <span className="text-sm font-medium text-surface-600">Report Period:</span>
          <select
            value={isFullYear ? 'year' : String(selectedMonth)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'year') {
                setIsFullYear(true);
              } else {
                setIsFullYear(false);
                setSelectedMonth(parseInt(v));
              }
            }}
            className="input-field w-auto"
          >
            <option value="year">Full Year</option>
            <option disabled>──────────</option>
            {MONTHS.map((m, i) => (
              <option key={i} value={i}>{m}</option>
            ))}
          </select>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="input-field w-auto"
          >
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Revenue</p>
          <p className="text-xl font-display text-green-600 mt-1">{formatCurrency(summary.revenue)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Expenses</p>
          <p className="text-xl font-display text-red-600 mt-1">{formatCurrency(summary.expenses)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Net Profit</p>
          <p className={`text-xl font-display mt-1 ${summary.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(summary.netProfit)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Transactions</p>
          <p className="text-xl font-display text-surface-800 mt-1">{summary.txnCount}</p>
        </div>
      </div>

      {/* Report Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {reports.map((r) => (
          <div key={r.id} className="card p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${r.color}`}>
                <r.icon size={20} />
              </div>
              <div>
                <h3 className="font-display text-lg">{r.title}</h3>
                <p className="text-xs text-surface-500 mt-0.5">{r.description}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleDownload(r.id)}
                disabled={generating === r.id + '-dl'}
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
              >
                {generating === r.id + '-dl' ? <Spinner size="sm" className="text-white" /> : <Download size={14} />}
                Download
              </button>
              <button
                onClick={() => handlePreview(r.id)}
                disabled={generating === r.id + '-view'}
                className="btn-secondary flex items-center justify-center gap-2 text-sm px-3"
                title="Preview in browser"
              >
                {generating === r.id + '-view' ? <Spinner size="sm" /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Print for Auditor — composite package using the page's period selector.
          Full-Year scope → Cover + P&L + Book BS + Trial Balance.
          Month scope    → Cover + P&L + Trial Balance (Book BS is year-grained). */}
      <div className="card p-5 mb-6 border-amber-200 bg-amber-50/40">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-100 text-amber-700">
            <FileCheck2 size={20} />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg">Print for Auditor</h3>
            <p className="text-xs text-surface-500 mt-0.5">
              Single PDF: Cover + P&amp;L{isFullYear ? ' + Balance Sheet' : ''} + Trial Balance.{' '}
              <span className="text-surface-600 font-medium">Posted-only basis.</span>{' '}
              Uses the period selected above ({periodLabel}).
              {!isFullYear && <> Switch to <span className="font-mono">Full Year</span> for the year-end package with Balance Sheet.</>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleAuditorDownload}
            disabled={generating === 'auditor-dl' || generating === 'auditor-view'}
            className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
          >
            {generating === 'auditor-dl' ? <Spinner size="sm" className="text-white" /> : <Download size={14} />}
            Download Auditor Package
          </button>
          <button
            onClick={handleAuditorPreview}
            disabled={generating === 'auditor-dl' || generating === 'auditor-view'}
            className="btn-secondary flex items-center justify-center gap-2 text-sm px-3"
            title="Preview in browser"
          >
            {generating === 'auditor-view' ? <Spinner size="sm" /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* Source Documents — bank statements with PDF-pull totals */}
      <div className="card overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-surface-100 flex items-center gap-3 flex-wrap">
          <FileText size={16} className="text-surface-400" />
          <h3 className="section-title">Source Documents · Direct from PDF pull</h3>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-surface-600">
              <input type="checkbox" checked={sourceDocsShowAll} onChange={e => setSourceDocsShowAll(e.target.checked)} />
              All statements
            </label>
            {sourceDocsState === 'ready' && (
              <span className="text-surface-400">
                {visibleSourceDocs.length} / {sourceDocs.length}
              </span>
            )}
          </div>
        </div>

        {/* Summary line — narrates the filtered slice or the full set. */}
        {sourceDocsState === 'ready' && sourceDocs.length > 0 && (
          <div className="px-5 py-2.5 border-b border-surface-100 bg-brand-50/40 text-xs text-surface-700 flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold">
              {sourceDocsShowAll
                ? `${sourceDocsSummary.count} statement${sourceDocsSummary.count === 1 ? '' : 's'} total`
                : `${sourceDocsSummary.count} statement${sourceDocsSummary.count === 1 ? '' : 's'} cover ${periodLabel}`}
            </span>
            <span className="text-surface-400">·</span>
            <span><span className="font-mono text-red-600">{formatCurrency(sourceDocsSummary.debits)}</span> total debits</span>
            <span className="text-surface-400">·</span>
            <span><span className="font-mono text-green-600">{formatCurrency(sourceDocsSummary.credits)}</span> total credits</span>
            <span className="text-surface-400 ml-1">from PDF pulls</span>
          </div>
        )}

        {sourceDocsState === 'loading' && <div className="flex justify-center py-10"><Spinner size="lg" /></div>}
        {sourceDocsState === 'error'   && <div className="p-5 text-sm text-red-700">Failed to load source documents.</div>}
        {sourceDocsState === 'ready' && (
          sourceDocs.length === 0 ? (
            <div className="p-8 text-center text-sm text-surface-400">No bank statements uploaded yet.</div>
          ) : visibleSourceDocs.length === 0 ? (
            <div className="p-8 text-center text-sm text-surface-400">
              No statements cover {periodLabel}. Tick <span className="font-semibold">All statements</span> to see the full list.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-100 bg-surface-50/50">
                    <th className="table-header">Statement</th>
                    <th className="table-header">Uploaded</th>
                    <th className="table-header">Period covered</th>
                    <th className="table-header text-right">Txns</th>
                    <th className="table-header text-right">Debits</th>
                    <th className="table-header text-right">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSourceDocs.map(s => {
                    const range = formatStatementPeriod(s.period_start, s.period_end);
                    return (
                      <tr key={s.id} className="border-b border-surface-50 hover:bg-surface-50">
                        <td className="table-cell text-sm font-medium max-w-xs truncate" title={s.file_name}>{s.file_name || '—'}</td>
                        <td className="table-cell font-mono text-xs whitespace-nowrap">{s.upload_date ? formatDate(s.upload_date) : '—'}</td>
                        <td className="table-cell text-xs whitespace-nowrap">
                          {range ? (
                            <span className="font-mono text-surface-700">{range}</span>
                          ) : (
                            <span className="text-surface-400 italic">no transactions</span>
                          )}
                        </td>
                        <td className="table-cell text-right font-mono text-xs">{s.totals.count}</td>
                        <td className="table-cell text-right font-mono text-xs text-red-600">{formatCurrency(s.totals.debits)}</td>
                        <td className="table-cell text-right font-mono text-xs text-green-600">{formatCurrency(s.totals.credits)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Expense Breakdown Table */}
      {summary.expensesByCategory.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-100">
            <h3 className="section-title">Expense Breakdown — {periodLabel}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="table-header">Category</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header text-right">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.expensesByCategory.map(([cat, amount]) => (
                  <tr key={cat} className="border-b border-surface-50 hover:bg-surface-50 transition">
                    <td className="table-cell font-medium">{cat}</td>
                    <td className="table-cell text-right font-mono">{formatCurrency(amount)}</td>
                    <td className="table-cell text-right font-mono text-surface-500">
                      {summary.expenses > 0 ? ((amount / summary.expenses) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-50 font-semibold">
                  <td className="table-cell">Total Expenses</td>
                  <td className="table-cell text-right font-mono">{formatCurrency(summary.expenses)}</td>
                  <td className="table-cell text-right font-mono">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
