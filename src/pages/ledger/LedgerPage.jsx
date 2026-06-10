import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import { BookOpen, TrendingDown, TrendingUp, X, Search, Download, Loader2 } from 'lucide-react';

const PAGE_SIZE   = 100;
const FETCH_BATCH = 1000;            // Supabase per-request row limit
const MONTHS_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

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

// CSV helper — escapes quotes/commas/newlines per RFC 4180.
function downloadCsv(filename, headers, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function LedgerPage() {
  const { accounts } = useData();

  // ── Year list derived from real posted data ────────────────────────────────
  const [availableYears, setAvailableYears] = useState([]);
  const [yearListState, setYearListState]   = useState('loading'); // loading | error | ready

  // ── Filters ────────────────────────────────────────────────────────────────
  const [selectedPeriod,    setSelectedPeriod]    = useState('');
  const [selectedYear,      setSelectedYear]      = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCategory,  setSelectedCategory]  = useState('');
  const [searchInput,       setSearchInput]       = useState('');
  const [search,            setSearch]            = useState(''); // debounced
  const [dateFrom,          setDateFrom]          = useState('');
  const [dateTo,            setDateTo]            = useState('');
  const [minAmount,         setMinAmount]         = useState('');
  const [maxAmount,         setMaxAmount]         = useState('');
  const [txnType,           setTxnType]           = useState(''); // '' | 'debit' | 'credit'
  const [page,              setPage]              = useState(0);

  // ── Data state machine ────────────────────────────────────────────────────
  const [transactions,  setTransactions]  = useState([]);
  const [filterSummary, setFilterSummary] = useState([]); // ALL matching rows (slim)
  const [total,         setTotal]         = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [exporting,     setExporting]     = useState(false);

  // Category list comes from useData(); avoid trickling stale renders by picking
  // a stable slice here.
  const { categories } = useData();

  // Min/max posted dates → year dropdown. One-shot fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [minRes, maxRes] = await Promise.all([
          supabase.from('transactions').select('date').eq('posted', true).order('date', { ascending: true }).limit(1),
          supabase.from('transactions').select('date').eq('posted', true).order('date', { ascending: false }).limit(1),
        ]);
        if (cancelled) return;
        const min = minRes.data?.[0]?.date;
        const max = maxRes.data?.[0]?.date;
        const years = [];
        if (min && max) {
          const a = parseInt(min.slice(0, 4), 10);
          const b = parseInt(max.slice(0, 4), 10);
          for (let y = a; y <= b; y++) years.push(y);
        }
        setAvailableYears(years);
        setYearListState('ready');
      } catch {
        if (!cancelled) setYearListState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounce description search.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Effective dates: if either dateFrom or dateTo is set, they override
  // period/year. Period takes precedence over year.
  const dateBounds = useMemo(() => {
    if (dateFrom || dateTo) return { from: dateFrom || null, to: dateTo || null, source: 'range' };
    if (selectedPeriod) {
      const [yr, mo] = selectedPeriod.split('-');
      const lastDay = new Date(parseInt(yr), parseInt(mo), 0).getDate();
      return { from: `${yr}-${mo}-01`, to: `${yr}-${mo}-${String(lastDay).padStart(2,'0')}`, source: 'period' };
    }
    if (selectedYear) return { from: `${selectedYear}-01-01`, to: `${selectedYear}-12-31`, source: 'year' };
    return { from: null, to: null, source: 'none' };
  }, [dateFrom, dateTo, selectedPeriod, selectedYear]);

  // Build a fresh PostgREST query with the current filter set applied. Used by
  // pageQ, the slim full-set summary fetch, and the CSV export.
  const buildFilteredQuery = useCallback((columns, opts = undefined) => {
    let q = opts ? supabase.from('transactions').select(columns, opts) : supabase.from('transactions').select(columns);
    q = q.eq('posted', true);
    if (dateBounds.from) q = q.gte('date', dateBounds.from);
    if (dateBounds.to)   q = q.lte('date', dateBounds.to);
    if (selectedAccountId) q = q.eq('account_id', selectedAccountId);
    if (selectedCategory)  q = q.eq('category', selectedCategory);
    if (txnType)           q = q.eq('type', txnType);
    const min = parseFloat(minAmount);
    const max = parseFloat(maxAmount);
    if (!Number.isNaN(min)) q = q.gte('amount', min);
    if (!Number.isNaN(max)) q = q.lte('amount', max);
    if (search) q = q.ilike('description', `%${search}%`);
    return q;
  }, [dateBounds, selectedAccountId, selectedCategory, txnType, minAmount, maxAmount, search]);

  // Pull every matching row in batches of 1000. Returns the merged set.
  const fetchAllFiltered = useCallback(async (columns) => {
    const out = [];
    let from = 0;
    while (true) {
      const { data, error } = await buildFilteredQuery(columns).order('date', { ascending: true }).range(from, from + FETCH_BATCH - 1);
      if (error) throw error;
      const rows = data || [];
      out.push(...rows);
      if (rows.length < FETCH_BATCH) break;
      from += FETCH_BATCH;
    }
    return out;
  }, [buildFilteredQuery]);

  // Generation token so a stale loadData call can't overwrite newer state.
  const loadIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const myId = ++loadIdRef.current;
    setLoading(true);
    try {
      const pageQ = buildFilteredQuery('*', { count: 'exact' })
        .order('date', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const [pageRes, summary] = await Promise.all([
        pageQ,
        fetchAllFiltered('id, date, type, amount'),
      ]);

      if (myId !== loadIdRef.current) return; // superseded
      if (pageRes.error) throw pageRes.error;

      setTransactions(pageRes.data || []);
      setTotal(pageRes.count || 0);
      setFilterSummary(summary);
    } catch (err) {
      console.error('LedgerPage load error:', err);
      if (myId === loadIdRef.current) toast.error('Failed to load transactions');
    } finally {
      if (myId === loadIdRef.current) setLoading(false);
    }
  }, [page, buildFilteredQuery, fetchAllFiltered]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reset page on any filter change.
  useEffect(() => {
    setPage(0);
  }, [selectedPeriod, selectedYear, selectedAccountId, selectedCategory, search, dateFrom, dateTo, minAmount, maxAmount, txnType]);

  // ── Derived: totals + per-row running balance ─────────────────────────────
  const summary = useMemo(() => {
    let debit = 0, credit = 0;
    for (const t of filterSummary) {
      if (t.type === 'debit')  debit  += Math.abs(t.amount);
      else if (t.type === 'credit') credit += Math.abs(t.amount);
    }
    return { count: filterSummary.length, debits: debit, credits: credit, net: credit - debit };
  }, [filterSummary]);

  const runningBalanceById = useMemo(() => {
    const map = {};
    let running = 0;
    for (const t of filterSummary) {
      running += t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount);
      map[t.id] = running;
    }
    return map;
  }, [filterSummary]);

  const enrichedTxns = useMemo(
    () => transactions.map(t => ({ ...t, _runningBalance: runningBalanceById[t.id] ?? 0 })),
    [transactions, runningBalanceById]
  );

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
        return { key, label: monthLabel(key), transactions: txns, debits, credits, net: credits - debits };
      });
  }, [enrichedTxns]);

  // Account name lookup. The legacy `accounts` table has few rows; new txns
  // have account_id null, so most rows show '—' (the category column is the
  // meaningful chart-of-accounts label).
  const accountMap = useMemo(() => {
    const m = {}; accounts.forEach(a => { m[a.id] = a.name; }); return m;
  }, [accounts]);

  // Periods dropdown: every month in every year that has data.
  const periodOptions = useMemo(() => {
    const out = [];
    for (const y of availableYears) {
      for (let m = 0; m < 12; m++) {
        out.push({ key: `${y}-${String(m+1).padStart(2,'0')}`, label: `${MONTHS_ABBR[m]}-${String(y).slice(2)}` });
      }
    }
    return out;
  }, [availableYears]);

  const hasFilters = !!(
    selectedYear || selectedPeriod || selectedAccountId || selectedCategory ||
    search || dateFrom || dateTo || minAmount || maxAmount || txnType
  );

  function clearFilters() {
    setSelectedYear(''); setSelectedPeriod(''); setSelectedAccountId(''); setSelectedCategory('');
    setSearchInput(''); setSearch('');
    setDateFrom(''); setDateTo('');
    setMinAmount(''); setMaxAmount('');
    setTxnType('');
  }

  // ── CSV export — current filtered view, full set ──────────────────────────
  async function handleExport() {
    setExporting(true);
    try {
      const rows = await fetchAllFiltered('id, date, description, category, account_id, amount, type');
      // Recompute running balance over the EXACT same ordering as displayed.
      let running = 0;
      const data = rows.map(t => {
        running += t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount);
        const debit  = t.type === 'debit'  ? Math.abs(t.amount) : '';
        const credit = t.type === 'credit' ? Math.abs(t.amount) : '';
        return [
          t.date,
          monthLabel(t.date.slice(0, 7)),
          t.description || '',
          t.category || '',
          accountMap[t.account_id] || '',
          debit,
          credit,
          running.toFixed(2),
        ];
      });
      const headers = ['Date', 'Period', 'Description', 'Category', 'Account', 'Debit', 'Credit', 'Balance'];
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadCsv(`ledger_${stamp}.csv`, headers, data);
      toast.success(`Exported ${data.length} transactions`);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">General Ledger</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            {total.toLocaleString()} posted transactions match
            {loading && <span className="ml-2 text-surface-400">· loading…</span>}
          </p>
        </div>
      </div>

      {/* ── Current View Summary — always reflects all active filters ──────── */}
      <div className="card px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold">
          Current View Summary
          {hasFilters && <span className="ml-2 normal-case tracking-normal text-surface-400">· filtered</span>}
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-surface-500 text-xs">Matches</span>
            <span className="font-mono font-semibold">{summary.count.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingDown size={14} className="text-red-600" />
            <span className="text-surface-500 text-xs">Debits</span>
            <span className="font-mono font-semibold text-red-600">{formatCurrency(summary.debits)}</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-green-600" />
            <span className="text-surface-500 text-xs">Credits</span>
            <span className="font-mono font-semibold text-green-600">{formatCurrency(summary.credits)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-surface-500 text-xs">{summary.net >= 0 ? 'Net' : 'Net'}</span>
            <span className={`font-mono font-semibold ${summary.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {summary.net >= 0 ? '+' : ''}{formatCurrency(summary.net)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Filter toolbar ────────────────────────────────────────────────── */}
      <div className="card px-4 py-3 mb-6 space-y-3">
        {/* Row 1: search + date range + type */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search description…"
              className="input-field pl-9"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <span className="uppercase tracking-wider font-semibold">Range</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="input-field text-xs py-1.5 w-auto" title="From" />
            <span className="text-surface-300">→</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="input-field text-xs py-1.5 w-auto" title="To" />
            {(dateFrom || dateTo) && (selectedPeriod || selectedYear) && (
              <span className="text-amber-700 text-[10px] uppercase tracking-wider">overrides period/year</span>
            )}
          </div>
          <select value={txnType} onChange={e => setTxnType(e.target.value)}
            className="input-field text-xs py-1.5 w-auto">
            <option value="">All types</option>
            <option value="debit">Debits only</option>
            <option value="credit">Credits only</option>
          </select>
        </div>

        {/* Row 2: period / year / account / category / amount range */}
        <div className="flex flex-wrap items-center gap-3">
          <select value={selectedPeriod} onChange={e => { setSelectedPeriod(e.target.value); if (e.target.value) setSelectedYear(''); }}
            className="input-field text-xs py-1.5 w-auto min-w-[130px]" disabled={!!(dateFrom || dateTo)}>
            <option value="">All periods</option>
            {periodOptions.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>

          <select value={selectedYear} onChange={e => { setSelectedYear(e.target.value); if (e.target.value) setSelectedPeriod(''); }}
            className="input-field text-xs py-1.5 w-auto" disabled={!!(dateFrom || dateTo)}>
            <option value="">{yearListState === 'loading' ? 'Loading years…' : 'All years'}</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <select value={selectedAccountId} onChange={e => setSelectedAccountId(e.target.value)}
            className="input-field text-xs py-1.5 w-auto min-w-[140px]">
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
            className="input-field text-xs py-1.5 w-auto min-w-[160px]">
            <option value="">All categories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>

          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <span className="uppercase tracking-wider font-semibold">Amount</span>
            <input type="number" min="0" step="0.01" value={minAmount} onChange={e => setMinAmount(e.target.value)}
              placeholder="Min" className="input-field text-xs py-1.5 w-24 font-mono text-right" />
            <span className="text-surface-300">→</span>
            <input type="number" min="0" step="0.01" value={maxAmount} onChange={e => setMaxAmount(e.target.value)}
              placeholder="Max" className="input-field text-xs py-1.5 w-24 font-mono text-right" />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {hasFilters && (
              <button onClick={clearFilters} className="btn-ghost text-xs flex items-center gap-1">
                <X size={12} /> Clear filters
              </button>
            )}
            <button onClick={handleExport} disabled={exporting || summary.count === 0}
              className="btn-secondary text-xs flex items-center gap-1.5">
              {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
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
                {summary.count > 0 && (
                  <tr className="bg-surface-100 border-t-2 border-surface-300">
                    <td colSpan={5} className="table-cell text-right text-xs uppercase tracking-wider font-bold text-surface-800">
                      Filtered Total · {summary.count.toLocaleString()} txns
                    </td>
                    <td className="table-cell text-right font-mono text-sm font-bold text-red-700">{formatCurrency(summary.debits)}</td>
                    <td className="table-cell text-right font-mono text-sm font-bold text-green-700">{formatCurrency(summary.credits)}</td>
                    <td className={`table-cell text-right font-mono text-sm font-bold ${summary.net >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                      {formatCurrency(summary.net)}
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
