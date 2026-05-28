import { useState, useMemo } from 'react';
import { useData } from '../../contexts/DataContext';
import { extractBankStatement, extractInvoice } from '../../lib/claude';
import { formatCurrency, formatDate, fileToBase64, fuzzyMatchCategory, DEFAULT_CATEGORIES } from '../../lib/utils';
import FileDropZone from '../../components/ui/FileDropZone';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  FileText, Receipt, ArrowRightLeft, Search, Eye, Trash2,
  ChevronDown, ChevronRight, BookCheck, RotateCcw, PenLine,
  FolderOpen, Folder,
} from 'lucide-react';

const ALLOWED_BANK_TYPES = ['application/pdf'];
const ALLOWED_INVOICE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_SIZE_MB = 3;

export default function BookkeepingPage() {
  const {
    transactions, bankStatements, invoices, categories, accounts,
    addTransaction, addBankStatement, addInvoice,
    updateTransaction, deleteTransaction,
    postTransaction, unpostTransaction, learnSupplierCategory,
    uploadFile, getSignedUrl, supplierCategories,
  } = useData();

  // Tab: 'transactions' | 'posted' | 'statements' | 'invoices'
  const [activeTab, setActiveTab] = useState('transactions');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [uploadType, setUploadType] = useState('bank');
  const [uploading, setUploading] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [editingTxn, setEditingTxn] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [collapsedYears, setCollapsedYears] = useState(new Set());
  const [manualForm, setManualForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: '',
    amount: '',
    type: 'debit',
    category: '',
    account_id: '',
    reference: '',
  });

  // ── Derived data ──────────────────────────────────────────

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_CATEGORIES, ...categories.map((c) => c.name)]);
    return [...set].sort();
  }, [categories]);

  const unpostedTransactions = useMemo(() =>
    transactions.filter((t) => !t.posted).sort((a, b) => new Date(b.date) - new Date(a.date)),
    [transactions]
  );

  const postedTransactions = useMemo(() =>
    transactions.filter((t) => t.posted).sort((a, b) => new Date(b.date) - new Date(a.date)),
    [transactions]
  );

  const filteredUnposted = useMemo(() => {
    let list = [...unpostedTransactions];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.description?.toLowerCase().includes(q) ||
          t.category?.toLowerCase().includes(q)
      );
    }
    if (filterCategory) list = list.filter((t) => t.category === filterCategory);
    return list;
  }, [unpostedTransactions, search, filterCategory]);

  // Group unposted transactions by bank_statement_id ('manual' for those without)
  const statementGroups = useMemo(() => {
    const groups = {};
    for (const t of filteredUnposted) {
      const key = t.bank_statement_id || 'manual';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return groups;
  }, [filteredUnposted]);

  // Fast lookup: statement id → statement object
  const stmtMap = useMemo(() => {
    const map = {};
    bankStatements.forEach((s) => { map[s.id] = s; });
    return map;
  }, [bankStatements]);

  // Ordered group keys: real statements first (sorted by upload date desc), then 'manual'
  const orderedGroupKeys = useMemo(() => {
    const stmtKeys = Object.keys(statementGroups)
      .filter((k) => k !== 'manual')
      .sort((a, b) => {
        const sa = stmtMap[a], sb = stmtMap[b];
        return new Date(sb?.created_at || 0) - new Date(sa?.created_at || 0);
      });
    if (statementGroups.manual) stmtKeys.push('manual');
    return stmtKeys;
  }, [statementGroups, stmtMap]);

  // Invoice year groups for year-folder view
  const invoiceYearGroups = useMemo(() => {
    const years = {};
    invoices.forEach((inv) => {
      const yr = inv.date
        ? new Date(inv.date + 'T00:00:00').getFullYear()
        : new Date(inv.created_at).getFullYear();
      if (!years[yr]) years[yr] = [];
      years[yr].push(inv);
    });
    return Object.entries(years)
      .sort(([a], [b]) => parseInt(b) - parseInt(a))
      .map(([year, items]) => ({
        year: parseInt(year),
        invoices: items.sort(
          (a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at)
        ),
      }));
  }, [invoices]);

  // ── Helpers ───────────────────────────────────────────────

  function toggleGroup(key) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleYear(year) {
    setCollapsedYears((prev) => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });
  }

  async function handleCategorize(txn, category) {
    await updateTransaction(txn.id, { category });
    setEditingTxn(null);
    const supplier = txn.description || txn.supplier;
    if (supplier && category) {
      const propagated = await learnSupplierCategory(supplier, category);
      if (propagated > 0)
        toast.success(`Auto-categorized ${propagated} more transaction${propagated !== 1 ? 's' : ''}`);
    }
  }

  async function handlePost(txnId) {
    const propagated = await postTransaction(txnId);
    if (propagated > 0)
      toast.success(`Auto-categorized ${propagated} transaction${propagated !== 1 ? 's' : ''}`);
  }

  // ── Upload handler ────────────────────────────────────────

  async function handleUpload(files) {
    if (!files.length) return;

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast.error(`${file.name} exceeds ${MAX_FILE_SIZE_MB}MB limit`);
        return;
      }
      const allowed = uploadType === 'bank' ? ALLOWED_BANK_TYPES : ALLOWED_INVOICE_TYPES;
      if (!allowed.includes(file.type)) {
        toast.error(`${file.name} is not a supported file type`);
        return;
      }
    }

    setUploading(true);
    try {
      for (const file of files) {
        const base64 = await fileToBase64(file);
        const mediaType = file.type || 'application/pdf';

        if (uploadType === 'bank') {
          const extracted = await extractBankStatement(base64, mediaType);
          // Use 'documents' bucket (consistent with view button and schema)
          const uploadResult = await uploadFile('documents', `${Date.now()}_${file.name}`, file);
          const fileUrl = uploadResult?.path || '';
          const stmt = await addBankStatement({
            file_name: file.name,
            file_url: fileUrl,
            upload_date: new Date().toISOString(),
            transaction_count: extracted.transactions?.length || 0,
          });

          if (extracted.transactions?.length) {
            for (const t of extracted.transactions) {
              const suggestedCat = fuzzyMatchCategory(t.description || '', supplierCategories);
              await addTransaction({
                date: t.date,
                description: t.description || '',
                supplier: t.description || '',
                amount: parseFloat(t.amount) || 0,
                type: t.type || (parseFloat(t.amount) < 0 ? 'debit' : 'credit'),
                category: suggestedCat,
                bank_statement_id: stmt?.id,
                posted: false,
              });
            }
            toast.success(`Extracted ${extracted.transactions.length} transactions from ${file.name}`);
          }
        } else {
          const extracted = await extractInvoice(base64, mediaType);
          const uploadResult = await uploadFile('invoices', `${Date.now()}_${file.name}`, file);
          const fileUrl = uploadResult?.path || '';
          const suggestedCat = fuzzyMatchCategory(extracted.supplier_name || '', supplierCategories);
          await addInvoice({
            file_name: file.name,
            file_url: fileUrl,
            supplier: extracted.supplier_name || '',
            amount: parseFloat(extracted.total_amount) || 0,
            date: extracted.invoice_date || new Date().toISOString().slice(0, 10),
            due_date: extracted.due_date || null,
            payment_terms: extracted.payment_terms || '',
            category: suggestedCat,
            status: 'pending',
            extracted_data: extracted,
          });
          toast.success(`Invoice from ${extracted.supplier_name || file.name} processed`);
        }
      }
    } catch (err) {
      toast.error(err.message || 'Upload failed');
      console.error(err);
    } finally {
      setUploading(false);
      setShowUploadModal(false);
    }
  }

  // ── Manual transaction ─────────────────────────────────────

  async function handleManualSubmit(e) {
    e.preventDefault();
    if (!manualForm.description || !manualForm.amount || !manualForm.date) {
      toast.error('Date, description, and amount are required');
      return;
    }
    setSavingManual(true);
    try {
      await addTransaction({
        date: manualForm.date,
        description: manualForm.description,
        supplier: manualForm.description,
        amount: Math.abs(parseFloat(manualForm.amount)),
        type: manualForm.type,
        category: manualForm.category || '',
        account_id: manualForm.account_id || null,
        reference: manualForm.reference || '',
        bank_statement_id: null,
        posted: false,
      });
      toast.success('Transaction added');
      setShowManualModal(false);
      setManualForm({
        date: new Date().toISOString().slice(0, 10),
        description: '',
        amount: '',
        type: 'debit',
        category: '',
        account_id: '',
        reference: '',
      });
    } catch (err) {
      toast.error(err.message || 'Failed to add transaction');
    } finally {
      setSavingManual(false);
    }
  }

  // ── Shared transaction row renderer ───────────────────────

  function TxnRow({ t, showPost = false, showUnpost = false }) {
    return (
      <tr className="border-b border-surface-50 hover:bg-surface-50 transition">
        <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(t.date)}</td>
        <td className="table-cell font-medium max-w-[200px] truncate" title={t.description}>
          {t.description || '—'}
        </td>
        <td className="table-cell">
          {editingTxn === t.id ? (
            <select
              autoFocus
              defaultValue={t.category || ''}
              onChange={(e) => handleCategorize(t, e.target.value)}
              onBlur={() => setEditingTxn(null)}
              className="input-field text-xs py-1 w-44"
            >
              <option value="">Uncategorized</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingTxn(t.id)}
              className={`text-xs rounded-full px-2.5 py-0.5 transition ${
                t.category
                  ? 'badge-green cursor-pointer hover:opacity-80'
                  : 'bg-surface-100 text-surface-500 hover:bg-surface-200 cursor-pointer'
              }`}
            >
              {t.category || '+ Categorize'}
            </button>
          )}
        </td>
        <td className={`table-cell text-right font-mono text-sm ${t.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
          {t.type === 'credit' ? '+' : '−'}{formatCurrency(Math.abs(t.amount))}
        </td>
        <td className="table-cell">
          <span className={`text-xs rounded-full px-2 py-0.5 ${
            t.type === 'credit' ? 'badge-green' : 'bg-amber-100 text-amber-700'
          }`}>
            {t.type}
          </span>
        </td>
        <td className="table-cell">
          <div className="flex items-center gap-1 justify-end">
            {showPost && (
              <button
                onClick={() => handlePost(t.id)}
                title="Post to Ledger"
                className="p-1.5 text-surface-400 hover:text-brand-600 transition"
              >
                <BookCheck size={14} />
              </button>
            )}
            {showUnpost && (
              <button
                onClick={() => unpostTransaction(t.id)}
                title="Unpost"
                className="p-1.5 text-surface-400 hover:text-amber-600 transition"
              >
                <RotateCcw size={14} />
              </button>
            )}
            <button
              onClick={() => deleteTransaction(t.id)}
              title="Delete"
              className="p-1.5 text-surface-400 hover:text-red-500 transition"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const TABLE_HEAD = (
    <thead>
      <tr className="border-b border-surface-100">
        <th className="table-header">Date</th>
        <th className="table-header">Description</th>
        <th className="table-header">Category</th>
        <th className="table-header text-right">Amount</th>
        <th className="table-header">Type</th>
        <th className="table-header w-24"></th>
      </tr>
    </thead>
  );

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Bookkeeping</h1>
          <p className="text-surface-500 text-sm mt-0.5">Upload documents, categorize and post transactions</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/bookkeeping/reconcile" className="btn-secondary flex items-center gap-2">
            <ArrowRightLeft size={16} /> Reconcile
          </Link>
          <button
            onClick={() => setShowManualModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <PenLine size={16} /> Manual Entry
          </button>
          <button
            onClick={() => { setUploadType('bank'); setShowUploadModal(true); }}
            className="btn-secondary flex items-center gap-2"
          >
            <FileText size={16} /> Bank Statement
          </button>
          <button
            onClick={() => { setUploadType('invoice'); setShowUploadModal(true); }}
            className="btn-primary flex items-center gap-2"
          >
            <Receipt size={16} /> Invoice
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-surface-100 rounded-lg p-1 mb-6 w-fit">
        {[
          { id: 'transactions', label: 'Transactions', count: unpostedTransactions.length },
          { id: 'posted', label: 'Posted', count: postedTransactions.length },
          { id: 'statements', label: 'Bank Statements', count: bankStatements.length },
          { id: 'invoices', label: 'Invoices', count: invoices.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === tab.id ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'
            }`}
          >
            {tab.label}{' '}
            <span className="ml-1 text-xs opacity-60">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* ── TRANSACTIONS TAB ── */}
      {activeTab === 'transactions' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                type="text"
                placeholder="Search transactions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-9"
              />
            </div>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="input-field w-auto min-w-[180px]"
            >
              <option value="">All Categories</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {filteredUnposted.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No unposted transactions"
              description={transactions.length > 0 ? 'All transactions have been posted to the ledger' : 'Upload a bank statement or add a manual entry to get started'}
              action={transactions.length === 0
                ? { label: 'Upload Statement', onClick: () => { setUploadType('bank'); setShowUploadModal(true); } }
                : undefined}
            />
          ) : (
            <div className="space-y-3">
              {orderedGroupKeys.map((key) => {
                const groupTxns = statementGroups[key] || [];
                if (!groupTxns.length) return null;
                const isManual = key === 'manual';
                const stmt = isManual ? null : stmtMap[key];
                const isCollapsed = collapsedGroups.has(key);
                const totalDebits = groupTxns
                  .filter((t) => t.type === 'debit')
                  .reduce((s, t) => s + Math.abs(t.amount), 0);

                return (
                  <div key={key} className="card overflow-hidden">
                    {/* Group header */}
                    <button
                      onClick={() => toggleGroup(key)}
                      className="w-full flex items-center justify-between px-5 py-3 bg-surface-50 hover:bg-surface-100 transition border-b border-surface-100"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isCollapsed
                          ? <Folder size={16} className="shrink-0 text-brand-500" />
                          : <FolderOpen size={16} className="shrink-0 text-brand-500" />}
                        <span className="font-medium text-sm truncate">
                          {isManual ? 'Manual Transactions' : (stmt?.file_name || 'Bank Statement')}
                        </span>
                        <span className="text-xs text-surface-400 shrink-0">
                          {groupTxns.length} txn{groupTxns.length !== 1 ? 's' : ''}
                          {!isManual && totalDebits > 0 && (
                            <> · {formatCurrency(totalDebits)} withdrawals</>
                          )}
                        </span>
                      </div>
                      {isCollapsed
                        ? <ChevronRight size={16} className="text-surface-400 shrink-0" />
                        : <ChevronDown size={16} className="text-surface-400 shrink-0" />}
                    </button>

                    {/* Group rows */}
                    {!isCollapsed && (
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          {TABLE_HEAD}
                          <tbody>
                            {groupTxns.map((t) => (
                              <TxnRow key={t.id} t={t} showPost />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── POSTED TAB ── */}
      {activeTab === 'posted' && (
        <>
          {postedTransactions.length === 0 ? (
            <EmptyState
              icon={BookCheck}
              title="Nothing posted yet"
              description="Click the post icon (✓) on any transaction to move it here"
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  {TABLE_HEAD}
                  <tbody>
                    {postedTransactions.map((t) => (
                      <TxnRow key={t.id} t={t} showUnpost />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── BANK STATEMENTS TAB ── */}
      {activeTab === 'statements' && (
        <>
          {bankStatements.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No bank statements"
              description="Upload your first bank statement PDF"
              action={{ label: 'Upload', onClick: () => { setUploadType('bank'); setShowUploadModal(true); } }}
            />
          ) : (
            <div className="grid gap-3">
              {bankStatements.map((s) => {
                const stmtTxns = transactions.filter((t) => t.bank_statement_id === s.id);
                const posted = stmtTxns.filter((t) => t.posted).length;
                return (
                  <div key={s.id} className="card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
                        <FileText size={18} className="text-brand-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{s.file_name}</p>
                        <p className="text-xs text-surface-500">
                          {formatDate(s.upload_date || s.created_at)} · {stmtTxns.length} transactions
                          {stmtTxns.length > 0 && (
                            <span className={posted === stmtTxns.length ? 'text-green-600 ml-1' : 'text-amber-600 ml-1'}>
                              · {posted}/{stmtTxns.length} posted
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {s.file_url && (
                        <button
                          onClick={async () => {
                            try {
                              let url;
                              try {
                                url = await getSignedUrl('documents', s.file_url);
                              } catch {
                                url = await getSignedUrl('bank-statements', s.file_url);
                              }
                              window.open(url, '_blank', 'noreferrer');
                            } catch {
                              toast.error('Could not open file');
                            }
                          }}
                          className="btn-ghost text-xs flex items-center gap-1"
                        >
                          <Eye size={14} /> View
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── INVOICES TAB ── */}
      {activeTab === 'invoices' && (
        <>
          {invoices.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No invoices"
              description="Upload your first invoice"
              action={{ label: 'Upload', onClick: () => { setUploadType('invoice'); setShowUploadModal(true); } }}
            />
          ) : (
            <div className="space-y-3">
              {invoiceYearGroups.map(({ year, invoices: yearInvs }) => {
                const isCollapsed = collapsedYears.has(year);
                return (
                  <div key={year} className="card overflow-hidden">
                    <button
                      onClick={() => toggleYear(year)}
                      className="w-full flex items-center justify-between px-5 py-3 bg-surface-50 hover:bg-surface-100 transition border-b border-surface-100"
                    >
                      <div className="flex items-center gap-2.5">
                        {isCollapsed
                          ? <Folder size={16} className="text-purple-500" />
                          : <FolderOpen size={16} className="text-purple-500" />}
                        <span className="font-medium text-sm">{year}</span>
                        <span className="text-xs text-surface-400">
                          {yearInvs.length} invoice{yearInvs.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {isCollapsed
                        ? <ChevronRight size={16} className="text-surface-400" />
                        : <ChevronDown size={16} className="text-surface-400" />}
                    </button>

                    {!isCollapsed && (
                      <div className="divide-y divide-surface-50">
                        {yearInvs.map((inv) => (
                          <div key={inv.id} className="p-4 flex items-center justify-between hover:bg-surface-50 transition">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center">
                                <Receipt size={16} className="text-purple-600" />
                              </div>
                              <div>
                                <p className="font-medium text-sm">{inv.supplier || inv.file_name}</p>
                                <p className="text-xs text-surface-500">
                                  {formatDate(inv.date)} · {formatCurrency(inv.amount)}
                                  {inv.category ? ` · ${inv.category}` : ''}
                                </p>
                                {inv.due_date && (
                                  <p className="text-xs text-surface-400">Due: {formatDate(inv.due_date)}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {inv.file_url && (
                                <button
                                  onClick={async () => {
                                    try {
                                      const url = await getSignedUrl('invoices', inv.file_url);
                                      window.open(url, '_blank', 'noreferrer');
                                    } catch {
                                      toast.error('Could not open file');
                                    }
                                  }}
                                  className="btn-ghost text-xs flex items-center gap-1"
                                >
                                  <Eye size={14} /> View
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── UPLOAD MODAL ── */}
      <Modal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        title={uploadType === 'bank' ? 'Upload Bank Statement' : 'Upload Invoice'}
        size="lg"
      >
        <div>
          <p className="text-sm text-surface-500 mb-4">
            {uploadType === 'bank'
              ? 'Upload a bank statement PDF. Claude AI will extract all withdrawal transactions and auto-assign categories based on past history.'
              : 'Upload an invoice (PDF or image). Claude AI will extract supplier, amount, date, and more.'}
          </p>
          {uploading ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <Spinner size="lg" />
              <p className="text-sm text-surface-500">Processing with Claude AI…</p>
              <p className="text-xs text-surface-400">This may take 10–30 seconds</p>
            </div>
          ) : (
            <FileDropZone
              accept={uploadType === 'bank' ? '.pdf' : '.pdf,.png,.jpg,.jpeg,.webp'}
              multiple={true}
              onFiles={handleUpload}
              label={uploadType === 'bank' ? 'Drop bank statement PDF here' : 'Drop invoice PDF or image here'}
            />
          )}
        </div>
      </Modal>

      {/* ── MANUAL ENTRY MODAL ── */}
      <Modal open={showManualModal} onClose={() => setShowManualModal(false)} title="Manual Transaction Entry">
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label>
              <input
                type="date"
                value={manualForm.date}
                onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                className="input-field"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Type</label>
              <select
                value={manualForm.type}
                onChange={(e) => setManualForm({ ...manualForm, type: e.target.value })}
                className="input-field"
              >
                <option value="debit">Debit (expense)</option>
                <option value="credit">Credit (income)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Description</label>
            <input
              type="text"
              value={manualForm.description}
              onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })}
              className="input-field"
              placeholder="e.g. Payroll — May 2024"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={manualForm.amount}
              onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
              className="input-field"
              placeholder="0.00"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Category</label>
              <select
                value={manualForm.category}
                onChange={(e) => setManualForm({ ...manualForm, category: e.target.value })}
                className="input-field"
              >
                <option value="">— Uncategorized —</option>
                {allCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Account</label>
              <select
                value={manualForm.account_id}
                onChange={(e) => setManualForm({ ...manualForm, account_id: e.target.value })}
                className="input-field"
              >
                <option value="">— None —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Reference / Notes <span className="text-surface-400 normal-case font-normal">(optional)</span></label>
            <input
              type="text"
              value={manualForm.reference}
              onChange={(e) => setManualForm({ ...manualForm, reference: e.target.value })}
              className="input-field"
              placeholder="Invoice #, journal entry ref, etc."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowManualModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={savingManual} className="btn-primary">
              {savingManual ? <Spinner size="sm" className="text-white" /> : 'Add Transaction'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
