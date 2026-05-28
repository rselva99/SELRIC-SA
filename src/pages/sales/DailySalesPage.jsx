import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, parseISO, getDay, getISOWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { formatCurrency, formatDate, fileToBase64 } from '../../lib/utils';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import FileDropZone from '../../components/ui/FileDropZone';
import toast from 'react-hot-toast';
import { TrendingUp, Save, Upload, Edit3, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

const COLOR_HEX = {
  dark_red: '#991b1b', orange: '#f97316', green: '#22c55e',
  yellow: '#facc15', blue: '#3b82f6', gray: '#d1d5db',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0, 10),
  total_sales: '', food_sales: '', liquor_sales: '',
  beer_sales: '', wine_sales: '', other_sales: '', notes: '',
};

function currFmt(val) {
  if (!val && val !== 0) return '';
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function DailySalesPage() {
  const now = new Date();
  const [activeTab, setActiveTab] = useState('enter');
  const [sales, setSales] = useState([]);
  const [calEvents, setCalEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Analytics filters
  const [analyticsDate, setAnalyticsDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));

  const analyticsYear  = analyticsDate.getFullYear();
  const analyticsMonth = analyticsDate.getMonth();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [salesRes, eventsRes] = await Promise.all([
        supabase.from('daily_sales').select('*').order('date', { ascending: false }),
        supabase.from('calendar_events').select('date,color_label,name').order('date'),
      ]);
      setSales(salesRes.data || []);
      setCalEvents(eventsRes.data || []);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Data entry ──────────────────────────────────────────────────────────

  async function handleSave(e) {
    e.preventDefault();
    if (!form.date || !form.total_sales) { toast.error('Date and total sales are required'); return; }
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        total_sales: parseFloat(form.total_sales) || 0,
        food_sales: parseFloat(form.food_sales) || 0,
        liquor_sales: parseFloat(form.liquor_sales) || 0,
        beer_sales: parseFloat(form.beer_sales) || 0,
        wine_sales: parseFloat(form.wine_sales) || 0,
        other_sales: parseFloat(form.other_sales) || 0,
        notes: form.notes || '',
        source: 'manual',
      };
      const { error } = editingId
        ? await supabase.from('daily_sales').update(payload).eq('id', editingId)
        : await supabase.from('daily_sales').upsert(payload, { onConflict: 'date' });
      if (error) throw error;
      toast.success(editingId ? 'Entry updated' : 'Sales saved');
      setForm(EMPTY_FORM);
      setEditingId(null);
      loadData();
    } catch (err) { toast.error(err.message || 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleFileUpload(files) {
    if (!files.length) return;
    const file = files[0];
    if (file.size > 5 * 1024 * 1024) { toast.error('File too large (max 5MB)'); return; }
    setExtracting(true);
    try {
      const base64Data = await fileToBase64(file);
      const mediaType = file.type || 'application/pdf';
      const res = await fetch('/api/sales-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Data, mediaType }),
      });
      if (!res.ok) throw new Error('Extraction failed');
      const extracted = await res.json();
      setForm({
        date: extracted.date || new Date().toISOString().slice(0, 10),
        total_sales: extracted.total_sales?.toString() || '',
        food_sales: extracted.food_sales?.toString() || '',
        liquor_sales: extracted.liquor_sales?.toString() || '',
        beer_sales: extracted.beer_sales?.toString() || '',
        wine_sales: extracted.wine_sales?.toString() || '',
        other_sales: extracted.other_sales?.toString() || '',
        notes: extracted.notes || '',
      });
      setShowBreakdown(true);
      toast.success('Data extracted — review and save');
    } catch (err) { toast.error(err.message || 'Extraction failed'); }
    finally { setExtracting(false); }
  }

  function startEdit(entry) {
    setForm({
      date: entry.date,
      total_sales: entry.total_sales?.toString() || '',
      food_sales: entry.food_sales?.toString() || '',
      liquor_sales: entry.liquor_sales?.toString() || '',
      beer_sales: entry.beer_sales?.toString() || '',
      wine_sales: entry.wine_sales?.toString() || '',
      other_sales: entry.other_sales?.toString() || '',
      notes: entry.notes || '',
    });
    setEditingId(entry.id);
    setShowBreakdown(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this entry?')) return;
    await supabase.from('daily_sales').delete().eq('id', id);
    loadData();
    toast.success('Deleted');
  }

  // ── Analytics data ──────────────────────────────────────────────────────

  const eventDateMap = useMemo(() => {
    const m = {};
    calEvents.forEach((e) => { (m[e.date] = m[e.date] || []).push(e); });
    return m;
  }, [calEvents]);

  // Current month's daily sales
  const currentMonthSales = useMemo(() => {
    return sales
      .filter((s) => {
        const d = parseISO(s.date + 'T00:00:00');
        return d.getFullYear() === analyticsYear && d.getMonth() === analyticsMonth;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [sales, analyticsYear, analyticsMonth]);

  // Daily chart data (with running total + event dots)
  const dailyChartData = useMemo(() => {
    let running = 0;
    return currentMonthSales.map((s) => {
      running += Number(s.total_sales);
      const ev = (eventDateMap[s.date] || [])[0];
      return {
        label: format(parseISO(s.date + 'T00:00:00'), 'MMM d'),
        sales: Number(s.total_sales),
        running,
        eventColor: ev ? COLOR_HEX[ev.color_label] || null : null,
        eventName: ev?.name || null,
      };
    });
  }, [currentMonthSales, eventDateMap]);

  // Weekly grouped data
  const weeklyChartData = useMemo(() => {
    const weeks = {};
    currentMonthSales.forEach((s) => {
      const d = parseISO(s.date + 'T00:00:00');
      const wk = `W${getISOWeek(d)}`;
      weeks[wk] = (weeks[wk] || 0) + Number(s.total_sales);
    });
    return Object.entries(weeks).map(([week, total]) => ({ week, total }));
  }, [currentMonthSales]);

  // Day-of-week averages (use all data, not just current month)
  const dowChartData = useMemo(() => {
    const buckets = DAY_NAMES.map((d) => ({ day: d, sum: 0, count: 0 }));
    sales.forEach((s) => {
      const idx = getDay(parseISO(s.date + 'T00:00:00'));
      buckets[idx].sum += Number(s.total_sales);
      buckets[idx].count += 1;
    });
    return buckets.slice(1).concat(buckets[0]).map((b) => ({ // Mon-Sun order
      day: b.day,
      avg: b.count ? Math.round(b.sum / b.count) : 0,
    }));
  }, [sales]);

  // MoM comparison: current + up to 2 previous months
  const momChartData = useMemo(() => {
    const months = [0, 1, 2].map((offset) => {
      const d = subMonths(analyticsDate, offset);
      const yr = d.getFullYear();
      const mo = d.getMonth();
      const label = format(d, 'MMM yy');
      const data = sales
        .filter((s) => {
          const sd = parseISO(s.date + 'T00:00:00');
          return sd.getFullYear() === yr && sd.getMonth() === mo;
        })
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((s, i) => ({ day: i + 1, [label]: Number(s.total_sales) }));
      return { label, data };
    });

    // Merge into single array keyed by day-of-month
    const maxDays = Math.max(...months.map((m) => m.data.length), 0);
    return Array.from({ length: maxDays }, (_, i) => {
      const point = { day: i + 1 };
      months.forEach((m) => { if (m.data[i]) point[m.label] = m.data[i][m.label]; });
      return point;
    });
  }, [sales, analyticsDate]);

  const momLabels = [0, 1, 2].map((o) => format(subMonths(analyticsDate, o), 'MMM yy'));

  // Summary stats for current month
  const monthStats = useMemo(() => {
    const total = currentMonthSales.reduce((s, e) => s + Number(e.total_sales), 0);
    const days = currentMonthSales.length;
    const best = currentMonthSales.reduce((b, e) => Number(e.total_sales) > (b?.total_sales || 0) ? e : b, null);
    return { total, days, avg: days ? total / days : 0, best };
  }, [currentMonthSales]);

  // ── Custom dot for event impact ─────────────────────────────────────────
  function EventDot(props) {
    const { cx, cy, payload } = props;
    if (!payload.eventColor) return null;
    return (
      <g>
        <circle cx={cx} cy={cy - 14} r={5} fill={payload.eventColor} stroke="#fff" strokeWidth={1.5} />
      </g>
    );
  }

  function CustomTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    return (
      <div className="bg-white border border-surface-200 rounded-lg shadow-lg px-3 py-2 text-sm">
        <p className="font-semibold">{label}</p>
        {payload.map((e) => (
          <p key={e.dataKey} style={{ color: e.color }}>{e.name}: {currFmt(e.value)}</p>
        ))}
        {p?.eventName && <p className="text-xs text-surface-500 mt-1">📅 {p.eventName}</p>}
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Daily Sales</h1>
          <p className="text-surface-500 text-sm mt-0.5">Track revenue · Analyze trends · Spot event impact</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-100 rounded-lg p-1 mb-6 w-fit">
        {[{ id: 'enter', label: 'Enter Sales' }, { id: 'analytics', label: 'Analytics' }].map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-5 py-2 rounded-md text-sm font-medium transition ${activeTab === t.id ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── ENTER SALES TAB ── */}
      {activeTab === 'enter' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form */}
          <div className="card p-5">
            <h3 className="section-title mb-4">{editingId ? 'Edit Entry' : 'New Entry'}</h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="input-field" required />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Total Sales</label>
                  <input type="number" min="0" step="0.01" value={form.total_sales} onChange={(e) => setForm({ ...form, total_sales: e.target.value })} className="input-field" placeholder="0.00" required />
                </div>
              </div>

              <button type="button" onClick={() => setShowBreakdown((s) => !s)} className="btn-ghost text-xs w-full">
                {showBreakdown ? '▲ Hide' : '▼ Show'} category breakdown
              </button>

              {showBreakdown && (
                <div className="grid grid-cols-2 gap-3">
                  {[['food_sales', 'Food'], ['liquor_sales', 'Liquor'], ['beer_sales', 'Beer'], ['wine_sales', 'Wine'], ['other_sales', 'Other']].map(([key, label]) => (
                    <div key={key}>
                      <label className="block text-xs text-surface-500 mb-1">{label}</label>
                      <input type="number" min="0" step="0.01" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="input-field" placeholder="0.00" />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs text-surface-500 mb-1">Notes</label>
                    <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input-field" placeholder="Optional" />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? <Spinner size="sm" className="text-white" /> : <><Save size={15} /> Save</>}
                </button>
                {editingId && <button type="button" onClick={() => { setForm(EMPTY_FORM); setEditingId(null); }} className="btn-ghost">Cancel</button>}
              </div>
            </form>
          </div>

          {/* File upload */}
          <div className="card p-5">
            <h3 className="section-title mb-2">Upload from POS</h3>
            <p className="text-sm text-surface-500 mb-4">Upload a CSV, PDF, or screenshot from your POS system — Claude will extract the sales data for you.</p>
            {extracting ? (
              <div className="flex flex-col items-center py-10 gap-2">
                <Spinner size="lg" />
                <p className="text-sm text-surface-500">Extracting sales data...</p>
              </div>
            ) : (
              <FileDropZone
                accept=".pdf,.csv,.png,.jpg,.jpeg,.webp"
                onFile={(file) => handleFileUpload([file])}
                label="Drop POS report here"
              />
            )}
          </div>

          {/* Recent entries */}
          <div className="lg:col-span-2 card overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
              <h3 className="font-semibold text-sm">Recent Entries</h3>
            </div>
            {loading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : sales.length === 0 ? (
              <EmptyState icon={TrendingUp} title="No sales data yet" description="Add your first entry above" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-surface-100">
                    <th className="table-header">Date</th>
                    <th className="table-header text-right">Total</th>
                    <th className="table-header text-right">Food</th>
                    <th className="table-header text-right">Liquor</th>
                    <th className="table-header text-right">Beer</th>
                    <th className="table-header">Source</th>
                    <th className="table-header w-16"></th>
                  </tr></thead>
                  <tbody>
                    {sales.slice(0, 30).map((s) => (
                      <tr key={s.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-mono text-xs">{formatDate(s.date)}</td>
                        <td className="table-cell text-right font-mono font-semibold text-green-700">{currFmt(s.total_sales)}</td>
                        <td className="table-cell text-right font-mono text-xs text-surface-500">{s.food_sales > 0 ? currFmt(s.food_sales) : '—'}</td>
                        <td className="table-cell text-right font-mono text-xs text-surface-500">{s.liquor_sales > 0 ? currFmt(s.liquor_sales) : '—'}</td>
                        <td className="table-cell text-right font-mono text-xs text-surface-500">{s.beer_sales > 0 ? currFmt(s.beer_sales) : '—'}</td>
                        <td className="table-cell"><span className="text-xs bg-surface-100 text-surface-600 px-2 py-0.5 rounded-full">{s.source}</span></td>
                        <td className="table-cell">
                          <div className="flex gap-1">
                            <button onClick={() => startEdit(s)} className="p-1 text-surface-400 hover:text-brand-600"><Edit3 size={13} /></button>
                            <button onClick={() => handleDelete(s.id)} className="p-1 text-surface-400 hover:text-red-500"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Month navigator */}
          <div className="flex items-center gap-3">
            <button onClick={() => setAnalyticsDate((d) => subMonths(d, 1))} className="p-2 hover:bg-surface-100 rounded-lg"><ChevronLeft size={18} /></button>
            <span className="font-display text-lg w-36 text-center">{format(analyticsDate, 'MMMM yyyy')}</span>
            <button onClick={() => setAnalyticsDate((d) => {
              const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
              return next > now ? d : next;
            })} className="p-2 hover:bg-surface-100 rounded-lg"><ChevronRight size={18} /></button>
          </div>

          {loading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : currentMonthSales.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No sales data for this month" description="Add entries in the Enter Sales tab" />
          ) : (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Month Total', value: currFmt(monthStats.total), color: 'text-green-700' },
                  { label: 'Days Recorded', value: monthStats.days, color: 'text-brand-700' },
                  { label: 'Daily Average', value: currFmt(monthStats.avg), color: 'text-surface-700' },
                  { label: 'Best Day', value: monthStats.best ? `${currFmt(monthStats.best.total_sales)} (${format(parseISO(monthStats.best.date + 'T00:00:00'), 'MMM d')})` : '—', color: 'text-amber-700' },
                ].map((s) => (
                  <div key={s.label} className="card p-4">
                    <p className="text-xs text-surface-500 uppercase tracking-wider">{s.label}</p>
                    <p className={`font-mono font-semibold text-lg mt-1 ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Daily line chart */}
              <div className="card p-5">
                <h3 className="section-title mb-1">Daily Sales — {format(analyticsDate, 'MMMM yyyy')}</h3>
                <p className="text-xs text-surface-400 mb-4">Colored dots = calendar events</p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={dailyChartData} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={currFmt} tick={{ fontSize: 11 }} width={70} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} dot={<EventDot />} name="Daily Sales" />
                    <Line type="monotone" dataKey="running" stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 2" dot={false} name="Running Total" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Weekly bar + DoW side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card p-5">
                  <h3 className="section-title mb-4">Sales by Week</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={weeklyChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={currFmt} tick={{ fontSize: 11 }} width={65} />
                      <Tooltip formatter={(v) => [currFmt(v), 'Sales']} />
                      <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Total Sales" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="card p-5">
                  <h3 className="section-title mb-1">Average by Day of Week</h3>
                  <p className="text-xs text-surface-400 mb-3">All-time averages</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dowChartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={currFmt} tick={{ fontSize: 11 }} width={65} />
                      <Tooltip formatter={(v) => [currFmt(v), 'Avg Sales']} />
                      <Bar dataKey="avg" fill="#10b981" radius={[4, 4, 0, 0]} name="Avg Sales" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* MoM comparison */}
              <div className="card p-5">
                <h3 className="section-title mb-4">Month-over-Month Comparison</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={momChartData} margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="day" tickFormatter={(v) => `Day ${v}`} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={currFmt} tick={{ fontSize: 11 }} width={70} />
                    <Tooltip formatter={(v, n) => [currFmt(v), n]} labelFormatter={(v) => `Day ${v}`} />
                    <Legend />
                    {momLabels.map((label, i) => (
                      <Line key={label} type="monotone" dataKey={label} stroke={MONTH_COLORS[i]} strokeWidth={i === 0 ? 2.5 : 1.5} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
