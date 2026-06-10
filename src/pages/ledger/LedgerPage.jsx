import { useState, useMemo, useEffect, useCallback, Fragment } from 'react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import { BookOpen, TrendingDown, TrendingUp, X } from 'lucide-react';

const PAGE_SIZE   = 100;
const CURRENT_YR  = new Date().getFullYear();
const YEARS       = [CURRENT_YR - 2, CURRENT_YR - 1, CURRENT_YR, CURRENT_YR + 1];
const MONTHS_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function allPeriods() {
  const out = [];
  for (const y of YEARS)
    for (let m = 0; m < 12; m++)
      out.push({ key: `${y}-${String(m+1).padStart(2,'0')}`, label: `${MONTHS_ABBR[m]}-${String(y).slice(2)}` });
  return out;
}

const monthLabel = (yyyymm) => format(parseISO(yyyymm + '-01'), 'MMM-yy').toUpperCase();

function PageBar({ page, total, onPage }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-surface-100 bg-surface-50 text-xs text-surface-500">
      <span>{total.toLocaleString()} entries · page {page + 1} of {pages}</span>
      <div className="flex gap-1">
        {[['«',0],['‹',page-1],['›',page+1],['»',pages-1]].map(([lbl,pg]) => (
          <button key={lbl} onClick={() => onPage(pg)} disabled={pg < 0 || pg >= pages}
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-30">{lbl}</button>
        ))}
      </div>
    </div>
  );
}

export default function LedgerPage() {
  const { accounts, categories } = useData();

  const [selectedYear,      setSelectedYear]      = useState('');
  const [selectedPeriod,    setSelectedPeriod]    = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCategory,  setSelectedCategory]  = useState('');
  const [page,              setPage]              = useState(0);

  const [transactions, setTransactions] = useState([]);
  const [yearSummary,  setYearSummary]  = useState(null);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(false);

  // The year used for the running balance + summary. Falls back to the period's
  // year when only a period is filtered.
  const activeYear = selectedYear || (selectedPeriod ? selectedPeriod.slice(0, 4) : '');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let pageQ = supabase.from('transactions')
        .select('*', { count: 'exact' })
        .eq('posted', true)
        .order('date', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (selectedPeriod) {
        const [yr, mo] = selectedPeriod.split('-');
        const lastDay = new Date(parseInt(yr), parseInt(mo), 0).getDate();
        pageQ = pageQ.gte('date', `${yr}-${mo}-01`).lte('date', `${yr}-${mo}-${String(lastDay).padStart(2,'0')}`);
      } else if (selectedYear) {
        pageQ = pageQ.gte('date', `${selectedYear}-01-01`).lte('date', `${selectedYear}-12-31`);
      }
      if (selectedAccountId) pageQ = pageQ.eq('account_id', selectedAccountId);
      if (selectedCategory)  pageQ = pageQ.eq('category', selectedCategory);

      let summaryQ = null;
      if (activeYear) {
        summaryQ = supabase.from('transactions')
          .select('id, date, type, amount')
          .eq('posted', true)
          .gte('date', `${activeYear}-01-01`)
          .lte('date', `${activeYear}-12-31`)
          .order('date', { ascending: true });
        if (selectedAccountId) summaryQ = summaryQ.eq('account_id', selectedAccountId);
        if (selectedCategory)  summaryQ = summaryQ.eq('category', selectedCategory);
      }

      const [pageRes, summaryRes] = await Promise.all([
        pageQ,
        summaryQ || Promise.resolve(null),
      ]);
      if (pageRes.error) throw pageRes.error;
      if (summaryRes && summaryRes.error) throw summaryRes.error;

      setTransactions(pageRes.data || []);
      setTotal(pageRes.count || 0);
      setYearSummary(summaryRes ? (summaryRes.data || []) : null);
    } catch (err) {
      console.error('LedgerPage load error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, selectedPeriod, selectedYear, selectedAccountId, selectedCategory, activeYear]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { setPage(0); }, [selectedPeriod, selectedYear, selectedAccountId, selectedCategory]);

  // id -> cumulative balance from Jan 1 of activeYear.
  const runningBalanceById = useMemo(() => {
    if (!yearSummary) return null;
    const map = {};
    let running = 0;
    for (const t of yearSummary) {
      running += t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount);
      map[t.id] = running;
    }
    return map;
  }, [yearSummary]);

  const yearTotals = useMemo(() => {
    if (!yearSummary) return null;
    const debits  = yearSummary.filter(t => t.type === 'debit').reduce((s,t) => s + Math.abs(t.amount), 0);
    const credits = yearSummary.filter(t => t.type === 'credit').reduce((s,t) => s + Math.abs(t.amount), 0);
    return { debits, credits, net: credits - debits };
  }, [yearSummary]);

  const pageTotals = useMemo(() => {
    const debits  = transactions.filter(t => t.type === 'debit').reduce((s,t)  => s + Math.abs(t.amount), 0);
    const credits = transactions.filter(t => t.type === 'credit').reduce((s,t) => s + Math.abs(t.amount), 0);
    return { debits, credits, net: credits - debits };
  }, [transactions]);

  const summary = yearTotals || pageTotals;

  const enrichedTxns = useMemo(() => {
    if (runningBalanceById) {
      return transactions.map(t => ({ ...t, _runningBalance: runningBalanceById[t.id] ?? 0 }));
    }
    let running = 0;
    return transactions.map(t => {
      running += t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount);
      return { ...t, _runningBalance: running };
    });
  }, [transactions, runningBalanceById]);

  const monthGroups = useMemo(() => {
    const groups = {};
    for (const t of enrichedTxns) {
      const key = t.date.slice(0, 7);
      (groups[key] = groups[key] || []).push(t);
    }
    return Object.entries(groups)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([key, txns]) => {
        const debits  = txns.filter(t => t.type === 'debit').reduce((s,t) => s + Math.abs(t.amount), 0);
        const credits = txns.filter(t => t.type === 'credit').reduce((s,t) => s + Math.abs(t.amount), 0);
        return {
          key,
          label: monthLabel(key),
          transactions: txns,
          debits, credits, net: credits - debits,
        };
      });
  }, [enrichedTxns]);

  // TODO(accounts-table): `accounts` is the legacy/empty table; new transactions
  // have account_id null. This lookup shows '—' for them. The Category column
  // already carries the meaningful chart-of-accounts label.
  const accountMap = useMemo(() => {
    const m = {}; accounts.forEach(a => { m[a.id] = a.name; }); return m;
  }, [accounts]);

  const hasFilters = selectedYear || selectedPeriod || selectedAccountId || selectedCategory;

  function clearFilters() {
    setSelectedYear(''); setSelectedPeriod(''); setSelectedAccountId(''); setSelectedCategory('');
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">General Ledger</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            {total.toLocaleString()} posted transactions
            {loading && <span className="ml-2 text-surface-400">· loading…</span>}
          </p>
        </div>
      </div>

      {/* Year / view summary bar */}
      <div className="card px-4 py-3 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold">
          {activeYear ? `Year ${activeYear}` : 'Current View'} Summary
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          <div className="flex items-center gap-2">
            <TrendingDown size={14} className="text-red-600" />
            <span className="text-surface-500 text-xs">Total Debits</span>
            <span className="font-mono font-semibold text-red-600">{formatCurrency(summary.debits)}</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-green-600" />
            <span className="text-surface-500 text-xs">Total Credits</span>
            <span className="font-mono font-semibold text-green-600">{formatCurrency(summary.credits)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-surface-500 text-xs">{summary.net >= 0 ? 'Net Income' : 'Net Loss'}</span>
            <span className={`font-mono font-semibold ${summary.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {summary.net >= 0 ? '+' : ''}{formatCurrency(summary.net)}
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select value={selectedPeriod} onChange={e => { setSelectedPeriod(e.target.value); if (e.target.value) setSelectedYear(''); }}
          className="input-field w-auto min-w-[130px]">
          <option value="">All Periods</option>
          {allPeriods().map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>

        <select value={selectedYear} onChange={e => { setSelectedYear(e.target.value); if (e.target.value) setSelectedPeriod(''); }}
          className="input-field w-auto">
          <option value="">All Years</option>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <select value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)}
          className="input-field w-auto min-w-[160px]">
          <option value="">All Accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
          className="input-field w-auto min-w-[180px]">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>

        {hasFilters && (
          <button onClick={clearFilters} className="btn-ghost text-xs flex items-center gap-1">
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {loading && !transactions.length ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : total === 0 ? (
        <EmptyState icon={BookOpen}
          title={hasFilters ? 'No transactions match these filters' : 'No posted transactions'}
          description={hasFilters ? 'Try adjusting your filters' : 'Post transactions from the Bookkeeping page to see them here'} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50">
                  <th className="table-header">Date</th>
                  <th className="table-header">Period</th>
                  <th className="table-header">Description</th>
                  <th className="table-header">Category</th>
                  <th className="table-header">Account</th>
                  <th className="table-header text-right text-red-500">Debit</th>
                  <th className="table-header text-right text-green-600">Credit</th>
                  <th className="table-header text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {monthGroups.map(group => (
                  <Fragment key={group.key}>
                    <tr className="bg-surface-50/70">
                      <td colSpan={8} className="px-5 py-1.5 text-center text-[11px] font-semibold tracking-[0.2em] text-surface-500">
                        — {group.label} —
                      </td>
                    </tr>
                    {group.transactions.map(t => (
                      <tr key={t.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                        <td className="table-cell font-mono text-xs text-surface-500 whitespace-nowrap">
                          {t.date ? monthLabel(t.date.slice(0, 7)) : '—'}
                        </td>
                        <td className="table-cell font-medium max-w-[200px] truncate" title={t.description}>{t.description || '—'}</td>
                        <td className="table-cell">
                          {t.category ? <span className="badge-green text-xs rounded-full px-2 py-0.5">{t.category}</span> : <span className="text-surface-300 text-xs">—</span>}
                        </td>
                        <td className="table-cell text-xs text-surface-500">{accountMap[t.account_id] || '—'}</td>
                        <td className="table-cell text-right font-mono text-xs text-red-600">
                          {t.type === 'debit' ? formatCurrency(Math.abs(t.amount)) : ''}
                        </td>
                        <td className="table-cell text-right font-mono text-xs text-green-600">
                          {t.type === 'credit' ? formatCurrency(Math.abs(t.amount)) : ''}
                        </td>
                        <td className={`table-cell text-right font-mono text-xs font-semibold ${t._runningBalance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatCurrency(t._runningBalance)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-surface-100/70 border-b border-surface-200">
                      <td colSpan={5} className="table-cell text-right text-[11px] text-surface-600 uppercase tracking-wider font-semibold">
                        {group.label} Subtotal
                      </td>
                      <td className="table-cell text-right font-mono text-xs font-semibold text-red-600">{formatCurrency(group.debits)}</td>
                      <td className="table-cell text-right font-mono text-xs font-semibold text-green-600">{formatCurrency(group.credits)}</td>
                      <td className={`table-cell text-right font-mono text-xs font-semibold ${group.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {group.net >= 0 ? '+' : ''}{formatCurrency(group.net)}
                      </td>
                    </tr>
                  </Fragment>
                ))}
                {activeYear && yearTotals && (
                  <tr className="bg-surface-100 border-t-2 border-surface-300">
                    <td colSpan={5} className="table-cell text-right text-xs uppercase tracking-wider font-bold text-surface-800">
                      Year {activeYear} Total
                    </td>
                    <td className="table-cell text-right font-mono text-sm font-bold text-red-700">{formatCurrency(yearTotals.debits)}</td>
                    <td className="table-cell text-right font-mono text-sm font-bold text-green-700">{formatCurrency(yearTotals.credits)}</td>
                    <td className={`table-cell text-right font-mono text-sm font-bold ${yearTotals.net >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                      {formatCurrency(yearTotals.net)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PageBar page={page} total={total} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
