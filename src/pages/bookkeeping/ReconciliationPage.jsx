import { useState, useMemo, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { formatCurrency, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Link2, Search, Eye } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';

export default function ReconciliationPage() {
  const [transactions, setTransactions] = useState([]);
  const [invoices,     setInvoices]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [selectedTxn,  setSelectedTxn]  = useState(null);
  const [selectedInv,  setSelectedInv]  = useState(null);
  const [search,       setSearch]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [txnRes, invRes] = await Promise.all([
      // Fetch unreconciled debit transactions — uses the correct 'reconciled' boolean column
      supabase.from('transactions').select('*').eq('type', 'debit').eq('reconciled', false).order('date', { ascending: false }).limit(200),
      // Fetch non-matched invoices — uses the invoice status column (pending/paid/overdue/cancelled)
      supabase.from('invoices').select('*').in('status', ['pending', 'overdue']).order('date', { ascending: false }).limit(200),
    ]);
    setTransactions(txnRes.data || []);
    setInvoices(invRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const unreconciledTxns = useMemo(() => {
    let list = [...transactions];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t => t.description?.toLowerCase().includes(q) || t.supplier?.toLowerCase().includes(q));
    }
    return list;
  }, [transactions, search]);

  const pendingInvoices = useMemo(() => invoices, [invoices]);

  const reconciledCount = useMemo(
    () => transactions.filter(t => t.reconciled).length,
    [transactions]
  );

  async function handleMatch() {
    if (!selectedTxn || !selectedInv) { toast.error('Select one transaction and one invoice'); return; }
    const [txnRes, invRes] = await Promise.all([
      // Correct field: 'reconciled' boolean, not 'status'
      supabase.from('transactions').update({ reconciled: true, invoice_id: selectedInv }).eq('id', selectedTxn),
      // Invoice status: use 'paid' (valid value in the CHECK constraint)
      supabase.from('invoices').update({ status: 'paid' }).eq('id', selectedInv),
    ]);
    if (txnRes.error || invRes.error) { toast.error('Match failed'); return; }
    toast.success('Matched successfully!');
    setSelectedTxn(null);
    setSelectedInv(null);
    load();
  }

  async function handleMarkReconciled(txnId) {
    const { error } = await supabase.from('transactions').update({ reconciled: true }).eq('id', txnId);
    if (error) { toast.error('Failed to reconcile'); return; }
    toast.success('Marked as reconciled');
    setSelectedTxn(null);
    load();
  }

  async function openFile(inv) {
    if (!inv.file_url) return;
    try {
      const { data } = await supabase.storage.from('invoices').createSignedUrl(inv.file_url, 3600);
      if (data) window.open(data.signedUrl, '_blank', 'noreferrer');
    } catch { toast.error('Could not open file'); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/bookkeeping" className="p-2 hover:bg-surface-100 rounded-lg transition">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="page-title">Reconciliation</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            Match bank transactions with invoices · {reconciledCount} reconciled
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input type="text" placeholder="Search transactions…" value={search} onChange={e => setSearch(e.target.value)} className="input-field pl-9" />
        </div>
        <button onClick={handleMatch} disabled={!selectedTxn || !selectedInv} className="btn-primary flex items-center gap-2 disabled:opacity-40">
          <Link2 size={16} /> Match Selected
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bank Transactions */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
            <h3 className="section-title">Bank Transactions ({unreconciledTxns.length})</h3>
            <p className="text-xs text-surface-400 mt-0.5">Select one to match with an invoice</p>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {unreconciledTxns.length === 0 ? (
              <div className="p-8 text-center text-sm text-surface-400">All transactions reconciled!</div>
            ) : (
              unreconciledTxns.map(t => (
                <button key={t.id} onClick={() => setSelectedTxn(selectedTxn === t.id ? null : t.id)}
                  className={`w-full text-left px-5 py-3 border-b border-surface-50 transition hover:bg-brand-50/50 ${selectedTxn === t.id ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-surface-800 truncate max-w-[200px]">{t.description || t.supplier || '—'}</p>
                      <p className="text-xs text-surface-400 font-mono mt-0.5">{formatDate(t.date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-semibold text-red-600">−{formatCurrency(Math.abs(t.amount))}</p>
                      {t.category && <p className="text-xs text-surface-400">{t.category}</p>}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          {selectedTxn && (
            <div className="px-5 py-3 border-t border-surface-100 bg-surface-50">
              <button onClick={() => handleMarkReconciled(selectedTxn)} className="btn-ghost text-xs flex items-center gap-1">
                <Check size={14} /> Mark reconciled (no invoice)
              </button>
            </div>
          )}
        </div>

        {/* Invoices */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-100 bg-surface-50">
            <h3 className="section-title">Pending Invoices ({pendingInvoices.length})</h3>
            <p className="text-xs text-surface-400 mt-0.5">Select one to match with a transaction</p>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {pendingInvoices.length === 0 ? (
              <div className="p-8 text-center text-sm text-surface-400">No pending invoices</div>
            ) : (
              pendingInvoices.map(inv => (
                <button key={inv.id} onClick={() => setSelectedInv(selectedInv === inv.id ? null : inv.id)}
                  className={`w-full text-left px-5 py-3 border-b border-surface-50 transition hover:bg-purple-50/50 ${selectedInv === inv.id ? 'bg-purple-50 border-l-2 border-l-purple-500' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-surface-800 truncate max-w-[200px]">{inv.supplier || inv.file_name}</p>
                      <p className="text-xs text-surface-400 font-mono mt-0.5">
                        {formatDate(inv.date)}{inv.due_date ? ` · Due: ${formatDate(inv.due_date)}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-semibold text-surface-800">{formatCurrency(inv.amount)}</p>
                      {inv.file_url && (
                        <button onClick={e => { e.stopPropagation(); openFile(inv); }}
                          className="text-xs text-brand-600 hover:underline flex items-center gap-1 ml-auto">
                          <Eye size={11} /> View
                        </button>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Match preview */}
      {selectedTxn && selectedInv && (
        <div className="mt-6 card p-5 border-brand-200 bg-brand-50/30">
          <h3 className="section-title mb-3">Match Preview</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {[
              { label: 'Transaction', item: transactions.find(x => x.id === selectedTxn), amount: t => `−${formatCurrency(Math.abs(t.amount))}` },
              { label: 'Invoice',     item: invoices.find(x => x.id === selectedInv),    amount: t => formatCurrency(t.amount) },
            ].map(({ label, item, amount }) => item ? (
              <div key={label}>
                <p className="text-xs text-surface-500 uppercase tracking-wider mb-1">{label}</p>
                <p className="font-medium">{item.description || item.supplier || item.supplier_name || '—'}</p>
                <p className="text-surface-500 font-mono">{formatDate(item.date)} · {amount(item)}</p>
              </div>
            ) : null)}
          </div>
          {(() => {
            const t = transactions.find(x => x.id === selectedTxn);
            const inv = invoices.find(x => x.id === selectedInv);
            if (t && inv && Math.abs(Math.abs(t.amount) - inv.amount) > 0.01)
              return <div className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">⚠️ Amount mismatch: {formatCurrency(Math.abs(t.amount))} ≠ {formatCurrency(inv.amount)}</div>;
          })()}
        </div>
      )}
    </div>
  );
}
