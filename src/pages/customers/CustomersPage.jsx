import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useLabel } from '../../components/useLabel';
import { useT } from '../../i18n/I18nContext';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import {
  Plus, Pencil, Trash2, Search, X, Check, ChevronDown, Users, Repeat, CircleDollarSign,
  Mail, Phone, ShoppingBag,
} from 'lucide-react';

// Customers — the people and businesses a workspace sells to. Rows are
// created automatically by the Sales tab (record_sale files the customer the
// first time a name is used) and can be added or edited here. Deleting a
// customer keeps their sales: each sale carries a snapshot of the name.
//
// Purchase totals come from the customer_stats view (security_invoker, so the
// same RLS as the tables underneath).

const emptyForm = () => ({ name: '', email: '', phone: '', notes: '' });

export default function CustomersPage() {
  const { user } = useAuth();
  const { products } = useData();
  const label = useLabel();
  const { t, tn } = useT();

  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');       // 'recent' | 'name' | 'spent'

  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  const [openId, setOpenId] = useState(null);
  const [history, setHistory] = useState({});       // customer_id → { loading, sales, items }
  const [prices, setPrices] = useState({});         // customer_id → [{ product_id, unit_price, updated_at }]
  const [priceDraft, setPriceDraft] = useState({}); // `${customer}:${product}` → draft price
  const [newPrice, setNewPrice] = useState({ product_id: '', unit_price: '' });
  const [priceBusy, setPriceBusy] = useState('');

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, st] = await Promise.all([
        fetchAll(supabase.from('customers').select('*').order('name')),
        fetchAll(supabase.from('customer_stats').select('*'), { tiebreaker: 'customer_id' }),
      ]);
      setCustomers(rows || []);
      setStats(Object.fromEntries((st || []).map((s) => [s.customer_id, s])));
    } catch (err) {
      console.error('customers load failed:', err);
      toast.error(t('crm.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function loadHistory(id) {
    setHistory((h) => ({ ...h, [id]: { loading: true, sales: [], items: {} } }));
    try {
      const { data: sales, error } = await supabase.from('sales')
        .select('id, number, date, total, items_count, payment_method')
        .eq('customer_id', id).order('date', { ascending: false }).order('number', { ascending: false }).limit(8);
      if (error) throw error;
      let items = {};
      if (sales?.length) {
        const { data: its } = await supabase.from('sale_items')
          .select('sale_id, product_name, quantity').in('sale_id', sales.map((s) => s.id)).order('position');
        (its || []).forEach((it) => { (items[it.sale_id] = items[it.sale_id] || []).push(it); });
      }
      setHistory((h) => ({ ...h, [id]: { loading: false, sales: sales || [], items } }));
    } catch (err) {
      console.warn('history load failed:', err.message);
      setHistory((h) => ({ ...h, [id]: { loading: false, sales: [], items: {} } }));
    }
  }

  async function loadPrices(id) {
    const { data, error } = await supabase.from('customer_prices').select('product_id, unit_price, updated_at').eq('customer_id', id);
    if (error) { console.warn('customer_prices read failed:', error.message); return; }
    setPrices((p) => ({ ...p, [id]: data || [] }));
  }

  // Agreed price for one product: upsert (also used to add a new one).
  async function savePrice(customerId, productId, value) {
    const unit_price = Math.round((parseFloat(value) || 0) * 100) / 100;
    if (!productId || Number.isNaN(unit_price) || unit_price < 0) { toast.error(t('crm.priceInvalid')); return; }
    setPriceBusy(`${customerId}:${productId}`);
    try {
      const { error } = await supabase.from('customer_prices')
        .upsert({ customer_id: customerId, product_id: productId, unit_price, updated_at: new Date().toISOString() }, { onConflict: 'customer_id,product_id' });
      if (error) throw error;
      await loadPrices(customerId);
      setPriceDraft((d) => { const n = { ...d }; delete n[`${customerId}:${productId}`]; return n; });
      setNewPrice({ product_id: '', unit_price: '' });
      toast.success(t('crm.priceSaved'));
    } catch (err) { toast.error(err.message || t('settings.saveFailed')); }
    finally { setPriceBusy(''); }
  }

  async function removePrice(customerId, productId) {
    setPriceBusy(`${customerId}:${productId}`);
    try {
      const { error } = await supabase.from('customer_prices').delete().eq('customer_id', customerId).eq('product_id', productId);
      if (error) throw error;
      await loadPrices(customerId);
      toast.success(t('crm.priceRemoved'));
    } catch (err) { toast.error(err.message || t('settings.saveFailed')); }
    finally { setPriceBusy(''); }
  }

  function toggleOpen(id) {
    const next = openId === id ? null : id;
    setOpenId(next);
    setNewPrice({ product_id: '', unit_price: '' });
    if (next && !history[next]) loadHistory(next);
    if (next && !prices[next]) loadPrices(next);
  }

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const sellable = useMemo(() => products.filter((p) => p.kind !== 'supply').sort((a, b) => a.name.localeCompare(b.name)), [products]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const all = Object.values(stats);
    return {
      total: customers.length,
      repeat: all.filter((s) => (s.sales_count || 0) >= 2).length,
      spent: all.reduce((sum, s) => sum + (Number(s.total_spent) || 0), 0),
    };
  }, [customers, stats]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? customers.filter((c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q) ||
          (c.notes || '').toLowerCase().includes(q))
      : customers.slice();
    const st = (c) => stats[c.id] || {};
    if (sort === 'name') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sort === 'spent') list.sort((a, b) => (Number(st(b).total_spent) || 0) - (Number(st(a).total_spent) || 0) || (a.name || '').localeCompare(b.name || ''));
    else list.sort((a, b) => (st(b).last_sale_date || '').localeCompare(st(a).last_sale_date || '') || (a.name || '').localeCompare(b.name || ''));
    return list;
  }, [customers, stats, search, sort]);

  // ── Form ─────────────────────────────────────────────────────────────────
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function startAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setConfirmId(null);
  }

  function startEdit(c) {
    setEditingId(c.id);
    setForm({ name: c.name || '', email: c.email || '', phone: c.phone || '', notes: c.notes || '' });
    setShowForm(true);
    setConfirmId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelForm() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { toast.error(t('crm.nameRequired')); return; }
    const payload = { name, email: form.email.trim(), phone: form.phone.trim(), notes: form.notes.trim() };
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from('customers').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingId);
        if (error) throw error;
        toast.success(t('crm.saved'));
      } else {
        const { error } = await supabase.from('customers').insert({ ...payload, created_by: user?.id || null });
        if (error) throw error;
        toast.success(t('crm.added'));
      }
      cancelForm();
      await load();
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;
      setConfirmId(null);
      if (editingId === id) cancelForm();
      if (openId === id) setOpenId(null);
      toast.success(t('crm.deleted'));
      await load();
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    }
  }

  const SORTS = ['recent', 'name', 'spent'];

  return (
    <div className="animate-fade-in">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="page-title">{label('customers')}</h1>
          <p className="text-surface-500 text-sm mt-1">{t('crm.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/sales" className="btn-secondary px-3 py-2 text-sm"><ShoppingBag size={16} /> {t('crm.recordSale')}</Link>
          <button type="button" onClick={startAdd} className="btn-primary px-3 py-2 text-sm"><Plus size={16} /> {t('crm.add')}</button>
        </div>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm text-surface-500"><Users size={15} className="text-brand-600" /> {t('crm.total')}</div>
          <div className="stat-value mt-2">{summary.total}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm text-surface-500"><Repeat size={15} className="text-brand-600" /> {t('crm.repeat')}</div>
          <div className="stat-value mt-2">{summary.repeat}</div>
        </div>
        <div className="rounded-xl border border-brand-950 bg-brand-950 text-white p-5">
          <div className="flex items-center gap-2 text-sm text-brand-200"><CircleDollarSign size={15} /> {t('crm.spent')}</div>
          <div className="font-mono text-2xl font-medium mt-2">{formatCurrency(summary.spent)}</div>
        </div>
      </div>

      {/* ── Add / edit ───────────────────────────────────────────────── */}
      {showForm && (
        <section className={cn('card mt-6 p-5', editingId && 'border-brand-400 ring-2 ring-brand-500/15')}>
          <h2 className="section-title">{editingId ? t('crm.editTitle') : t('crm.addTitle')}</h2>
          <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-4">
              <label htmlFor="cu-name" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('crm.name')}</label>
              <input id="cu-name" type="text" value={form.name} onChange={set('name')} className="input-field" required autoFocus />
            </div>
            <div className="lg:col-span-3">
              <label htmlFor="cu-email" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('crm.email')}</label>
              <input id="cu-email" type="email" value={form.email} onChange={set('email')} className="input-field" placeholder="name@example.com" />
            </div>
            <div className="lg:col-span-2">
              <label htmlFor="cu-phone" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('crm.phone')}</label>
              <input id="cu-phone" type="tel" value={form.phone} onChange={set('phone')} className="input-field" placeholder="+1 314 555 0100" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3 flex items-end gap-2">
              <button type="submit" disabled={saving} className="btn-primary w-full px-3">
                {saving ? <Spinner size="sm" className="text-white" /> : editingId ? <Check size={16} /> : <Plus size={16} />}
                {editingId ? t('common.save') : t('crm.add')}
              </button>
              <button type="button" onClick={cancelForm} className="btn-ghost px-2.5" aria-label={t('common.cancel')}><X size={16} /></button>
            </div>
            <div className="sm:col-span-2 lg:col-span-12">
              <label htmlFor="cu-notes" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('crm.notes')}</label>
              <input id="cu-notes" type="text" value={form.notes} onChange={set('notes')} className="input-field" placeholder={t('crm.notesPlaceholder')} />
            </div>
          </form>
        </section>
      )}

      {/* ── List ─────────────────────────────────────────────────────── */}
      <section className="card mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-b border-surface-200">
          <div className="inline-flex rounded-lg bg-surface-100 p-1" role="radiogroup" aria-label={t('crm.sortBy')}>
            {SORTS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => setSort(k)}
                className={cn('px-3 py-1.5 rounded-md text-sm font-medium transition-colors', sort === k ? 'bg-white shadow-sm text-brand-900' : 'text-surface-600 hover:text-surface-900')}>
                {t(`crm.sorts.${k}`)}
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9 py-2 text-sm" placeholder={t('crm.search')} />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 px-5 py-10 text-sm text-surface-500"><Spinner size="sm" /> {t('common.loading')}</div>
        ) : customers.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center"><Users size={22} /></div>
            <p className="font-display text-xl text-brand-950 mt-4">{t('crm.emptyTitle')}</p>
            <p className="text-sm text-surface-600 mt-1">{t('crm.emptyBody')}</p>
            <button type="button" onClick={startAdd} className="btn-primary mt-5"><Plus size={16} /> {t('crm.add')}</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-surface-500">{t('crm.noMatches')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="table-header w-8"><span className="sr-only">{t('crm.history')}</span></th>
                  <th className="table-header">{t('crm.name')}</th>
                  <th className="table-header">{t('crm.colContact')}</th>
                  <th className="table-header text-right">{t('crm.colSales')}</th>
                  <th className="table-header text-right">{t('crm.colSpent')}</th>
                  <th className="table-header">{t('crm.colLast')}</th>
                  <th className="table-header w-24"><span className="sr-only">{t('tx.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => {
                  const s = stats[c.id] || {};
                  const isOpen = openId === c.id;
                  const h = history[c.id];
                  return [
                    <tr key={c.id} className={cn('border-b border-surface-50 transition group', editingId === c.id ? 'bg-brand-50/60' : 'hover:bg-surface-50')}>
                      <td className="table-cell pr-0">
                        <button type="button" onClick={() => toggleOpen(c.id)} className="p-1 rounded text-surface-400 hover:text-brand-700" aria-expanded={isOpen} aria-label={t('crm.history')}>
                          <ChevronDown size={15} className={cn('transition-transform', isOpen && 'rotate-180')} />
                        </button>
                      </td>
                      <td className="table-cell">
                        <div className="font-medium text-surface-900">{c.name}</div>
                        {c.notes && <div className="text-xs text-surface-500 truncate max-w-[16rem]" title={c.notes}>{c.notes}</div>}
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-col gap-0.5 text-xs text-surface-600">
                          {c.email ? <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Mail size={12} className="text-surface-400" /> {c.email}</a> : null}
                          {c.phone ? <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-brand-700"><Phone size={12} className="text-surface-400" /> {c.phone}</a> : null}
                          {!c.email && !c.phone && <span className="text-surface-400">—</span>}
                        </div>
                      </td>
                      <td className="table-cell text-right font-mono">{s.sales_count || 0}</td>
                      <td className="table-cell text-right font-mono text-brand-700 whitespace-nowrap">{formatCurrency(Number(s.total_spent) || 0)}</td>
                      <td className="table-cell font-mono text-xs whitespace-nowrap">{s.last_sale_date ? formatDate(s.last_sale_date) : <span className="font-sans text-surface-400">{t('crm.never')}</span>}</td>
                      <td className="table-cell text-right whitespace-nowrap">
                        {confirmId === c.id ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="text-surface-600">{t('crm.deleteConfirm')}</span>
                            <button type="button" onClick={() => handleDelete(c.id)} className="rounded px-2 py-1 bg-red-600 text-white hover:bg-red-700">{t('tx.yes')}</button>
                            <button type="button" onClick={() => setConfirmId(null)} className="rounded px-2 py-1 bg-surface-100 text-surface-700 hover:bg-surface-200">{t('tx.no')}</button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button type="button" onClick={() => startEdit(c)} className="p-1.5 rounded text-surface-500 hover:text-brand-700 hover:bg-brand-50" aria-label={t('tx.edit')}><Pencil size={15} /></button>
                            <button type="button" onClick={() => setConfirmId(c.id)} className="p-1.5 rounded text-surface-500 hover:text-red-600 hover:bg-red-50" aria-label={t('tx.delete')}><Trash2 size={15} /></button>
                          </span>
                        )}
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${c.id}-history`} className="border-b border-surface-100 bg-surface-50/70">
                        <td />
                        <td colSpan={6} className="px-4 py-3">
                          <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">{t('crm.history')}</div>
                          {!h || h.loading ? (
                            <div className="flex items-center gap-2 text-sm text-surface-500"><Spinner size="sm" /> {t('common.loading')}</div>
                          ) : h.sales.length === 0 ? (
                            <p className="text-sm text-surface-500">{t('crm.historyEmpty')}</p>
                          ) : (
                            <ul className="divide-y divide-surface-200 rounded-lg border border-surface-200 bg-white">
                              {h.sales.map((sale) => (
                                <li key={sale.id} className="flex items-center justify-between gap-4 px-3.5 py-2 text-sm">
                                  <div className="min-w-0">
                                    <span className="font-mono text-xs text-surface-500 mr-2">{formatDate(sale.date)} · #{sale.number}</span>
                                    <span className="text-surface-700 truncate">{(h.items[sale.id] || []).map((it) => `${it.quantity}× ${it.product_name}`).join(', ')}</span>
                                  </div>
                                  <span className="font-mono text-brand-700 whitespace-nowrap">{formatCurrency(sale.total)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {(s.sales_count || 0) > 8 && <p className="text-xs text-surface-400 mt-2">{tn('crm.moreSales', (s.sales_count || 0) - 8)}</p>}

                          {/* Agreed prices — learned from sales, editable here */}
                          <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider mt-5 mb-1">{t('crm.pricesTitle')}</div>
                          <p className="text-xs text-surface-500 mb-2">{t('crm.pricesBody')}</p>
                          {(() => {
                            const list = (prices[c.id] || []).map((r) => ({ ...r, product: productById[r.product_id] })).filter((r) => r.product).sort((a, b) => a.product.name.localeCompare(b.product.name));
                            const available = sellable.filter((p) => !list.some((r) => r.product_id === p.id));
                            return (
                              <div className="rounded-lg border border-surface-200 bg-white">
                                {list.length === 0 && <p className="px-3.5 py-3 text-sm text-surface-500">{t('crm.pricesEmpty')}</p>}
                                {list.length > 0 && (
                                  <ul className="divide-y divide-surface-100">
                                    {list.map((r) => {
                                      const key = `${c.id}:${r.product_id}`;
                                      const draft = priceDraft[key] ?? Number(r.unit_price).toFixed(2);
                                      const dirty = Math.abs((parseFloat(draft) || 0) - Number(r.unit_price)) > 0.005;
                                      const listPrice = Number(r.product.sell_price) || 0;
                                      return (
                                        <li key={r.product_id} className="flex items-center gap-2 px-3.5 py-2 text-sm">
                                          <div className="flex-1 min-w-0">
                                            <div className="text-surface-900 truncate">{r.product.name}</div>
                                            <div className="text-[11px] text-surface-400">{t('crm.listPrice', { price: formatCurrency(listPrice) })}{listPrice && Math.abs(Number(r.unit_price) - listPrice) > 0.005 ? ` · ${Number(r.unit_price) < listPrice ? '−' : '+'}${formatCurrency(Math.abs(Number(r.unit_price) - listPrice))}` : ''}</div>
                                          </div>
                                          <div className="relative w-28">
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 text-xs">$</span>
                                            <input type="number" inputMode="decimal" min="0" step="0.01" value={draft} onChange={(e) => setPriceDraft((d) => ({ ...d, [key]: e.target.value }))}
                                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePrice(c.id, r.product_id, draft); } }}
                                              className="input-field py-1.5 pl-6 text-sm font-mono" aria-label={r.product.name} />
                                          </div>
                                          <button type="button" onClick={() => savePrice(c.id, r.product_id, draft)} disabled={!dirty || priceBusy === key} className="btn-primary px-2.5 py-1.5 text-xs" aria-label={t('common.save')}>
                                            {priceBusy === key ? <Spinner size="sm" className="text-white" /> : <Check size={14} />}
                                          </button>
                                          <button type="button" onClick={() => removePrice(c.id, r.product_id)} disabled={priceBusy === key} className="p-1.5 rounded text-surface-400 hover:text-red-600 hover:bg-red-50" aria-label={t('tx.delete')}>
                                            <Trash2 size={14} />
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                                {available.length > 0 && (
                                  <form onSubmit={(e) => { e.preventDefault(); savePrice(c.id, newPrice.product_id, newPrice.unit_price); }} className="flex items-center gap-2 px-3.5 py-2 border-t border-surface-100 bg-surface-50/60">
                                    <select value={newPrice.product_id} onChange={(e) => { const p = productById[e.target.value]; setNewPrice({ product_id: e.target.value, unit_price: p && p.sell_price != null ? Number(p.sell_price).toFixed(2) : '' }); }} className="input-field py-1.5 text-sm flex-1" aria-label={t('sales.product')}>
                                      <option value="">{t('crm.addPrice')}</option>
                                      {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                    <div className="relative w-28">
                                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 text-xs">$</span>
                                      <input type="number" inputMode="decimal" min="0" step="0.01" value={newPrice.unit_price} onChange={(e) => setNewPrice((n) => ({ ...n, unit_price: e.target.value }))} className="input-field py-1.5 pl-6 text-sm font-mono" placeholder="0.00" aria-label={t('sales.price')} />
                                    </div>
                                    <button type="submit" disabled={!newPrice.product_id || newPrice.unit_price === '' || priceBusy === `${c.id}:${newPrice.product_id}`} className="btn-primary px-2.5 py-1.5 text-xs" aria-label={t('crm.add')}><Plus size={14} /></button>
                                  </form>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
