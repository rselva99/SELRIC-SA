import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency, formatDate, formatStatementPeriod } from '../../lib/utils';
import { debitOf, creditOf } from '../../lib/finance';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  ArrowLeft, CheckCircle2, AlertCircle, Loader2, RotateCw,
} from 'lucide-react';

const STORAGE_BUCKET = 'bank-statements';
const SIGNED_URL_TTL = 60 * 60; // 1 hour

const TOLERANCE = 0.01; // dollars — totals must agree to the cent

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
  const [pdfUrl,  setPdfUrl]  = useState(null);
  const [pdfErr,  setPdfErr]  = useState(null);
  const [pdfRetrying, setPdfRetrying] = useState(false);
  const [savingId, setSavingId] = useState(null);    // txn id currently saving
  const [confirming, setConfirming] = useState(false);

  const loadPdfUrl = useCallback(async (path) => {
    if (!path) return;
    setPdfErr(null);
    try {
      const { data, error: e } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
      if (e) throw e;
      setPdfUrl(data?.signedUrl || null);
    } catch (e) {
      setPdfUrl(null);
      setPdfErr(e.message || 'Could not load PDF');
    }
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
      const d = debitOf(t);
      const c = creditOf(t);
      if (d > 0) { withdrawalsTotal += d; wCount += 1; }
      if (c > 0) { depositsTotal    += c; dCount += 1; }
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

      {!hasTotals && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 mb-4 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber-700 mt-0.5" />
          <div>
            Statement totals unavailable — re-import to enable auto-matching. The extracted sums are shown below for reference; Confirm Match will mark this as "confirmed manually".
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
            {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">Open in new tab</a>}
          </div>
          {pdfErr ? (
            <div className="flex-1 flex items-center justify-center p-5 text-sm text-red-700">
              <div>
                Could not load the PDF: {pdfErr}
                <div className="mt-3">
                  <button
                    onClick={async () => { setPdfRetrying(true); await loadPdfUrl(stmt.file_path || stmt.file_url); setPdfRetrying(false); }}
                    disabled={pdfRetrying}
                    className="btn-ghost text-sm inline-flex items-center gap-1.5"
                  >
                    <RotateCw size={12} className={pdfRetrying ? 'animate-spin' : ''} /> Retry
                  </button>
                </div>
              </div>
            </div>
          ) : pdfUrl ? (
            <iframe title="Statement PDF" src={pdfUrl} className="flex-1 w-full bg-surface-100" />
          ) : (
            <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
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
                {txns.map(t => (
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
                      <span className={`uppercase tracking-wider px-1.5 py-0.5 rounded-full ${t.type === 'debit' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {t.type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-surface-600">{t.category || <span className="text-surface-400">—</span>}</td>
                  </tr>
                ))}
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
