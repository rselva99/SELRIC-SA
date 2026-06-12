import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency, formatDate, formatStatementPeriod } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  ArrowLeft, CheckCircle2, AlertCircle, Loader2, RotateCw, Info, FileX2,
} from 'lucide-react';

const SIGNED_URL_TTL = 60 * 60;     // 1 hour
const TOLERANCE      = 0.01;        // dollars — totals must agree to the cent

// Storage buckets we look in, in order. The new import flow writes to
// `bank-statements`; legacy bookkeeping uploads ended up in `documents`.
// The PDF-loader tries each before giving up.
const STORAGE_BUCKET_CHAIN = ['bank-statements', 'documents'];

// True when the stored file_path is already a full http(s) URL (some
// older imports stamped public URLs directly into the column). When
// that's the case we skip the signed-URL machinery entirely and let
// the iframe load it as-is.
function looksLikeAbsoluteUrl(p) {
  return typeof p === 'string' && /^https?:\/\//i.test(p);
}

// ── Local row-direction helpers ─────────────────────────────────────────
// Sign of `amount` is the authoritative direction for bank-imported
// rows. The OLD extraction prompt hardcoded `"type": "debit"` for every
// row, so the `type` column on legacy imports is uniformly 'debit' even
// when the row was actually a deposit. JE-mirrored rows (Payroll,
// Capitalize, Depreciation, Opening Balances, Revenue Breakdown,
// Reversal) all carry `bank_statement_id IS NULL` and never reach this
// screen, so we don't need finance.js's type-aware helpers here.
function rowDirection(t) {
  const amt = Number(t?.amount) || 0;
  if (amt < 0) return 'debit';
  if (amt > 0) return 'credit';
  // Exactly zero — defer to whatever the stored type says.
  return t?.type === 'credit' ? 'credit' : 'debit';
}

function withdrawalOf(t) {
  return rowDirection(t) === 'debit'  ? Math.abs(Number(t?.amount) || 0) : 0;
}
function depositOf(t) {
  return rowDirection(t) === 'credit' ? Math.abs(Number(t?.amount) || 0) : 0;
}

// Side-by-side Review & Match. Loads one bank_statements row + its
// transactions, signs a 1-hour URL for the original PDF, shows match
// cards that recompute LIVE from local state as the user edits, and
// persists changes back to the transactions table. Admin-only (the
// route wrapper enforces).
export default function StatementReviewMatch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [state,   setState]   = useState('loading'); // loading | error | ready
  const [error,   setError]   = useState(null);
  const [stmt,    setStmt]    = useState(null);
  const [txns,    setTxns]    = useState([]);
  // pdfState: loading | ok | unavailable
  //   loading      — initial fetch in flight
  //   ok           — a signed URL (or full URL) is in pdfUrl
  //   unavailable  — exhausted every bucket; file is just not there.
  //                  Treat as a permanent absence and show the friendly
  //                  empty state. (Retry stays around for the rare
  //                  transient that masquerades as a 404.)
  const [pdfState, setPdfState] = useState('loading');
  const [pdfUrl,   setPdfUrl]   = useState(null);
  const [pdfRetrying, setPdfRetrying] = useState(false);
  const [savingId, setSavingId] = useState(null);    // txn id currently saving
  const [confirming, setConfirming] = useState(false);

  const loadPdfUrl = useCallback(async (path) => {
    setPdfState('loading');
    setPdfUrl(null);
    if (!path) { setPdfState('unavailable'); return; }

    // (b) Absolute URLs — older imports occasionally wrote a full URL
    // into file_url. Use it as-is; the iframe handles it.
    if (looksLikeAbsoluteUrl(path)) {
      setPdfUrl(path);
      setPdfState('ok');
      return;
    }

    // (a) + (c) Try every known bucket in order. createSignedUrl returns
    // an error rather than throwing for missing objects, so we just move
    // on. A genuine RLS-denied or network failure would surface
    // identically here — the Retry button in the empty state covers both.
    for (const bucket of STORAGE_BUCKET_CHAIN) {
      try {
        const { data, error: e } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, SIGNED_URL_TTL);
        if (!e && data?.signedUrl) {
          setPdfUrl(data.signedUrl);
          setPdfState('ok');
          return;
        }
      } catch (_) {
        // try the next bucket
      }
    }

    setPdfState('unavailable');
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [stmtRes, txnRes] = await Promise.all([
        supabase.from('bank_statements').select('*').eq('id', id).single(),
        supabase.from('transactions')
          .select('id, date, description, supplier, category, amount, type, verified, posted')
          .eq('bank_statement_id', id)
          .order('date', { ascending: true })
          .order('id',   { ascending: true }),
      ]);
      if (stmtRes.error) throw stmtRes.error;
      if (txnRes.error)  throw txnRes.error;
      setStmt(stmtRes.data);
      setTxns(txnRes.data || []);
      await loadPdfUrl(stmtRes.data?.file_path || stmtRes.data?.file_url);
      setState('ready');
    } catch (e) {
      setError(e);
      setState('error');
    }
  }, [id, loadPdfUrl]);

  useEffect(() => { load(); }, [load]);

  // ── Live match cards ──────────────────────────────────────────────────
  const computed = useMemo(() => {
    let withdrawalsTotal = 0, depositsTotal = 0, wCount = 0, dCount = 0;
    for (const t of txns) {
      const w = withdrawalOf(t);
      const d = depositOf(t);
      if (w > 0) { withdrawalsTotal += w; wCount += 1; }
      if (d > 0) { depositsTotal    += d; dCount += 1; }
    }
    return { withdrawalsTotal, depositsTotal, wCount, dCount };
  }, [txns]);

  const totals = stmt?.statement_totals || null;
  const hasTotals = !!(totals && (
    totals.withdrawals_total != null ||
    totals.deposits_total    != null ||
    totals.withdrawal_count  != null ||
    totals.deposit_count     != null
  ));

  function cmpAmount(stmtVal, liveVal) {
    if (stmtVal == null) return { ok: null, delta: null };
    const delta = (Number(liveVal) || 0) - (Number(stmtVal) || 0);
    return { ok: Math.abs(delta) < TOLERANCE, delta };
  }
  function cmpCount(stmtVal, liveVal) {
    if (stmtVal == null) return { ok: null, delta: null };
    const delta = (Number(liveVal) || 0) - (Number(stmtVal) || 0);
    return { ok: delta === 0, delta };
  }

  const matchW   = cmpAmount(totals?.withdrawals_total, computed.withdrawalsTotal);
  const matchD   = cmpAmount(totals?.deposits_total,    computed.depositsTotal);
  const matchWC  = cmpCount(totals?.withdrawal_count,   computed.wCount);
  const matchDC  = cmpCount(totals?.deposit_count,      computed.dCount);

  const overallMatch =
    hasTotals &&
    [matchW.ok, matchD.ok, matchWC.ok, matchDC.ok].every(v => v === true);

  // Aggregate dollar delta — used by the "confirm manually" prompt.
  const totalDollarDelta = (matchW.delta || 0) + (matchD.delta || 0);

  // ── Row editing ───────────────────────────────────────────────────────
  function patchLocal(rowId, patch) {
    setTxns(prev => prev.map(t => t.id === rowId ? { ...t, ...patch } : t));
  }

  async function commitRow(row, patch) {
    setSavingId(row.id);
    try {
      const { error: e } = await supabase.from('transactions').update(patch).eq('id', row.id);
      if (e) throw e;
    } catch (e) {
      toast.error(e.message || 'Could not save');
      // Roll back the optimistic patch so the cell shows the truth again.
      await load();
    } finally {
      setSavingId(null);
    }
  }

  async function handleAmountBlur(row, valueStr) {
    const raw = parseFloat(valueStr);
    if (Number.isNaN(raw)) return;
    // Preserve the sign convention of the original row (bank imports
    // store negative for debits, positive for credits; JE-mirrored rows
    // are positive). Accept the user's magnitude and keep the existing
    // sign.
    const sign = (row.amount ?? 0) < 0 ? -1 : 1;
    const next = Math.abs(raw) * sign;
    if (next === row.amount) return;
    patchLocal(row.id, { amount: next });
    await commitRow(row, { amount: next });
  }

  async function handleDescriptionBlur(row, value) {
    const v = (value || '').trim();
    if (v === (row.description || '')) return;
    patchLocal(row.id, { description: v, supplier: v });
    await commitRow(row, { description: v, supplier: v });
  }

  async function handleVerifiedToggle(row) {
    const next = !row.verified;
    patchLocal(row.id, { verified: next });
    await commitRow(row, { verified: next });
  }

  // ── Confirm Match ─────────────────────────────────────────────────────
  async function confirmMatch() {
    if (!stmt) return;
    let nextStatus;
    if (overallMatch) {
      nextStatus = 'matched';
    } else {
      const offBy = formatCurrency(Math.abs(totalDollarDelta));
      if (!confirm(`Statement totals don't match — off by ${offBy} overall. Confirm manually?`)) return;
      nextStatus = 'confirmed_manually';
    }
    setConfirming(true);
    try {
      const { error: e } = await supabase
        .from('bank_statements')
        .update({ match_status: nextStatus })
        .eq('id', stmt.id);
      if (e) throw e;
      // Update the close_checklist step so the per-step audit trail
      // matches the UI. The step row already exists for any prior touch;
      // upsert covers the "first time" path.
      if (stmt.period) {
        await supabase.from('close_checklist').upsert({
          period:       stmt.period,
          step_key:     'import_statements',
          status:       'done',
          completed_by: user?.id,
          completed_at: new Date().toISOString(),
        }, { onConflict: 'period,step_key' });
      }
      toast.success(nextStatus === 'matched' ? 'Matched to the cent' : 'Confirmed manually');
      setStmt(s => ({ ...s, match_status: nextStatus }));
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally {
      setConfirming(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }
  if (state === 'error' || !stmt) {
    return (
      <div className="max-w-xl mx-auto mt-12 card p-5 border-red-200 bg-red-50 text-sm text-red-700">
        Could not load this statement: {error?.message || 'unknown'}
        <div className="mt-3"><button onClick={() => navigate('/accountant')} className="btn-ghost text-sm">← Back to checklist</button></div>
      </div>
    );
  }

  const range = formatStatementPeriod(stmt.period_start, stmt.period_end);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <button onClick={() => navigate('/accountant')} className="text-xs text-surface-500 hover:text-brand-700 inline-flex items-center gap-1">
            <ArrowLeft size={12} /> Back to checklist
          </button>
          <h1 className="page-title mt-1 truncate">{stmt.file_name}</h1>
          <p className="text-surface-500 text-sm">
            Working period {stmt.period || '—'}{range ? ` · ${range}` : ''} · {txns.length} extracted transactions
          </p>
        </div>
        <button
          onClick={confirmMatch}
          disabled={confirming}
          className={`text-sm px-4 py-2 rounded-lg font-semibold inline-flex items-center gap-2 transition ${overallMatch ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-brand-600 text-white hover:bg-brand-700'} disabled:opacity-50`}
        >
          {confirming && <Loader2 size={14} className="animate-spin" />}
          {overallMatch ? 'Confirm match' : 'Confirm anyway'}
        </button>
      </div>

      {/* Legacy-import notice — brand palette, proper spacing */}
      {!hasTotals && (
        <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4 mb-4 flex items-start gap-3">
          <Info size={18} className="text-brand-700 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold text-brand-900 text-sm">Statement totals unavailable</div>
            <p className="text-xs text-surface-600 mt-1 leading-relaxed">
              This import predates the auto-matching feature, so the bank's printed totals weren't captured.
              The cards below show the extracted sums for reference; <span className="font-semibold text-surface-700">Confirm Match</span> will mark this statement as "confirmed manually".
              Re-import the original PDF on a future close to enable side-by-side total verification.
            </p>
          </div>
        </div>
      )}

      {/* Match cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <MatchCard label="Withdrawals total"   stmt={totals?.withdrawals_total} live={computed.withdrawalsTotal} match={matchW}  format={formatCurrency} />
        <MatchCard label="Deposits total"      stmt={totals?.deposits_total}    live={computed.depositsTotal}    match={matchD}  format={formatCurrency} />
        <MatchCard label="Withdrawals (#)"     stmt={totals?.withdrawal_count}  live={computed.wCount}           match={matchWC} format={(n) => Number(n).toString()} />
        <MatchCard label="Deposits (#)"        stmt={totals?.deposit_count}     live={computed.dCount}           match={matchDC} format={(n) => Number(n).toString()} />
      </div>

      {/* Split view */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: PDF */}
        <div className="card overflow-hidden h-[78vh] flex flex-col">
          <div className="px-4 py-2 border-b border-surface-100 bg-surface-50 text-xs text-surface-500 flex items-center justify-between">
            <span>Original PDF</span>
            {pdfState === 'ok' && pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">Open in new tab</a>
            )}
          </div>
          {pdfState === 'loading' && (
            <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
          )}
          {pdfState === 'ok' && pdfUrl && (
            <iframe title="Statement PDF" src={pdfUrl} className="flex-1 w-full bg-surface-100" />
          )}
          {pdfState === 'unavailable' && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center max-w-sm">
                <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-700 mx-auto mb-3 flex items-center justify-center">
                  <FileX2 size={22} />
                </div>
                <div className="font-semibold text-surface-800">Original PDF isn't available</div>
                <p className="text-xs text-surface-500 mt-1.5 leading-relaxed">
                  Imports made before this feature didn't store the original file. Re-import the statement to enable the side-by-side view; the extracted transactions on the right are still usable.
                </p>
                <button
                  onClick={async () => { setPdfRetrying(true); await loadPdfUrl(stmt.file_path || stmt.file_url); setPdfRetrying(false); }}
                  disabled={pdfRetrying}
                  className="btn-ghost text-xs inline-flex items-center gap-1.5 mt-3"
                >
                  <RotateCw size={12} className={pdfRetrying ? 'animate-spin' : ''} /> Try again
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: editable transactions */}
        <div className="card overflow-hidden h-[78vh] flex flex-col">
          <div className="px-4 py-2 border-b border-surface-100 bg-surface-50 text-xs text-surface-500 flex items-center justify-between">
            <span>Extracted transactions</span>
            <span>{txns.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b border-surface-100 text-[10px] uppercase tracking-wider text-surface-500">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Category</th>
                </tr>
              </thead>
              <tbody>
                {txns.map(t => {
                  const dir = rowDirection(t);
                  return (
                    <tr key={t.id} className={`border-b border-surface-50 ${t.verified ? 'bg-green-50/40' : ''}`}>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!t.verified}
                          onChange={() => handleVerifiedToggle(t)}
                          disabled={savingId === t.id}
                          title="Verified"
                        />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="px-3 py-1.5">
                        <input
                          defaultValue={t.description || ''}
                          onBlur={(e) => handleDescriptionBlur(t, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          className="w-full bg-transparent text-sm focus:bg-white focus:border focus:border-brand-300 rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          defaultValue={Math.abs(Number(t.amount) || 0).toFixed(2)}
                          type="number"
                          step="0.01"
                          min="0"
                          onBlur={(e) => handleAmountBlur(t, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          className="w-28 text-right bg-transparent font-mono text-sm focus:bg-white focus:border focus:border-brand-300 rounded px-1 py-0.5"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        <span className={`uppercase tracking-wider px-1.5 py-0.5 rounded-full ${dir === 'debit' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                          {dir}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-surface-600">{t.category || <span className="text-surface-400">—</span>}</td>
                    </tr>
                  );
                })}
                {txns.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-surface-400">No transactions extracted.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchCard({ label, stmt, live, match, format }) {
  const noStmt = stmt == null;
  const tone   = noStmt ? 'neutral' : match.ok ? 'good' : 'bad';
  const cls = {
    neutral: 'border-surface-100',
    good:    'border-green-200 bg-green-50/40',
    bad:     'border-red-200 bg-red-50/40',
  }[tone];
  return (
    <div className={`card p-3 border ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold flex items-center gap-1.5">
        {label}
        {!noStmt && (
          match.ok
            ? <CheckCircle2 size={12} className="text-green-600" />
            : <AlertCircle size={12} className="text-red-600" />
        )}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-surface-400">Statement</div>
          <div className="font-mono font-semibold">{noStmt ? '—' : format(stmt)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-surface-400">Extracted</div>
          <div className="font-mono font-semibold">{format(live)}</div>
        </div>
      </div>
      {!noStmt && !match.ok && (
        <div className="mt-1.5 text-[11px] text-red-700">
          Off by {typeof match.delta === 'number' && Math.abs(match.delta) >= 1 ? format(Math.abs(match.delta)) : format(Math.abs(match.delta || 0))}
        </div>
      )}
    </div>
  );
}
