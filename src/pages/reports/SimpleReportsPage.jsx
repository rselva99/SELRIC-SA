import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  format, parseISO, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  subMonths, addMonths, subDays, addDays, differenceInCalendarDays, getDay, isAfter,
} from 'date-fns';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { useData } from '../../contexts/DataContext';
import { useT } from '../../i18n/I18nContext';
import { aggregateForPnL } from '../../lib/finance';
import { generatePnLPdf } from '../../lib/reports';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import {
  ChevronLeft, ChevronRight, Download, FileText, TrendingUp, TrendingDown, Package, Users, Wallet,
  BarChart3, Sparkles, AlertTriangle, Clock, ShoppingBag, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';

// Simple mode: Reports.
//
// Built for a small business that sells products (supplements, bread, parts…)
// and records each sale in the Sales tab. Six views over the same data:
//   Summary    — P&L (from `transactions`), gross margin (from sale lines).
//   Products   — units, revenue, margin per product; best / slow sellers.
//   Trends     — 12-month sales, product × month heat map, day of week,
//                seasonal patterns called out in words.
//   Customers  — top customers, new vs returning, who has gone quiet.
//   Inventory  — days of stock left, running out, dead stock, stock value.
//   Cash       — sales by payment method.
// Full mode keeps its accountant reports page; main.jsx picks by mode.

const BRAND = ['#368a67', '#276e52', '#55a683', '#84c3a7', '#f59f00', '#1971c2', '#e03131', '#8b5cf6'];
const MONTHS_IN_TREND = 12;
const QUIET_DAYS = 60;
const RUNNING_OUT_DAYS = 14;
const RATE_WINDOW_DAYS = 30;

const iso = (d) => format(d, 'yyyy-MM-dd');
const monthKey = (d) => format(d, 'yyyy-MM');
const pct = (part, whole) => (whole ? (part / whole) * 100 : 0);
const fmtPct = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;
const changeOf = (now, before) => (before ? ((now - before) / Math.abs(before)) * 100 : null);

function rangeFor(kind, anchor, custom) {
  if (kind === 'month')   return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  if (kind === 'quarter') return { start: startOfQuarter(anchor), end: endOfQuarter(anchor) };
  if (kind === 'year')    return { start: startOfYear(anchor), end: endOfYear(anchor) };
  const s = custom.start ? parseISO(custom.start) : startOfMonth(anchor);
  const e = custom.end ? parseISO(custom.end) : endOfMonth(anchor);
  return isAfter(s, e) ? { start: e, end: s } : { start: s, end: e };
}

function previousRange(kind, range) {
  if (kind === 'month')   return { start: startOfMonth(subMonths(range.start, 1)), end: endOfMonth(subMonths(range.start, 1)) };
  if (kind === 'quarter') return { start: startOfQuarter(subMonths(range.start, 3)), end: endOfQuarter(subMonths(range.start, 3)) };
  if (kind === 'year')    return { start: startOfYear(subMonths(range.start, 12)), end: endOfYear(subMonths(range.start, 12)) };
  const days = differenceInCalendarDays(range.end, range.start) + 1;
  return { start: subDays(range.start, days), end: subDays(range.start, 1) };
}

function inRange(dateStr, r) {
  return dateStr >= iso(r.start) && dateStr <= iso(r.end);
}

function downloadCsv(filename, header, rows) {
  const lines = [header, ...rows].map((cols) => cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Delta({ value, invert = false, suffix = '' }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-xs text-surface-400">—</span>;
  const up = value > 0.05, down = value < -0.05;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', good ? 'text-brand-700' : bad ? 'text-red-600' : 'text-surface-500')}>
      <Icon size={13} /> {Math.abs(value) >= 1000 ? '>999' : (Math.round(Math.abs(value) * 10) / 10).toFixed(1)}%{suffix}
    </span>
  );
}

export default function SimpleReportsPage() {
  const { products, categories } = useData();
  const { t, tn, locale, lang } = useT();

  // ── Period ───────────────────────────────────────────────────────────────
  const [kind, setKind] = useState('month');
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()));
  const [custom, setCustom] = useState({ start: iso(startOfMonth(new Date())), end: iso(new Date()) });
  const [compare, setCompare] = useState(true);
  const [tab, setTab] = useState('summary');

  const range = useMemo(() => rangeFor(kind, anchor, custom), [kind, anchor, custom]);
  const prev = useMemo(() => previousRange(kind, range), [kind, range]);
  const today = useMemo(() => new Date(), []);

  const periodLabel = useMemo(() => {
    if (kind === 'month') { const s = range.start.toLocaleDateString(locale, { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); }
    if (kind === 'quarter') return `Q${Math.floor(range.start.getMonth() / 3) + 1} ${range.start.getFullYear()}`;
    if (kind === 'year') return String(range.start.getFullYear());
    return `${range.start.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${range.end.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }, [kind, range, locale]);

  function shift(dir) {
    if (kind === 'month') setAnchor((a) => addMonths(a, dir));
    else if (kind === 'quarter') setAnchor((a) => addMonths(a, 3 * dir));
    else if (kind === 'year') setAnchor((a) => addMonths(a, 12 * dir));
  }

  // ── Data: a rolling window that always covers the trend months + the period ──
  const windowStart = useMemo(() => {
    const trendStart = startOfMonth(subMonths(range.end, MONTHS_IN_TREND + 12));   // 24 months: room for a prior-year overlay
    const earliest = [trendStart, prev.start, range.start].reduce((a, b) => (isAfter(a, b) ? b : a));
    return iso(earliest);
  }, [range, prev]);
  const windowEnd = useMemo(() => iso(isAfter(range.end, today) ? range.end : today), [range, today]);

  const [txns, setTxns] = useState([]);
  const [sales, setSales] = useState([]);
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tx, sl, cu, st] = await Promise.all([
        fetchAll(supabase.from('transactions').select('id, date, description, amount, type, category, reference, posted')
          .gte('date', windowStart).lte('date', windowEnd).eq('voided', false).order('date')),
        fetchAll(supabase.from('sales').select('id, number, date, customer_id, customer_name, payment_method, total, items_count')
          .gte('date', windowStart).lte('date', windowEnd).order('date')),
        fetchAll(supabase.from('customers').select('id, name, email, phone').order('name')),
        fetchAll(supabase.from('customer_stats').select('*'), { tiebreaker: 'customer_id' }),
      ]);
      setTxns(tx || []); setSales(sl || []); setCustomers(cu || []); setStats(st || []);
      if (sl?.length) {
        // Lines for every sale in the window, in sale-id chunks to keep the URL short.
        const ids = sl.map((s) => s.id);
        const chunks = [];
        for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
        const parts = await Promise.all(chunks.map((c) =>
          fetchAll(supabase.from('sale_items').select('id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total').in('sale_id', c))
        ));
        setItems(parts.flat());
      } else {
        setItems([]);
      }
    } catch (err) {
      console.error('reports load failed:', err);
      toast.error(t('rep.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [windowStart, windowEnd, t]);

  useEffect(() => { load(); }, [load]);

  // ── Shared lookups ───────────────────────────────────────────────────────
  const saleById = useMemo(() => Object.fromEntries(sales.map((s) => [s.id, s])), [sales]);
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const statsById = useMemo(() => Object.fromEntries(stats.map((s) => [s.customer_id, s])), [stats]);
  const itemsWithDate = useMemo(() => items.map((it) => ({ ...it, date: saleById[it.sale_id]?.date || '', customer_id: saleById[it.sale_id]?.customer_id || null })).filter((it) => it.date), [items, saleById]);

  const periodTxns = useMemo(() => txns.filter((x) => inRange(x.date, range)), [txns, range]);
  const prevTxns = useMemo(() => txns.filter((x) => inRange(x.date, prev)), [txns, prev]);
  const periodSales = useMemo(() => sales.filter((s) => inRange(s.date, range)), [sales, range]);
  const prevSales = useMemo(() => sales.filter((s) => inRange(s.date, prev)), [sales, prev]);
  const periodItems = useMemo(() => itemsWithDate.filter((it) => inRange(it.date, range)), [itemsWithDate, range]);
  const prevItems = useMemo(() => itemsWithDate.filter((it) => inRange(it.date, prev)), [itemsWithDate, prev]);

  const monthLabel = (ym) => { const d = parseISO(ym + '-01'); const s = d.toLocaleDateString(locale, { month: 'short', year: '2-digit' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const monthName = (ym) => { const d = parseISO(ym + '-01'); const s = d.toLocaleDateString(locale, { month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const trendMonths = useMemo(() => Array.from({ length: MONTHS_IN_TREND }, (_, i) => monthKey(subMonths(startOfMonth(range.end), MONTHS_IN_TREND - 1 - i))), [range]);

  // ── 1. Summary ───────────────────────────────────────────────────────────
  const pnl = useMemo(() => aggregateForPnL(periodTxns, categories), [periodTxns, categories]);
  const pnlPrev = useMemo(() => aggregateForPnL(prevTxns, categories), [prevTxns, categories]);
  const marginOf = (list) => list.reduce((acc, it) => {
    const rev = Number(it.line_total) || 0, cost = (Number(it.unit_cost) || 0) * (Number(it.quantity) || 0);
    return { revenue: acc.revenue + rev, cost: acc.cost + cost, margin: acc.margin + (rev - cost), units: acc.units + (Number(it.quantity) || 0) };
  }, { revenue: 0, cost: 0, margin: 0, units: 0 });
  const margin = useMemo(() => marginOf(periodItems), [periodItems]);
  const marginPrev = useMemo(() => marginOf(prevItems), [prevItems]);
  const net = pnl.totalRevenue - pnl.totalExpenses;
  const netPrev = pnlPrev.totalRevenue - pnlPrev.totalExpenses;

  const monthlySeries = useMemo(() => {
    const by = Object.fromEntries(trendMonths.map((m) => [m, { revenue: 0, expenses: 0 }]));
    const typeOf = new Map((categories || []).map((c) => [c.name, (c.type || '').toLowerCase()]));
    for (const x of txns) {
      const m = x.date.slice(0, 7); if (!by[m]) continue;
      const type = typeOf.get(x.category);
      const amt = Math.abs(Number(x.amount) || 0);
      if (type === 'revenue') by[m].revenue += x.type === 'credit' ? amt : -amt;
      else if (type === 'expense') by[m].expenses += x.type === 'debit' ? amt : -amt;
    }
    return trendMonths.map((m) => ({ key: m, month: monthLabel(m), [t('dash.revenue')]: Math.round(by[m].revenue), [t('dash.expenses')]: Math.round(by[m].expenses) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txns, trendMonths, categories, lang]);

  const prevByCat = useMemo(() => {
    const m = {};
    pnlPrev.revenue.forEach((r) => { m['r:' + r.account] = r.amount; });
    pnlPrev.expenses.forEach((r) => { m['e:' + r.account] = r.amount; });
    return m;
  }, [pnlPrev]);

  function downloadPnlPdf() {
    try {
      const doc = generatePnLPdf({ transactions: periodTxns, period: periodLabel, categories });
      doc.save(`selric-pnl-${periodLabel.replace(/\s+/g, '_')}.pdf`);
    } catch (err) { toast.error(err.message || t('settings.saveFailed')); }
  }

  // ── 2. Products ──────────────────────────────────────────────────────────
  const [productSort, setProductSort] = useState({ key: 'revenue', dir: 'desc' });
  const [groupBy, setGroupBy] = useState('product');   // 'product' | 'category'
  const productRows = useMemo(() => {
    const keyOf = (it) => groupBy === 'category'
      ? ((it.product_id && productById[it.product_id]?.category) || t('rep.uncategorized'))
      : (it.product_id || 'custom:' + it.product_name);
    const build = (list) => {
      const by = {};
      for (const it of list) {
        const k = keyOf(it);
        const r = by[k] || (by[k] = { key: k, name: groupBy === 'category' ? k : it.product_name, category: it.product_id ? (productById[it.product_id]?.category || '') : '', units: 0, revenue: 0, cost: 0, sales: new Set() });
        const q = Number(it.quantity) || 0;
        r.units += q; r.revenue += Number(it.line_total) || 0; r.cost += (Number(it.unit_cost) || 0) * q; r.sales.add(it.sale_id);
        if (groupBy === 'product' && it.product_id && productById[it.product_id]) r.name = productById[it.product_id].name;
      }
      return by;
    };
    const now = build(periodItems), before = build(prevItems);
    const total = Object.values(now).reduce((s, r) => s + r.revenue, 0);
    const rows = Object.values(now).map((r) => ({
      ...r, sales: r.sales.size, margin: r.revenue - r.cost, marginPct: pct(r.revenue - r.cost, r.revenue), share: pct(r.revenue, total),
      unitsChange: changeOf(r.units, before[r.key]?.units || 0), revenueChange: changeOf(r.revenue, before[r.key]?.revenue || 0),
    }));
    const { key, dir } = productSort;
    rows.sort((a, b) => { const va = a[key], vb = b[key]; const c = typeof va === 'string' ? va.localeCompare(vb) : (va || 0) - (vb || 0); return dir === 'asc' ? c : -c; });
    return { rows, total };
  }, [periodItems, prevItems, productById, productSort, groupBy, t]);

  const productHighlights = useMemo(() => {
    const rows = productRows.rows;
    const byUnits = [...rows].sort((a, b) => b.units - a.units)[0];
    const byRevenue = [...rows].sort((a, b) => b.revenue - a.revenue)[0];
    const byMargin = [...rows].filter((r) => r.revenue > 0).sort((a, b) => b.margin - a.margin)[0];
    const soldIds = new Set(periodItems.map((it) => it.product_id).filter(Boolean));
    const notSold = products.filter((p) => !soldIds.has(p.id) && (p.current_stock || 0) > 0);
    return { byUnits, byRevenue, byMargin, notSold };
  }, [productRows, periodItems, products]);

  function sortBy(key) { setProductSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' })); }

  // ── 3. Trends ────────────────────────────────────────────────────────────
  const [heatMetric, setHeatMetric] = useState('units');
  const salesByMonth = useMemo(() => {
    const by = Object.fromEntries(trendMonths.map((m) => [m, { total: 0, count: 0, prior: 0 }]));
    for (const s of sales) {
      const m = s.date.slice(0, 7);
      if (by[m]) { by[m].total += Number(s.total) || 0; by[m].count += 1; }
      const priorKey = monthKey(addMonths(parseISO(s.date.slice(0, 7) + '-01'), 12));
      if (by[priorKey]) by[priorKey].prior += Number(s.total) || 0;
    }
    return trendMonths.map((m) => ({ key: m, month: monthLabel(m), total: Math.round(by[m].total), count: by[m].count, prior: Math.round(by[m].prior) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, trendMonths, lang]);
  const hasPriorYear = salesByMonth.some((m) => m.prior > 0);

  const heat = useMemo(() => {
    const by = {};
    for (const it of itemsWithDate) {
      const m = it.date.slice(0, 7); if (!trendMonths.includes(m)) continue;
      const k = it.product_id || 'custom:' + it.product_name;
      const r = by[k] || (by[k] = { key: k, name: it.product_id ? (productById[it.product_id]?.name || it.product_name) : it.product_name, months: Object.fromEntries(trendMonths.map((x) => [x, { units: 0, revenue: 0 }])), units: 0, revenue: 0 });
      const q = Number(it.quantity) || 0, rev = Number(it.line_total) || 0;
      r.months[m].units += q; r.months[m].revenue += rev; r.units += q; r.revenue += rev;
    }
    const rows = Object.values(by).sort((a, b) => b.revenue - a.revenue).slice(0, 15);
    rows.forEach((r) => { r.max = Math.max(...trendMonths.map((m) => r.months[m][heatMetric]), 0); });
    return rows;
  }, [itemsWithDate, trendMonths, productById, heatMetric]);

  const seasonal = useMemo(() => {
    const out = [];
    for (const r of heat) {
      if (r.units < 12) continue;
      const vals = trendMonths.map((m) => ({ m, v: r.months[m].units }));
      const active = vals.filter((x) => x.v > 0);
      if (active.length < 3) continue;
      const best = vals.reduce((a, b) => (b.v > a.v ? b : a));
      const share = pct(best.v, r.units);
      const avg = r.units / MONTHS_IN_TREND;
      if (best.v >= 2 * avg && share >= 25) out.push({ name: r.name, month: monthName(best.m), share });
    }
    return out.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heat, trendMonths, lang]);

  const weekday = useMemo(() => {
    const sums = Array(7).fill(0), counts = Array(7).fill(0), days = Array(7).fill(0);
    for (const s of periodSales) { const d = getDay(parseISO(s.date)); sums[d] += Number(s.total) || 0; counts[d] += 1; }
    for (let d = new Date(range.start); !isAfter(d, range.end); d = addDays(d, 1)) days[getDay(d)] += 1;
    const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: 'short' }));
    return [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: names[d].charAt(0).toUpperCase() + names[d].slice(1), avg: days[d] ? Math.round(sums[d] / days[d]) : 0, sales: counts[d] }));
  }, [periodSales, range, locale]);

  const trendStats = useMemo(() => {
    const withData = salesByMonth.filter((m) => m.total > 0);
    const best = withData.length ? withData.reduce((a, b) => (b.total > a.total ? b : a)) : null;
    const worst = withData.length ? withData.reduce((a, b) => (b.total < a.total ? b : a)) : null;
    const avg = withData.length ? withData.reduce((s, m) => s + m.total, 0) / withData.length : 0;
    return { best, worst, avg, months: withData.length };
  }, [salesByMonth]);

  // ── 4. Customers ─────────────────────────────────────────────────────────
  const customerRows = useMemo(() => {
    const by = {};
    for (const s of periodSales) {
      if (!s.customer_id) continue;
      const r = by[s.customer_id] || (by[s.customer_id] = { id: s.customer_id, name: s.customer_name || customers.find((c) => c.id === s.customer_id)?.name || '—', sales: 0, spent: 0, last: '', products: {} });
      r.sales += 1; r.spent += Number(s.total) || 0; if (s.date > r.last) r.last = s.date;
    }
    for (const it of periodItems) {
      if (!it.customer_id || !by[it.customer_id]) continue;
      const name = it.product_id ? (productById[it.product_id]?.name || it.product_name) : it.product_name;
      by[it.customer_id].products[name] = (by[it.customer_id].products[name] || 0) + (Number(it.quantity) || 0);
    }
    return Object.values(by).map((r) => ({
      ...r, avg: r.sales ? r.spent / r.sales : 0,
      isNew: !!(statsById[r.id]?.first_sale_date && inRange(statsById[r.id].first_sale_date, range)),
      top: Object.entries(r.products).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n).join(', '),
    })).sort((a, b) => b.spent - a.spent);
  }, [periodSales, periodItems, customers, productById, statsById, range]);

  const customerStats = useMemo(() => {
    const active = customerRows.length;
    const fresh = customerRows.filter((r) => r.isNew).length;
    const walkIns = periodSales.filter((s) => !s.customer_id).length;
    const revenue = periodSales.reduce((s, x) => s + (Number(x.total) || 0), 0);
    const ticket = periodSales.length ? revenue / periodSales.length : 0;
    const prevRevenue = prevSales.reduce((s, x) => s + (Number(x.total) || 0), 0);
    const prevTicket = prevSales.length ? prevRevenue / prevSales.length : 0;
    return { active, fresh, returning: active - fresh, walkIns, ticket, ticketChange: changeOf(ticket, prevTicket) };
  }, [customerRows, periodSales, prevSales]);

  const quiet = useMemo(() => {
    const cutoff = iso(subDays(today, QUIET_DAYS));
    return customers
      .map((c) => ({ ...c, st: statsById[c.id] }))
      .filter((c) => c.st?.last_sale_date && c.st.last_sale_date < cutoff)
      .map((c) => ({ ...c, days: differenceInCalendarDays(today, parseISO(c.st.last_sale_date)) }))
      .sort((a, b) => b.st.total_spent - a.st.total_spent)
      .slice(0, 12);
  }, [customers, statsById, today]);

  const newVsReturning = useMemo(() => {
    const by = Object.fromEntries(trendMonths.map((m) => [m, { fresh: new Set(), back: new Set() }]));
    for (const s of sales) {
      const m = s.date.slice(0, 7); if (!by[m] || !s.customer_id) continue;
      const first = statsById[s.customer_id]?.first_sale_date || '';
      (first.slice(0, 7) === m ? by[m].fresh : by[m].back).add(s.customer_id);
    }
    return trendMonths.map((m) => ({ month: monthLabel(m), [t('rep.newCustomers')]: by[m].fresh.size, [t('rep.returning')]: by[m].back.size }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, trendMonths, statsById, lang]);

  // ── 5. Inventory ─────────────────────────────────────────────────────────
  const inventoryRows = useMemo(() => {
    const since = iso(subDays(today, RATE_WINDOW_DAYS));
    const sold30 = {}, lastSale = {};
    for (const it of itemsWithDate) {
      if (!it.product_id) continue;
      if (it.date >= since) sold30[it.product_id] = (sold30[it.product_id] || 0) + (Number(it.quantity) || 0);
      if (!lastSale[it.product_id] || it.date > lastSale[it.product_id]) lastSale[it.product_id] = it.date;
    }
    const cutoff = iso(subDays(today, QUIET_DAYS));
    return products.map((p) => {
      const stock = Number(p.current_stock) || 0;
      const s30 = sold30[p.id] || 0;
      const rate = s30 / RATE_WINDOW_DAYS;
      const daysLeft = rate > 0 ? stock / rate : null;
      const last = lastSale[p.id] || null;
      const reorder = Number(p.reorder_level) || 0;
      const status = stock <= 0 ? 'out'
        : daysLeft != null && daysLeft <= RUNNING_OUT_DAYS ? 'running'
        : stock <= reorder ? 'low'
        : (!last || last < cutoff) ? 'dead' : 'ok';
      return { id: p.id, name: p.name, category: p.category || '', stock, unit: p.unit || '', sold30: s30, rate, daysLeft, last, status, value: stock * (Number(p.cost_price) || 0), reorder };
    }).sort((a, b) => {
      const order = { out: 0, running: 1, low: 2, ok: 3, dead: 4 };
      return order[a.status] - order[b.status] || ((a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9)) || b.value - a.value;
    });
  }, [products, itemsWithDate, today]);

  const inventoryStats = useMemo(() => ({
    value: inventoryRows.reduce((s, r) => s + r.value, 0),
    running: inventoryRows.filter((r) => r.status === 'running' || r.status === 'out').length,
    dead: inventoryRows.filter((r) => r.status === 'dead').length,
  }), [inventoryRows]);

  // ── 6. Cash ──────────────────────────────────────────────────────────────
  const PAY_KEYS = ['cash', 'card', 'transfer', 'other'];
  const payment = useMemo(() => {
    const by = Object.fromEntries(PAY_KEYS.map((k) => [k, { count: 0, total: 0 }]));
    for (const s of periodSales) { const k = by[s.payment_method] ? s.payment_method : 'other'; by[k].count += 1; by[k].total += Number(s.total) || 0; }
    const total = Object.values(by).reduce((s, x) => s + x.total, 0);
    return PAY_KEYS.map((k) => ({ key: k, name: t(`sales.payments.${k}`), ...by[k], share: pct(by[k].total, total) })).filter((x) => x.count > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodSales, lang]);
  const paymentByMonth = useMemo(() => {
    const by = Object.fromEntries(trendMonths.map((m) => [m, Object.fromEntries(PAY_KEYS.map((k) => [k, 0]))]));
    for (const s of sales) { const m = s.date.slice(0, 7); if (!by[m]) continue; const k = by[m][s.payment_method] != null ? s.payment_method : 'other'; by[m][k] += Number(s.total) || 0; }
    return trendMonths.map((m) => ({ month: monthLabel(m), ...Object.fromEntries(PAY_KEYS.map((k) => [t(`sales.payments.${k}`), Math.round(by[m][k])])) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, trendMonths, lang]);

  // ── UI bits ──────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'summary',   icon: FileText },
    { key: 'products',  icon: Package },
    { key: 'trends',    icon: TrendingUp },
    { key: 'customers', icon: Users },
    { key: 'inventory', icon: BarChart3 },
    { key: 'cash',      icon: Wallet },
  ];
  const money = (v) => formatCurrency(v);
  const tooltipMoney = (v) => money(v);
  const noSales = !loading && periodSales.length === 0;

  const Tile = ({ label, value, delta, invert, dark, icon: Icon, sub }) => (
    <div className={cn('rounded-xl border p-5', dark ? 'bg-brand-950 border-brand-950 text-white' : 'card')}>
      <div className={cn('flex items-center gap-2 text-sm', dark ? 'text-brand-200' : 'text-surface-500')}>{Icon && <Icon size={15} className={dark ? '' : 'text-brand-600'} />} {label}</div>
      <div className={cn('font-mono text-2xl font-medium mt-2', dark ? 'text-white' : 'text-surface-900')}>{value}</div>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        {compare && delta !== undefined && <Delta value={delta} invert={invert} />}
        {compare && delta !== undefined && <span className={dark ? 'text-brand-300' : 'text-surface-400'}>{t('rep.vsPrev')}</span>}
        {sub && <span className={dark ? 'text-brand-300' : 'text-surface-400'}>{sub}</span>}
      </div>
    </div>
  );

  const Th = ({ k, children, right }) => (
    <th className={cn('table-header select-none', right && 'text-right', k && 'cursor-pointer hover:text-brand-700')} onClick={k ? () => sortBy(k) : undefined}>
      {children}{k && productSort.key === k && <span className="ml-1 text-brand-600">{productSort.dir === 'desc' ? '↓' : '↑'}</span>}
    </th>
  );

  const Empty = ({ icon: Icon = ShoppingBag, title, body, link }) => (
    <div className="px-5 py-12 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center"><Icon size={22} /></div>
      <p className="font-display text-xl text-brand-950 mt-4">{title}</p>
      {body && <p className="text-sm text-surface-600 mt-1">{body}</p>}
      {link && <Link to={link.to} className="btn-primary mt-5 inline-flex">{link.label}</Link>}
    </div>
  );

  return (
    <div className="animate-fade-in">
      {/* ── Header + period ─────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="page-title">{t('rep.title')}</h1>
          <p className="text-surface-500 text-sm mt-1">{t('rep.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-surface-100 p-1" role="radiogroup" aria-label={t('rep.period')}>
            {['month', 'quarter', 'year', 'custom'].map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                className={cn('px-3 py-1.5 rounded-md text-sm font-medium transition-colors', kind === k ? 'bg-white shadow-sm text-brand-900' : 'text-surface-600 hover:text-surface-900')}>
                {t(`rep.kinds.${k}`)}
              </button>
            ))}
          </div>
          {kind === 'custom' ? (
            <div className="inline-flex items-center gap-1.5">
              <input type="date" value={custom.start} max={custom.end} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} className="input-field py-1.5 text-sm w-auto" aria-label={t('rep.from')} />
              <span className="text-surface-400">–</span>
              <input type="date" value={custom.end} min={custom.start} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} className="input-field py-1.5 text-sm w-auto" aria-label={t('rep.to')} />
            </div>
          ) : (
            <div className="inline-flex items-center rounded-lg border border-surface-300 bg-white">
              <button type="button" onClick={() => shift(-1)} className="px-2.5 py-2 text-surface-600 hover:text-brand-700" aria-label={t('tx.prevMonth')}><ChevronLeft size={18} /></button>
              <span className="px-2 text-sm font-medium text-surface-900 min-w-[9rem] text-center">{periodLabel}</span>
              <button type="button" onClick={() => shift(1)} className="px-2.5 py-2 text-surface-600 hover:text-brand-700" aria-label={t('tx.nextMonth')}><ChevronRight size={18} /></button>
            </div>
          )}
          <label className="inline-flex items-center gap-2 text-sm text-surface-700 px-2 py-1.5 rounded-lg border border-surface-300 bg-white cursor-pointer">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-brand-600" /> {t('rep.compare')}
          </label>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────── */}
      <div className="mt-6 flex gap-1 bg-surface-100 rounded-lg p-1 w-fit max-w-full overflow-x-auto">
        {TABS.map(({ key, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={cn('inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-medium whitespace-nowrap transition', tab === key ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700')}>
            <Icon size={15} /> {t(`rep.tabs.${key}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-3 px-5 py-16 text-sm text-surface-500"><Spinner size="sm" /> {t('common.loading')}</div>
      ) : (
        <div className="mt-6 space-y-6">

          {/* ═══ 1. Summary ═══════════════════════════════════════════ */}
          {tab === 'summary' && (<>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Tile dark icon={TrendingUp} label={t('rep.revenue')} value={money(pnl.totalRevenue)} delta={changeOf(pnl.totalRevenue, pnlPrev.totalRevenue)} />
              <Tile icon={TrendingDown} label={t('rep.expenses')} value={money(pnl.totalExpenses)} delta={changeOf(pnl.totalExpenses, pnlPrev.totalExpenses)} invert />
              <Tile icon={Wallet} label={t('rep.profit')} value={money(net)} delta={changeOf(net, netPrev)} />
              <Tile icon={Sparkles} label={t('rep.grossMargin')} value={margin.revenue ? fmtPct(pct(margin.margin, margin.revenue)) : '—'} delta={changeOf(margin.margin, marginPrev.margin)} sub={margin.revenue ? money(margin.margin) : t('rep.noSalesShort')} />
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="section-title">{t('rep.revVsExp')}</h2>
                <span className="text-xs text-surface-400">{tn('rep.lastMonths', MONTHS_IN_TREND)}</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlySeries} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} tick={{ fontSize: 11 }} width={48} />
                  <Tooltip formatter={tooltipMoney} />
                  <Legend />
                  <Bar dataKey={t('dash.revenue')} fill="#368a67" radius={[6, 6, 0, 0]} />
                  <Bar dataKey={t('dash.expenses')} fill="#d1d5db" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {[['revenue', pnl.revenue, 'r:'], ['expenses', pnl.expenses, 'e:']].map(([k, list, prefix]) => (
                <section key={k} className="card">
                  <header className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
                    <h2 className="section-title">{t(`rep.${k}ByCat`)}</h2>
                    <span className="font-mono text-sm text-surface-700">{money(k === 'revenue' ? pnl.totalRevenue : pnl.totalExpenses)}</span>
                  </header>
                  {list.length === 0 ? (
                    <p className="px-5 py-8 text-sm text-surface-500 text-center">{t('rep.nothingInPeriod')}</p>
                  ) : (
                    <table className="w-full">
                      <thead><tr className="border-b border-surface-100"><th className="table-header">{t('dash.category')}</th><th className="table-header text-right">{t('dash.amount')}</th><th className="table-header text-right">%</th>{compare && <th className="table-header text-right">{t('rep.vsPrevShort')}</th>}</tr></thead>
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.account} className="border-b border-surface-50">
                            <td className="table-cell text-surface-900">{r.account}</td>
                            <td className="table-cell text-right font-mono">{money(r.amount)}</td>
                            <td className="table-cell text-right font-mono text-xs text-surface-500">{fmtPct(pct(r.amount, k === 'revenue' ? pnl.totalRevenue : pnl.totalExpenses))}</td>
                            {compare && <td className="table-cell text-right"><Delta value={changeOf(r.amount, prevByCat[prefix + r.account] || 0)} invert={k === 'expenses'} /></td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={downloadPnlPdf} disabled={!periodTxns.length} className="btn-primary"><Download size={16} /> {t('rep.downloadPnl')}</button>
              <button type="button" disabled={!periodTxns.length} className="btn-secondary" onClick={() => downloadCsv(`selric-pnl-${periodLabel}.csv`,
                [t('rep.section'), t('dash.category'), t('dash.amount')],
                [...pnl.revenue.map((r) => [t('rep.revenue'), r.account, r.amount.toFixed(2)]), ...pnl.expenses.map((r) => [t('rep.expenses'), r.account, r.amount.toFixed(2)]), [t('rep.profit'), '', net.toFixed(2)]])}>
                <Download size={16} /> CSV
              </button>
            </div>
          </>)}

          {/* ═══ 2. Products ══════════════════════════════════════════ */}
          {tab === 'products' && (noSales ? <div className="card"><Empty title={t('rep.noSalesTitle', { period: periodLabel })} body={t('rep.noSalesBody')} link={{ to: '/sales', label: t('crm.recordSale') }} /></div> : <>
            <div className="grid sm:grid-cols-3 gap-4">
              {[['bestUnits', productHighlights.byUnits, (r) => tn('sales.itemsSold', r.units)], ['bestRevenue', productHighlights.byRevenue, (r) => money(r.revenue)], ['bestMargin', productHighlights.byMargin, (r) => `${money(r.margin)} · ${fmtPct(r.marginPct)}`]].map(([k, r, f]) => (
                <div key={k} className="card p-5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-surface-500">{t(`rep.${k}`)}</div>
                  {r ? (<><div className="font-display text-xl text-brand-950 mt-2 truncate" title={r.name}>{r.name}</div><div className="font-mono text-sm text-brand-700 mt-1">{f(r)}</div></>) : <div className="text-surface-400 mt-2">—</div>}
                </div>
              ))}
            </div>

            <section className="card">
              <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-b border-surface-200">
                <h2 className="section-title">{t('rep.salesByProduct')} <span className="text-surface-400 font-sans text-sm">· {periodLabel}</span></h2>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg bg-surface-100 p-1">
                    {['product', 'category'].map((g) => (
                      <button key={g} type="button" onClick={() => setGroupBy(g)} className={cn('px-3 py-1 rounded-md text-xs font-medium', groupBy === g ? 'bg-white shadow-sm text-brand-900' : 'text-surface-600')}>{t(`rep.by.${g}`)}</button>
                    ))}
                  </div>
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => downloadCsv(`selric-products-${periodLabel}.csv`,
                    [t('sales.product'), t('dash.category'), t('rep.units'), t('rep.revenue'), '%', t('rep.cost'), t('rep.margin'), t('rep.marginPct')],
                    productRows.rows.map((r) => [r.name, r.category, r.units, r.revenue.toFixed(2), fmtPct(r.share), r.cost.toFixed(2), r.margin.toFixed(2), fmtPct(r.marginPct)]))}>
                    <Download size={15} /> CSV
                  </button>
                </div>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-surface-100">
                    <Th k="name">{groupBy === 'category' ? t('dash.category') : t('sales.product')}</Th>
                    <Th k="units" right>{t('rep.units')}</Th>
                    <Th k="revenue" right>{t('rep.revenue')}</Th>
                    <Th k="share" right>%</Th>
                    <Th k="margin" right>{t('rep.margin')}</Th>
                    <Th k="marginPct" right>{t('rep.marginPct')}</Th>
                    {compare && <Th k="unitsChange" right>{t('rep.unitsVsPrev')}</Th>}
                  </tr></thead>
                  <tbody>
                    {productRows.rows.map((r) => (
                      <tr key={r.key} className="border-b border-surface-50 hover:bg-surface-50">
                        <td className="table-cell">
                          <div className="font-medium text-surface-900">{r.name}</div>
                          {groupBy === 'product' && (r.category ? <div className="text-xs text-surface-400">{r.category}</div> : r.key.startsWith('custom:') && <div className="text-xs text-surface-400">{t('sales.customTag')}</div>)}
                        </td>
                        <td className="table-cell text-right font-mono">{r.units}</td>
                        <td className="table-cell text-right font-mono text-brand-700">{money(r.revenue)}</td>
                        <td className="table-cell text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-surface-100 overflow-hidden"><div className="h-full bg-brand-500" style={{ width: `${Math.min(100, r.share)}%` }} /></div>
                            <span className="font-mono text-xs text-surface-500 w-12 text-right">{fmtPct(r.share)}</span>
                          </div>
                        </td>
                        <td className="table-cell text-right font-mono">{r.cost > 0 ? money(r.margin) : <span className="text-surface-400" title={t('rep.noCostHint')}>{money(r.margin)}*</span>}</td>
                        <td className="table-cell text-right font-mono text-xs">{r.revenue ? fmtPct(r.marginPct) : '—'}</td>
                        {compare && <td className="table-cell text-right"><Delta value={r.unitsChange} /></td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-surface-50">
                    <td className="table-cell font-semibold">{t('rep.total')}</td>
                    <td className="table-cell text-right font-mono font-semibold">{margin.units}</td>
                    <td className="table-cell text-right font-mono font-semibold text-brand-700">{money(margin.revenue)}</td>
                    <td className="table-cell" />
                    <td className="table-cell text-right font-mono font-semibold">{money(margin.margin)}</td>
                    <td className="table-cell text-right font-mono text-xs font-semibold">{margin.revenue ? fmtPct(pct(margin.margin, margin.revenue)) : '—'}</td>
                    {compare && <td className="table-cell text-right"><Delta value={changeOf(margin.units, marginPrev.units)} /></td>}
                  </tr></tfoot>
                </table>
              </div>
              <p className="px-5 py-3 text-xs text-surface-400 border-t border-surface-100">{t('rep.marginNote')}</p>
            </section>

            {productHighlights.notSold.length > 0 && (
              <section className="card p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-surface-700"><Clock size={15} className="text-amber-600" /> {tn('rep.notSold', productHighlights.notSold.length)}</div>
                <p className="text-xs text-surface-500 mt-1">{t('rep.notSoldBody', { period: periodLabel })}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {productHighlights.notSold.slice(0, 20).map((p) => <span key={p.id} className="badge bg-surface-100 text-surface-700">{p.name} · {p.current_stock} {p.unit}</span>)}
                  {productHighlights.notSold.length > 20 && <span className="text-xs text-surface-400 self-center">+{productHighlights.notSold.length - 20}</span>}
                </div>
              </section>
            )}
          </>)}

          {/* ═══ 3. Trends ════════════════════════════════════════════ */}
          {tab === 'trends' && (sales.length === 0 ? <div className="card"><Empty icon={TrendingUp} title={t('rep.noTrendTitle')} body={t('rep.noTrendBody')} /></div> : <>
            <div className="grid sm:grid-cols-3 gap-4">
              <Tile dark icon={TrendingUp} label={t('rep.bestMonth')} value={trendStats.best ? money(trendStats.best.total) : '—'} sub={trendStats.best?.month} />
              <Tile icon={BarChart3} label={t('rep.avgMonth')} value={money(trendStats.avg)} sub={tn('rep.monthsWithSales', trendStats.months)} />
              <Tile icon={TrendingDown} label={t('rep.worstMonth')} value={trendStats.worst ? money(trendStats.worst.total) : '—'} sub={trendStats.worst?.month} />
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="section-title">{t('rep.salesByMonth')}</h2>
                {hasPriorYear && <span className="text-xs text-surface-400">{t('rep.priorYearShown')}</span>}
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={salesByMonth} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} tick={{ fontSize: 11 }} width={48} />
                  <Tooltip formatter={tooltipMoney} />
                  <Legend />
                  <Line type="monotone" dataKey="total" name={t('rep.sales')} stroke="#368a67" strokeWidth={2.5} dot={{ r: 3 }} />
                  {hasPriorYear && <Line type="monotone" dataKey="prior" name={t('rep.priorYear')} stroke="#adb5bd" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {seasonal.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><Sparkles size={15} /> {t('rep.seasonalTitle')}</div>
                <ul className="mt-2 space-y-1 text-sm text-amber-900">
                  {seasonal.map((s) => <li key={s.name}>• {t('rep.seasonalLine', { product: s.name, month: s.month, share: Math.round(s.share) })}</li>)}
                </ul>
              </section>
            )}

            <section className="card">
              <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-b border-surface-200">
                <div>
                  <h2 className="section-title">{t('rep.heatTitle')}</h2>
                  <p className="text-xs text-surface-500">{t('rep.heatBody')}</p>
                </div>
                <div className="inline-flex rounded-lg bg-surface-100 p-1">
                  {['units', 'revenue'].map((m) => (
                    <button key={m} type="button" onClick={() => setHeatMetric(m)} className={cn('px-3 py-1 rounded-md text-xs font-medium', heatMetric === m ? 'bg-white shadow-sm text-brand-900' : 'text-surface-600')}>{t(`rep.${m}`)}</button>
                  ))}
                </div>
              </header>
              {heat.length === 0 ? <p className="px-5 py-8 text-sm text-surface-500 text-center">{t('rep.nothingInPeriod')}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-surface-100">
                      <th className="table-header sticky left-0 bg-white">{t('sales.product')}</th>
                      {trendMonths.map((m) => <th key={m} className="px-1 py-2 text-center font-semibold text-surface-500">{monthLabel(m).replace(/\s.*/, '')}</th>)}
                      <th className="table-header text-right">{t('rep.total')}</th>
                    </tr></thead>
                    <tbody>
                      {heat.map((r) => (
                        <tr key={r.key} className="border-b border-surface-50">
                          <td className="px-4 py-1.5 font-medium text-surface-900 whitespace-nowrap sticky left-0 bg-white max-w-[12rem] truncate" title={r.name}>{r.name}</td>
                          {trendMonths.map((m) => {
                            const v = r.months[m][heatMetric];
                            const a = r.max ? v / r.max : 0;
                            return (
                              <td key={m} className="px-0.5 py-1">
                                <div className={cn('h-7 rounded flex items-center justify-center font-mono', a > 0.55 ? 'text-white' : 'text-surface-700')}
                                  style={{ backgroundColor: v ? `rgba(54,138,103,${0.12 + a * 0.78})` : '#f6f5f1' }}
                                  title={`${monthLabel(m)}: ${heatMetric === 'units' ? v : money(v)}`}>
                                  {v ? (heatMetric === 'units' ? v : (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v))) : ''}
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-4 py-1.5 text-right font-mono text-surface-700 whitespace-nowrap">{heatMetric === 'units' ? r.units : money(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="card p-5">
              <h2 className="section-title mb-1">{t('rep.weekdayTitle')}</h2>
              <p className="text-xs text-surface-500 mb-4">{t('rep.weekdayBody', { period: periodLabel })}</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weekday} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} width={48} />
                  <Tooltip formatter={(v, n) => [n === 'avg' ? money(v) : v, n === 'avg' ? t('rep.avgPerDay') : t('rep.salesCount')]} />
                  <Bar dataKey="avg" fill="#368a67" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>)}

          {/* ═══ 4. Customers ═════════════════════════════════════════ */}
          {tab === 'customers' && (<>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Tile dark icon={Users} label={t('rep.activeCustomers')} value={customerStats.active} sub={tn('rep.walkIns', customerStats.walkIns)} />
              <Tile icon={Sparkles} label={t('rep.newCustomers')} value={customerStats.fresh} />
              <Tile icon={TrendingUp} label={t('rep.returning')} value={customerStats.returning} />
              <Tile icon={ShoppingBag} label={t('rep.avgTicket')} value={money(customerStats.ticket)} delta={customerStats.ticketChange} />
            </div>

            <div className="grid lg:grid-cols-5 gap-6">
              <section className="card lg:col-span-3">
                <header className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
                  <h2 className="section-title">{t('rep.topCustomers')} <span className="text-surface-400 font-sans text-sm">· {periodLabel}</span></h2>
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={!customerRows.length} onClick={() => downloadCsv(`selric-customers-${periodLabel}.csv`,
                    [t('crm.name'), t('crm.colSales'), t('crm.colSpent'), t('rep.avgTicket'), t('crm.colLast'), t('rep.buys')],
                    customerRows.map((r) => [r.name, r.sales, r.spent.toFixed(2), r.avg.toFixed(2), r.last, r.top]))}>
                    <Download size={15} /> CSV
                  </button>
                </header>
                {customerRows.length === 0 ? <Empty icon={Users} title={t('rep.noCustomersTitle')} body={t('rep.noCustomersBody')} /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead><tr className="border-b border-surface-100"><th className="table-header">{t('crm.name')}</th><th className="table-header text-right">{t('crm.colSales')}</th><th className="table-header text-right">{t('crm.colSpent')}</th><th className="table-header text-right">{t('rep.avgTicket')}</th><th className="table-header">{t('rep.buys')}</th></tr></thead>
                      <tbody>
                        {customerRows.slice(0, 15).map((r) => (
                          <tr key={r.id} className="border-b border-surface-50 hover:bg-surface-50">
                            <td className="table-cell whitespace-nowrap"><span className="font-medium text-surface-900">{r.name}</span>{r.isNew && <span className="badge-green ml-2">{t('rep.newTag')}</span>}</td>
                            <td className="table-cell text-right font-mono">{r.sales}</td>
                            <td className="table-cell text-right font-mono text-brand-700">{money(r.spent)}</td>
                            <td className="table-cell text-right font-mono text-xs">{money(r.avg)}</td>
                            <td className="table-cell text-xs text-surface-600 max-w-[14rem] truncate" title={r.top}>{r.top || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="card lg:col-span-2">
                <header className="px-5 py-4 border-b border-surface-200">
                  <h2 className="section-title flex items-center gap-2"><Clock size={16} className="text-amber-600" /> {tn('rep.quietTitle', quiet.length)}</h2>
                  <p className="text-xs text-surface-500 mt-0.5">{t('rep.quietBody', { days: QUIET_DAYS })}</p>
                </header>
                {quiet.length === 0 ? <p className="px-5 py-8 text-sm text-surface-500 text-center">{t('rep.quietNone')}</p> : (
                  <ul className="divide-y divide-surface-100">
                    {quiet.map((c) => (
                      <li key={c.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-surface-900 truncate">{c.name}</div>
                          <div className="text-xs text-surface-500 truncate">{c.email || c.phone || '—'}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-mono text-amber-700">{tn('rep.daysAgo', c.days)}</div>
                          <div className="text-[11px] text-surface-400">{money(c.st.total_spent)} {t('rep.lifetime')}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="px-5 py-3 border-t border-surface-100"><Link to="/customers" className="text-sm text-brand-700 hover:text-brand-800 font-medium">{t('rep.openCustomers')} →</Link></div>
              </section>
            </div>

            <div className="card p-5">
              <h2 className="section-title mb-4">{t('rep.newVsReturning')}</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={newVsReturning} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey={t('rep.newCustomers')} stackId="c" fill="#368a67" />
                  <Bar dataKey={t('rep.returning')} stackId="c" fill="#b5dbc9" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>)}

          {/* ═══ 5. Inventory ═════════════════════════════════════════ */}
          {tab === 'inventory' && (products.length === 0 ? <div className="card"><Empty icon={Package} title={t('rep.noProductsTitle')} body={t('rep.noProductsBody')} link={{ to: '/inventory', label: t('dash.viewInventory') }} /></div> : <>
            <div className="grid sm:grid-cols-3 gap-4">
              <Tile dark icon={Package} label={t('rep.stockValue')} value={money(inventoryStats.value)} sub={t('rep.atCost')} />
              <Tile icon={AlertTriangle} label={t('rep.runningOut')} value={inventoryStats.running} sub={t('rep.withinDays', { days: RUNNING_OUT_DAYS })} />
              <Tile icon={Clock} label={t('rep.deadStock')} value={inventoryStats.dead} sub={t('rep.noSaleDays', { days: QUIET_DAYS })} />
            </div>

            <section className="card">
              <header className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
                <div>
                  <h2 className="section-title">{t('rep.inventoryTitle')}</h2>
                  <p className="text-xs text-surface-500">{t('rep.inventoryBody', { days: RATE_WINDOW_DAYS })}</p>
                </div>
                <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => downloadCsv('selric-inventory.csv',
                  [t('sales.product'), t('dash.category'), t('rep.stock'), t('rep.sold30', { days: RATE_WINDOW_DAYS }), t('rep.daysLeft'), t('rep.lastSale'), t('rep.status'), t('rep.stockValue')],
                  inventoryRows.map((r) => [r.name, r.category, r.stock, r.sold30, r.daysLeft == null ? '' : Math.round(r.daysLeft), r.last || '', t(`rep.statuses.${r.status}`), r.value.toFixed(2)]))}>
                  <Download size={15} /> CSV
                </button>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-surface-100">
                    <th className="table-header">{t('sales.product')}</th>
                    <th className="table-header text-right">{t('rep.stock')}</th>
                    <th className="table-header text-right">{t('rep.sold30', { days: RATE_WINDOW_DAYS })}</th>
                    <th className="table-header text-right">{t('rep.daysLeft')}</th>
                    <th className="table-header">{t('rep.lastSale')}</th>
                    <th className="table-header">{t('rep.status')}</th>
                    <th className="table-header text-right">{t('rep.value')}</th>
                  </tr></thead>
                  <tbody>
                    {inventoryRows.map((r) => (
                      <tr key={r.id} className="border-b border-surface-50 hover:bg-surface-50">
                        <td className="table-cell"><div className="font-medium text-surface-900">{r.name}</div>{r.category && <div className="text-xs text-surface-400">{r.category}</div>}</td>
                        <td className={cn('table-cell text-right font-mono', r.stock <= r.reorder && 'text-red-600')}>{r.stock} <span className="text-xs text-surface-400 font-sans">{r.unit}</span></td>
                        <td className="table-cell text-right font-mono">{r.sold30}</td>
                        <td className="table-cell text-right font-mono">{r.daysLeft == null ? <span className="text-surface-400">—</span> : r.daysLeft > 365 ? '365+' : Math.round(r.daysLeft)}</td>
                        <td className="table-cell font-mono text-xs">{r.last ? formatDate(r.last) : <span className="font-sans text-surface-400">{t('crm.never')}</span>}</td>
                        <td className="table-cell">
                          <span className={cn('badge', r.status === 'out' ? 'bg-red-100 text-red-800' : r.status === 'running' || r.status === 'low' ? 'bg-amber-100 text-amber-800' : r.status === 'dead' ? 'bg-surface-200 text-surface-700' : 'bg-brand-100 text-brand-800')}>
                            {t(`rep.statuses.${r.status}`)}
                          </span>
                        </td>
                        <td className="table-cell text-right font-mono text-xs">{money(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>)}

          {/* ═══ 6. Cash ══════════════════════════════════════════════ */}
          {tab === 'cash' && (noSales ? <div className="card"><Empty icon={Wallet} title={t('rep.noSalesTitle', { period: periodLabel })} body={t('rep.noSalesBody')} link={{ to: '/sales', label: t('crm.recordSale') }} /></div> : <>
            <div className="grid lg:grid-cols-5 gap-6">
              <section className="card lg:col-span-2 p-5">
                <h2 className="section-title mb-1">{t('rep.byPayment')}</h2>
                <p className="text-xs text-surface-500 mb-3">{periodLabel}</p>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={payment} dataKey="total" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {payment.map((_, i) => <Cell key={i} fill={BRAND[i % BRAND.length]} />)}
                    </Pie>
                    <Tooltip formatter={tooltipMoney} />
                  </PieChart>
                </ResponsiveContainer>
                <table className="w-full mt-2">
                  <tbody>
                    {payment.map((p, i) => (
                      <tr key={p.key} className="border-b border-surface-50">
                        <td className="table-cell"><span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: BRAND[i % BRAND.length] }} />{p.name}</td>
                        <td className="table-cell text-right font-mono text-xs text-surface-500">{tn('sales.countMonth', p.count)}</td>
                        <td className="table-cell text-right font-mono">{money(p.total)}</td>
                        <td className="table-cell text-right font-mono text-xs text-surface-500">{fmtPct(p.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="card lg:col-span-3 p-5">
                <h2 className="section-title mb-4">{t('rep.paymentByMonth')}</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={paymentByMonth} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} tick={{ fontSize: 11 }} width={48} />
                    <Tooltip formatter={tooltipMoney} />
                    <Legend />
                    {PAY_KEYS.map((k, i) => <Bar key={k} dataKey={t(`sales.payments.${k}`)} stackId="p" fill={BRAND[i % BRAND.length]} radius={i === PAY_KEYS.length - 1 ? [6, 6, 0, 0] : 0} />)}
                  </BarChart>
                </ResponsiveContainer>
              </section>
            </div>
          </>)}
        </div>
      )}
    </div>
  );
}
