import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, addMonths, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { useData } from '../../contexts/DataContext';
import { useT } from '../../i18n/I18nContext';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import {
  ChevronLeft, ChevronRight, ChevronDown, Plus, Pencil, Trash2, Download, Search, X, Check,
  ShoppingBag, Users, Package, AlertTriangle, Banknote, CreditCard, Landmark, CircleDollarSign,
} from 'lucide-react';

// Simple mode: Sales.
//
// One sale = date, customer (name / email / phone), the items at the price
// they actually sold for, how it was paid. Saving calls the record_sale RPC,
// which in ONE database transaction takes the stock off products, writes the
// inventory log, posts the money-in row to `transactions` (so the Transactions
// tab, dashboard and reports see it) and files the customer in Customers.
//
// The Full package keeps its Daily Sales page (POS totals); main.jsx picks
// the page by the workspace's accounting mode.

const NOT_IN_INVENTORY = '__custom__';
const PAYMENTS = [
  { key: 'cash',     icon: Banknote },
  { key: 'card',     icon: CreditCard },
  { key: 'transfer', icon: Landmark },
  { key: 'other',    icon: CircleDollarSign },
];

// `auto` = the price was filled by us (list or agreed price) and may be
// swapped when the customer changes; a hand-typed price is never overwritten.
const emptyLine = () => ({ product_id: '', name: '', quantity: '1', unit_price: '', auto: true });
const emptyForm = () => ({
  date: format(new Date(), 'yyyy-MM-dd'),
  customer_id: '',
  customer_name: '',
  customer_email: '',
  customer_phone: '',
  payment_method: 'cash',
  notes: '',
  lines: [emptyLine()],
});

const money = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const lineTotal = (l) => money((parseInt(l.quantity, 10) || 0) * (parseFloat(l.unit_price) || 0));

export default function SalesPage() {
  const { products, refresh } = useData();
  const { t, tn, locale } = useT();

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [rows, setRows] = useState([]);
  const [itemsBySale, setItemsBySale] = useState({});
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(() => new Set());

  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState(null);      // the sale row being edited (header only)
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [custOpen, setCustOpen] = useState(false);
  // Agreed prices for the picked customer: product_id → unit_price.
  const [agreed, setAgreed] = useState({});
  const custBox = useRef(null);

  // ── Load ─────────────────────────────────────────────────────────────────
  const loadCustomers = useCallback(async () => {
    try {
      const data = await fetchAll(supabase.from('customers').select('id, name, email, phone').order('name'));
      setCustomers(data || []);
    } catch (err) {
      console.warn('customers load failed:', err.message);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = format(month, 'yyyy-MM-dd');
      const end = format(endOfMonth(month), 'yyyy-MM-dd');
      const sales = await fetchAll(
        supabase.from('sales').select('*')
          .gte('date', start).lte('date', end)
          .order('date', { ascending: false })
          .order('number', { ascending: false })
      );
      setRows(sales || []);
      if (sales?.length) {
        const ids = sales.map((s) => s.id);
        const items = await fetchAll(
          supabase.from('sale_items').select('id, sale_id, product_id, product_name, quantity, unit_price, line_total, position')
            .in('sale_id', ids).order('position')
        );
        const map = {};
        (items || []).forEach((it) => { (map[it.sale_id] = map[it.sale_id] || []).push(it); });
        setItemsBySale(map);
      } else {
        setItemsBySale({});
      }
    } catch (err) {
      console.error('sales load failed:', err);
      toast.error(t('sales.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [month, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // The picked customer's agreed prices (learned from past sales, editable in
  // Customers). Lines whose price we filled follow the customer; typed prices stay.
  useEffect(() => {
    let cancelled = false;
    const cid = form.customer_id;
    const apply = (map) => {
      if (cancelled) return;
      setAgreed(map);
      setForm((f) => ({
        ...f,
        lines: f.lines.map((l) => {
          if (!l.auto || !l.product_id || l.product_id === NOT_IN_INVENTORY) return l;
          const p = productById[l.product_id];
          const price = map[l.product_id] ?? (p && p.sell_price != null ? Number(p.sell_price) : null);
          return price == null ? l : { ...l, unit_price: Number(price).toFixed(2) };
        }),
      }));
    };
    if (!cid) { apply({}); return () => { cancelled = true; }; }
    supabase.from('customer_prices').select('product_id, unit_price').eq('customer_id', cid)
      .then(({ data, error }) => {
        if (error) { console.warn('customer_prices read failed:', error.message); apply({}); return; }
        apply(Object.fromEntries((data || []).map((r) => [r.product_id, Number(r.unit_price)])));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.customer_id]);

  // Close the customer suggestions when clicking elsewhere.
  useEffect(() => {
    function onDown(e) { if (custBox.current && !custBox.current.contains(e.target)) setCustOpen(false); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const items = rows.reduce((s, r) => s + (Number(r.items_count) || 0), 0);
    return { revenue, count: rows.length, items, avg: rows.length ? revenue / rows.length : 0 };
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.customer_name || '').toLowerCase().includes(q) ||
      String(r.number).includes(q) ||
      (itemsBySale[r.id] || []).some((it) => (it.product_name || '').toLowerCase().includes(q))
    );
  }, [rows, search, itemsBySale]);

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  const customerMatches = useMemo(() => {
    const q = form.customer_name.trim().toLowerCase();
    const list = q ? customers.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.phone || '').includes(q)) : customers;
    return list.slice(0, 6);
  }, [customers, form.customer_name]);

  const isNewCustomer = form.customer_name.trim() !== '' && !form.customer_id &&
    !customers.some((c) => (c.name || '').toLowerCase() === form.customer_name.trim().toLowerCase());

  const formTotal = useMemo(() => money(form.lines.reduce((s, l) => s + lineTotal(l), 0)), [form.lines]);

  const rawMonthLabel = month.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1);

  // ── Form helpers ─────────────────────────────────────────────────────────
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function pickCustomer(c) {
    setForm((f) => ({ ...f, customer_id: c.id, customer_name: c.name, customer_email: c.email || '', customer_phone: c.phone || '' }));
    setCustOpen(false);
  }

  function setCustomerName(e) {
    const name = e.target.value;
    // Typing a different name detaches the picked customer; retyping an
    // existing one exactly re-attaches it so email/phone follow along.
    const exact = customers.find((c) => (c.name || '').toLowerCase() === name.trim().toLowerCase());
    setForm((f) => ({
      ...f,
      customer_name: name,
      customer_id: exact ? exact.id : '',
      customer_email: exact ? (exact.email || '') : (f.customer_id ? '' : f.customer_email),
      customer_phone: exact ? (exact.phone || '') : (f.customer_id ? '' : f.customer_phone),
    }));
    setCustOpen(true);
  }

  function setLine(i, patch) {
    setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  }

  function pickProduct(i, value) {
    if (value === NOT_IN_INVENTORY) { setLine(i, { product_id: NOT_IN_INVENTORY, name: '', unit_price: '' }); return; }
    const p = productById[value];
    const price = agreed[value] ?? (p && p.sell_price != null ? Number(p.sell_price) : null);
    setLine(i, { product_id: value, name: p?.name || '', unit_price: price == null ? '' : Number(price).toFixed(2), auto: true });
  }

  function addLine() { setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] })); }
  function removeLine(i) { setForm((f) => ({ ...f, lines: f.lines.length === 1 ? [emptyLine()] : f.lines.filter((_, j) => j !== i) })); }

  function startEdit(row) {
    setEditing(row);
    setConfirmId(null);
    setForm({
      date: row.date,
      customer_id: row.customer_id || '',
      customer_name: row.customer_name || '',
      customer_email: customers.find((c) => c.id === row.customer_id)?.email || '',
      customer_phone: customers.find((c) => c.id === row.customer_id)?.phone || '',
      payment_method: row.payment_method || 'cash',
      notes: row.notes || '',
      lines: [],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(emptyForm());
  }

  function explain(err) {
    const msg = err?.message || '';
    if (msg.includes('PERIOD_LOCKED')) return t('tx.periodLocked');
    if (msg.includes('SALE_NO_ITEMS')) return t('sales.needItem');
    if (msg.includes('SALE_BAD_QUANTITY')) return t('sales.needQty');
    if (msg.includes('SALE_BAD_PRODUCT')) return t('sales.productGone');
    if (msg.includes('SALE_BAD_ITEM')) return t('sales.needProduct');
    return msg || t('settings.saveFailed');
  }

  function customerPayload() {
    return {
      id: form.customer_id || null,
      name: form.customer_name.trim(),
      email: form.customer_email.trim(),
      phone: form.customer_phone.trim(),
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        const { data, error } = await supabase.rpc('update_sale', {
          p_sale_id: editing.id,
          p: { date: form.date, customer: customerPayload(), payment_method: form.payment_method, notes: form.notes.trim() },
        });
        if (error) throw error;
        toast.success(t('sales.updated', { n: data?.number ?? editing.number }));
        setEditing(null);
        setForm(emptyForm());
      } else {
        const lines = form.lines.filter((l) => l.product_id || l.name.trim());
        if (!lines.length) { toast.error(t('sales.needItem')); setSaving(false); return; }
        for (const l of lines) {
          const custom = l.product_id === NOT_IN_INVENTORY || !l.product_id;
          if (custom && !l.name.trim()) { toast.error(t('sales.needProduct')); setSaving(false); return; }
          if (!(parseInt(l.quantity, 10) > 0)) { toast.error(t('sales.needQty')); setSaving(false); return; }
          if (l.unit_price === '' || Number.isNaN(parseFloat(l.unit_price)) || parseFloat(l.unit_price) < 0) { toast.error(t('sales.needPrice')); setSaving(false); return; }
        }
        const { data, error } = await supabase.rpc('record_sale', {
          p: {
            date: form.date,
            customer: customerPayload(),
            payment_method: form.payment_method,
            notes: form.notes.trim(),
            items: lines.map((l) => ({
              product_id: l.product_id && l.product_id !== NOT_IN_INVENTORY ? l.product_id : null,
              name: l.name.trim(),
              quantity: parseInt(l.quantity, 10),
              unit_price: money(l.unit_price),
            })),
          },
        });
        if (error) throw error;
        toast.success(t('sales.recorded', { n: data?.number ?? '' }));
        setForm({ ...emptyForm(), date: form.date, payment_method: form.payment_method });   // keep date + payment for the next one
        refresh();                                   // products.current_stock changed
      }
      loadCustomers();
      const target = startOfMonth(parseISO(form.date));
      if (target.getTime() !== month.getTime()) setMonth(target); else await load();
    } catch (err) {
      toast.error(explain(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row) {
    try {
      const { error } = await supabase.rpc('void_sale', { p_sale_id: row.id });
      if (error) throw error;
      setConfirmId(null);
      if (editing?.id === row.id) cancelEdit();
      toast.success(t('sales.deleted'));
      refresh();
      await load();
    } catch (err) {
      toast.error(explain(err));
    }
  }

  function toggleOpen(id) {
    setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function exportCsv() {
    const header = [t('dash.date'), '#', t('sales.customer'), t('crm.email'), t('crm.phone'), t('sales.items'), t('sales.payment'), t('sales.total')];
    const lines = [header, ...rows.map((r) => {
      const c = customers.find((x) => x.id === r.customer_id);
      const items = (itemsBySale[r.id] || []).map((it) => `${it.quantity}× ${it.product_name} @ ${Number(it.unit_price).toFixed(2)}`).join('; ');
      return [r.date, r.number, r.customer_name || '', c?.email || '', c?.phone || '', items, t(`sales.payments.${r.payment_method}`), Number(r.total).toFixed(2)];
    })].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selric-sales-${format(month, 'yyyy-MM')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Supplies (raw materials, packaging) are stock-only — never sold.
  const inventoryProducts = useMemo(() => products.filter((p) => p.kind !== 'supply').sort((a, b) => a.name.localeCompare(b.name)), [products]);

  return (
    <div className="animate-fade-in">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="page-title">{t('sales.title')}</h1>
          <p className="text-surface-500 text-sm mt-1">{t('sales.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-surface-300 bg-white">
            <button type="button" onClick={() => setMonth((m) => addMonths(m, -1))} className="px-2.5 py-2 text-surface-600 hover:text-brand-700" aria-label={t('tx.prevMonth')}>
              <ChevronLeft size={18} />
            </button>
            <span className="px-2 text-sm font-medium text-surface-900 min-w-[9.5rem] text-center">{monthLabel}</span>
            <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))} className="px-2.5 py-2 text-surface-600 hover:text-brand-700" aria-label={t('tx.nextMonth')}>
              <ChevronRight size={18} />
            </button>
          </div>
          <button type="button" onClick={exportCsv} disabled={!rows.length} className="btn-secondary px-3 py-2 text-sm">
            <Download size={16} /> CSV
          </button>
        </div>
      </div>

      {/* ── Month stats ──────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-brand-950 bg-brand-950 text-white p-5">
          <div className="flex items-center gap-2 text-sm text-brand-200"><ShoppingBag size={15} /> {t('sales.revenueMonth')}</div>
          <div className="font-mono text-2xl font-medium mt-2">{formatCurrency(stats.revenue)}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm text-surface-500"><Package size={15} className="text-brand-600" /> {tn('sales.countMonth', stats.count)}</div>
          <div className="stat-value mt-2">{tn('sales.itemsSold', stats.items)}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm text-surface-500"><Users size={15} className="text-brand-600" /> {t('sales.avgSale')}</div>
          <div className="stat-value mt-2">{formatCurrency(stats.avg)}</div>
        </div>
      </div>

      {/* ── Record / edit ────────────────────────────────────────────── */}
      <section className={cn('card mt-6 p-5 transition-colors', editing && 'border-brand-400 ring-2 ring-brand-500/15')}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="section-title">{editing ? t('sales.editTitle', { n: editing.number }) : t('sales.recordTitle')}</h2>
          {!editing && !products.length && (
            <Link to="/inventory" className="text-sm text-brand-700 hover:text-brand-800 font-medium inline-flex items-center gap-1">
              <Package size={14} /> {t('sales.addProductsHint')}
            </Link>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-5">
          {/* Date + customer */}
          <div className="grid grid-cols-2 lg:grid-cols-12 gap-3">
            <div className="col-span-2 sm:col-span-1 lg:col-span-2">
              <label htmlFor="sale-date" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('dash.date')}</label>
              <input id="sale-date" type="date" value={form.date} onChange={set('date')} className="input-field" required />
            </div>
            <div className="col-span-2 sm:col-span-1 lg:col-span-4 relative" ref={custBox}>
              <label htmlFor="sale-customer" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('sales.customer')}</label>
              <input
                id="sale-customer" type="text" value={form.customer_name} onChange={setCustomerName} onFocus={() => setCustOpen(true)}
                className="input-field" placeholder={t('sales.customerPlaceholder')} autoComplete="off"
              />
              {custOpen && customerMatches.length > 0 && (
                <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-surface-200 rounded-lg shadow-lg overflow-hidden" role="listbox">
                  {customerMatches.map((c) => (
                    <li key={c.id}>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustomer(c)}
                        className={cn('w-full text-left px-3.5 py-2 hover:bg-brand-50 flex items-center justify-between gap-3', form.customer_id === c.id && 'bg-brand-50')}>
                        <span className="text-sm text-surface-900 truncate">{c.name}</span>
                        <span className="text-xs text-surface-400 truncate">{c.email || c.phone || ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {isNewCustomer && <p className="text-xs text-brand-700 mt-1">{t('sales.newCustomerHint')}</p>}
              {!form.customer_name.trim() && <p className="text-xs text-surface-400 mt-1">{t('sales.walkInHint')}</p>}
            </div>
            <div className="col-span-1 lg:col-span-3">
              <label htmlFor="sale-email" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('crm.email')}</label>
              <input id="sale-email" type="email" value={form.customer_email} onChange={set('customer_email')} className="input-field" placeholder="name@example.com" autoComplete="off" />
            </div>
            <div className="col-span-1 lg:col-span-3">
              <label htmlFor="sale-phone" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('crm.phone')}</label>
              <input id="sale-phone" type="tel" value={form.customer_phone} onChange={set('customer_phone')} className="input-field" placeholder="+1 314 555 0100" autoComplete="off" />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="block text-xs font-semibold text-surface-600">{t('sales.items')}</span>
              {!editing && (
                <button type="button" onClick={addLine} className="text-xs font-medium text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
                  <Plus size={14} /> {t('sales.addItem')}
                </button>
              )}
            </div>

            {editing ? (
              <div className="rounded-lg border border-surface-200 bg-surface-50">
                <ul className="divide-y divide-surface-200">
                  {(itemsBySale[editing.id] || []).map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <span className="text-surface-800"><span className="font-mono text-surface-500">{it.quantity}×</span> {it.product_name}</span>
                      <span className="font-mono text-surface-700">{formatCurrency(it.line_total)}</span>
                    </li>
                  ))}
                </ul>
                <p className="px-4 py-2.5 text-xs text-surface-500 border-t border-surface-200">{t('sales.itemsReadOnly')}</p>
              </div>
            ) : (
              <div className="rounded-lg border border-surface-200 overflow-hidden">
                <div className="hidden lg:grid grid-cols-12 gap-2 px-3 py-2 bg-surface-50 text-[11px] font-semibold uppercase tracking-wider text-surface-500">
                  <div className="col-span-6">{t('sales.product')}</div>
                  <div className="col-span-2">{t('sales.qty')}</div>
                  <div className="col-span-2">{t('sales.price')}</div>
                  <div className="col-span-2 text-right">{t('sales.lineTotal')}</div>
                </div>
                <ul className="divide-y divide-surface-100">
                  {form.lines.map((l, i) => {
                    const custom = l.product_id === NOT_IN_INVENTORY;
                    const p = !custom && l.product_id ? productById[l.product_id] : null;
                    const qty = parseInt(l.quantity, 10) || 0;
                    const stock = p ? (p.current_stock ?? 0) : null;
                    const over = p && qty > stock;
                    return (
                      <li key={i} className="grid grid-cols-12 gap-2 px-3 py-2.5 items-start">
                        <div className="col-span-12 lg:col-span-6">
                          {custom ? (
                            <div className="flex gap-2">
                              <input type="text" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} className="input-field py-2 text-sm"
                                placeholder={t('sales.itemNamePlaceholder')} autoFocus />
                              <button type="button" onClick={() => setLine(i, { product_id: '', name: '', unit_price: '' })} className="btn-ghost px-2 shrink-0" aria-label={t('common.cancel')}><X size={15} /></button>
                            </div>
                          ) : (
                            <select value={l.product_id} onChange={(e) => pickProduct(i, e.target.value)} className="input-field py-2 text-sm" aria-label={t('sales.product')}>
                              <option value="">{t('sales.chooseProduct')}</option>
                              {inventoryProducts.map((pr) => (
                                <option key={pr.id} value={pr.id}>{pr.name}{pr.current_stock <= 0 ? ` — ${t('sales.outOfStock')}` : ''}</option>
                              ))}
                              <option value={NOT_IN_INVENTORY}>{t('sales.notInInventory')}</option>
                            </select>
                          )}
                          {p && (
                            <p className={cn('text-xs mt-1 inline-flex items-center gap-1', over ? 'text-amber-700' : stock <= 0 ? 'text-red-600' : 'text-surface-400')}>
                              {over && <AlertTriangle size={12} />}
                              {over ? t('sales.overStock', { n: stock }) : stock <= 0 ? t('sales.outOfStock') : tn('sales.inStock', stock)}
                            </p>
                          )}
                        </div>
                        <div className="col-span-4 lg:col-span-2">
                          <input type="number" inputMode="numeric" min="1" step="1" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })}
                            className="input-field py-2 text-sm font-mono" aria-label={t('sales.qty')} />
                        </div>
                        <div className="col-span-5 lg:col-span-2">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm">$</span>
                            <input type="number" inputMode="decimal" min="0" step="0.01" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value, auto: false })}
                              className="input-field py-2 pl-6 text-sm font-mono" placeholder="0.00" aria-label={t('sales.price')} />
                          </div>
                          {p && agreed[l.product_id] != null && Math.abs(Number(l.unit_price) - agreed[l.product_id]) < 0.005 && (
                            <p className="text-[11px] text-brand-700 mt-1 truncate" title={t('sales.agreedPrice', { name: form.customer_name })}>{t('sales.agreedPrice', { name: form.customer_name })}</p>
                          )}
                        </div>
                        <div className="col-span-3 lg:col-span-2 flex items-center justify-end gap-1 pt-2">
                          <span className="font-mono text-sm text-surface-800">{formatCurrency(lineTotal(l))}</span>
                          <button type="button" onClick={() => removeLine(i)} className="p-1.5 rounded text-surface-400 hover:text-red-600 hover:bg-red-50" aria-label={t('sales.removeItem')}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* Payment, notes, total */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-5">
              <span className="block text-xs font-semibold text-surface-600 mb-1.5">{t('sales.payment')}</span>
              <div className="inline-flex flex-wrap rounded-lg bg-surface-100 p-1 gap-0.5" role="radiogroup" aria-label={t('sales.payment')}>
                {PAYMENTS.map(({ key, icon: Icon }) => (
                  <button key={key} type="button" role="radio" aria-checked={form.payment_method === key}
                    onClick={() => setForm((f) => ({ ...f, payment_method: key }))}
                    className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                      form.payment_method === key ? 'bg-white shadow-sm text-brand-900' : 'text-surface-600 hover:text-surface-900')}>
                    <Icon size={14} /> {t(`sales.payments.${key}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="lg:col-span-4">
              <label htmlFor="sale-notes" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('sales.notes')}</label>
              <input id="sale-notes" type="text" value={form.notes} onChange={set('notes')} className="input-field" placeholder={t('sales.notesPlaceholder')} />
            </div>
            <div className="lg:col-span-3 flex items-end justify-between lg:justify-end gap-3">
              {!editing && (
                <div className="text-right">
                  <div className="text-xs text-surface-500">{t('sales.total')}</div>
                  <div className="font-mono text-2xl text-brand-950 leading-tight">{formatCurrency(formTotal)}</div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button type="submit" disabled={saving} className="btn-primary px-4 whitespace-nowrap">
                  {saving ? <Spinner size="sm" className="text-white" /> : editing ? <Check size={16} /> : <ShoppingBag size={16} />}
                  {editing ? t('common.save') : t('sales.record')}
                </button>
                {editing && (
                  <button type="button" onClick={cancelEdit} className="btn-ghost px-2.5" aria-label={t('common.cancel')}><X size={16} /></button>
                )}
              </div>
            </div>
          </div>
        </form>
      </section>

      {/* ── List ─────────────────────────────────────────────────────── */}
      <section className="card mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-b border-surface-200">
          <h2 className="section-title">
            {monthLabel} <span className="text-surface-400 font-sans text-sm">· {tn('sales.countMonth', rows.length)}</span>
          </h2>
          <div className="relative sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9 py-2 text-sm" placeholder={t('sales.search')} />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 px-5 py-10 text-sm text-surface-500"><Spinner size="sm" /> {t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center"><ShoppingBag size={22} /></div>
            <p className="font-display text-xl text-brand-950 mt-4">{t('sales.emptyTitle', { month: rawMonthLabel })}</p>
            <p className="text-sm text-surface-600 mt-1">{t('sales.emptyBody')}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-surface-500">{t('sales.noMatches')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="table-header w-8"><span className="sr-only">{t('sales.showItems')}</span></th>
                  <th className="table-header">{t('dash.date')}</th>
                  <th className="table-header">#</th>
                  <th className="table-header">{t('sales.customer')}</th>
                  <th className="table-header">{t('sales.items')}</th>
                  <th className="table-header">{t('sales.payment')}</th>
                  <th className="table-header text-right">{t('sales.total')}</th>
                  <th className="table-header w-24"><span className="sr-only">{t('tx.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const items = itemsBySale[r.id] || [];
                  const isOpen = open.has(r.id);
                  const summary = items.slice(0, 2).map((it) => `${it.quantity}× ${it.product_name}`).join(', ') + (items.length > 2 ? ` +${items.length - 2}` : '');
                  return [
                    <tr key={r.id} className={cn('border-b border-surface-50 transition group', editing?.id === r.id ? 'bg-brand-50/60' : 'hover:bg-surface-50')}>
                      <td className="table-cell pr-0">
                        <button type="button" onClick={() => toggleOpen(r.id)} className="p-1 rounded text-surface-400 hover:text-brand-700" aria-expanded={isOpen} aria-label={isOpen ? t('sales.hideItems') : t('sales.showItems')}>
                          <ChevronDown size={15} className={cn('transition-transform', isOpen && 'rotate-180')} />
                        </button>
                      </td>
                      <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="table-cell font-mono text-xs text-surface-500">{r.number}</td>
                      <td className="table-cell font-medium text-surface-900 max-w-[14rem] truncate">{r.customer_name || <span className="text-surface-400 font-normal">{t('sales.walkIn')}</span>}</td>
                      <td className="table-cell text-surface-600 max-w-[18rem] truncate" title={items.map((it) => `${it.quantity}× ${it.product_name}`).join(', ')}>{summary || '—'}</td>
                      <td className="table-cell"><span className="badge bg-surface-100 text-surface-700">{t(`sales.payments.${r.payment_method}`)}</span></td>
                      <td className="table-cell text-right font-mono whitespace-nowrap text-brand-700">{formatCurrency(r.total)}</td>
                      <td className="table-cell text-right whitespace-nowrap">
                        {confirmId === r.id ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="text-surface-600">{t('sales.deleteConfirm')}</span>
                            <button type="button" onClick={() => handleDelete(r)} className="rounded px-2 py-1 bg-red-600 text-white hover:bg-red-700">{t('tx.yes')}</button>
                            <button type="button" onClick={() => setConfirmId(null)} className="rounded px-2 py-1 bg-surface-100 text-surface-700 hover:bg-surface-200">{t('tx.no')}</button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button type="button" onClick={() => startEdit(r)} className="p-1.5 rounded text-surface-500 hover:text-brand-700 hover:bg-brand-50" aria-label={t('tx.edit')}><Pencil size={15} /></button>
                            <button type="button" onClick={() => setConfirmId(r.id)} className="p-1.5 rounded text-surface-500 hover:text-red-600 hover:bg-red-50" aria-label={t('tx.delete')}><Trash2 size={15} /></button>
                          </span>
                        )}
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${r.id}-items`} className="border-b border-surface-100 bg-surface-50/70">
                        <td />
                        <td colSpan={7} className="px-4 py-3">
                          <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
                            {items.map((it) => (
                              <li key={it.id} className="flex items-center justify-between gap-3">
                                <span className="text-surface-700 truncate">
                                  <span className="font-mono text-surface-500">{it.quantity}×</span> {it.product_name}
                                  {!it.product_id && <span className="ml-1.5 text-[11px] text-surface-400">{t('sales.customTag')}</span>}
                                </span>
                                <span className="font-mono text-surface-600 whitespace-nowrap">
                                  {it.quantity > 1 && <span className="text-surface-400">{formatCurrency(it.unit_price)} {t('sales.each')} · </span>}{formatCurrency(it.line_total)}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {r.notes && <p className="text-xs text-surface-500 mt-2">{r.notes}</p>}
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
