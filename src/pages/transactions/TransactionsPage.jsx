import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, startOfMonth, endOfMonth, addMonths, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useT } from '../../i18n/I18nContext';
import { creditOf, debitOf, pickableCategories } from '../../lib/finance';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import CategoriesManager from '../../components/CategoriesManager';
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Download,
  ArrowDownLeft, ArrowUpRight, Lock, Search, X, Check, ShoppingBag, Tags,
} from 'lucide-react';

// Simple mode: one tab for money in / money out.
//
// Writes go to the SAME `transactions` table the full package uses —
// type 'credit' = money in, 'debit' = money out, amount stored as a positive
// number, posted = true (there is no review step in simple mode). Switching
// the workspace to full mode later shows every row here in the ledger.
//
// Rows that came from a bank statement or a journal entry (full-mode work)
// are shown read-only with a lock; they are managed from the full package.
// Rows posted by the Sales tab (reference 'SALE-…') are locked too: the
// amount belongs to the sale's items, so they are changed or deleted there.

const NEW_CATEGORY = '__new__';

const emptyForm = (kind = 'out') => ({
  kind,                                     // 'in' | 'out'
  date: format(new Date(), 'yyyy-MM-dd'),
  amount: '',
  description: '',
  category: '',
});

function isSale(row) {
  return typeof row.reference === 'string' && row.reference.startsWith('SALE-');
}

function isLocked(row) {
  return !!(row.bank_statement_id || row.journal_entry_id) || isSale(row);
}

export default function TransactionsPage() {
  const { user } = useAuth();
  const { categories, addCategory, addTransaction, updateTransaction, deleteTransaction } = useData();
  const { t, tn, locale } = useT();

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [showCats, setShowCats] = useState(false);

  // ── Load the month ───────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = format(month, 'yyyy-MM-dd');
      const end = format(endOfMonth(month), 'yyyy-MM-dd');
      const data = await fetchAll(
        supabase.from('transactions').select('*')
          .gte('date', start).lte('date', end).eq('voided', false)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
      );
      setRows(data || []);
    } catch (err) {
      console.error('transactions load failed:', err);
      toast.error(t('tx.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [month, t]);

  useEffect(() => { load(); }, [load]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let moneyIn = 0, moneyOut = 0;
    for (const r of rows) { moneyIn += creditOf(r); moneyOut += debitOf(r); }
    return { moneyIn, moneyOut, net: moneyIn - moneyOut };
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.description || '').toLowerCase().includes(q) ||
      (r.category || '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  const kindType = form.kind === 'in' ? 'revenue' : 'expense';
  const categoryOptions = useMemo(
    () => pickableCategories(categories).filter((c) => (c.type || '').toLowerCase() === kindType),
    [categories, kindType]
  );

  const rawMonthLabel = month.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const monthLabel = rawMonthLabel.charAt(0).toUpperCase() + rawMonthLabel.slice(1);

  // ── Form helpers ─────────────────────────────────────────────────────────
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function setKind(kind) {
    // Switching money in ↔ out changes the category list; clear the pick.
    setForm((f) => ({ ...f, kind, category: '' }));
    setNewCat('');
  }

  function startEdit(row) {
    setEditingId(row.id);
    setConfirmId(null);
    setForm({
      kind: row.type === 'credit' ? 'in' : 'out',
      date: row.date,
      amount: String(Math.abs(Number(row.amount) || 0)),
      description: row.description || '',
      category: row.category || '',
    });
    setNewCat('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(form.kind));
    setNewCat('');
  }

  async function handleAddCategory() {
    const name = newCat.trim();
    if (!name) return;
    setAddingCat(true);
    try {
      const created = await addCategory(name, kindType);
      setForm((f) => ({ ...f, category: created.name }));
      setNewCat('');
      toast.success(t('tx.categoryAdded', { name: created.name }));
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    } finally {
      setAddingCat(false);
    }
  }

  function explain(err) {
    const msg = err?.message || '';
    if (msg.includes('PERIOD_LOCKED')) return t('tx.periodLocked');
    return msg || t('settings.saveFailed');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const amount = Math.abs(parseFloat(form.amount));
    if (!amount || Number.isNaN(amount)) { toast.error(t('tx.amountRequired')); return; }
    if (!form.category || form.category === NEW_CATEGORY) { toast.error(t('tx.categoryRequired')); return; }
    const description = form.description.trim();
    if (!description) { toast.error(t('tx.descriptionRequired')); return; }

    const payload = {
      date: form.date,
      description,
      supplier: description,
      amount,
      type: form.kind === 'in' ? 'credit' : 'debit',
      category: form.category,
    };

    setSaving(true);
    try {
      if (editingId) {
        await updateTransaction(editingId, payload);
        toast.success(t('tx.updated'));
      } else {
        await addTransaction({ ...payload, posted: true, user_id: user?.id || null });
        toast.success(form.kind === 'in' ? t('tx.savedIn') : t('tx.savedOut'));
      }
      const kind = form.kind;
      setEditingId(null);
      setForm({ ...emptyForm(kind), date: form.date });   // keep the date for the next entry
      const target = startOfMonth(parseISO(form.date));
      if (target.getTime() !== month.getTime()) setMonth(target); else await load();
    } catch (err) {
      toast.error(explain(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteTransaction(id);
      setConfirmId(null);
      if (editingId === id) cancelEdit();
      toast.success(t('tx.deleted'));
      await load();
    } catch (err) {
      toast.error(explain(err));
    }
  }

  function exportCsv() {
    const header = [t('dash.date'), t('dash.description'), t('dash.category'), t('tx.moneyIn'), t('tx.moneyOut')];
    const lines = [header, ...rows.map((r) => [
      r.date,
      r.description || '',
      r.category || '',
      creditOf(r) ? creditOf(r).toFixed(2) : '',
      debitOf(r) ? debitOf(r).toFixed(2) : '',
    ])].map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selric-transactions-${format(month, 'yyyy-MM')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isIn = form.kind === 'in';

  return (
    <div className="animate-fade-in">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="page-title">{t('tx.title')}</h1>
          <p className="text-surface-500 text-sm mt-1">{t('tx.subtitle')}</p>
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
          <button type="button" onClick={() => setShowCats(true)} className="btn-secondary px-3 py-2 text-sm" title={t('cats.title')}>
            <Tags size={16} /> {t('cats.button')}
          </button>
          <button type="button" onClick={exportCsv} disabled={!rows.length} className="btn-secondary px-3 py-2 text-sm">
            <Download size={16} /> CSV
          </button>
        </div>
      </div>
      <CategoriesManager open={showCats} onClose={() => { setShowCats(false); load(); }} />

      {/* ── Month totals ─────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm text-surface-500"><ArrowDownLeft size={15} className="text-brand-600" /> {t('tx.moneyIn')}</div>
          <div className="stat-value mt-2 text-brand-700">{formatCurrency(totals.moneyIn)}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm text-surface-500"><ArrowUpRight size={15} className="text-surface-500" /> {t('tx.moneyOut')}</div>
          <div className="stat-value mt-2">{formatCurrency(totals.moneyOut)}</div>
        </div>
        <div className={cn('rounded-xl border p-5', totals.net < 0 ? 'bg-red-50 border-red-100' : 'bg-brand-950 border-brand-950 text-white')}>
          <div className={cn('text-sm', totals.net < 0 ? 'text-red-700' : 'text-brand-200')}>{t('tx.net')}</div>
          <div className={cn('font-mono text-2xl font-medium mt-2', totals.net < 0 ? 'text-red-700' : 'text-white')}>{formatCurrency(totals.net)}</div>
        </div>
      </div>

      {/* ── Quick add / edit ─────────────────────────────────────────── */}
      <section className={cn('card mt-6 p-5 transition-colors', editingId && 'border-brand-400 ring-2 ring-brand-500/15')}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="section-title">{editingId ? t('tx.editTitle') : t('tx.addTitle')}</h2>
          <div className="inline-flex rounded-lg bg-surface-100 p-1" role="radiogroup" aria-label={t('tx.kind')}>
            {['out', 'in'].map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={form.kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors',
                  form.kind === k ? 'bg-white shadow-sm text-brand-900' : 'text-surface-600 hover:text-surface-900'
                )}
              >
                {k === 'in' ? <ArrowDownLeft size={15} className="text-brand-600" /> : <ArrowUpRight size={15} />}
                {k === 'in' ? t('tx.moneyIn') : t('tx.moneyOut')}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-2 lg:grid-cols-12 gap-3">
          <div className="col-span-1 lg:col-span-2">
            <label htmlFor="tx-date" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('dash.date')}</label>
            <input id="tx-date" type="date" value={form.date} onChange={set('date')} className="input-field" required />
          </div>
          <div className="col-span-1 lg:col-span-2">
            <label htmlFor="tx-amount" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('dash.amount')}</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 text-sm">$</span>
              <input id="tx-amount" type="number" inputMode="decimal" step="0.01" min="0.01" value={form.amount} onChange={set('amount')}
                className="input-field pl-7 font-mono" placeholder="0.00" required />
            </div>
          </div>
          <div className="col-span-2 lg:col-span-3">
            <label htmlFor="tx-desc" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('dash.description')}</label>
            <input id="tx-desc" type="text" value={form.description} onChange={set('description')} className="input-field"
              placeholder={isIn ? t('tx.descPlaceholderIn') : t('tx.descPlaceholderOut')} required />
          </div>
          <div className="col-span-2 lg:col-span-3">
            <label htmlFor="tx-cat" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('dash.category')}</label>
            {form.category === NEW_CATEGORY ? (
              <div className="flex gap-2">
                <input
                  type="text" value={newCat} onChange={(e) => setNewCat(e.target.value)} className="input-field"
                  placeholder={t('tx.newCategoryPlaceholder')} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } }}
                />
                <button type="button" onClick={handleAddCategory} disabled={addingCat || !newCat.trim()} className="btn-primary px-3 shrink-0" aria-label={t('tx.addCategory')}>
                  {addingCat ? <Spinner size="sm" className="text-white" /> : <Check size={16} />}
                </button>
                <button type="button" onClick={() => { setForm((f) => ({ ...f, category: '' })); setNewCat(''); }} className="btn-ghost px-2 shrink-0" aria-label={t('common.cancel')}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <select id="tx-cat" value={form.category} onChange={set('category')} className="input-field" required>
                <option value="">{t('tx.chooseCategory')}</option>
                {categoryOptions.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                {form.category && !categoryOptions.some((c) => c.name === form.category) && (
                  <option value={form.category}>{form.category}</option>
                )}
                <option value={NEW_CATEGORY}>{t('tx.newCategoryOption')}</option>
              </select>
            )}
          </div>
          <div className="col-span-2 lg:col-span-2 flex items-end gap-2">
            <button type="submit" disabled={saving} className={cn('btn-primary w-full px-3', !isIn && 'bg-brand-900 hover:bg-brand-950')}>
              {saving ? <Spinner size="sm" className="text-white" /> : editingId ? <Check size={16} /> : <Plus size={16} />}
              {editingId ? t('common.save') : t('tx.add')}
            </button>
            {editingId && (
              <button type="button" onClick={cancelEdit} className="btn-ghost px-2.5" aria-label={t('common.cancel')}><X size={16} /></button>
            )}
          </div>
        </form>
      </section>

      {/* ── List ─────────────────────────────────────────────────────── */}
      <section className="card mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-b border-surface-200">
          <h2 className="section-title">
            {monthLabel} <span className="text-surface-400 font-sans text-sm">· {tn('tx.count', rows.length)}</span>
          </h2>
          <div className="relative sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9 py-2 text-sm" placeholder={t('tx.search')} />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 px-5 py-10 text-sm text-surface-500"><Spinner size="sm" /> {t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center"><Plus size={22} /></div>
            <p className="font-display text-xl text-brand-950 mt-4">{t('tx.emptyTitle', { month: rawMonthLabel })}</p>
            <p className="text-sm text-surface-600 mt-1">{t('tx.emptyBody')}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-surface-500">{t('tx.noMatches')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="table-header">{t('dash.date')}</th>
                  <th className="table-header">{t('dash.description')}</th>
                  <th className="table-header">{t('dash.category')}</th>
                  <th className="table-header text-right">{t('dash.amount')}</th>
                  <th className="table-header w-24"><span className="sr-only">{t('tx.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const locked = isLocked(r);
                  const credit = r.type === 'credit';
                  return (
                    <tr key={r.id} className={cn('border-b border-surface-50 transition group', editingId === r.id ? 'bg-brand-50/60' : 'hover:bg-surface-50')}>
                      <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="table-cell font-medium text-surface-900 max-w-[18rem] truncate" title={r.description}>{r.description || '—'}</td>
                      <td className="table-cell">{r.category ? <span className="badge-green">{r.category}</span> : <span className="text-surface-400">—</span>}</td>
                      <td className={cn('table-cell text-right font-mono whitespace-nowrap', credit ? 'text-brand-700' : 'text-surface-800')}>
                        {credit ? '+' : '−'}{formatCurrency(Math.abs(r.amount))}
                      </td>
                      <td className="table-cell text-right whitespace-nowrap">
                        {locked ? (
                          isSale(r) ? (
                            <Link to="/sales" className="inline-flex items-center gap-1 text-xs text-surface-400 hover:text-brand-700" title={t('tx.saleHint')}>
                              <ShoppingBag size={13} /> {t('tx.saleTag')}
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-surface-400" title={t('tx.lockedHint')}><Lock size={13} /></span>
                          )
                        ) : confirmId === r.id ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span className="text-surface-600">{t('tx.deleteConfirm')}</span>
                            <button type="button" onClick={() => handleDelete(r.id)} className="rounded px-2 py-1 bg-red-600 text-white hover:bg-red-700">{t('tx.yes')}</button>
                            <button type="button" onClick={() => setConfirmId(null)} className="rounded px-2 py-1 bg-surface-100 text-surface-700 hover:bg-surface-200">{t('tx.no')}</button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button type="button" onClick={() => startEdit(r)} className="p-1.5 rounded text-surface-500 hover:text-brand-700 hover:bg-brand-50" aria-label={t('tx.edit')}><Pencil size={15} /></button>
                            <button type="button" onClick={() => setConfirmId(r.id)} className="p-1.5 rounded text-surface-500 hover:text-red-600 hover:bg-red-50" aria-label={t('tx.delete')}><Trash2 size={15} /></button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
