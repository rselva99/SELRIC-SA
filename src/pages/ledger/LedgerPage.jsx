import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import EmptyState from '../../components/ui/EmptyState';
import { BookOpen, TrendingDown, TrendingUp, X } from 'lucide-react';

export default function LedgerPage() {
  const { transactions, accounts, categories } = useData();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const availablePeriods = useMemo(() => {
    const set = new Set(
      transactions.filter((t) => t.posted && t.date).map((t) => t.date.slice(0, 7))
    );
    return [...set].sort().map((key) => ({
      key,
      label: format(parseISO(key + '-01'), 'MMM-yy').toUpperCase(),
    }));
  }, [transactions]);

  const years = useMemo(() => {
    const set = new Set(
      transactions
        .filter((t) => t.posted && t.date)
        .map((t) => new Date(t.date + 'T00:00:00').getFullYear())
    );
    // Always include the last 3 years even if empty
    [currentYear - 2, currentYear - 1, currentYear].forEach((y) => set.add(y));
    return [...set].sort((a, b) => b - a);
  }, [transactions, currentYear]);

  const usedCategories = useMemo(() => {
    const set = new Set(
      transactions.filter((t) => t.posted && t.category).map((t) => t.category)
    );
    return [...set].sort();
  }, [transactions]);

  // Filtered posted transactions, sorted ascending for running balance
  const filteredPosted = useMemo(() => {
    return transactions
      .filter((t) => {
        if (!t.posted) return false;
        if (selectedPeriod && t.date.slice(0, 7) !== selectedPeriod) return false;
        if (!selectedPeriod && selectedYear && new Date(t.date + 'T00:00:00').getFullYear() !== parseInt(selectedYear)) return false;
        if (selectedAccountId && t.account_id !== selectedAccountId) return false;
        if (selectedCategory && t.category !== selectedCategory) return false;
        return true;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date) || new Date(a.created_at) - new Date(b.created_at));
  }, [transactions, selectedYear, selectedAccountId, selectedCategory]);

  // Add cumulative running balance to each row
  const filteredWithBalance = useMemo(() => {
    let running = 0;
    return filteredPosted.map((t) => {
      const net = t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount);
      running += net;
      return { ...t, _runningBalance: running };
    });
  }, [filteredPosted]);

  // Group into month buckets (descending order for display)
  const monthGroups = useMemo(() => {
    const groups = {};
    for (const t of filteredWithBalance) {
      const key = t.date.slice(0, 7); // "2024-01"
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }

    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a)) // newest first
      .map(([key, txns]) => {
        const debits = txns.filter((t) => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0);
        const credits = txns.filter((t) => t.type === 'credit').reduce((s, t) => s + Math.abs(t.amount), 0);
        return {
          key,
          label: format(parseISO(key + '-01'), 'MMM-yy').toUpperCase(),
          transactions: [...txns].sort((a, b) => new Date(a.date) - new Date(b.date)),
          debits,
          credits,
          net: credits - debits,
        };
      });
  }, [filteredWithBalance]);

  const totals = useMemo(() => ({
    debits: filteredPosted.filter((t) => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0),
    credits: filteredPosted.filter((t) => t.type === 'credit').reduce((s, t) => s + Math.abs(t.amount), 0),
    count: filteredPosted.length,
  }), [filteredPosted]);

  const hasFilters = selectedYear || selectedPeriod || selectedAccountId || selectedCategory;

  const accountMap = useMemo(() => {
    const m = {};
    accounts.forEach((a) => { m[a.id] = a.name; });
    return m;
  }, [accounts]);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">General Ledger</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            All posted transactions · {totals.count} entries
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="card px-3 py-2 flex items-center gap-2 text-sm">
            <TrendingDown size={14} className="text-red-500" />
            <span className="text-surface-500 text-xs">Total Debits</span>
            <span className="font-mono font-semibold text-red-600">{formatCurrency(totals.debits)}</span>
          </div>
          <div className="card px-3 py-2 flex items-center gap-2 text-sm">
            <TrendingUp size={14} className="text-green-500" />
            <span className="text-surface-500 text-xs">Total Credits</span>
            <span className="font-mono font-semibold text-green-600">{formatCurrency(totals.credits)}</span>
          </div>
          <div className="card px-3 py-2 flex items-center gap-2 text-sm">
            <span className="text-surface-500 text-xs">Net</span>
            <span className={`font-mono font-semibold ${totals.credits - totals.debits >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {totals.credits - totals.debits >= 0 ? '+' : ''}{formatCurrency(totals.credits - totals.debits)}
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={selectedPeriod}
          onChange={(e) => { setSelectedPeriod(e.target.value); if (e.target.value) setSelectedYear(''); }}
          className="input-field w-auto min-w-[130px]"
        >
          <option value="">All Periods</option>
          {availablePeriods.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>

        <select
          value={selectedYear}
          onChange={(e) => { setSelectedYear(e.target.value); if (e.target.value) setSelectedPeriod(''); }}
          className="input-field w-auto"
        >
          <option value="">All Years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <select
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="input-field w-auto min-w-[160px]"
        >
          <option value="">All Accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="input-field w-auto min-w-[180px]"
        >
          <option value="">All Categories</option>
          {usedCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => { setSelectedYear(''); setSelectedPeriod(''); setSelectedAccountId(''); setSelectedCategory(''); }}
            className="btn-ghost text-xs flex items-center gap-1"
          >
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      {/* Content */}
      {filteredPosted.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={hasFilters ? 'No transactions match these filters' : 'No posted transactions'}
          description={hasFilters ? 'Try adjusting your filters' : 'Post transactions from the Bookkeeping page to see them here'}
        />
      ) : (
        <div className="space-y-6">
          {monthGroups.map((group) => (
            <div key={group.key} className="card overflow-hidden">
              {/* Month header */}
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

              {/* Transactions table */}
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
                    {group.transactions.map((t) => (
                      <tr key={t.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-mono text-xs whitespace-nowrap">
                          {formatDate(t.date)}
                        </td>
                        <td className="table-cell font-mono text-xs text-surface-500 whitespace-nowrap">
                          {t.date ? format(parseISO(t.date.slice(0, 7) + '-01'), 'MMM-yy').toUpperCase() : '—'}
                        </td>
                        <td className="table-cell font-medium max-w-[200px] truncate" title={t.description}>
                          {t.description || '—'}
                        </td>
                        <td className="table-cell">
                          {t.category ? (
                            <span className="badge-green text-xs rounded-full px-2 py-0.5">
                              {t.category}
                            </span>
                          ) : (
                            <span className="text-surface-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="table-cell text-xs text-surface-500">
                          {accountMap[t.account_id] || '—'}
                        </td>
                        <td className="table-cell text-right font-mono text-xs text-red-600">
                          {t.type === 'debit' ? formatCurrency(Math.abs(t.amount)) : ''}
                        </td>
                        <td className="table-cell text-right font-mono text-xs text-green-600">
                          {t.type === 'credit' ? formatCurrency(Math.abs(t.amount)) : ''}
                        </td>
                        <td className={`table-cell text-right font-mono text-xs font-semibold ${
                          t._runningBalance >= 0 ? 'text-green-700' : 'text-red-700'
                        }`}>
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
      )}
    </div>
  );
}
