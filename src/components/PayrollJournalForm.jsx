import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { formatCurrency, formatDate } from '../lib/utils';
import Spinner from './ui/Spinner';
import toast from 'react-hot-toast';
import { AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function periodFullLabel(p) { const [y,m] = p.split('-'); return `${MONTHS_FULL[+m-1]} ${y}`; }
function periodRange(p) {
  const [y,m] = p.split('-');
  const last = new Date(+y, +m, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2,'0')}` };
}

async function nextReference() {
  const { data } = await supabase.from('journal_entries')
    .select('reference').order('created_at', { ascending: false }).limit(1);
  const last = data?.[0]?.reference || '';
  const m = last.match(/JE-(\d+)/);
  const n = m ? parseInt(m[1], 10) + 1 : 1;
  return `JE-${String(n).padStart(3, '0')}`;
}

export default function PayrollJournalForm({ period, onPosted, allowPeriodChange = false }) {
  const { user } = useAuth();
  const { accounts } = useData();

  const [activePeriod, setActivePeriod] = useState(period);
  useEffect(() => { setActivePeriod(period); }, [period]);

  const { start: pStart, end: pEnd } = useMemo(() => periodRange(activePeriod), [activePeriod]);

  const [scanning, setScanning]         = useState(false);
  const [venmoTxns, setVenmoTxns]       = useState([]);
  const [existingJE, setExistingJE]     = useState(null);
  const [totalPayroll, setTotalPayroll] = useState('');
  const [accountId, setAccountId]       = useState('');
  const [posting, setPosting]           = useState(false);

  const expenseAccounts = useMemo(() => accounts.filter(a => a.type === 'expense'), [accounts]);

  // Default to Salaries & Wages (or similar) on first load
  useEffect(() => {
    if (accountId) return;
    const sw = accounts.find(a => /salaries\s*&?\s*wages|payroll/i.test(a.name));
    if (sw) setAccountId(sw.id);
  }, [accounts, accountId]);

  // Scan period for Venmo/CashApp payroll txns + any existing payroll JE
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setScanning(true);
      try {
        const [txnRes, jeRes] = await Promise.all([
          supabase.from('transactions')
            .select('id, date, description, amount, type')
            .gte('date', pStart).lte('date', pEnd)
            .eq('posted', true).eq('category', 'Payroll')
            .or('description.ilike.%Venmo%,description.ilike.%Cash App%,description.ilike.%CashApp%')
            .order('date'),
          supabase.from('journal_entries')
            .select('id, reference, total_amount, date')
            .gte('date', pStart).lte('date', pEnd)
            .ilike('description', 'Payroll —%')
            .order('created_at', { ascending: false })
            .limit(1),
        ]);
        if (cancelled) return;
        setVenmoTxns(txnRes.data || []);
        setExistingJE(jeRes.data?.[0] || null);
      } finally {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pStart, pEnd]);

  const venmoTotal = useMemo(() => venmoTxns.reduce((s, t) => s + Math.abs(t.amount), 0), [venmoTxns]);
  const total      = parseFloat(totalPayroll) || 0;
  const remaining  = Math.max(0, total - venmoTotal);
  const shortfall  = total > 0 && total < venmoTotal;

  async function postJE() {
    if (total <= 0) { toast.error('Enter total payroll amount'); return; }
    if (!accountId) { toast.error('Choose the expense account to debit'); return; }
    if (shortfall) { toast.error('Total payroll is less than Venmo/CashApp already posted'); return; }
    if (existingJE && !confirm(`A payroll JE (${existingJE.reference}) already exists for this period. Post another?`)) return;

    setPosting(true);
    try {
      const reference = await nextReference();
      const monthLabel = periodFullLabel(activePeriod);
      const jeDate = pEnd;

      const { data: entry, error: e1 } = await supabase.from('journal_entries').insert({
        reference,
        date: jeDate,
        description: `Payroll — ${monthLabel}`,
        memo: `Total payroll $${total.toFixed(2)} | Venmo/CashApp already posted $${venmoTotal.toFixed(2)} | Check/Other recorded here $${remaining.toFixed(2)}`,
        total_amount: remaining,
        status: 'posted',
        entry_type: 'simple',
        created_by: user?.id || null,
        posted_at: new Date().toISOString(),
      }).select().single();
      if (e1) throw e1;

      const { error: e2 } = await supabase.from('journal_entry_lines').insert({
        journal_entry_id: entry.id,
        account_id: accountId,
        description: `Check/Other payroll for ${monthLabel}`,
        debit_amount: remaining,
        credit_amount: 0,
        category: 'Payroll',
      });
      if (e2) throw e2;

      const { error: e3 } = await supabase.from('transactions').insert({
        date: jeDate,
        description: `Payroll — ${monthLabel}`,
        supplier: 'Payroll JE',
        amount: remaining,
        type: 'debit',
        category: 'Payroll',
        account_id: accountId,
        reference,
        bank_statement_id: null,
        journal_entry_id: entry.id,
        posted: true,
      });
      if (e3) throw e3;

      toast.success(`Posted ${reference} — ${formatCurrency(remaining)}`);
      setTotalPayroll('');
      setExistingJE({ id: entry.id, reference, total_amount: remaining, date: jeDate });
      onPosted?.({ reference, amount: remaining });
    } catch (err) {
      toast.error(err.message || 'Failed to post');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-4">
      {allowPeriodChange && (
        <div>
          <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Period</label>
          <input type="month" value={activePeriod}
            onChange={e => setActivePeriod(e.target.value)}
            className="input-field w-auto" />
        </div>
      )}

      <div className="card p-4 bg-surface-50">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold">
            Venmo / Cash App payroll already posted · {periodFullLabel(activePeriod)}
          </div>
          {scanning && <Spinner size="sm" />}
        </div>
        {!scanning && venmoTxns.length === 0 ? (
          <div className="text-sm text-surface-500 italic">No Venmo / Cash App payroll transactions found.</div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {venmoTxns.map(t => (
                <tr key={t.id} className="border-b border-surface-100 last:border-0">
                  <td className="py-1 pr-2 font-mono text-xs text-surface-500 whitespace-nowrap">{formatDate(t.date)}</td>
                  <td className="py-1 truncate" title={t.description}>{t.description}</td>
                  <td className="py-1 pl-2 text-right font-mono text-xs">{formatCurrency(Math.abs(t.amount))}</td>
                </tr>
              ))}
              {venmoTxns.length > 0 && (
                <tr className="font-semibold">
                  <td colSpan={2} className="pt-2 text-right">Subtotal</td>
                  <td className="pt-2 pl-2 text-right font-mono">{formatCurrency(venmoTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Total payroll for the period</label>
          <input type="number" min="0" step="0.01" value={totalPayroll}
            onChange={e => setTotalPayroll(e.target.value)}
            className="input-field" placeholder="e.g. 15000.00" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Debit account</label>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input-field">
            <option value="">— Choose expense account —</option>
            {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {total > 0 && (
        <div className={`card p-4 ${shortfall ? 'bg-red-50 border-red-200' : 'bg-gradient-to-br from-brand-50 to-green-50'}`}>
          <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold mb-2">Math</div>
          <div className="space-y-1 font-mono text-sm">
            <div className="flex justify-between"><span>Total payroll</span><span>{formatCurrency(total)}</span></div>
            <div className="flex justify-between text-surface-500"><span>− Venmo / Cash App (already posted)</span><span>{formatCurrency(venmoTotal)}</span></div>
            <div className={`flex justify-between border-t border-surface-200 pt-1.5 font-bold ${shortfall ? 'text-red-700' : 'text-brand-700'}`}>
              <span>= Check / Other (this JE)</span>
              <span>{formatCurrency(remaining)}</span>
            </div>
          </div>
          {shortfall && (
            <div className="text-xs text-red-700 mt-2">
              Total payroll is less than the Venmo/CashApp transactions already posted. Increase the total or remove the offending transactions.
            </div>
          )}
        </div>
      )}

      {existingJE && (
        <div className="card p-3 bg-amber-50 border border-amber-200 flex items-center gap-2 text-sm">
          <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
          <span>A payroll JE <span className="font-mono font-semibold">{existingJE.reference}</span> already exists for this period ({formatCurrency(existingJE.total_amount)}).</span>
        </div>
      )}

      <div className="flex justify-end items-center gap-3">
        {existingJE && (
          <span className="text-xs text-green-700 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> Payroll JE recorded for this period
          </span>
        )}
        <button onClick={postJE} disabled={posting || total <= 0 || !accountId || shortfall}
          className="btn-primary flex items-center gap-2">
          {posting && <Loader2 size={14} className="animate-spin" />}
          Post Payroll JE
        </button>
      </div>
    </div>
  );
}
