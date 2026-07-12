import { useMemo, useState, useEffect } from 'react';
import { subMonths, startOfMonth, format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { aggregateForPnL, debitOf } from '../../lib/finance';
import StatCard from '../../components/ui/StatCard';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Package,
  FileText,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const COLORS = ['#368a67', '#276e52', '#55a683', '#84c3a7', '#f59f00', '#1971c2', '#e03131'];

export default function DashboardPage() {
  const { profile, isAdmin } = useAuth();
  const { products, categories } = useData();

  const [transactions, setTransactions] = useState([]);

  // Fetch the last 6 months of posted transactions. Paginated because a
  // 6-month window can easily exceed PostgREST's 1,000-row default cap and
  // silent truncation would under-report the dashboard's headline numbers.
  useEffect(() => {
    if (!isAdmin) return;
    const sixMonthsAgo = format(startOfMonth(subMonths(new Date(), 5)), 'yyyy-MM-dd');
    fetchAll(
      supabase.from('transactions').select('*')
        .gte('date', sixMonthsAgo).eq('voided', false)
        .order('date', { ascending: false })
    )
      .then((rows) => setTransactions(rows || []))
      .catch(() => setTransactions([]));
  }, [isAdmin]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = transactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const agg = aggregateForPnL(thisMonth, categories);
    const lowStock = products.filter((p) => p.current_stock <= (p.reorder_level || 5));
    return {
      revenue: agg.totalRevenue,
      expenses: agg.totalExpenses,
      netProfit: agg.totalRevenue - agg.totalExpenses,
      lowStock,
      totalProducts: products.length,
    };
  }, [transactions, products, categories]);

  const chartData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = d.toLocaleDateString('en-US', { month: 'short' });
      const mt = transactions.filter((t) => { const td = new Date(t.date); return td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear(); });
      const agg = aggregateForPnL(mt, categories);
      return { month: label, Revenue: agg.totalRevenue, Expenses: agg.totalExpenses };
    });
  }, [transactions, categories]);

  const categoryData = useMemo(() => {
    const map = {};
    for (const t of transactions) {
      if (!t.category) continue;
      const d = debitOf(t);
      if (d > 0) map[t.category] = (map[t.category] || 0) + d;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7);
  }, [transactions]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}
            {profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-surface-500 text-sm mt-0.5">Here's your overview for today</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {isAdmin && (
          <>
            <StatCard icon={TrendingUp} label="Revenue (This Month)" value={formatCurrency(stats.revenue)} />
            <StatCard icon={TrendingDown} label="Expenses (This Month)" value={formatCurrency(stats.expenses)} />
            <StatCard
              icon={DollarSign}
              label="Net Profit"
              value={formatCurrency(stats.netProfit)}
              className={stats.netProfit < 0 ? 'border-red-200 bg-red-50/50' : ''}
            />
          </>
        )}
        <StatCard icon={Package} label="Products" value={stats.totalProducts} sublabel={`${stats.lowStock.length} low stock`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue vs Expenses chart */}
        {isAdmin && (
          <div className="lg:col-span-2 card p-5">
            <h3 className="section-title mb-4">Revenue vs Expenses (6 months)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#868e96' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#868e96' }} />
                  <Tooltip
                    formatter={(value) => formatCurrency(value)}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e9ecef',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      fontSize: 13,
                    }}
                  />
                  <Bar dataKey="Revenue" fill="#368a67" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#e03131" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Expense breakdown pie */}
        {isAdmin && categoryData.length > 0 && (
          <div className="card p-5">
            <h3 className="section-title mb-4">Expense Breakdown</h3>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={75}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 mt-2">
              {categoryData.slice(0, 5).map((c, i) => (
                <div key={c.name} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-surface-600 truncate flex-1">{c.name}</span>
                  <span className="font-mono text-surface-700">{formatCurrency(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Low stock warning */}
      {stats.lowStock.length > 0 && (
        <div className="mt-6 card border-amber-200 bg-amber-50/50 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-accent-amber" />
            <h3 className="section-title text-amber-900">Low Stock Alert</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.lowStock.map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-amber-200">
                <span className="text-sm font-medium text-surface-800">{p.name}</span>
                <span className="badge-red">{p.current_stock} left</span>
              </div>
            ))}
          </div>
          <Link to="/inventory" className="inline-flex items-center gap-1 text-sm text-amber-700 hover:text-amber-800 font-medium mt-3">
            View inventory <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* Recent transactions */}
      {isAdmin && transactions.length > 0 && (
        <div className="mt-6 card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
            <h3 className="section-title">Recent Transactions</h3>
            <Link to="/bookkeeping" className="text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="table-header">Date</th>
                  <th className="table-header">Description</th>
                  <th className="table-header">Category</th>
                  <th className="table-header text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 8).map((t) => (
                  <tr key={t.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                    <td className="table-cell font-mono text-xs">{formatDate(t.date)}</td>
                    <td className="table-cell font-medium">{t.description || t.supplier_name || '—'}</td>
                    <td className="table-cell">
                      {t.category ? <span className="badge-green">{t.category}</span> : '—'}
                    </td>
                    <td className={`table-cell text-right font-mono ${t.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                      {t.type === 'credit' ? '+' : '-'}{formatCurrency(Math.abs(t.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
