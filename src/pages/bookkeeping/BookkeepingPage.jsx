import { useState, useMemo } from 'react';
import { useData } from '../../contexts/DataContext';
import { extractBankStatement, extractInvoice } from '../../lib/claude';
import { formatCurrency, formatDate, fileToBase64, DEFAULT_CATEGORIES } from '../../lib/utils';
import FileDropZone from '../../components/ui/FileDropZone';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  Upload, FileText, Receipt, ArrowRightLeft, Search, Filter, Download,
  ChevronDown, Check, X, Eye, Trash2, Tag,
} from 'lucide-react';

export default function BookkeepingPage() {
  const {
    transactions, bankStatements, invoices, categories,
    addTransaction, addBankStatement, addInvoice, updateTransaction,
    deleteTransaction, uploadFile, supplierCategories, addSupplierCategory,
  } = useData();

  const [activeTab, setActiveTab] = useState('transactions');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadType, setUploadType] = useState('bank'); // bank | invoice
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [editingTxn, setEditingTxn] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_CATEGORIES, ...categories.map((c) => c.name)]);
    return [...set].sort();
  }, [categories]);

  const filteredTransactions = useMemo(() => {
    let list = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.description?.toLowerCase().includes(q) ||
          t.supplier_name?.toLowerCase().includes(q) ||
          t.category?.toLowerCase().includes(q)
      );
    }
    if (filterCategory) list = list.filter((t) => t.category === filterCategory);
    return list;
  }, [transactions, search, filterCategory]);

  async function handleUpload(files) {
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const base64 = await fileToBase64(file);
        const mediaType = file.type || 'application/pdf';

        if (uploadType === 'bank') {
          const extracted = await extractBankStatement(base64, mediaType);
          // Upload file to storage
          const fileUrl = await uploadFile(file, 'bank-statements');
          const stmt = await addBankStatement({
            filename: file.name,
            file_url: fileUrl,
            uploaded_at: new Date().toISOString(),
            transaction_count: extracted.transactions?.length || 0,
          });
          // Add extracted transactions
          if (extracted.transactions?.length) {
            for (const t of extracted.transactions) {
              const suggestedCat = supplierCategories.find(
                (sc) => sc.supplier_name?.toLowerCase() === t.description?.toLowerCase()
              );
              await addTransaction({
                date: t.date,
                description: t.description || '',
                supplier_name: t.description || '',
                amount: parseFloat(t.amount) || 0,
                type: t.type || (parseFloat(t.amount) < 0 ? 'debit' : 'credit'),
                category: suggestedCat?.category || '',
                bank_statement_id: stmt?.id,
                status: 'unreconciled',
              });
            }
            toast.success(`Extracted ${extracted.transactions.length} transactions from ${file.name}`);
          }
        } else {
          const extracted = await extractInvoice(base64, mediaType);
          const fileUrl = await uploadFile(file, 'invoices');
          const suggestedCat = supplierCategories.find(
            (sc) => sc.supplier_name?.toLowerCase() === extracted.supplier_name?.toLowerCase()
          );
          await addInvoice({
            filename: file.name,
            file_url: fileUrl,
            supplier_name: extracted.supplier_name || '',
            amount: parseFloat(extracted.total_amount) || 0,
            date: extracted.invoice_date || new Date().toISOString().slice(0, 10),
            due_date: extracted.due_date || '',
            payment_terms: extracted.payment_terms || '',
            category: suggestedCat?.category || '',
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

  async function handleCategorize(txnId, category) {
    const txn = transactions.find((t) => t.id === txnId);
    await updateTransaction(txnId, { category });
    // Remember supplier→category mapping
    if (txn?.supplier_name && category) {
      const existing = supplierCategories.find(
        (sc) => sc.supplier_name?.toLowerCase() === txn.supplier_name.toLowerCase()
      );
      if (!existing) {
        await addSupplierCategory({ supplier_name: txn.supplier_name, category });
      }
    }
    toast.success('Category updated');
    setEditingTxn(null);
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Bookkeeping</h1>
          <p className="text-surface-500 text-sm mt-0.5">Upload documents, categorize transactions, reconcile</p>
        </div>
        <div className="flex gap-2">
          <Link to="/bookkeeping/reconcile" className="btn-secondary flex items-center gap-2">
            <ArrowRightLeft size={16} /> Reconcile
          </Link>
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
      <div className="flex gap-1 bg-surface-100 rounded-lg p-1 mb-6 w-fit">
        {[
          { id: 'transactions', label: 'Transactions', count: transactions.length },
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
            {tab.label} <span className="ml-1 text-xs opacity-60">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                type="text"
                placeholder="Search transactions..."
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

          {filteredTransactions.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No transactions yet"
              description="Upload a bank statement to get started"
              action={{ label: 'Upload Statement', onClick: () => { setUploadType('bank'); setShowUploadModal(true); } }}
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-100">
                      <th className="table-header">Date</th>
                      <th className="table-header">Description</th>
                      <th className="table-header">Category</th>
                      <th className="table-header text-right">Amount</th>
                      <th className="table-header">Status</th>
                      <th className="table-header w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((t) => (
                      <tr key={t.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                        <td className="table-cell font-medium max-w-[220px] truncate">{t.description || t.supplier_name || '—'}</td>
                        <td className="table-cell">
                          {editingTxn === t.id ? (
                            <select
                              autoFocus
                              defaultValue={t.category || ''}
                              onChange={(e) => handleCategorize(t.id, e.target.value)}
                              onBlur={() => setEditingTxn(null)}
                              className="input-field text-xs py-1"
                            >
                              <option value="">Select category</option>
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
                        <td className={`table-cell text-right font-mono ${t.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                          {t.type === 'credit' ? '+' : '-'}{formatCurrency(Math.abs(t.amount))}
                        </td>
                        <td className="table-cell">
                          <span className={`text-xs rounded-full px-2 py-0.5 ${
                            t.status === 'reconciled' ? 'badge-green' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {t.status || 'unreconciled'}
                          </span>
                        </td>
                        <td className="table-cell">
                          <button
                            onClick={() => deleteTransaction(t.id)}
                            className="p-1 text-surface-400 hover:text-red-500 transition"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Bank Statements Tab */}
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
              {bankStatements.map((s) => (
                <div key={s.id} className="card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
                      <FileText size={18} className="text-brand-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{s.filename}</p>
                      <p className="text-xs text-surface-500">
                        {formatDate(s.uploaded_at)} · {s.transaction_count || 0} transactions
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {s.file_url && (
                      <a href={s.file_url} target="_blank" rel="noreferrer" className="btn-ghost text-xs flex items-center gap-1">
                        <Eye size={14} /> View
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Invoices Tab */}
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
            <div className="grid gap-3">
              {invoices.map((inv) => (
                <div key={inv.id} className="card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                      <Receipt size={18} className="text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{inv.supplier_name || inv.filename}</p>
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
                      <a href={inv.file_url} target="_blank" rel="noreferrer" className="btn-ghost text-xs flex items-center gap-1">
                        <Eye size={14} /> View
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Upload Modal */}
      <Modal open={showUploadModal} onClose={() => setShowUploadModal(false)} title={uploadType === 'bank' ? 'Upload Bank Statement' : 'Upload Invoice'} size="lg">
        <div className="p-1">
          <p className="text-sm text-surface-500 mb-4">
            {uploadType === 'bank'
              ? 'Upload a bank statement PDF. Claude AI will extract all transactions automatically.'
              : 'Upload an invoice (PDF or image). Claude AI will extract supplier, amount, date, and more.'}
          </p>
          {uploading ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <Spinner size="lg" />
              <p className="text-sm text-surface-500">Processing with Claude AI...</p>
              <p className="text-xs text-surface-400">This may take 10-30 seconds</p>
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
    </div>
  );
}
