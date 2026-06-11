import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import { isBalanceSheetType, debitOf, creditOf } from '../../lib/finance';
import {
  postOpeningJE,
  findExistingOpeningJE,
  OPENING_REFERENCE,
  OPENING_EXPECTED_TOTAL,
  OPENING_LINES,
  OPENING_DATE,
  sumDebits,
  sumCredits,
} from '../../lib/openingBalances';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Plus, ChevronDown, ChevronRight, Edit3, Archive, RotateCcw,
  Search, BookOpen, ArrowRightLeft, Loader2, CheckCircle2, AlertCircle, X,
} from 'lucide-react';

const SECTION_ORDER  = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const SECTION_LABELS = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Revenue', expense: 'Expenses' };

// ──────────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────────
export default function AccountsPage() {
  const { user } = useAuth();
  const { categories, addCategory, refresh, loading: dataLoading } = useData();

  // YTD posted transactions — single fetch on mount, drives balances and counts.
  const [txns, setTxns]                 = useState([]);
  const [txnState, setTxnState]         = useState('loading'); // loading | error | ready
  const [txnError, setTxnError]         = useState(null);

  // Opening-JE existence — single fetch on mount.
  const [openingJE, setOpeningJE]       = useState(null);
  const [openingChecking, setOpeningChecking] = useState(true);

  // UI state.
  const [search, setSearch]             = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed]       = useState(() => new Set());
  const [selected, setSelected]         = useState(null);
  const [editingId, setEditingId]       = useState(null);
  const [editName, setEditName]         = useState('');
  const [busy, setBusy]                 = useState(false);
  const [adding, setAdding]             = useState(false);
  const [newForm, setNewForm]           = useState({ name: '', type: 'expense' });
  const [mergeFrom, setMergeFrom]       = useState(null);
  const [openingOpen, setOpeningOpen]   = useState(false);

  const loadTxns = useCallback(() => {
    const year  = new Date().getFullYear();
    const start = `${year}-01-01`;
    const end   = `${year}-12-31`;
    setTxnState('loading');
    setTxnError(null);
    supabase.from('transactions')
      .select('category, amount, type')
      .gte('date', start).lte('date', end).eq('posted', true).eq('voided', false)
      .then(({ data, error }) => {
        if (error) { setTxnError(error); setTxnState('error'); return; }
        setTxns(data || []);
        setTxnState('ready');
      });
  }, []);

  useEffect(() => { loadTxns(); }, [loadTxns]);

  useEffect(() => {
    setOpeningChecking(true);
    findExistingOpeningJE()
      .then(je => setOpeningJE(je))
      .catch(() => {})
      .finally(() => setOpeningChecking(false));
  }, []);

  // Aggregate balances + counts per category name.
  const ytdByCategory = useMemo(() => {
    const map = new Map();
    for (const t of txns) {
      if (!t.category) continue;
      const e = map.get(t.category) || { count: 0, debit: 0, credit: 0 };
      e.count++;
      e.debit  += debitOf(t);
      e.credit += creditOf(t);
      map.set(t.category, e);
    }
    return map;
  }, [txns]);

  function naturalBalance(type, entry) {
    if (!entry) return 0;
    const debitNatural = (type === 'asset' || type === 'expense');
    return debitNatural ? entry.debit - entry.credit : entry.credit - entry.debit;
  }

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = { asset: [], liability: [], equity: [], revenue: [], expense: [] };
    for (const c of categories) {
      if (!showArchived && c.archived) continue;
      if (q && !c.name.toLowerCase().includes(q)) continue;
      const type  = (c.type || 'expense').toLowerCase();
      const bucket = groups[type];
      if (!bucket) continue;
      const entry = ytdByCategory.get(c.name);
      bucket.push({
        id:       c.id,
        name:     c.name,
        type,
        archived: !!c.archived,
        balance:  naturalBalance(type, entry),
        count:    entry?.count || 0,
        gross:    (entry?.debit || 0) + (entry?.credit || 0),
      });
    }
    for (const [type, rows] of Object.entries(groups)) {
      if (type === 'expense') {
        rows.sort((a, b) => b.count - a.count || b.gross - a.gross || a.name.localeCompare(b.name));
      } else {
        rows.sort((a, b) => a.name.localeCompare(b.name));
      }
    }
    return SECTION_ORDER.map(type => ({
      type,
      label: SECTION_LABELS[type],
      rows:  groups[type],
      total: groups[type].reduce((s, r) => s + r.balance, 0),
    })).filter(s => s.rows.length > 0);
  }, [categories, ytdByCategory, search, showArchived]);

  function toggleSection(type) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  // Rename = update category name + cascade to txns and JE lines.
  async function commitRename(cat) {
    const newName = editName.trim();
    if (!newName || newName === cat.name) { setEditingId(null); return; }
    setBusy(true);
    try {
      const collide = categories.find(c => c.id !== cat.id && c.name === newName);
      if (collide) throw new Error(`A category named "${newName}" already exists. Use Merge instead.`);
      const { error: e1 } = await supabase.from('categories').update({ name: newName }).eq('id', cat.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('transactions').update({ category: newName }).eq('category', cat.name);
      if (e2) throw e2;
      const { error: e3 } = await supabase.from('journal_entry_lines').update({ category: newName }).eq('category', cat.name);
      if (e3) throw e3;
      await refresh?.();
      setTxns(prev => prev.map(t => t.category === cat.name ? { ...t, category: newName } : t));
      toast.success(`Renamed to ${newName}`);
    } catch (err) {
      toast.error(err.message || 'Rename failed');
    } finally {
      setBusy(false);
      setEditingId(null);
    }
  }

  async function archiveCategory(cat, archive = true) {
    setBusy(true);
    try {
      const { error } = await supabase.from('categories').update({ archived: archive }).eq('id', cat.id);
      if (error) throw error;
      await refresh?.();
      toast.success(archive ? `Archived "${cat.name}"` : `Restored "${cat.name}"`);
    } catch (err) {
      toast.error(err.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!newForm.name.trim()) { toast.error('Name required'); return; }
    setBusy(true);
    try {
      await addCategory(newForm.name.trim(), newForm.type);
      toast.success('Created');
      setAdding(false);
      setNewForm({ name: '', type: 'expense' });
    } catch (err) {
      toast.error(err.message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            {categories.filter(c => !c.archived).length} active accounts
            {categories.some(c => c.archived) && ` · ${categories.filter(c => c.archived).length} archived`}
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> New Account
        </button>
      </div>

      <OpeningBalancesBar
        openingJE={openingJE}
        checking={openingChecking}
        onClick={() => setOpeningOpen(true)}
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search accounts..." className="input-field pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm text-surface-600 cursor-pointer select-none">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {dataLoading || txnState === 'loading' ? (
        <div className="flex justify-center py-10"><Spinner size="lg" /></div>
      ) : txnState === 'error' ? (
        <div className="card p-5 border-red-200 bg-red-50 text-sm text-red-700">
          Could not load transactions: {txnError?.message || 'unknown error'}.
          <button onClick={loadTxns} className="ml-3 underline">Retry</button>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map(section => (
            <SectionGroup
              key={section.type}
              section={section}
              collapsed={collapsed.has(section.type)}
              onToggle={() => toggleSection(section.type)}
              onRowClick={setSelected}
              editingId={editingId}
              editName={editName}
              setEditName={setEditName}
              onStartRename={(row) => { setEditingId(row.id); setEditName(row.name); }}
              onCancelRename={() => setEditingId(null)}
              onCommitRename={commitRename}
              onArchive={archiveCategory}
              onMerge={(row) => setMergeFrom(row)}
              busy={busy}
            />
          ))}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="New Account">
        <form onSubmit={handleAdd} className="space-y-4 p-1">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Name</label>
            <input value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} className="input-field" placeholder="e.g. Bar Supplies" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Type</label>
            <select value={newForm.type} onChange={e => setNewForm({ ...newForm, type: e.target.value })} className="input-field">
              {SECTION_ORDER.map(t => <option key={t} value={t}>{SECTION_LABELS[t]}</option>)}
            </select>
            {isBalanceSheetType(newForm.type) && (
              <div className="text-xs text-surface-500 mt-1.5">
                Balance-sheet categories are hidden from transaction dropdowns. Use them in journal entries.
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAdding(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <MergeModal
        from={mergeFrom}
        categories={categories}
        onClose={() => setMergeFrom(null)}
        onDone={async () => { await refresh?.(); loadTxns(); setMergeFrom(null); }}
      />

      <OpeningBalancesModal
        open={openingOpen}
        onClose={() => setOpeningOpen(false)}
        existing={openingJE}
        userId={user?.id}
        categories={categories}
        addCategory={addCategory}
        onPosted={async () => {
          const je = await findExistingOpeningJE();
          setOpeningJE(je);
          await refresh?.();
          loadTxns();
        }}
      />

      <LedgerDrawer category={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Opening Balances bar — sits at the top of the page.
// ──────────────────────────────────────────────────────────────────────────────
function OpeningBalancesBar({ openingJE, checking, onClick }) {
  if (checking) {
    return (
      <div className="card p-3 mb-4 flex items-center justify-between bg-surface-50">
        <div className="text-sm text-surface-500 flex items-center gap-2"><Spinner size="sm" /> Checking opening balances…</div>
      </div>
    );
  }
  if (openingJE) {
    return (
      <div className="card p-3 mb-4 flex items-center justify-between bg-green-50 border-green-200">
        <div className="flex items-center gap-3 text-sm">
          <CheckCircle2 size={16} className="text-green-600" />
          <span>
            <span className="font-semibold">Opening balances posted</span>
            <span className="text-surface-500"> · {OPENING_REFERENCE} · {formatCurrency(openingJE.total_amount)}</span>
          </span>
        </div>
        <button onClick={onClick} className="btn-ghost text-xs">Review / Replace</button>
      </div>
    );
  }
  return (
    <div className="card p-3 mb-4 flex items-center justify-between bg-amber-50 border-amber-200">
      <div className="flex items-center gap-3 text-sm">
        <AlertCircle size={16} className="text-amber-700" />
        <span>
          <span className="font-semibold">Opening balances not yet posted.</span>
          <span className="text-surface-600"> Required so the Balance Sheet starts from the CPA's 12/31/2023 numbers.</span>
        </span>
      </div>
      <button onClick={onClick} className="btn-primary text-xs">Post Opening Balances</button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Collapsible section
// ──────────────────────────────────────────────────────────────────────────────
function SectionGroup({ section, collapsed, onToggle, onRowClick, editingId, editName, setEditName, onStartRename, onCancelRename, onCommitRename, onArchive, onMerge, busy }) {
  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-50 transition">
        <div className="flex items-center gap-3">
          {collapsed ? <ChevronRight size={16} className="text-surface-400" /> : <ChevronDown size={16} className="text-surface-400" />}
          <span className="font-display text-base">{section.label}</span>
          <span className="text-xs text-surface-400">{section.rows.length} {section.rows.length === 1 ? 'account' : 'accounts'}</span>
        </div>
        <div className="text-xs text-surface-500">
          <span className="uppercase tracking-wider mr-2">YTD</span>
          <span className={`font-mono font-semibold ${section.total >= 0 ? 'text-surface-800' : 'text-red-600'}`}>{formatCurrency(section.total)}</span>
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-surface-100">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-surface-400 bg-surface-50/50">
                <th className="px-5 py-2">Account</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">YTD balance</th>
                <th className="px-3 py-2 text-right">Txns</th>
                <th className="px-3 py-2 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map(row => (
                <AccountRow
                  key={row.id}
                  row={row}
                  isEditing={editingId === row.id}
                  editName={editName}
                  setEditName={setEditName}
                  onClick={() => onRowClick(row)}
                  onStartRename={() => onStartRename(row)}
                  onCancelRename={onCancelRename}
                  onCommitRename={onCommitRename}
                  onArchive={onArchive}
                  onMerge={() => onMerge(row)}
                  busy={busy}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AccountRow({ row, isEditing, editName, setEditName, onClick, onStartRename, onCancelRename, onCommitRename, onArchive, onMerge, busy }) {
  return (
    <tr className={`border-t border-surface-50 hover:bg-surface-50 ${row.archived ? 'opacity-60' : ''}`}>
      <td className="px-5 py-2.5">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onCommitRename(row);
                if (e.key === 'Escape') onCancelRename();
              }}
              className="input-field h-8 text-sm"
              autoFocus
            />
            <button onClick={() => onCommitRename(row)} disabled={busy} className="btn-ghost p-1.5 text-green-600"><CheckCircle2 size={14} /></button>
            <button onClick={onCancelRename} className="btn-ghost p-1.5 text-surface-400"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={onClick} className="text-sm font-medium hover:text-brand-700 text-left">
            {row.name}
            {row.archived && <span className="ml-2 text-[10px] uppercase tracking-wider text-surface-400">archived</span>}
          </button>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-surface-500 capitalize">{row.type}</td>
      <td className={`px-3 py-2.5 text-right font-mono text-sm ${row.balance < 0 ? 'text-red-600' : 'text-surface-800'}`}>
        {formatCurrency(row.balance)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs text-surface-500">{row.count}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1 text-surface-400">
          {!isEditing && (
            <>
              <button onClick={onStartRename} title="Rename" className="p-1.5 hover:text-brand-600"><Edit3 size={13} /></button>
              <button onClick={onMerge} title="Merge into another" className="p-1.5 hover:text-brand-600"><ArrowRightLeft size={13} /></button>
              {row.archived ? (
                <button onClick={() => onArchive(row, false)} title="Restore" className="p-1.5 hover:text-green-600"><RotateCcw size={13} /></button>
              ) : (
                <button onClick={() => onArchive(row, true)} title="Archive" className="p-1.5 hover:text-amber-600"><Archive size={13} /></button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Merge modal — confirm + reassign + archive A
// ──────────────────────────────────────────────────────────────────────────────
function MergeModal({ from, categories, onClose, onDone }) {
  const [intoId, setIntoId]   = useState('');
  const [counts, setCounts]   = useState(null); // { txns, lines } or null = not loaded yet
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    if (!from) { setIntoId(''); setCounts(null); return; }
    setCounts(null);
    (async () => {
      const [txnRes, lineRes] = await Promise.all([
        supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('category', from.name).eq('voided', false),
        supabase.from('journal_entry_lines').select('id', { count: 'exact', head: true }).eq('category', from.name),
      ]);
      setCounts({ txns: txnRes.count || 0, lines: lineRes.count || 0 });
    })();
  }, [from]);

  const candidates = useMemo(() => {
    if (!from) return [];
    return categories
      .filter(c => c.id !== from.id && !c.archived && (c.type || '').toLowerCase() === from.type)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [from, categories]);

  async function doMerge() {
    if (!from || !intoId) return;
    const into = categories.find(c => c.id === intoId);
    if (!into) return;
    if (!confirm(`Reassign ${counts?.txns || 0} transactions and ${counts?.lines || 0} journal lines from "${from.name}" into "${into.name}", then archive "${from.name}"?`)) return;
    setBusy(true);
    try {
      const { error: e1 } = await supabase.from('transactions').update({ category: into.name }).eq('category', from.name);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('journal_entry_lines').update({ category: into.name }).eq('category', from.name);
      if (e2) throw e2;
      const { error: e3 } = await supabase.from('categories').update({ archived: true }).eq('id', from.id);
      if (e3) throw e3;
      toast.success(`Merged "${from.name}" into "${into.name}"`);
      await onDone();
    } catch (err) {
      toast.error(err.message || 'Merge failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!from} onClose={onClose} title="Merge category">
      {from && (
        <div className="space-y-4 p-1">
          <div className="text-sm">
            Merge <span className="font-semibold">"{from.name}"</span> ({from.type}) into another {from.type} category.
            All transactions and journal lines move; the source category is archived.
          </div>
          <div className="text-xs text-surface-500">
            {counts === null ? 'Counting affected rows…' : <>Affected: <span className="font-mono">{counts.txns}</span> transactions, <span className="font-mono">{counts.lines}</span> journal lines.</>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Merge into</label>
            <select value={intoId} onChange={e => setIntoId(e.target.value)} className="input-field">
              <option value="">— Choose target —</option>
              {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {candidates.length === 0 && (
              <div className="text-xs text-amber-700 mt-1.5">No other active {from.type} categories to merge into.</div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={doMerge} disabled={!intoId || busy} className="btn-primary flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}
              Merge
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Opening Balances modal — review then post / replace
// ──────────────────────────────────────────────────────────────────────────────
function OpeningBalancesModal({ open, onClose, existing, userId, categories, addCategory, onPosted }) {
  const [busy, setBusy] = useState(false);
  const dr = sumDebits(OPENING_LINES);
  const cr = sumCredits(OPENING_LINES);

  async function doPost() {
    const replace = !!existing;
    if (replace && !confirm(`Replace existing ${OPENING_REFERENCE} (${formatCurrency(existing.total_amount)})? Old entries will be deleted before posting fresh.`)) return;
    setBusy(true);
    try {
      const res = await postOpeningJE({ userId, existingCategories: categories, addCategory, replace });
      if (!res.posted && res.existing) {
        toast.error('JE-OPENING already exists. Use Replace.');
        return;
      }
      toast.success(replace ? `Replaced ${OPENING_REFERENCE} — ${formatCurrency(res.total)}` : `Posted ${OPENING_REFERENCE} — ${formatCurrency(res.total)}`);
      await onPosted?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to post opening balances');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Opening Balances">
      <div className="space-y-4 p-1">
        <p className="text-sm text-surface-600">
          One journal entry, dated <span className="font-mono">{OPENING_DATE}</span>, captures the 12/31/2023 closing balance sheet
          so the books open clean on Jan 1, 2024. P&L is not affected — only asset/liability/equity categories move.
        </p>

        <div className="rounded-lg border border-surface-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-[10px] uppercase tracking-wider text-surface-500">
              <tr>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {OPENING_LINES.map(l => (
                <tr key={l.category} className="border-t border-surface-50">
                  <td className="px-3 py-1.5">{l.category}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{l.debit ? formatCurrency(l.debit) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{l.credit ? formatCurrency(l.credit) : ''}</td>
                </tr>
              ))}
              <tr className="bg-surface-50 font-semibold">
                <td className="px-3 py-1.5">Totals</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(dr)}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(cr)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className={`text-xs ${Math.abs(dr - cr) < 0.005 ? 'text-green-700' : 'text-red-700'}`}>
          {Math.abs(dr - cr) < 0.005
            ? `Balanced · ${formatCurrency(dr)} = ${formatCurrency(cr)} (asserted before any insert)`
            : `IMBALANCE · ${formatCurrency(dr)} ≠ ${formatCurrency(cr)} — refusing to post`}
        </div>

        {existing && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-amber-900">{OPENING_REFERENCE} already posted</div>
              <div className="text-xs text-amber-800 mt-0.5">
                Total {formatCurrency(existing.total_amount)} · dated {formatDate(existing.date)}. Posting again will replace, not stack.
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={doPost} disabled={busy || Math.abs(dr - cr) >= 0.005} className="btn-primary flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {existing ? 'Replace & Post' : 'Post Opening Balances'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Ledger drawer — lazy-loaded transactions for the clicked category
// ──────────────────────────────────────────────────────────────────────────────
function LedgerDrawer({ category, onClose }) {
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const [rows, setRows]   = useState([]);
  const [err, setErr]     = useState(null);

  useEffect(() => {
    if (!category) { setState('idle'); setRows([]); return; }
    setState('loading');
    const year = new Date().getFullYear();
    supabase.from('transactions')
      .select('id, date, description, supplier, amount, type, reference')
      .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
      .eq('category', category.name).eq('posted', true).eq('voided', false)
      .order('date', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErr(error); setState('error'); return; }
        setRows(data || []);
        setState('ready');
      });
  }, [category]);

  if (!category) return null;

  const totalDebit  = rows.reduce((s, t) => s + debitOf(t),  0);
  const totalCredit = rows.reduce((s, t) => s + creditOf(t), 0);

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-brand-600 font-semibold">YTD Ledger</div>
            <h3 className="font-display text-lg">{category.name}</h3>
            <div className="text-xs text-surface-500 mt-0.5 capitalize">{category.type}</div>
          </div>
          <button onClick={onClose} className="btn-ghost p-2"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {state === 'loading' && <div className="flex justify-center py-10"><Spinner size="lg" /></div>}
          {state === 'error'   && <div className="p-5 text-sm text-red-700">Failed to load: {err?.message || 'unknown'}</div>}
          {state === 'ready'   && (
            rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-surface-400">No transactions YTD.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-50 text-[10px] uppercase tracking-wider text-surface-500">
                  <tr>
                    <th className="px-5 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(t => (
                    <tr key={t.id} className="border-t border-surface-50">
                      <td className="px-5 py-2 font-mono text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="px-3 py-2 text-xs">
                        {t.supplier || t.description || '—'}
                        {t.reference && <span className="ml-2 font-mono text-[10px] text-surface-400">{t.reference}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{t.type === 'debit'  ? formatCurrency(Math.abs(t.amount)) : ''}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{t.type === 'credit' ? formatCurrency(Math.abs(t.amount)) : ''}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface-50 font-semibold">
                    <td className="px-5 py-2 text-xs uppercase tracking-wider" colSpan={2}>Subtotal · {rows.length} txn{rows.length === 1 ? '' : 's'}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(totalDebit)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(totalCredit)}</td>
                  </tr>
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}
