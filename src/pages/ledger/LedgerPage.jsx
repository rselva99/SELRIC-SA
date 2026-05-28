import { useState, useMemo, useEffect, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import { BookOpen, TrendingDown, TrendingUp, X } from 'lucide-react';

const PAGE_SIZE   = 100; // rows per page
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
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from('transactions')
        .select('*', { count: 'exact' })
        .eq('posted', true)
        .order('date', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (selectedPeriod) {
        const [yr, mo] = selectedPeriod.split('-');
        const lastDay = new Date(parseInt(yr), parseInt(mo), 0).getDate();
        q = q.gte('date', `${yr}-${mo}-01`).lte('date', `${yr}-${mo}-${String(lastDay).padStart(2,'0')}`);
      } else if (selectedYear) {
        q = q.gte('date', `${selectedYear}-01-01`).lte('date', `${selectedYear}-12-31`);
      }
      if (selectedAccountId) q = q.eq('account_id', selectedAccountId);
      if (selectedCategory)  q = q.eq('category', selectedCategory);

      const { data, count, error } = await q;
      if (error) throw error;
      setTransactions(data || []);
      setTotal(count || 0);
    } catch (err) {
      console.error('LedgerPage load error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, selectedPeriod, selectedYear, selectedAccountId, selectedCategory]);

  useEffect(() => { loadData(); }, [loadData]);
  // Reset to page 0 whenever a filter changes
  useEffect(() => { setPage(0); }, [selectedPeriod, selectedYear, selectedAccountId, selectedCategory]);

  // Group the current page's transactions by month for display
  const monthGroups = useMemo(() => {
    let running = 0;
    const withBalance = transactions.map((t) => {
      running += t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount);
      return { ...t, _runningBalance: running };
    });
    const groups = {};
    for (const t of withBalance) {
      const key = t.date.slice(0, 7);
      (groups[key] = groups[key] || []).push(t);
    }
    return Object.entries(groups)
      .sort(([a],[b]) => b.localeCompare(a))
      .map(([key, txns]) => {
        const debits  = txns.filter(t => t.type === 'debit').reduce((s,t) => s + Math.abs(t.amount), 0);
        const credits = txns.filter(t => t.type === 'credit').reduce((s,t) => s + Math.abs(t.amount), 0);
        return { key, label: format(parseISO(key+'-01'), 'MMM-yy').toUpperCase(),
          transactions: [...txns].sort((a,b) => a.date.localeCompare(b.date)),
          debits, credits, net: credits - debits };
      });
  }, [transactions]);

  const totals = useMemo(() => ({
    debits:  transactions.filter(t => t.type==='debit').reduce((s,t)  => s + Math.abs(t.amount), 0),
    credits: transactions.filter(t => t.type==='credit').reduce((s,t) => s + Math.abs(t.amount), 0),
  }), [transactions]);

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
        <div className="flex gap-2 flex-wrap">
          {[
            { icon: TrendingDown, label: 'Total Debits',  val: totals.debits,  cls: 'text-red-600' },
            { icon: TrendingUp,   label: 'Total Credits', val: totals.credits, cls: 'text-green-600' },
          ].map(s => (
            <div key={s.label} className="card px-3 py-2 flex items-center gap-2 text-sm">
              <s.icon size={14} className={s.cls} />
              <span className="text-surface-500 text-xs">{s.label}</span>
              <span className={`font-mono font-semibold ${s.cls}`}>{formatCurrency(s.val)}</span>
            </div>
          ))}
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
        <>
          <div className="space-y-6">
            {monthGroups.map(group => (
              <div key={group.key} className="card overflow-hidden">
                <div className="px-5 py-3 bg-surface-50 border-b border-surface-100 flex items-center justify-between">
                  <h3 className="font-display text-base font-semibold tracking-wide">{group.label}</h3>
                  <div className="flex gap-4 text-xs font-mono">
                    <span className="text-red-600">DR {formatCurrency(group.debits)}</span>
                    <span className="text-green-600">CR {formatCurrency(group.credits)}</span>
                    <span className={`font-semibold ${group.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      Net {group.net >= 0 ? '+' : ''}{formatCurrency(group.net)}
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-surface-100">
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
                      {group.transactions.map(t => (
                        <tr key={t.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                          <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                          <td className="table-cell font-mono text-xs text-surface-500 whitespace-nowrap">
                            {t.date ? format(parseISO(t.date.slice(0,7)+'-01'), 'MMM-yy').toUpperCase() : '—'}
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
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          <PageBar page={page} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
