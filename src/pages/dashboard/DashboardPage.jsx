import { useMemo, useState, useEffect } from 'react';
import { subMonths, startOfMonth, format, addDays } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useT } from '../../i18n/I18nContext';
import { aggregateForPnL, debitOf } from '../../lib/finance';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  TrendingUp,
  TrendingDown,
  Package,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  ListChecks,
  Receipt,
  CheckCircle2,
  Upload,
  FileText,
  Users,
  Settings,
  ArrowLeftRight,
  ShoppingBag,
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
// Get-started tiles: icon per link target (the copy lives in translations, dash.start.*).
const START_ICONS = {
  '/settings': Settings,
  '/transactions': ArrowLeftRight,
  '/sales': ShoppingBag,
  '/bookkeeping': Upload,
  '/inventory': Package,
  '/accounts': FileText,
  '/users': Users,
};

function sameMonth(dateStr, ref) {
  const d = new Date(dateStr);
  return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear();
}

function pctChange(now, prev) {
  if (!prev) return null;
  return Math.round(((now - prev) / Math.abs(prev)) * 100);
}

export default function DashboardPage() {
  const { profile, organization, accountingMode, isAdmin, config } = useAuth();
  // Simple mode: which sections show and which modules exist come from the
  // portal config (Settings → Your portal). Full mode shows everything.
  const show = (k) => accountingMode !== 'simple' || config?.dashboard?.[k] !== false;
  const moduleOn = (k) => accountingMode !== 'simple' || config?.modules?.[k] !== false;
  const { products, categories } = useData();
  const { t, tn, locale } = useT();
  const simple = accountingMode === 'simple';

  const [transactions, setTransactions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [bills, setBills] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Six months of posted transactions (paginated — a 6-month window can pass
  // PostgREST's 1,000-row cap) plus the small "what needs you" lists.
  useEffect(() => {
    const inAWeek = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const sixMonthsAgo = format(startOfMonth(subMonths(new Date(), 5)), 'yyyy-MM-dd');

    const jobs = [
      supabase.from('tasks').select('id, title, due_date, status').eq('status', 'open').lte('due_date', inAWeek).order('due_date')
        .then(({ data }) => setTasks(data || []), () => setTasks([])),
    ];
    if (isAdmin) {
      jobs.push(
        fetchAll(
          supabase.from('transactions').select('*')
            .gte('date', sixMonthsAgo).eq('voided', false)
            .order('date', { ascending: false })
        ).then((rows) => setTransactions(rows || []), () => setTransactions([])),
        supabase.from('invoices').select('id, supplier, amount, due_date, status').in('status', ['pending', 'overdue']).lte('due_date', inAWeek).order('due_date')
          .then(({ data }) => setBills(data || []), () => setBills([])),
      );
    }
    Promise.allSettled(jobs).then(() => setLoaded(true));
  }, [isAdmin]);

  const stats = useMemo(() => {
    const now = new Date();
    const last = subMonths(now, 1);
    const thisMonth = aggregateForPnL(transactions.filter((x) => sameMonth(x.date, now)), categories);
    const lastMonth = aggregateForPnL(transactions.filter((x) => sameMonth(x.date, last)), categories);
    // Same rule as the Inventory page: at/below the minimum (reorder_level) is
    // "below minimum"; under the ideal quantity (target_stock) is "to restock".
    const belowMin = products.filter((p) => (p.current_stock || 0) <= (p.reorder_level ?? 0));
    const toRestock = products.filter((p) => !belowMin.includes(p) && (p.target_stock || 0) > 0 && (p.current_stock || 0) < p.target_stock);
    const lowStock = [...belowMin, ...toRestock];
    const net = thisMonth.totalRevenue - thisMonth.totalExpenses;
    const lastNet = lastMonth.totalRevenue - lastMonth.totalExpenses;
    return {
      revenue: thisMonth.totalRevenue,
      expenses: thisMonth.totalExpenses,
      net,
      revenueTrend: pctChange(thisMonth.totalRevenue, lastMonth.totalRevenue),
      expensesTrend: pctChange(thisMonth.totalExpenses, lastMonth.totalExpenses),
      netTrend: pctChange(net, lastNet),
      lowStock,
      belowMin,
      toRestock,
      totalProducts: products.length,
    };
  }, [transactions, products, categories]);

  const chartData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = d.toLocaleDateString(locale, { month: 'short' });
      const agg = aggregateForPnL(transactions.filter((x) => sameMonth(x.date, d)), categories);
      return { month: label, [t('dash.revenue')]: agg.totalRevenue, [t('dash.expenses')]: agg.totalExpenses };
    });
  }, [transactions, categories, locale, t]);

  const categoryData = useMemo(() => {
    const map = {};
    for (const x of transactions) {
      if (!x.category) continue;
      const d = debitOf(x);
      if (d > 0) map[x.category] = (map[x.category] || 0) + d;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7);
  }, [transactions]);

  // "What needs you" — one line per thing, each a link.
  const attention = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const overdueTasks = tasks.filter((x) => x.due_date < today).length;
    const weekTasks = tasks.length - overdueTasks;
    const overdueBills = bills.filter((b) => b.due_date && b.due_date < today).length;
    const weekBills = bills.length - overdueBills;
    const billsTo = simple ? '/transactions' : '/bookkeeping';
    const items = [];
    if (overdueTasks && moduleOn('tasks')) items.push({ icon: ListChecks, tone: 'red',   text: tn('dash.overdueTasks',  overdueTasks),  to: '/tasks' });
    if (overdueBills) items.push({ icon: Receipt,    tone: 'red',   text: tn('dash.billsOverdue',  overdueBills),  to: billsTo });
    if (weekBills)    items.push({ icon: Receipt,    tone: 'amber', text: tn('dash.billsDue',      weekBills),     to: billsTo });
    if (weekTasks && moduleOn('tasks')) items.push({ icon: ListChecks, tone: 'amber', text: tn('dash.tasksThisWeek', weekTasks),     to: '/tasks' });
    if (stats.belowMin.length && moduleOn('inventory'))  items.push({ icon: Package, tone: 'red',   text: tn('dash.lowStockItems', stats.belowMin.length),  to: '/inventory' });
    if (stats.toRestock.length && moduleOn('inventory')) items.push({ icon: Package, tone: 'amber', text: tn('dash.restockItems',  stats.toRestock.length), to: '/inventory' });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, bills, stats.belowMin.length, stats.toRestock.length, tn, simple, config]);

  const hour = new Date().getHours();
  const slot = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const firstName = profile?.full_name?.split(' ')[0];
  const greeting = firstName ? t(`dash.greeting.${slot}`, { name: firstName }) : t(`dash.greetingNoName.${slot}`);
  const rawDate = new Date().toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
  const dateLine = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const isEmptyWorkspace = isAdmin && loaded && transactions.length === 0 && products.length === 0;
  // The wide column holds the chart and recent transactions — admin-only, and
  // nothing to show until the first statement is in.
  const hasWide = isAdmin && transactions.length > 0;

  const Trend = ({ value, invert = false }) => {
    if (value == null) return <span className="text-xs text-brand-300">{t('dash.noPriorMonth')}</span>;
    const good = invert ? value <= 0 : value >= 0;
    const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
    return (
      <span className={`inline-flex items-center gap-1 text-xs ${good ? 'text-brand-200' : 'text-amber-300'}`}>
        <Icon size={13} /> {Math.abs(value)}% {t('dash.vsLastMonth')}
      </span>
    );
  };

  return (
    <div className="animate-fade-in">
      {/* ── Header band ─────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-brand-950 text-white px-6 py-6 sm:px-8 sm:py-7 shadow-modal">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl leading-tight">{greeting}</h1>
            <p className="text-brand-300 text-sm mt-1">{dateLine}</p>
          </div>
          {organization?.name && (
            <p className="text-brand-200 text-sm">{t('dash.thisWeekAt', { business: organization.name })}</p>
          )}
        </div>

        {isAdmin && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="rounded-xl bg-white/[0.06] px-4 py-4">
              <div className="flex items-center gap-2 text-brand-200 text-sm"><TrendingUp size={15} /> {t('dash.salesMonth')}</div>
              <div className="font-mono text-2xl sm:text-[1.7rem] mt-2">{formatCurrency(stats.revenue)}</div>
              <div className="mt-1.5"><Trend value={stats.revenueTrend} /></div>
            </div>
            <div className="rounded-xl bg-white/[0.06] px-4 py-4">
              <div className="flex items-center gap-2 text-brand-200 text-sm"><TrendingDown size={15} /> {t('dash.expensesMonth')}</div>
              <div className="font-mono text-2xl sm:text-[1.7rem] mt-2">{formatCurrency(stats.expenses)}</div>
              <div className="mt-1.5"><Trend value={stats.expensesTrend} invert /></div>
            </div>
            <div className={`rounded-xl px-4 py-4 ${stats.net < 0 ? 'bg-red-500/15' : 'bg-brand-500/25'}`}>
              <div className="flex items-center gap-2 text-brand-100 text-sm">{t('dash.netMonth')}</div>
              <div className="font-mono text-2xl sm:text-[1.7rem] mt-2">{formatCurrency(stats.net)}</div>
              <div className="mt-1.5"><Trend value={stats.netTrend} /></div>
            </div>
          </div>
        )}
      </section>

      {/* ── Empty workspace: get started ─────────────────────────────── */}
      {isEmptyWorkspace && (
        <section className="mt-6 card p-6">
          <h2 className="font-display text-xl text-brand-950">{t('dash.getStartedTitle')}</h2>
          <p className="text-surface-600 text-sm mt-1">{t('dash.getStartedBody')}</p>
          <ol className="mt-5 grid sm:grid-cols-2 gap-3">
            {t(simple ? 'dash.startSimple' : 'dash.start').filter(([, , to]) => !simple || ({ '/inventory': 'inventory', '/sales': 'sales', '/customers': 'customers', '/tasks': 'tasks' }[to] ? moduleOn({ '/inventory': 'inventory', '/sales': 'sales', '/customers': 'customers', '/tasks': 'tasks' }[to]) : true)).map(([title, body, to]) => {
              const Icon = START_ICONS[to] || FileText;
              return (
                <li key={to}>
                  <Link to={to} className="flex gap-3 rounded-xl border border-surface-200 hover:border-brand-400 hover:bg-brand-50 px-4 py-3.5 transition-colors">
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center"><Icon size={18} /></span>
                    <span>
                      <span className="block font-medium text-surface-900">{title}</span>
                      <span className="block text-sm text-surface-600 mt-0.5">{body}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className={`mt-6 grid grid-cols-1 gap-6 ${hasWide ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        {hasWide && (
        <div className="lg:col-span-2 space-y-6">
          {isAdmin && !isEmptyWorkspace && show('chart') && (
            <div className="card p-5">
              <h3 className="section-title mb-4">{t('dash.chartTitle')}</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#868e96' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#868e96' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(value) => formatCurrency(value)}
                      contentStyle={{ borderRadius: 10, border: '1px solid #e9ecef', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 13 }}
                    />
                    <Bar dataKey={t('dash.revenue')} fill="#368a67" radius={[6, 6, 0, 0]} />
                    <Bar dataKey={t('dash.expenses')} fill="#c9c2b4" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {isAdmin && transactions.length > 0 && show('recent') && (
            <div className="card">
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
                <h3 className="section-title">{t('dash.recent')}</h3>
                <Link to={simple ? '/transactions' : '/ledger'} className="text-sm text-brand-700 hover:text-brand-800 font-medium flex items-center gap-1">
                  {t('common.viewAll')} <ArrowRight size={14} />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-100">
                      <th className="table-header">{t('dash.date')}</th>
                      <th className="table-header">{t('dash.description')}</th>
                      <th className="table-header">{t('dash.category')}</th>
                      <th className="table-header text-right">{t('dash.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 8).map((x) => (
                      <tr key={x.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(x.date)}</td>
                        <td className="table-cell font-medium">{x.description || x.supplier_name || '—'}</td>
                        <td className="table-cell">{x.category ? <span className="badge-green">{x.category}</span> : '—'}</td>
                        <td className={`table-cell text-right font-mono whitespace-nowrap ${x.type === 'credit' ? 'text-brand-700' : 'text-surface-800'}`}>
                          {x.type === 'credit' ? '+' : '−'}{formatCurrency(Math.abs(x.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        )}

        <div className={hasWide ? 'space-y-6' : 'contents'}>
          {/* What needs you */}
          <div className="card p-5">
            <h3 className="section-title mb-3">{t('dash.needsYou')}</h3>
            {attention.length === 0 ? (
              <div className="flex items-center gap-3 text-sm text-surface-600 py-2">
                <CheckCircle2 size={20} className="text-brand-500 shrink-0" />
                {t('dash.allClear')}
              </div>
            ) : (
              <ul className="divide-y divide-surface-100">
                {attention.map((a) => {
                  const tone = a.tone === 'red' ? 'bg-red-50 text-red-600' : a.tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700';
                  return (
                    <li key={a.text}>
                      <Link to={a.to} className="flex items-center gap-3 py-2.5 group">
                        <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${tone}`}><a.icon size={16} /></span>
                        <span className="flex-1 text-sm text-surface-800 group-hover:text-brand-800">{a.text}</span>
                        <ArrowRight size={14} className="text-surface-400 group-hover:text-brand-700" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Products (everyone, when the inventory module is on) */}
          {moduleOn('inventory') && show('products') && (
          <div className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-surface-500">{t('dash.products')}</p>
                <p className="stat-value mt-1">{stats.totalProducts}</p>
                <p className={`text-xs mt-1 ${stats.lowStock.length ? 'text-amber-700' : 'text-surface-500'}`}>
                  {tn('dash.lowStock', stats.lowStock.length)}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center"><Package size={20} /></div>
            </div>
            {stats.lowStock.length > 0 && (
              <div className="mt-4 space-y-2">
                {stats.lowStock.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                    <span className="text-sm text-surface-800 truncate">{p.name}</span>
                    <span className="badge-amber shrink-0">{t('dash.left', { n: p.current_stock })}</span>
                  </div>
                ))}
                <Link to="/inventory" className="inline-flex items-center gap-1 text-sm text-amber-800 hover:text-amber-900 font-medium pt-1">
                  {t('dash.viewInventory')} <ArrowRight size={14} />
                </Link>
              </div>
            )}
          </div>

          )}

          {/* Where the money went */}
          {isAdmin && categoryData.length > 0 && show('breakdown') && (
            <div className="card p-5">
              <h3 className="section-title mb-2">{t('dash.breakdown')}</h3>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryData} cx="50%" cy="50%" innerRadius={42} outerRadius={70} dataKey="value" paddingAngle={2}>
                      {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
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
      </div>
    </div>
  );
}
