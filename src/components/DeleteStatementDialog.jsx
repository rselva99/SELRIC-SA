import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, formatDate } from '../lib/utils';
import { debitOf, creditOf } from '../lib/finance';
import { reopenPeriod } from '../lib/periodLock';
import Modal from './ui/Modal';
import toast from 'react-hot-toast';
import { AlertTriangle, Loader2, Lock, RotateCcw } from 'lucide-react';

const MONTHS_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function periodChip(p) { const [y, m] = p.split('-'); return `${MONTHS_ABBR[+m - 1]}-${y.slice(2)}`; }

// Storage buckets the statement PDF could live in. Newer uploads go to
// 'documents'; some legacy files still sit in 'bank-statements'. We try
// both on delete so no orphan files remain.
const STATEMENT_BUCKETS = ['documents', 'bank-statements'];

export default function DeleteStatementDialog({ statement, onClose, onDeleted }) {
  const { user, isAdmin } = useAuth();
  const [state, setState]   = useState('loading'); // loading | error | ready | confirming | deleting
  const [error, setError]   = useState(null);
  const [data,  setData]    = useState(null);
  const [typed, setTyped]   = useState('');
  const [reopening, setReopening] = useState(null);

  useEffect(() => {
    if (!statement) { setState('loading'); setData(null); setTyped(''); return; }
    let cancelled = false;
    setState('loading');
    setError(null);
    (async () => {
      try {
        const [txnRes, closeRes] = await Promise.all([
          supabase.from('transactions')
            .select('id, date, amount, type, posted, journal_entry_id, reconciled')
            .eq('bank_statement_id', statement.id),
          supabase.from('period_close')
            .select('period, status').eq('status', 'closed'),
        ]);
        if (txnRes.error)   throw txnRes.error;
        if (closeRes.error) throw closeRes.error;
        const txns = txnRes.data || [];
        const closedSet = new Set((closeRes.data || []).map(r => r.period));
        const periods = new Set();
        let debits = 0, credits = 0, postedCount = 0, withJE = 0, reconciledCount = 0;
        for (const t of txns) {
          debits  += debitOf(t);
          credits += creditOf(t);
          if (t.posted) postedCount++;
          if (t.journal_entry_id) withJE++;
          if (t.reconciled) reconciledCount++;
          periods.add((t.date || '').slice(0, 7));
        }
        const periodList   = [...periods].filter(Boolean).sort();
        const closedHit    = periodList.filter(p => closedSet.has(p));
        if (cancelled) return;
        setData({
          count: txns.length,
          debits,
          credits,
          postedCount,
          withJE,
          reconciledCount,
          periods: periodList,
          closedHit,
        });
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err);
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [statement?.id]);

  const canDelete = useMemo(() => {
    if (!data) return false;
    if (data.closedHit.length > 0) return false;
    if (typed !== 'DELETE') return false;
    return true;
  }, [data, typed]);

  async function handleReopen(period) {
    setReopening(period);
    try {
      await reopenPeriod(period, user?.id);
      toast.success(`Reopened ${periodChip(period)}`);
      // Re-pull the dialog data so closedHit empties.
      const fresh = await supabase.from('period_close').select('period, status').eq('status', 'closed');
      const closedSet = new Set((fresh.data || []).map(r => r.period));
      setData(d => d ? { ...d, closedHit: d.periods.filter(p => closedSet.has(p)) } : d);
    } catch (err) {
      toast.error(err.message || 'Reopen failed');
    } finally {
      setReopening(null);
    }
  }

  async function performDelete() {
    if (!statement || !data || !canDelete) return;
    setState('deleting');
    try {
      // 1) Delete the linked transactions first. The period-lock trigger
      //    (now covering DELETE per migrations/2026-06-11-extend-period-
      //    lock-delete.sql) would block anything in a closed period — we
      //    already short-circuited that above.
      const { error: txnErr } = await supabase
        .from('transactions').delete().eq('bank_statement_id', statement.id);
      if (txnErr) throw txnErr;

      // 2) Delete the bank_statements row.
      const { error: stmtErr } = await supabase
        .from('bank_statements').delete().eq('id', statement.id);
      if (stmtErr) throw stmtErr;

      // 3) Best-effort storage cleanup. Try every known bucket; swallow
      //    not-found errors so a missing file doesn't leave the DB+row
      //    cleanup half-done.
      if (statement.file_url) {
        for (const bucket of STATEMENT_BUCKETS) {
          try { await supabase.storage.from(bucket).remove([statement.file_url]); }
          catch { /* ignore */ }
        }
      }

      const periodLabel = data.periods.map(periodChip).join(', ') || 'no period';
      toast.success(`Removed statement "${statement.file_name}": ${data.count} transactions across ${periodLabel}`);
      await onDeleted?.();
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Delete failed');
      setState('ready');
    }
  }

  if (!statement) return null;

  const busy = state === 'deleting';

  return (
    <Modal open={!!statement} onClose={busy ? () => {} : onClose} title="Delete bank statement" size="lg">
      <div className="space-y-4 p-1">
        {state === 'loading' && (
          <div className="flex items-center justify-center py-6"><Loader2 size={18} className="animate-spin text-surface-400" /></div>
        )}
        {state === 'error' && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Failed to inspect linked data: {error?.message || 'unknown error'}.
          </div>
        )}
        {(state === 'ready' || state === 'deleting') && data && (
          <>
            <div className="rounded-lg border border-surface-100 bg-surface-50 p-3">
              <div className="font-semibold text-sm truncate">{statement.file_name}</div>
              <div className="text-xs text-surface-500 mt-0.5">
                Uploaded {statement.upload_date ? formatDate(statement.upload_date) : '—'}
                {statement.period_start && statement.period_end && (
                  <> · period {formatDate(statement.period_start)} → {formatDate(statement.period_end)}</>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="card p-3">
                <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Transactions</div>
                <div className="font-mono text-lg font-semibold mt-1">{data.count}</div>
                <div className="text-[10px] text-surface-400">{data.postedCount} posted · {data.count - data.postedCount} unposted</div>
              </div>
              <div className="card p-3">
                <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Total movement</div>
                <div className="font-mono text-lg font-semibold mt-1">{formatCurrency(data.debits + data.credits)}</div>
                <div className="text-[10px] text-surface-400">
                  <span className="text-red-600">{formatCurrency(data.debits)} debits</span> · <span className="text-green-600">{formatCurrency(data.credits)} credits</span>
                </div>
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold mb-1.5">Periods affected</div>
              <div className="flex flex-wrap gap-1.5">
                {data.periods.length === 0
                  ? <span className="text-xs text-surface-400">No transactions</span>
                  : data.periods.map(p => (
                      <span key={p}
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${data.closedHit.includes(p) ? 'bg-amber-100 text-amber-800' : 'bg-surface-100 text-surface-700'}`}>
                        {periodChip(p)}{data.closedHit.includes(p) && ' · closed'}
                      </span>
                    ))}
              </div>
            </div>

            {(data.withJE > 0 || data.reconciledCount > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold">Linked records detected.</div>
                  <ul className="list-disc pl-4 mt-0.5">
                    {data.withJE > 0 && <li>{data.withJE} of these transactions are linked to a journal entry (<span className="font-mono">journal_entry_id</span>) — deleting them clears that back-reference; the JE row itself is untouched.</li>}
                    {data.reconciledCount > 0 && <li>{data.reconciledCount} are marked reconciled — the invoice they matched will become unreconciled.</li>}
                  </ul>
                </div>
              </div>
            )}

            {data.closedHit.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2 text-sm text-amber-900">
                  <Lock size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-semibold">Cannot delete — periods are closed.</div>
                    <div className="text-xs text-amber-800 mt-0.5">
                      Reopen each closed period before deleting. Books will be unbalanced briefly while txns are wiped.
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.closedHit.map(p => (
                    <button key={p}
                      type="button"
                      onClick={() => handleReopen(p)}
                      disabled={!isAdmin || reopening === p}
                      className="text-xs px-2.5 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {reopening === p ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                      Reopen {periodChip(p)}
                    </button>
                  ))}
                </div>
                {!isAdmin && <div className="text-[10px] text-amber-700 mt-2">Only an admin can reopen a closed period.</div>}
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                <div className="text-red-800 font-semibold mb-1.5">This action is permanent.</div>
                <div className="text-xs text-red-700 mb-2">
                  Removes {data.count} transactions + the statement record + the PDF in storage. Type <span className="font-mono font-bold">DELETE</span> to confirm.
                </div>
                <input
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  placeholder="DELETE"
                  className="input-field text-sm bg-white"
                  disabled={busy}
                  autoComplete="off"
                />
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button
            type="button"
            onClick={performDelete}
            disabled={!canDelete || busy}
            className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Delete statement &amp; transactions
          </button>
        </div>
      </div>
    </Modal>
  );
}

