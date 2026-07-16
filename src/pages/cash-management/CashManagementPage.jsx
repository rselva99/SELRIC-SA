import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useData } from '../../contexts/DataContext';
import { postJournalEntry } from '../../lib/postJournalEntry';
import { formatCurrency } from '../../lib/utils';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Landmark, AlertTriangle, CheckCircle2, ChevronDown, Search, Filter,
  RotateCcw, Trash2, DollarSign, Ban, BookOpen, CornerDownLeft,
} from 'lucide-react';

// Cash Management page — check register + classification workflow.
// See docs/CHECKS_RUN_LOG.md for the design contract.
//
// Three outcomes per unclassified check:
//   A. Expense        — pick expense category + description → post JE
//   B. Balance Sheet  — pick asset/liability/equity account → post JE
//   C. Already recorded — optional note → no JE, status='excluded'
//
// Undo paths:
//   Excluded  → reset to unclassified (no ledger touch)
//   Classified → void the tagged JE then reset to unclassified
//
// Keyboard: Enter submits the active inline form.

async function fetchAllChecks() {
  const out = [];
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('checks')
      .select('*')
      .order('check_no', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < CHUNK) break;
  }
  return out;
}

// ── Outcome helpers ───────────────────────────────────────────────────────────

// Build description + memo strings per spec.
function buildJEDescription(checkNo, categoryName, userDesc) {
  return `Check #${checkNo} — ${categoryName}: ${userDesc}`;
}
function buildJEMemo(outcome, sourceStatement, userDesc) {
  const label = outcome === 'expense' ? 'Expense' : 'Balance Sheet';
  return `Cash Management classification (${label}): ${sourceStatement} · ${userDesc}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CashManagementPage() {
  const { categories = [] } = useData() || {};

  const [checks, setChecks]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState('unclassified');
  const [monthFilter, setMonthFilter]   = useState('all');
  const [search, setSearch]             = useState('');
  const [selected, setSelected]         = useState(new Set());
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [posting, setPosting]           = useState(false);

  // Inline form state: { id, outcome } | null
  // outcome ∈ 'expense' | 'balance' | 'excluded' | null (none open)
  const [inlineForm, setInlineForm] = useState(null);

  // ── Data load ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchAllChecks();
      setChecks(rows);
    } catch (e) {
      const missingTable =
        /relation.*"?public\.checks"?/i.test(e.message || '') ||
        /schema cache/i.test(e.message || '') ||
        /42P01/i.test(e.code || '');
      if (missingTable) {
        toast.error(
          'Checks table not found. Apply migrations/2026-07-15-checks-table.sql, then reload.',
          { duration: 8000 },
        );
      } else {
        toast.error(`Load failed: ${e.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return checks.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (
        monthFilter !== 'all' &&
        (!c.clear_date || c.clear_date.slice(0, 7) !== monthFilter)
      ) return false;
      if (search) {
        const s = search.toLowerCase();
        if (
          !(
            c.check_no.toLowerCase().includes(s) ||
            (c.payee || '').toLowerCase().includes(s) ||
            String(c.amount).includes(s)
          )
        ) return false;
      }
      return true;
    });
  }, [checks, statusFilter, monthFilter, search]);

  const totals = useMemo(() => {
    const byStatus = s => checks.filter(c => c.status === s);
    const sum      = arr => arr.reduce((acc, c) => acc + Number(c.amount || 0), 0);

    const unclassified = byStatus('unclassified');
    const expense      = checks.filter(c => c.status === 'classified' && categories.find(cat => cat.id === c.account_id)?.type === 'expense');
    const balanceSheet = checks.filter(c => c.status === 'classified' && (() => { const t = categories.find(cat => cat.id === c.account_id)?.type; return ['asset','liability','equity'].includes(t); })());
    const excluded     = byStatus('excluded');
    const voided       = byStatus('voided');
    const classified   = byStatus('classified');

    return {
      unclassifiedCount:  unclassified.length,  unclassifiedTotal:  sum(unclassified),
      expenseCount:       expense.length,        expenseTotal:       sum(expense),
      balanceSheetCount:  balanceSheet.length,   balanceSheetTotal:  sum(balanceSheet),
      excludedCount:      excluded.length,       excludedTotal:      sum(excluded),
      classifiedCount:    classified.length,     classifiedTotal:    sum(classified),
      voidedCount:        voided.length,         voidedTotal:        sum(voided),
      grandCount:         checks.length,         grandTotal:         sum(checks),
    };
  }, [checks, categories]);

  const gaps = useMemo(() => {
    const nums = checks
      .map(c => parseInt(c.check_no))
      .filter(n => Number.isFinite(n) && n >= 1000 && n < 10000)
      .sort((a, b) => a - b);
    if (nums.length < 2) return { total: 0, ranges: [] };
    const lo = nums[0], hi = nums[nums.length - 1];
    const present = new Set(nums);
    const missing = [];
    for (let n = lo; n <= hi; n++) if (!present.has(n)) missing.push(n);
    const ranges = [];
    let a = missing[0], b = a;
    for (let i = 1; i < missing.length; i++) {
      if (missing[i] === b + 1) b = missing[i];
      else { ranges.push([a, b]); a = b = missing[i]; }
    }
    if (a !== undefined) ranges.push([a, b]);
    return { total: missing.length, ranges: ranges.slice(0, 30), lo, hi };
  }, [checks]);

  const months = useMemo(() => {
    const s = new Set();
    for (const c of checks) if (c.clear_date) s.add(c.clear_date.slice(0, 7));
    return [...s].sort();
  }, [checks]);

  const undatedCount = useMemo(() => checks.filter(c => !c.clear_date).length, [checks]);

  // ── Selection helpers ────────────────────────────────────────────────────────

  function toggle(id) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    const unclassifiedFiltered = filtered.filter(c => c.status === 'unclassified');
    if (selected.size === unclassifiedFiltered.length && unclassifiedFiltered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(unclassifiedFiltered.map(c => c.id)));
    }
  }

  const selectedRows = useMemo(() => checks.filter(c => selected.has(c.id)), [checks, selected]);
  const selectedSum  = selectedRows.reduce((s, c) => s + Number(c.amount || 0), 0);

  // ── Category buckets ─────────────────────────────────────────────────────────

  const expenseCats     = useMemo(() => categories.filter(c => !c.archived && c.type === 'expense'), [categories]);
  const balanceSheetCats = useMemo(() => categories.filter(c => !c.archived && ['asset','liability','equity'].includes(c.type)), [categories]);

  // ── Core action: post JE + update check (outcomes A and B) ──────────────────

  async function classifyOneWithJE(c, { outcome, categoryId, categoryName, userDesc, dateOverride }) {
    const clearDate = dateOverride || c.clear_date;
    if (!clearDate) throw new Error(`Check #${c.check_no}: no clear date`);

    const description = buildJEDescription(c.check_no, categoryName, userDesc);
    const memo        = buildJEMemo(outcome, c.source_statement, userDesc);

    const { entry_id } = await postJournalEntry({
      entry: {
        date:        clearDate,
        description,
        memo,
        entry_type:  'auto',
        status:      'posted',
        source_tag:  'checks',
      },
      lines: [
        { description: categoryName,  debit_amount: c.amount, credit_amount: 0,        category: categoryName  },
        { description: 'Cash & Bank', debit_amount: 0,        credit_amount: c.amount, category: 'Cash & Bank' },
      ],
      txns: [
        {
          description: `Check #${c.check_no} — ${categoryName}: ${userDesc}`,
          amount: c.amount, type: 'debit', category: categoryName,
          date: clearDate, supplier: c.payee || null,
        },
        {
          description: `[Cash leg] Check #${c.check_no}`,
          amount: c.amount, type: 'credit', category: 'Cash & Bank',
          date: clearDate, supplier: c.payee || null,
        },
      ],
    });

    const { error } = await supabase.from('checks').update({
      status:               'classified',
      account_id:           categoryId || null,
      classified_entry_id:  entry_id,
      clear_date:           clearDate,
      notes:                userDesc || null,
    }).eq('id', c.id);
    if (error) throw error;
  }

  // Outcome C: mark excluded without posting anything.
  async function classifyOneExcluded(c, { note }) {
    const { error } = await supabase.from('checks').update({
      status:     'excluded',
      notes:      note || null,
      account_id: null,
      classified_entry_id: null,
    }).eq('id', c.id);
    if (error) throw error;
  }

  // ── Undo ─────────────────────────────────────────────────────────────────────

  async function undoCheck(c) {
    if (c.status === 'excluded') {
      // Outcome C undo: simply reset — no ledger touch.
      const { error } = await supabase.from('checks').update({
        status: 'unclassified',
        notes:  null,
      }).eq('id', c.id);
      if (error) { toast.error(error.message); return; }
      toast.success(`Check #${c.check_no} reset to unclassified`);
      await load();
      return;
    }

    if (c.status === 'classified' && c.classified_entry_id) {
      // Void the JE (only 'checks'-tagged entries are ever voided this way).
      const { data: je } = await supabase
        .from('journal_entries')
        .select('source_tag')
        .eq('id', c.classified_entry_id)
        .single();
      if (je && je.source_tag !== 'checks') {
        toast.error(`JE ${c.classified_entry_id} has source_tag '${je.source_tag}' — refusing to void a non-checks entry.`);
        return;
      }
      const { error: jeErr } = await supabase
        .from('journal_entries')
        .update({ status: 'voided' })
        .eq('id', c.classified_entry_id);
      if (jeErr) { toast.error(`JE void failed: ${jeErr.message}`); return; }
      await supabase
        .from('transactions')
        .update({ voided: true })
        .eq('journal_entry_id', c.classified_entry_id);
      const { error: chkErr } = await supabase.from('checks').update({
        status: 'unclassified',
        classified_entry_id: null,
        account_id: null,
        notes: null,
      }).eq('id', c.id);
      if (chkErr) { toast.error(chkErr.message); return; }
      toast.success(`Check #${c.check_no} classification reversed`);
      await load();
      return;
    }

    toast.error(`Check #${c.check_no} has no reversible classification.`);
  }

  // ── Void (hard-void — remove from register) ──────────────────────────────────

  async function voidCheck(c) {
    if (!confirm(`Void check #${c.check_no}?`)) return;
    if (c.status === 'classified' && c.classified_entry_id) {
      if (!confirm(`Check #${c.check_no} was classified. Voiding will also mark the classification journal entry as voided. Continue?`)) return;
      const { error } = await supabase
        .from('journal_entries')
        .update({ status: 'voided' })
        .eq('id', c.classified_entry_id);
      if (error) { toast.error(`JE void failed: ${error.message}`); return; }
      await supabase
        .from('transactions')
        .update({ voided: true })
        .eq('journal_entry_id', c.classified_entry_id);
    }
    if (c.status === 'unclassified') {
      const { error } = await supabase.from('checks').delete().eq('id', c.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('checks').update({
        status: 'voided',
        classified_entry_id: null,
      }).eq('id', c.id);
      if (error) { toast.error(error.message); return; }
    }
    toast.success(`Check #${c.check_no} voided`);
    await load();
  }

  // ── Bulk classify (modal) ─────────────────────────────────────────────────────

  async function classifySelection({ outcome, categoryName, categoryId, userDesc, dateOverride }) {
    if (selectedRows.length === 0) return;
    setPosting(true);
    let ok = 0, fail = 0;

    for (const c of selectedRows) {
      if (c.status !== 'unclassified') continue;
      try {
        if (outcome === 'excluded') {
          await classifyOneExcluded(c, { note: userDesc });
        } else {
          await classifyOneWithJE(c, { outcome, categoryId, categoryName, userDesc, dateOverride });
        }
        ok++;
      } catch (e) {
        fail++;
        toast.error(`#${c.check_no}: ${(e.message || '').slice(0, 80)}`);
      }
    }

    setPosting(false);
    setClassifyOpen(false);
    setSelected(new Set());
    await load();

    if (ok) {
      const label = outcome === 'excluded' ? 'excluded' : `classified to ${categoryName}`;
      toast.success(`${ok} check${ok === 1 ? '' : 's'} ${label}`);
    }
    if (fail) toast.error(`${fail} failed — see errors above`);
  }

  // ── Inline form submit ─────────────────────────────────────────────────────────

  async function submitInlineForm(c, formData) {
    setPosting(true);
    try {
      if (formData.outcome === 'excluded') {
        await classifyOneExcluded(c, { note: formData.note });
        toast.success(`Check #${c.check_no} marked as already recorded`);
      } else {
        if (!formData.categoryName) throw new Error('Select an account');
        await classifyOneWithJE(c, formData);
        toast.success(`Check #${c.check_no} → ${formData.categoryName}`);
      }
      setInlineForm(null);
      await load();
    } catch (e) {
      toast.error(e.message || 'Failed');
    } finally {
      setPosting(false);
    }
  }

  // ── Early returns ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20"><Spinner /></div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="max-w-6xl mx-auto py-10 px-4">
        <div className="mb-6">
          <h1 className="text-2xl font-display font-bold text-surface-900 mb-1">Cash Management</h1>
          <p className="text-sm text-surface-500">Paid check register and classification workflow.</p>
        </div>
        <EmptyState
          icon={Landmark}
          title="No checks in the register yet"
          description="Load the check register from the parsed bank statements. See docs/CHECKS_RUN_LOG.md for the load script."
        />
      </div>
    );
  }

  const unclassifiedFilteredCount = filtered.filter(c => c.status === 'unclassified').length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">

      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-surface-900 mb-1">Cash Management</h1>
          <p className="text-sm text-surface-500">
            Paid check register. Each unclassified row needs one of three outcomes: Expense, Balance Sheet, or Already Recorded.
          </p>
        </div>
      </div>

      {/* Running tallies — always sum to grand total */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard
          label="Unclassified"
          value={totals.unclassifiedCount}
          sub={formatCurrency(totals.unclassifiedTotal)}
          tone={totals.unclassifiedCount > 0 ? 'warn' : 'ok'}
        />
        <StatCard
          label="Expense"
          value={totals.expenseCount}
          sub={formatCurrency(totals.expenseTotal)}
          tone="ok"
        />
        <StatCard
          label="Balance Sheet"
          value={totals.balanceSheetCount}
          sub={formatCurrency(totals.balanceSheetTotal)}
          tone="ok"
        />
        <StatCard
          label="Already recorded"
          value={totals.excludedCount}
          sub={formatCurrency(totals.excludedTotal)}
          tone="neutral"
        />
        <StatCard
          label="All checks"
          value={totals.grandCount}
          sub={formatCurrency(totals.grandTotal)}
          tone="neutral"
        />
      </div>

      {/* Gaps + undated panel */}
      {(gaps.total > 0 || undatedCount > 0) && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
            <div className="flex-1 text-sm text-amber-800">
              {gaps.total > 0 && (
                <div className="mb-1">
                  <b>{gaps.total}</b> missing check number{gaps.total === 1 ? '' : 's'} in the {gaps.lo}–{gaps.hi} sequence.
                  {gaps.ranges.length ? (
                    <> Ranges: {gaps.ranges.map(([a, b]) => a === b ? String(a) : `${a}–${b}`).join(', ')}{gaps.total > 30 ? ' …' : ''}</>
                  ) : null}
                </div>
              )}
              {undatedCount > 0 && (
                <div>
                  <b>{undatedCount}</b> check{undatedCount === 1 ? '' : 's'} without a clear date. These are blocked from monthly close until dated.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 text-sm">
          <Filter size={14} className="text-surface-400" />
          {['unclassified', 'classified', 'excluded', 'voided', 'all'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md text-sm ${statusFilter === s ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-700 hover:bg-surface-200'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <select
          value={monthFilter}
          onChange={e => setMonthFilter(e.target.value)}
          className="px-3 py-1.5 rounded-md text-sm border border-surface-200 bg-white"
        >
          <option value="all">All months</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-2.5 text-surface-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search check # / payee / amount"
            className="w-full pl-9 pr-3 py-1.5 rounded-md text-sm border border-surface-200"
          />
        </div>
        {selected.size > 0 && (
          <button
            onClick={() => setClassifyOpen(true)}
            className="px-4 py-1.5 rounded-md text-sm bg-brand-600 text-white hover:bg-brand-700 flex items-center gap-2"
          >
            <DollarSign size={14} />
            Bulk classify {selected.size} ({formatCurrency(selectedSum)})
          </button>
        )}
      </div>

      {/* Check register table */}
      <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-50 text-surface-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="p-3 w-8">
                <input
                  type="checkbox"
                  checked={unclassifiedFilteredCount > 0 && selected.size === unclassifiedFilteredCount}
                  onChange={toggleAll}
                  title="Select all unclassified in view"
                />
              </th>
              <th className="p-3 text-left">Check #</th>
              <th className="p-3 text-left">Clear date</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3 text-left">Payee</th>
              <th className="p-3 text-left">Assigned / Note</th>
              <th className="p-3 text-left">Source</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-6 text-center text-surface-500">
                  No checks match the filters.
                </td>
              </tr>
            ) : (
              filtered.slice(0, 500).map(c => {
                const assigned   = c.account_id ? categories.find(cat => cat.id === c.account_id)?.name : null;
                const isOpen     = inlineForm?.id === c.id;
                const isPosting  = posting && isOpen;

                return (
                  <React.Fragment key={c.id}>
                    <tr className={`border-t border-surface-100 hover:bg-surface-50 ${isOpen ? 'bg-surface-50' : ''}`}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          disabled={c.status !== 'unclassified'}
                        />
                      </td>
                      <td className="p-3 font-mono text-xs">{c.check_no}</td>
                      <td className="p-3 text-surface-600">
                        {c.clear_date || <span className="text-amber-600">— undated</span>}
                      </td>
                      <td className="p-3 text-right font-medium">{formatCurrency(c.amount)}</td>
                      <td className="p-3 text-surface-600">{c.payee || <span className="text-surface-400">—</span>}</td>
                      <td className="p-3">
                        {assigned
                          ? <span className="text-brand-700">{assigned}{c.notes ? <span className="text-surface-400"> · {c.notes}</span> : null}</span>
                          : c.notes
                            ? <span className="text-surface-500 italic">{c.notes}</span>
                            : <span className="text-surface-400">—</span>}
                      </td>
                      <td className="p-3 text-xs text-surface-500">{c.source_statement}</td>
                      <td className="p-3"><StatusBadge status={c.status} /></td>
                      <td className="p-3">
                        {c.status === 'unclassified' ? (
                          <div className="flex items-center gap-1">
                            {/* Three outcome buttons */}
                            <button
                              onClick={() => setInlineForm(isOpen && inlineForm.outcome === 'expense' ? null : { id: c.id, outcome: 'expense' })}
                              title="Expense"
                              className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${isOpen && inlineForm.outcome === 'expense' ? 'bg-brand-600 text-white border-brand-600' : 'border-surface-200 text-surface-600 hover:bg-surface-100'}`}
                            >
                              Expense
                            </button>
                            <button
                              onClick={() => setInlineForm(isOpen && inlineForm.outcome === 'balance' ? null : { id: c.id, outcome: 'balance' })}
                              title="Balance Sheet"
                              className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${isOpen && inlineForm.outcome === 'balance' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-surface-200 text-surface-600 hover:bg-surface-100'}`}
                            >
                              B/S
                            </button>
                            <button
                              onClick={() => setInlineForm(isOpen && inlineForm.outcome === 'excluded' ? null : { id: c.id, outcome: 'excluded' })}
                              title="Already recorded — no new JE"
                              className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${isOpen && inlineForm.outcome === 'excluded' ? 'bg-surface-600 text-white border-surface-600' : 'border-surface-200 text-surface-600 hover:bg-surface-100'}`}
                            >
                              <Ban size={11} className="inline -mt-0.5" />
                            </button>
                            <button
                              onClick={() => voidCheck(c)}
                              title="Void check"
                              className="p-1 text-surface-400 hover:text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : (c.status === 'classified' || c.status === 'excluded') ? (
                          <button
                            onClick={() => undoCheck(c)}
                            title="Undo — reset to unclassified"
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-surface-500 hover:text-brand-700 hover:bg-brand-50 border border-surface-200"
                          >
                            <RotateCcw size={11} /> Undo
                          </button>
                        ) : (
                          <button
                            onClick={() => voidCheck(c)}
                            title="Void check"
                            className="p-1.5 text-surface-400 hover:text-red-600 hover:bg-red-50 rounded"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {/* Inline form row */}
                    {isOpen && (
                      <tr className="border-t border-brand-100 bg-surface-50">
                        <td colSpan={9} className="px-4 py-3">
                          <InlineForm
                            check={c}
                            outcome={inlineForm.outcome}
                            expenseCats={expenseCats}
                            balanceSheetCats={balanceSheetCats}
                            posting={isPosting}
                            onSubmit={(formData) => submitInlineForm(c, formData)}
                            onCancel={() => setInlineForm(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div className="p-3 text-xs text-surface-500 text-center border-t border-surface-100">
            Showing 500 of {filtered.length} — narrow filters to see the rest.
          </div>
        )}
      </div>

      {/* Bulk classify modal */}
      {classifyOpen && (
        <BulkClassifyModal
          open={classifyOpen}
          onClose={() => setClassifyOpen(false)}
          onConfirm={classifySelection}
          expenseCats={expenseCats}
          balanceSheetCats={balanceSheetCats}
          selectedRows={selectedRows}
          posting={posting}
        />
      )}
    </div>
  );
}

// ── InlineForm ────────────────────────────────────────────────────────────────
// Rendered inside a <tr> below the target check row.
// Enter on last field submits.

function InlineForm({ check, outcome, expenseCats, balanceSheetCats, posting, onSubmit, onCancel }) {
  const [categoryId,   setCategoryId]   = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [userDesc,     setUserDesc]     = useState('');
  const [note,         setNote]         = useState('');
  const [dateOverride, setDateOverride] = useState('');
  const descRef = useRef(null);
  const noteRef = useRef(null);

  // Focus the first input when the form opens.
  useEffect(() => {
    if (outcome === 'excluded') {
      noteRef.current?.focus();
    } else {
      // Select is not easily focusable cross-browser, focus description instead.
      descRef.current?.focus();
    }
  }, [outcome]);

  const cats = outcome === 'expense' ? expenseCats : balanceSheetCats;

  function handleCatChange(e) {
    const id   = e.target.value;
    const found = cats.find(c => c.id === id);
    setCategoryId(id);
    setCategoryName(found?.name || '');
    // Move focus to description
    setTimeout(() => descRef.current?.focus(), 0);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') onCancel();
  }

  function handleSubmit() {
    if (outcome !== 'excluded' && !categoryId) {
      toast.error('Select an account first');
      return;
    }
    onSubmit({
      outcome,
      categoryId:   categoryId || null,
      categoryName: categoryName || null,
      userDesc:     userDesc.trim() || (categoryName || ''),
      note:         note.trim() || null,
      dateOverride: dateOverride || null,
    });
  }

  const outcomeLabel = outcome === 'expense' ? 'Expense' : outcome === 'balance' ? 'Balance Sheet' : 'Already Recorded';
  const accentClass  = outcome === 'expense' ? 'text-brand-700' : outcome === 'balance' ? 'text-indigo-700' : 'text-surface-700';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <span className={`text-xs font-semibold uppercase tracking-wider ${accentClass} w-28 shrink-0 mt-1`}>
        {outcomeLabel}
      </span>

      {outcome !== 'excluded' ? (
        <>
          <div className="flex flex-col gap-1 min-w-48">
            <label className="text-xs text-surface-500 uppercase tracking-wider">Account</label>
            <select
              value={categoryId}
              onChange={handleCatChange}
              onKeyDown={handleKeyDown}
              className="px-2 py-1.5 border border-surface-200 rounded text-sm bg-white"
            >
              <option value="">— select —</option>
              {outcome === 'balance' ? (
                <>
                  <optgroup label="Assets">
                    {balanceSheetCats.filter(c => c.type === 'asset').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                  <optgroup label="Liabilities">
                    {balanceSheetCats.filter(c => c.type === 'liability').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                  <optgroup label="Equity / Draws">
                    {balanceSheetCats.filter(c => c.type === 'equity').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                </>
              ) : (
                expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
              )}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-52">
            <label className="text-xs text-surface-500 uppercase tracking-wider">Description</label>
            <input
              ref={descRef}
              value={userDesc}
              onChange={e => setUserDesc(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Office supplies"
              className="px-2 py-1.5 border border-surface-200 rounded text-sm"
            />
          </div>
          {!check.clear_date && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-surface-500 uppercase tracking-wider">Clear date</label>
              <input
                type="date"
                value={dateOverride}
                onChange={e => setDateOverride(e.target.value)}
                onKeyDown={handleKeyDown}
                className="px-2 py-1.5 border border-surface-200 rounded text-sm"
              />
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1 min-w-64">
          <label className="text-xs text-surface-500 uppercase tracking-wider">Note (optional)</label>
          <input
            ref={noteRef}
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Already in payroll JE #45"
            className="px-2 py-1.5 border border-surface-200 rounded text-sm"
          />
        </div>
      )}

      <div className="flex items-center gap-2 pb-0.5">
        <button
          onClick={handleSubmit}
          disabled={posting || (outcome !== 'excluded' && !categoryId)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-brand-600 text-white disabled:bg-surface-300 hover:bg-brand-700"
        >
          {posting
            ? <RotateCcw className="animate-spin" size={13} />
            : <CornerDownLeft size={13} />}
          {posting ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded text-sm text-surface-600 hover:bg-surface-100 border border-surface-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── BulkClassifyModal ─────────────────────────────────────────────────────────
// Extended modal supporting all three outcomes for N selected rows.

function BulkClassifyModal({ open, onClose, onConfirm, expenseCats, balanceSheetCats, selectedRows, posting }) {
  const [outcome,      setOutcome]      = useState('expense');
  const [categoryId,   setCategoryId]   = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [userDesc,     setUserDesc]     = useState('');
  const [note,         setNote]         = useState('');
  const [dateOverride, setDateOverride] = useState('');

  const undatedInSelection = selectedRows.filter(r => !r.clear_date).length;
  const total              = selectedRows.reduce((s, c) => s + Number(c.amount || 0), 0);

  const cats = outcome === 'expense' ? expenseCats : balanceSheetCats;

  function handleCatChange(e) {
    const id    = e.target.value;
    const found = cats.find(c => c.id === id);
    setCategoryId(id);
    setCategoryName(found?.name || '');
  }

  function handleOutcomeChange(o) {
    setOutcome(o);
    setCategoryId('');
    setCategoryName('');
  }

  const canSubmit = outcome === 'excluded' || !!categoryId;

  function handleConfirm() {
    onConfirm({
      outcome,
      categoryId:   categoryId || null,
      categoryName: categoryName || null,
      userDesc:     userDesc.trim() || (categoryName || ''),
      note:         note.trim() || null,
      dateOverride: dateOverride || null,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bulk classify ${selectedRows.length} check${selectedRows.length === 1 ? '' : 's'}`}
      size="lg"
    >
      <div className="space-y-4">
        {/* Summary */}
        <div className="bg-surface-50 rounded-lg p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-surface-600">Total amount</span>
            <span className="font-display font-bold text-lg">{formatCurrency(total)}</span>
          </div>
          {undatedInSelection > 0 && (
            <div className="text-xs text-amber-700 mt-2">
              {undatedInSelection} of {selectedRows.length} checks lack a clear date.
              {outcome !== 'excluded' ? ' Set a date override below or those rows will be skipped.' : ''}
            </div>
          )}
        </div>

        {/* Outcome selector */}
        <div>
          <label className="block text-xs uppercase tracking-wider text-surface-500 mb-2">Outcome</label>
          <div className="flex gap-2">
            {[
              { id: 'expense',  label: 'Expense',          accent: 'brand' },
              { id: 'balance',  label: 'Balance Sheet',    accent: 'indigo' },
              { id: 'excluded', label: 'Already recorded', accent: 'surface' },
            ].map(o => (
              <button
                key={o.id}
                onClick={() => handleOutcomeChange(o.id)}
                className={`px-3 py-2 rounded-md text-sm font-medium border flex-1 transition-colors ${outcome === o.id
                  ? o.accent === 'brand'
                    ? 'bg-brand-600 text-white border-brand-600'
                    : o.accent === 'indigo'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-surface-700 text-white border-surface-700'
                  : 'border-surface-200 text-surface-600 hover:bg-surface-50'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Account picker (outcomes A + B) */}
        {outcome !== 'excluded' && (
          <div>
            <label className="block text-xs uppercase tracking-wider text-surface-500 mb-1">Account</label>
            <select
              value={categoryId}
              onChange={handleCatChange}
              className="w-full px-3 py-2 border border-surface-200 rounded-md"
            >
              <option value="">— select account —</option>
              {outcome === 'expense' ? (
                expenseCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
              ) : (
                <>
                  <optgroup label="Assets">
                    {balanceSheetCats.filter(c => c.type === 'asset').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                  <optgroup label="Liabilities">
                    {balanceSheetCats.filter(c => c.type === 'liability').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                  <optgroup label="Equity / Draws">
                    {balanceSheetCats.filter(c => c.type === 'equity').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                </>
              )}
            </select>
          </div>
        )}

        {/* Description / note */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-surface-500 mb-1">
              {outcome === 'excluded' ? 'Note (optional)' : 'Description'}
            </label>
            {outcome === 'excluded' ? (
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Already in payroll JE"
                className="w-full px-3 py-2 border border-surface-200 rounded-md text-sm"
              />
            ) : (
              <input
                value={userDesc}
                onChange={e => setUserDesc(e.target.value)}
                placeholder="e.g. Monthly supplies run"
                className="w-full px-3 py-2 border border-surface-200 rounded-md text-sm"
              />
            )}
          </div>
          {outcome !== 'excluded' && (
            <div>
              <label className="block text-xs uppercase tracking-wider text-surface-500 mb-1">Date override (optional)</label>
              <input
                type="date"
                value={dateOverride}
                onChange={e => setDateOverride(e.target.value)}
                className="w-full px-3 py-2 border border-surface-200 rounded-md text-sm"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-surface-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm text-surface-600 hover:bg-surface-100">
            Cancel
          </button>
          <button
            disabled={!canSubmit || posting}
            onClick={handleConfirm}
            className="px-4 py-2 rounded-md text-sm bg-brand-600 text-white disabled:bg-surface-300 flex items-center gap-2"
          >
            {posting && <RotateCcw className="animate-spin" size={14} />}
            {posting
              ? 'Posting…'
              : outcome === 'excluded'
                ? `Exclude ${selectedRows.length} check${selectedRows.length === 1 ? '' : 's'}`
                : `Post ${selectedRows.length} entr${selectedRows.length === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone = 'neutral' }) {
  const tones = {
    ok:      'bg-emerald-50 border-emerald-200 text-emerald-800',
    warn:    'bg-amber-50 border-amber-200 text-amber-800',
    neutral: 'bg-surface-50 border-surface-200 text-surface-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-2xl font-display font-bold mt-1">{value}</div>
      <div className="text-sm opacity-80">{sub}</div>
    </div>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    unclassified: 'bg-amber-100 text-amber-800',
    classified:   'bg-emerald-100 text-emerald-800',
    voided:       'bg-surface-200 text-surface-600',
    excluded:     'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || map.unclassified}`}>
      {status}
    </span>
  );
}
