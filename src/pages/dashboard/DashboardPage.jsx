import { Suspense, lazy, useMemo, useState, useEffect } from 'react';
import { subMonths, startOfMonth, format, addDays } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useT } from '../../i18n/I18nContext';
import { aggregateForPnL } from '../../lib/finance';
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
import Spinner from '../../components/ui/Spinner';
// The charts (and recharts with them) arrive after the numbers above them.
const DashboardCharts = lazy(() => import('./DashboardCharts'));
import { HealthTile } from '../checks/parts';
import { BUSINESS_CHECKS, healthScore } from '../../lib/checks/index.js';
import { loadLatest } from '../../lib/checks/store.js';

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
  const [statements, setStatements] = useState([]);
  const [paperChecks, setPaperChecks] = useState([]);
  const [checkRun, setCheckRun] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const full = accountingMode !== 'simple';
  const orgId = organization?.id;

  // Twelve months of posted transactions for the charts (paginated — a year
  // can pass PostgREST's 1,000-row cap), the small "what needs you" lists,
  // and for the full package the statements (the cash bridge's opening
  // balance), the paper checks and the last run of the integrity checks.
  useEffect(() => {
    const inAWeek = format(addDays(new Date(), 7), 'yyyy-MM-dd');
    const yearAgo = format(startOfMonth(subMonths(new Date(), 11)), 'yyyy-MM-dd');

    const jobs = [
      supabase.from('tasks').select('id, title, due_date, status').eq('status', 'open').lte('due_date', inAWeek).order('due_date')
        .then(({ data }) => setTasks(data || []), () => setTasks([])),
    ];
    if (isAdmin) {
      jobs.push(
        fetchAll(
          supabase.from('transactions').select('*')
            .gte('date', yearAgo).eq('voided', false)
            .order('date', { ascending: false })
        ).then((rows) => setTransactions(rows || []), () => setTransactions([])),
        supabase.from('invoices').select('id, supplier, amount, due_date, status').in('status', ['pending', 'overdue']).lte('due_date', inAWeek).order('due_date')
          .then(({ data }) => setBills(data || []), () => setBills([])),
      );
      if (full) {
        jobs.push(
          supabase.from('bank_statements').select('id, period_start, period_end, statement_totals').gte('period_start', yearAgo)
            .then(({ data }) => setStatements(data || []), () => setStatements([])),
          fetchAll(supabase.from('checks').select('id, status, amount'))
            .then((rows) => setPaperChecks(rows || []), () => setPaperChecks([])),
        );
        if (orgId) {
          jobs.push(loadLatest(supabase, orgId).then((r) => setCheckRun(r), () => setCheckRun({ missing: true, byCheck: new Map(), runAt: null })));
        }
      }
    }
    Promise.allSettled(jobs).then(() => setLoaded(true));
  }, [isAdmin, full, orgId]);

  // The health score of the last stored run (null until a run exists).
  const health = useMemo(() => {
    if (!checkRun?.byCheck?.size) return null;
    const results = BUSINESS_CHECKS.map((c) => checkRun.byCheck.get(c.key)).filter(Boolean);
    return results.length ? healthScore(results) : null;
  }, [checkRun]);

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
  // Recent transactions — admin-only, and nothing to show until the first
  // statement is in.
  const hasRecent = isAdmin && transactions.length > 0 && show('recent');

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

      {/* ── Where things stand: health, what needs you, products ───── */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {isAdmin && full && <HealthTile health={health} runAt={checkRun?.runAt} to="/checks" />}

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
      </div>

      {/* ── Twelve months in charts ─────────────────────────────────── */}
      {isAdmin && loaded && !isEmptyWorkspace && (
        <Suspense fallback={<div className="py-16 flex justify-center"><Spinner size="lg" /></div>}>
          <DashboardCharts transactions={transactions} categories={categories} statements={statements} checks={paperChecks}
            full={full} show={show} endMonth={format(new Date(), 'yyyy-MM')} />
        </Suspense>
      )}

      {/* ── Recent transactions ─────────────────────────────────────── */}
      {hasRecent && (
        <div className="mt-6">
          <div className="card">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
              <h3 className="section-title">{t('dash.recent')}</h3>
              <Link to={simple ? '/transactions' : '/ledger'} className="text-sm text-brand-700 hover:text-brand-800 font-medium flex items-center gap-1">
                {t('common.viewAll')} <ArrowRight size={14} />
              </Link>
            </div>
            <div className="overflow-x-auto" tabIndex={0}>
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
        </div>
      )}
    </div>
  );
}
