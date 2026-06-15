import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { insertJournalEntryWithRetry } from '../lib/journalReference';
import {
  PeriodClosedError,
  isPeriodLockedError,
  periodFromLockedError,
  checkPeriodStatus,
  reopenPeriod,
} from '../lib/periodLock';
import { closePeriod } from '../lib/periodClose';
import {
  RECLASS_SPLIT,
  resolveReclassCategoryNames,
  fetchAmazonBalance,
  fetchAmazonBalanceByMonth,
  monthBounds,
  buildReclassPreviewForPeriod,
} from '../lib/amazonReclass';
import Modal from './ui/Modal';
import Spinner from './ui/Spinner';
import { formatCurrency, getMonthLabel } from '../lib/utils';
import toast from 'react-hot-toast';
import {
  Repeat, Loader2, AlertTriangle, Lock, Unlock, Pencil,
  CheckCircle2, XCircle, Info,
} from 'lucide-react';

const MIN_YEAR  = 2020;
const NEXT_YEAR = new Date().getFullYear() + 1;

function defaultMonth() {
  return new Date().toISOString().slice(0, 7);
}
function defaultYear() {
  return new Date().getFullYear();
}

// Compact read-only chip with an inline edit affordance. The chip carries
// the resolved category name; clicking "change" swaps it for a select
// populated from the live categories table (expense-type only).
function CategoryChip({ label, value, allOptions, onChange }) {
  const [editing, setEditing] = useState(false);
  const ok = !!value;

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs">
        <span className="text-surface-500 font-medium whitespace-nowrap">{label}</span>
        <select
          autoFocus
          value={value || ''}
          onChange={e => { onChange(e.target.value); setEditing(false); }}
          onBlur={() => setEditing(false)}
          className="input-field text-xs py-1 flex-1"
        >
          <option value="">— pick a category —</option>
          {allOptions.map(c => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${ok ? 'border-surface-200 bg-surface-50' : 'border-amber-300 bg-amber-50'}`}>
      <span className="text-surface-500 font-medium whitespace-nowrap">{label}</span>
      <span className={`font-mono truncate ${ok ? 'text-surface-900' : 'text-amber-800'}`}>
        {value || 'not found'}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-brand-600 hover:text-brand-700 inline-flex items-center gap-0.5 ml-auto whitespace-nowrap"
      >
        <Pencil size={11} /> change
      </button>
    </div>
  );
}

// Render the per-period progress badge. The badge picks colors from the
// row's final state so a glance at the results panel tells the user which
// periods succeeded, which failed mid-run, and which ended re-closed.
function ResultRow({ result }) {
  const { label, wasClosed, steps, failure, reference } = result;
  const completed = steps.includes('re-closed') || (!wasClosed && steps.includes('posted'));
  const tone = failure ? 'bg-red-50 border-red-200 text-red-800'
             : completed ? 'bg-green-50 border-green-200 text-green-800'
             : 'bg-amber-50 border-amber-200 text-amber-800';
  const icon = failure ? <XCircle size={13} />
             : completed ? <CheckCircle2 size={13} />
             : <Loader2 size={13} className="animate-spin" />;
  const stepText = (() => {
    if (steps.length === 0 && !failure) return 'queued…';
    const parts = [];
    if (wasClosed && steps.includes('reopened'))   parts.push('reopened');
    if (steps.includes('posted'))                   parts.push(`posted${reference ? ` (${reference})` : ''}`);
    if (wasClosed && steps.includes('re-closed'))   parts.push('re-closed');
    return parts.join(' · ') || (failure ? 'failed' : 'pending');
  })();
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-mono font-semibold">{label}</div>
        <div className="opacity-90">{stepText}</div>
        {failure && <div className="mt-0.5 text-[11px]">{failure}</div>}
      </div>
    </div>
  );
}

export default function AmazonReclassModal({ open, onClose, onPosted }) {
  const { user } = useAuth();
  const { categories } = useData();

  // ── State ─────────────────────────────────────────────────────────────────
  const [scope, setScope]     = useState('month'); // 'month' | 'year'
  const [month, setMonth]     = useState(defaultMonth);
  const [year, setYear]       = useState(defaultYear);

  const [names, setNames]     = useState({
    amazon: null, additions: null, repairs: null, supplies: null, misc: null,
  });
  // Once the user manually overrides a chip we stop overwriting it from the
  // auto-resolver if the categories list reloads.
  const [overrides, setOverrides] = useState({});

  const [loading, setLoading]         = useState(false);
  const [previews, setPreviews]       = useState([]);
  const [periodStatus, setPeriodStatus] = useState({}); // { 'YYYY-MM': 'open'|'closed'|'unknown' }
  const [statusChecking, setStatusChecking] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [posting, setPosting]         = useState(false);
  const [results, setResults]         = useState([]); // per-period progress

  const expenseCategories = useMemo(
    () => (categories || [])
      .filter(c => (c.type || '').toLowerCase() === 'expense' && !c.archived)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
  );

  // ── Auto-resolve names whenever the categories list changes, but never
  //    clobber a manual override.
  useEffect(() => {
    if (!categories?.length) return;
    const resolved = resolveReclassCategoryNames(categories);
    setNames(prev => {
      const next = { ...prev };
      for (const k of Object.keys(resolved)) {
        if (overrides[k]) continue;
        if (!prev[k]) next[k] = resolved[k];
      }
      return next;
    });
  }, [categories, overrides]);

  // ── Reset preview state any time the scope/period selection changes ─────
  useEffect(() => {
    setPreviews([]);
    setPeriodStatus({});
    setResults([]);
  }, [scope, month, year]);

  // ── Reset everything when the modal closes ──────────────────────────────
  useEffect(() => {
    if (!open) {
      setPreviews([]);
      setPeriodStatus({});
      setConfirmOpen(false);
      setLoading(false);
      setStatusChecking(false);
      setPosting(false);
      setResults([]);
    }
  }, [open]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const allNamesResolved = Object.values(names).every(Boolean);

  const postableRows = useMemo(
    () => previews.filter(r => r.postable),
    [previews]
  );
  const grandTotal = useMemo(
    () => postableRows.reduce((s, r) => s + r.totalCredits, 0),
    [postableRows]
  );
  const closedRows = useMemo(
    () => postableRows.filter(r => periodStatus[r.period] === 'closed'),
    [postableRows, periodStatus]
  );
  const openRows = useMemo(
    () => postableRows.filter(r => periodStatus[r.period] !== 'closed'),
    [postableRows, periodStatus]
  );
  const totalUnposted = useMemo(
    () => postableRows.reduce((s, r) => s + r.unpostedCount, 0),
    [postableRows]
  );

  // Hard guards: every category must resolve, at least one row must be
  // postable, and every row must be cent-balanced. We re-check the math
  // here defensively so a future refactor of buildReclassLegs cannot
  // let an imbalanced row through.
  const allBalanced = postableRows.every(r => Math.abs(r.totalDebits - r.totalCredits) < 0.005);
  const canPost = allNamesResolved
    && postableRows.length > 0
    && allBalanced
    && !loading
    && !posting;

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleNameOverride(key, value) {
    setOverrides(prev => ({ ...prev, [key]: true }));
    setNames(prev => ({ ...prev, [key]: value || null }));
  }

  async function runPreview() {
    if (!allNamesResolved) {
      toast.error('Resolve every category first');
      return;
    }
    setLoading(true);
    setPreviews([]);
    setPeriodStatus({});
    setResults([]);
    try {
      let rows;
      if (scope === 'month') {
        const { start, end } = monthBounds(month);
        const { balance, txnCount, unpostedCount } = await fetchAmazonBalance({
          amazonName: names.amazon, start, end,
        });
        rows = [buildReclassPreviewForPeriod({
          period: month, balance, names, txnCount, unpostedCount,
        })];
      } else {
        const monthly = await fetchAmazonBalanceByMonth({ amazonName: names.amazon, year });
        rows = monthly.map(m => buildReclassPreviewForPeriod({
          period: m.period,
          balance: m.balance,
          names,
          txnCount: m.txnCount,
          unpostedCount: m.unpostedCount,
        }));
      }
      setPreviews(rows);

      // Period-close probe — only for the rows we'd actually post.
      const probeRows = rows.filter(r => r.postable);
      if (probeRows.length) {
        setStatusChecking(true);
        const statusMap = {};
        for (const r of probeRows) {
          try {
            const s = await checkPeriodStatus(r.date);
            statusMap[r.period] = s?.status || 'open';
          } catch {
            statusMap[r.period] = 'unknown';
          }
        }
        setPeriodStatus(statusMap);
        setStatusChecking(false);
      }
    } catch (err) {
      console.error('Amazon reclass preview failed:', err);
      toast.error(err.message || 'Failed to build preview');
    } finally {
      setLoading(false);
    }
  }

  // Posts one row's JE + lines + mirrored transactions. Same shape as the
  // Capitalize and Reverse flows so the P&L / GL pick everything up.
  async function postOneRow(row) {
    const { data: entry, reference } = await insertJournalEntryWithRetry({
      date: row.date,
      description: `Amazon reclass — ${getMonthLabel(row.start)}`,
      memo: 'Reclass of Amazon balance into Additions / Repairs & Maintenance / Supplies / Miscellaneous',
      total_amount: row.totalCredits,
      status: 'posted',
      entry_type: 'auto',
      created_by: user?.id || null,
      posted_at: new Date().toISOString(),
    });
    if (!entry) throw new Error('Insert returned no row');

    const lineRows = row.legs.map(l => ({
      journal_entry_id: entry.id,
      account_id: null,
      description: l.side === 'credit'
        ? 'Reclass from Amazon'
        : `Reclass to ${l.label}`,
      debit_amount:  l.side === 'debit'  ? l.amount : 0,
      credit_amount: l.side === 'credit' ? l.amount : 0,
      category: l.categoryName,
    }));
    const { error: linesErr } = await supabase.from('journal_entry_lines').insert(lineRows);
    if (linesErr) throw linesErr;

    const txnRows = row.legs.map(l => ({
      date: row.date,
      description: l.side === 'credit' ? 'Reclass from Amazon' : `Reclass to ${l.label}`,
      supplier: 'Amazon Reclass',
      amount: l.amount,
      type: l.side,
      category: l.categoryName,
      account_id: null,
      reference,
      bank_statement_id: null,
      journal_entry_id: entry.id,
      posted: true,
    }));
    const { error: txnsErr } = await supabase.from('transactions').insert(txnRows);
    if (txnsErr) throw txnsErr;

    return reference;
  }

  // The new flow: each period is handled INDEPENDENTLY.
  //   • If a period was CLOSED at preview time → reopen, post, re-close
  //     (re-close uses shared closePeriod, which regenerates the snapshot
  //     against post-reclass live data).
  //   • If a period was OPEN → just post, leave it open.
  //   • try/finally guarantees a previously-closed period ends closed again
  //     even if the post step throws.
  // One period's outcome never short-circuits the rest of the batch.
  async function handleConfirmPost() {
    if (!canPost) return;
    setPosting(true);

    // Build a fresh results array we'll mutate-and-replace as we progress.
    const next = postableRows.map(r => ({
      period:    r.period,
      label:     getMonthLabel(monthBounds(r.period).start),
      wasClosed: periodStatus[r.period] === 'closed',
      steps:     [],          // 'reopened' | 'posted' | 're-closed'
      reference: null,
      failure:   null,
    }));
    setResults(next);
    // Replace state with a shallow clone so React picks up step mutations.
    const flush = () => setResults(next.map(r => ({ ...r, steps: [...r.steps] })));

    try {
      for (let i = 0; i < postableRows.length; i++) {
        const row = postableRows[i];
        const r   = next[i];
        const wasClosed = r.wasClosed;
        let reopened = false;

        try {
          if (wasClosed) {
            try {
              await reopenPeriod(row.period, user?.id);
              r.steps.push('reopened');
              reopened = true;
              flush();
            } catch (reopenErr) {
              r.failure = `reopen failed: ${reopenErr?.message || String(reopenErr)}`;
              flush();
              continue; // nothing to post into; skip to next period
            }
          }

          // Post the JE + lines + mirrored transactions.
          try {
            const ref = await postOneRow(row);
            r.steps.push('posted');
            r.reference = ref;
            flush();
          } catch (postErr) {
            if (isPeriodLockedError(postErr)) {
              const p = periodFromLockedError(postErr) || row.period;
              r.failure = `post hit closed period ${p}`;
            } else {
              r.failure = `post failed: ${postErr?.message || String(postErr)}`;
            }
            flush();
            // Fall through to finally so the period gets re-closed if we
            // reopened it.
          }
        } finally {
          // Only re-close periods we actually reopened. If reopen failed
          // (or the period was open to begin with), don't touch period_close
          // here — open periods MUST stay open per spec.
          if (wasClosed && reopened) {
            try {
              await closePeriod({
                period: row.period,
                userId: user?.id,
                categories,
                description: r.reference
                  ? `Re-closed ${row.period} after Amazon Reclass post (${r.reference})`
                  : `Re-closed ${row.period} after Amazon Reclass post attempt failed — state restored`,
              });
              r.steps.push('re-closed');
              flush();
            } catch (closeErr) {
              const msg = `re-close failed: ${closeErr?.message || String(closeErr)}`;
              r.failure = r.failure ? `${r.failure}; ${msg}` : msg;
              flush();
            }
          }
        }
      }

      const failed = next.filter(r => r.failure);
      const ok     = next.filter(r => !r.failure);
      if (failed.length === 0) {
        toast.success(`Posted ${ok.length} reclass entr${ok.length === 1 ? 'y' : 'ies'}`);
      } else if (ok.length === 0) {
        toast.error(`All ${failed.length} entr${failed.length === 1 ? 'y' : 'ies'} failed — see results`);
      } else {
        toast(`${ok.length} succeeded, ${failed.length} failed — see results`, { icon: '⚠️' });
      }
      // Notify the parent regardless of partial success so journal history
      // refreshes for whatever did post.
      onPosted?.();
      setConfirmOpen(false);
    } finally {
      setPosting(false);
    }
  }

  function renderPreviewRow(row) {
    if (row.reason === 'zero') {
      return (
        <tr key={row.period} className="border-t border-surface-100">
          <td className="px-3 py-1.5 text-xs font-mono">{getMonthLabel(row.start)}</td>
          <td colSpan={4} className="px-3 py-1.5 text-xs text-surface-400">
            — Amazon balance is $0 for this period
          </td>
        </tr>
      );
    }
    if (row.reason === 'negative') {
      return (
        <tr key={row.period} className="border-t border-surface-100 bg-red-50/40">
          <td className="px-3 py-1.5 text-xs font-mono">{getMonthLabel(row.start)}</td>
          <td colSpan={4} className="px-3 py-1.5 text-xs text-red-700">
            <span className="inline-flex items-center gap-1">
              <XCircle size={12} />
              Amazon balance is negative ({formatCurrency(row.balance)}) — reclass manually
            </span>
          </td>
        </tr>
      );
    }
    const closed = periodStatus[row.period] === 'closed';
    return (
      <tr key={row.period} className="border-t border-surface-100 align-top">
        <td className="px-3 py-2 text-xs font-mono whitespace-nowrap">
          <div>{getMonthLabel(row.start)}</div>
          <div className="text-[10px] text-surface-400 mt-0.5">{row.date}</div>
          {closed && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-700">
              <Lock size={10} /> closed
            </div>
          )}
          {!closed && periodStatus[row.period] && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-surface-500">
              <Unlock size={10} /> open
            </div>
          )}
          {row.unpostedCount > 0 && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-700">
              <AlertTriangle size={10} /> {row.unpostedCount} unposted
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-xs">
          <div className="space-y-0.5">
            {row.legs.map(l => (
              <div key={l.key} className="flex justify-between gap-3">
                <span className="text-surface-600">
                  {l.side === 'debit' ? 'DR' : 'CR'} {l.categoryName || l.label}
                </span>
                <span className="font-mono">{formatCurrency(l.amount)}</span>
              </div>
            ))}
          </div>
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(row.totalDebits)}</td>
        <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(row.totalCredits)}</td>
        <td className="px-3 py-2 text-center">
          {row.balanced
            ? <CheckCircle2 size={14} className="text-green-600 inline" />
            : <XCircle size={14} className="text-red-600 inline" />}
        </td>
      </tr>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  // Button label adapts to what's in the batch.
  const primaryLabel = (() => {
    if (postableRows.length === 0) return 'Create Journal Entries';
    if (closedRows.length === 0)   return `Post ${postableRows.length} Entr${postableRows.length === 1 ? 'y' : 'ies'}`;
    return `Reopen, Post & Re-close (${postableRows.length})`;
  })();

  return (
    <>
      <Modal
        open={open}
        onClose={posting ? () => {} : onClose}
        title="Amazon Reclass"
        size="xl"
      >
        <div className="space-y-5">

          {/* Categories */}
          <section>
            <div className="text-xs font-semibold text-surface-600 uppercase tracking-wider mb-2">
              Categories (auto-detected)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <CategoryChip label="Amazon (source)"       value={names.amazon}    allOptions={expenseCategories} onChange={v => handleNameOverride('amazon', v)} />
              <CategoryChip label="Additions"             value={names.additions} allOptions={expenseCategories} onChange={v => handleNameOverride('additions', v)} />
              <CategoryChip label="Repairs & Maintenance" value={names.repairs}   allOptions={expenseCategories} onChange={v => handleNameOverride('repairs', v)} />
              <CategoryChip label="Supplies"              value={names.supplies}  allOptions={expenseCategories} onChange={v => handleNameOverride('supplies', v)} />
              <CategoryChip label="Miscellaneous"         value={names.misc}      allOptions={expenseCategories} onChange={v => handleNameOverride('misc', v)} />
            </div>
            {!allNamesResolved && (
              <div className="mt-2 text-xs text-amber-700 inline-flex items-center gap-1">
                <AlertTriangle size={12} />
                Posting is disabled until every category resolves to a real chart-of-accounts entry.
              </div>
            )}
          </section>

          {/* Fixed split */}
          <section>
            <div className="text-xs font-semibold text-surface-600 uppercase tracking-wider mb-2">
              Split (fixed)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {RECLASS_SPLIT.map(s => (
                <div key={s.key} className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-xs">
                  <div className="text-surface-500">{s.label}</div>
                  <div className="font-mono font-semibold text-surface-900">{Math.round(s.pct * 100)}%</div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-surface-400 mt-1 inline-flex items-center gap-1">
              <Info size={11} />
              Penny residual from rounding lands on the Supplies leg so total debits exactly equal the credit.
            </div>
          </section>

          {/* Scope */}
          <section>
            <div className="text-xs font-semibold text-surface-600 uppercase tracking-wider mb-2">Scope</div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="inline-flex bg-surface-100 rounded-lg p-1">
                {[
                  { id: 'month', label: 'Single Month' },
                  { id: 'year',  label: 'Full Year' },
                ].map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setScope(t.id)}
                    className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${scope === t.id ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {scope === 'month' ? (
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-surface-500 mb-1">Month</label>
                  <input
                    type="month"
                    value={month}
                    onChange={e => setMonth(e.target.value)}
                    className="input-field text-xs py-1.5"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-surface-500 mb-1">Year</label>
                  <input
                    type="number"
                    min={MIN_YEAR}
                    max={NEXT_YEAR}
                    value={year}
                    onChange={e => setYear(Number(e.target.value) || defaultYear())}
                    className="input-field text-xs py-1.5 w-28"
                  />
                </div>
              )}
              <button
                type="button"
                onClick={runPreview}
                disabled={loading || !allNamesResolved}
                className="btn-secondary text-sm disabled:opacity-50 inline-flex items-center gap-2"
              >
                {loading ? <Spinner size="sm" /> : 'Build Preview'}
              </button>
            </div>
            <div className="text-[11px] text-surface-400 mt-2 inline-flex items-center gap-1">
              <Info size={11} />
              Year mode posts a SEPARATE entry per month that has a nonzero balance — never a single combined entry.
            </div>
          </section>

          {/* Preview */}
          {previews.length > 0 && (
            <section className="space-y-2">
              <div className="text-xs font-semibold text-surface-600 uppercase tracking-wider">Preview</div>
              <div className="overflow-x-auto border border-surface-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-surface-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-surface-600 uppercase tracking-wider">Period · JE date</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-surface-600 uppercase tracking-wider">Legs</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-surface-600 uppercase tracking-wider">Debits</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-surface-600 uppercase tracking-wider">Credit</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-surface-600 uppercase tracking-wider">Balanced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previews.map(renderPreviewRow)}
                  </tbody>
                  {postableRows.length > 0 && (
                    <tfoot className="bg-surface-50">
                      <tr className="border-t-2 border-surface-200">
                        <td colSpan={2} className="px-3 py-2 text-right text-xs font-semibold">
                          Grand total ({postableRows.length} entr{postableRows.length === 1 ? 'y' : 'ies'} will post)
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatCurrency(grandTotal)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{formatCurrency(grandTotal)}</td>
                        <td className="px-3 py-2 text-center">
                          <CheckCircle2 size={14} className="text-green-600 inline" />
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {statusChecking && (
                <div className="text-[11px] text-surface-500 inline-flex items-center gap-1">
                  <Spinner size="sm" /> Checking period status…
                </div>
              )}

              {closedRows.length > 0 && !statusChecking && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                  <Lock size={13} className="text-amber-700 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-semibold">
                      {closedRows.length} closed period{closedRows.length === 1 ? '' : 's'} in this batch:
                    </div>
                    <div className="font-mono text-amber-800 mt-0.5">
                      {closedRows.map(r => getMonthLabel(monthBounds(r.period).start)).join(', ')}
                    </div>
                    <div className="mt-1 text-amber-800">
                      Each will be reopened, posted into, and re-closed automatically. The re-close regenerates the close snapshot so it reflects the post-reclass numbers.
                    </div>
                  </div>
                </div>
              )}

              {openRows.length > 0 && !statusChecking && (
                <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs text-surface-700 flex items-start gap-2">
                  <Unlock size={13} className="text-surface-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-semibold">
                      {openRows.length} open period{openRows.length === 1 ? '' : 's'} in this batch:
                    </div>
                    <div className="font-mono text-surface-600 mt-0.5">
                      {openRows.map(r => getMonthLabel(monthBounds(r.period).start)).join(', ')}
                    </div>
                    <div className="mt-1 text-surface-600">
                      Each will be posted into and left OPEN — open periods are being actively worked on and the tool will not close them.
                    </div>
                  </div>
                </div>
              )}

              {totalUnposted > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle size={13} className="text-amber-700 mt-0.5 flex-shrink-0" />
                  <div>
                    {totalUnposted} of the transactions feeding these balances {totalUnposted === 1 ? 'is' : 'are'} not yet posted.
                    Post them first or this reclass may not match the final Amazon balance.
                  </div>
                </div>
              )}

              {postableRows.length === 0 && (
                <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs text-surface-500">
                  Nothing to post for this selection.
                </div>
              )}
            </section>
          )}

          {/* Results — visible after a run, success or partial failure. */}
          {results.length > 0 && (
            <section className="space-y-2">
              <div className="text-xs font-semibold text-surface-600 uppercase tracking-wider">Run results</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {results.map(r => <ResultRow key={r.period} result={r} />)}
              </div>
            </section>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-surface-100">
            <button type="button" onClick={onClose} disabled={posting} className="btn-ghost">Close</button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canPost}
              className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Repeat size={14} />
              {primaryLabel}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm dialog */}
      <Modal
        open={confirmOpen && open}
        onClose={posting ? () => {} : () => setConfirmOpen(false)}
        title="Confirm Amazon Reclass"
        size="lg"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-surface-200 bg-surface-50 p-3">
            <div className="text-xs uppercase tracking-wider text-surface-500 mb-1">You are about to post</div>
            <div className="text-sm font-semibold text-surface-900">
              {postableRows.length} journal entr{postableRows.length === 1 ? 'y' : 'ies'} · total {formatCurrency(grandTotal)}
            </div>
            <div className="mt-2 max-h-48 overflow-y-auto text-xs">
              <table className="w-full">
                <tbody>
                  {postableRows.map(r => {
                    const closed = periodStatus[r.period] === 'closed';
                    return (
                      <tr key={r.period} className="border-t border-surface-100">
                        <td className="py-1 font-mono pr-3">{getMonthLabel(monthBounds(r.period).start)}</td>
                        <td className="py-1 text-surface-500 pr-3">{r.date}</td>
                        <td className="py-1 pr-3 text-[11px]">
                          {closed
                            ? <span className="inline-flex items-center gap-1 text-amber-700"><Lock size={10} /> closed → reopen, post, re-close</span>
                            : <span className="inline-flex items-center gap-1 text-surface-500"><Unlock size={10} /> open → post (stays open)</span>}
                        </td>
                        <td className="py-1 text-right font-mono">{formatCurrency(r.totalCredits)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {closedRows.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
              <div className="font-semibold inline-flex items-center gap-1">
                <Lock size={12} /> These closed periods will be reopened, posted, and re-closed automatically:
              </div>
              <div className="font-mono text-amber-800">
                {closedRows.map(r => getMonthLabel(monthBounds(r.period).start)).join(', ')}
              </div>
              <div className="text-amber-800">
                Each is wrapped in try/finally — if posting fails, the period is still re-closed so it returns to its original CLOSED state. The reopen, the post, and the re-close are each logged in the audit trail, and the re-close regenerates the period snapshot against post-reclass live data.
              </div>
            </div>
          )}

          {openRows.length > 0 && (
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs text-surface-700 space-y-1">
              <div className="font-semibold inline-flex items-center gap-1">
                <Unlock size={12} /> These open periods will be posted into and LEFT OPEN:
              </div>
              <div className="font-mono text-surface-600">
                {openRows.map(r => getMonthLabel(monthBounds(r.period).start)).join(', ')}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setConfirmOpen(false)} disabled={posting} className="btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmPost}
              disabled={posting || postableRows.length === 0}
              className="btn-primary inline-flex items-center gap-2"
            >
              {posting && <Loader2 size={14} className="animate-spin" />}
              {primaryLabel}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
