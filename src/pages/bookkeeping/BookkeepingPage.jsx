import { useState, useMemo, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { extractBankStatement, extractInvoice, extractBankStatementFromImages } from '../../lib/claude';
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
  FolderOpen, Folder, MessageSquare,
} from 'lucide-react';

const ALLOWED_BANK_TYPES    = ['application/pdf'];
const ALLOWED_INVOICE_TYPES = ['application/pdf','image/png','image/jpeg','image/webp'];
const MAX_FILE_SIZE_MB      = 3;
const POSTED_PAGE_SIZE      = 50;
const STMTS_PER_PAGE        = 8;
const INV_YEAR              = new Date().getFullYear();
const TXN_BATCH             = 1000; // Supabase's per-request row limit

// Fetch every row from a Supabase query by looping with .range() until
// fewer than TXN_BATCH rows are returned, bypassing the 1,000-row default cap.
async function fetchAllPages(buildQuery) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + TXN_BATCH - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < TXN_BATCH) break;
    from += TXN_BATCH;
  }
  return all;
}

function PageBar({ page, total, pageSize, onPage }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-surface-100 bg-surface-50 text-xs text-surface-500">
      <span>{total.toLocaleString()} total · page {page + 1} / {pages}</span>
      <div className="flex gap-1">
        {[['«',0],['‹',page-1],['›',page+1],['»',pages-1]].map(([l,p]) => (
          <button key={l} onClick={() => onPage(p)} disabled={p < 0 || p >= pages}
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-30">{l}</button>
        ))}
      </div>
    </div>
  );
}

// ── Notes panel — rendered as an extra <tr> below any transaction row ────────
function NotesPanel({ txnId, currentUserId, isAdmin, profileMap, onCountChange }) {
  const [notes,   setNotes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [input,   setInput]   = useState('');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    supabase.from('transaction_notes').select('*')
      .eq('transaction_id', txnId).order('created_at', { ascending: false })
      .then(({ data }) => { setNotes(data || []); setLoading(false); });
  }, [txnId]);

  async function addNote() {
    const text = input.trim();
    if (!text) return;
    setSaving(true);
    const { data, error } = await supabase.from('transaction_notes')
      .insert({ transaction_id: txnId, content: text, user_id: currentUserId })
      .select().single();
    if (!error && data) {
      setNotes(prev => [data, ...prev]);
      onCountChange(txnId, notes.length + 1);
    }
    setInput('');
    setSaving(false);
  }

  async function deleteNote(noteId) {
    await supabase.from('transaction_notes').delete().eq('id', noteId);
    const updated = notes.filter(n => n.id !== noteId);
    setNotes(updated);
    onCountChange(txnId, updated.length);
  }

  return (
    <div className="px-5 py-3 bg-blue-50/40 border-t border-blue-100">
      {/* Add note */}
      <div className="flex gap-2 mb-3">
        <input
          type="text" value={input} autoFocus
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addNote(); }}
          placeholder="Add a note… (Enter to submit)"
          className="input-field text-sm py-1.5 flex-1"
        />
        <button onClick={addNote} disabled={saving || !input.trim()} className="btn-primary text-xs px-3 py-1.5">
          {saving ? <Spinner size="sm" className="text-white" /> : 'Add'}
        </button>
      </div>

      {/* Thread */}
      {loading ? (
        <div className="flex justify-center py-2"><Spinner size="sm" /></div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-surface-400 text-center py-1">No notes yet.</p>
      ) : (
        <div className="space-y-2 max-h-52 overflow-y-auto">
          {notes.map(note => (
            <div key={note.id} className="flex items-start gap-2">
              <div className="flex-1 bg-white rounded-lg px-3 py-2 border border-surface-100 text-xs">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-semibold text-surface-700">{profileMap[note.user_id] || 'User'}</span>
                  <span className="text-surface-400">{formatDate(note.created_at)}</span>
                </div>
                <p className="text-surface-600">{note.content}</p>
              </div>
              {(note.user_id === currentUserId || isAdmin) && (
                <button onClick={() => deleteNote(note.id)} className="p-1 mt-1 text-surface-300 hover:text-red-500 transition shrink-0">
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BookkeepingPage() {
  const { user, isAdmin } = useAuth();
  const {
    categories, supplierCategories,
    addTransaction, updateTransaction, deleteTransaction,
    postTransaction, unpostTransaction, learnSupplierCategory,
    addBankStatement, addInvoice, updateInvoice,
    uploadFile, getSignedUrl,
  } = useData();

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]       = useState('transactions');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [uploadType, setUploadType]     = useState('bank');
  const [uploading, setUploading]         = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [savingManual, setSavingManual]   = useState(false);
  const [search, setSearch]             = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [editingTxn, setEditingTxn]     = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [collapsedYears, setCollapsedYears]   = useState(new Set());

  // ── Notes state ───────────────────────────────────────────────────────────
  const [activeNotesTxnId, setActiveNotesTxnId] = useState(null);
  const [noteCounts, setNoteCounts]             = useState({});
  const [profileMap, setProfileMap]             = useState({});

  useEffect(() => {
    supabase.from('profiles').select('id, full_name')
      .then(({ data }) => {
        const m = {};
        (data || []).forEach(p => { m[p.id] = p.full_name || 'Unknown'; });
        setProfileMap(m);
      });
  }, []);

  // ── Transactions (unposted) — paginated by bank statement ─────────────────
  const [stmts, setStmts]                   = useState([]);
  const [stmtsTotal, setStmtsTotal]         = useState(0);
  const [stmtsPage, setStmtsPage]           = useState(0);
  const [txnsByStmt, setTxnsByStmt]         = useState({});
  const [manualTxns, setManualTxns]         = useState([]);
  const [stmtsLoading, setStmtsLoading]     = useState(true);
  // Real unposted count from DB (not capped by what's currently rendered)
  const [unpostedTotalCount, setUnpostedTotalCount] = useState(0);

  // ── Posted transactions ───────────────────────────────────────────────────
  const [postedTxns, setPostedTxns]     = useState([]);
  const [postedTotal, setPostedTotal]   = useState(0);
  const [postedPage, setPostedPage]     = useState(0);
  const [postedLoading, setPostedLoading] = useState(true);

  // ── Invoices (by year) ────────────────────────────────────────────────────
  const [invoiceYear, setInvoiceYear] = useState(INV_YEAR);
  const [invoices, setInvoices]       = useState([]);
  const [invLoading, setInvLoading]   = useState(true);

  // ── Manual form ───────────────────────────────────────────────────────────
  const [manualForm, setManualForm] = useState({
    date: new Date().toISOString().slice(0,10), description: '', amount: '',
    type: 'debit', category: '', account_id: '', reference: '',
  });

  // ── Load functions ────────────────────────────────────────────────────────

  // Fetch the real unposted count with a head-only query (no row data transferred)
  const loadUnpostedCount = useCallback(async () => {
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('posted', false);
    setUnpostedTotalCount(count || 0);
  }, []);

  const loadUnposted = useCallback(async () => {
    setStmtsLoading(true);

    // 1. Paginate bank statements (small table — one query is fine)
    const from = stmtsPage * STMTS_PER_PAGE;
    const { data: stmtData, count: stmtCount } = await supabase
      .from('bank_statements').select('*', { count: 'exact' })
      .order('created_at', { ascending: false }).range(from, from + STMTS_PER_PAGE - 1);
    setStmts(stmtData || []);
    setStmtsTotal(stmtCount || 0);

    // 2. Fetch ALL unposted transactions for these statements, bypassing the
    //    1,000-row cap by looping with .range() until no more rows are returned.
    let stmtTxnData = [];
    if (stmtData?.length) {
      const ids = stmtData.map(s => s.id);
      stmtTxnData = await fetchAllPages((f, t) => {
        let q = supabase.from('transactions').select('*')
          .eq('posted', false).in('bank_statement_id', ids)
          .order('date', { ascending: false }).range(f, t);
        if (search) q = q.ilike('description', `%${search}%`);
        if (filterCategory) q = q.eq('category', filterCategory);
        return q;
      });
      const grouped = {};
      stmtTxnData.forEach(t => { (grouped[t.bank_statement_id] = grouped[t.bank_statement_id] || []).push(t); });
      setTxnsByStmt(grouped);
    } else {
      setTxnsByStmt({});
    }

    // 3. Manual transactions (no bank_statement_id) — also fully paginated
    const manData = await fetchAllPages((f, t) => {
      let q = supabase.from('transactions').select('*')
        .eq('posted', false).is('bank_statement_id', null)
        .order('date', { ascending: false }).range(f, t);
      if (search) q = q.ilike('description', `%${search}%`);
      if (filterCategory) q = q.eq('category', filterCategory);
      return q;
    });
    setManualTxns(manData);

    // 4. Load note counts for all visible transactions in one query
    const allIds = [...stmtTxnData, ...manData].map(t => t.id);
    if (allIds.length) {
      const { data: nc } = await supabase
        .from('transaction_notes').select('transaction_id').in('transaction_id', allIds);
      const counts = {};
      (nc || []).forEach(n => { counts[n.transaction_id] = (counts[n.transaction_id] || 0) + 1; });
      setNoteCounts(prev => ({ ...prev, ...counts }));
    }

    setStmtsLoading(false);
  }, [stmtsPage, search, filterCategory]);

  const loadPosted = useCallback(async () => {
    setPostedLoading(true);
    const from = postedPage * POSTED_PAGE_SIZE;
    const { data, count } = await supabase.from('transactions').select('*', { count: 'exact' })
      .eq('posted', true).order('date', { ascending: false }).range(from, from + POSTED_PAGE_SIZE - 1);
    setPostedTxns(data || []);
    setPostedTotal(count || 0);
    // Load note counts for this page of posted transactions
    const ids = (data || []).map(t => t.id);
    if (ids.length) {
      const { data: nc } = await supabase
        .from('transaction_notes').select('transaction_id').in('transaction_id', ids);
      const counts = {};
      (nc || []).forEach(n => { counts[n.transaction_id] = (counts[n.transaction_id] || 0) + 1; });
      setNoteCounts(prev => ({ ...prev, ...counts }));
    }
    setPostedLoading(false);
  }, [postedPage]);

  const loadInvoices = useCallback(async () => {
    setInvLoading(true);
    const { data } = await supabase.from('invoices').select('*')
      .gte('date', `${invoiceYear}-01-01`).lte('date', `${invoiceYear}-12-31`)
      .order('date', { ascending: false });
    setInvoices(data || []);
    setInvLoading(false);
  }, [invoiceYear]);

  useEffect(() => { loadUnpostedCount(); }, [loadUnpostedCount]);
  useEffect(() => { if (activeTab === 'transactions') loadUnposted(); }, [loadUnposted, activeTab]);
  useEffect(() => { if (activeTab === 'posted') loadPosted(); }, [loadPosted, activeTab]);
  useEffect(() => { if (activeTab === 'invoices') loadInvoices(); }, [loadInvoices, activeTab]);
  useEffect(() => { setStmtsPage(0); }, [search, filterCategory]);
  useEffect(() => { setPostedPage(0); }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const allCategories = useMemo(() => {
    const set = new Set([...DEFAULT_CATEGORIES, ...categories.map(c => c.name)]);
    return [...set].sort();
  }, [categories]);

  const invoiceYears = useMemo(() => {
    const cur = new Date().getFullYear();
    return [cur - 2, cur - 1, cur, cur + 1].filter(y => y >= 2024);
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function toggleGroup(key) {
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function toggleYear(yr) {
    setCollapsedYears(prev => { const n = new Set(prev); n.has(yr) ? n.delete(yr) : n.add(yr); return n; });
  }

  async function handleCategorize(txn, category) {
    // Optimistic local update
    if (txn.bank_statement_id) {
      setTxnsByStmt(prev => ({ ...prev, [txn.bank_statement_id]: (prev[txn.bank_statement_id]||[]).map(t => t.id===txn.id ? {...t,category} : t) }));
    } else {
      setManualTxns(prev => prev.map(t => t.id===txn.id ? {...t,category} : t));
    }
    setEditingTxn(null);
    await updateTransaction(txn.id, { category });
    const supplier = txn.description || txn.supplier;
    if (supplier && category) {
      const propagated = await learnSupplierCategory(supplier, category);
      if (propagated > 0) { toast.success(`Auto-categorized ${propagated} more transaction${propagated!==1?'s':''}`); loadUnposted(); }
    }
  }

  async function handlePost(txn) {
    if (txn.bank_statement_id) setTxnsByStmt(prev => ({ ...prev, [txn.bank_statement_id]: (prev[txn.bank_statement_id]||[]).filter(t => t.id!==txn.id) }));
    else setManualTxns(prev => prev.filter(t => t.id!==txn.id));
    setUnpostedTotalCount(prev => Math.max(0, prev - 1));
    const propagated = await postTransaction(txn.id, txn);
    if (propagated > 0) { toast.success(`Auto-categorized ${propagated} transaction${propagated!==1?'s':''}`); loadUnposted(); }
    loadUnpostedCount();
  }

  async function handleUnpost(txnId) {
    setPostedTxns(prev => prev.filter(t => t.id!==txnId));
    setPostedTotal(prev => prev - 1);
    await unpostTransaction(txnId);
    loadUnpostedCount();
  }

  async function handleDeleteTxn(txn) {
    if (txn.bank_statement_id) setTxnsByStmt(prev => ({ ...prev, [txn.bank_statement_id]: (prev[txn.bank_statement_id]||[]).filter(t => t.id!==txn.id) }));
    else setManualTxns(prev => prev.filter(t => t.id!==txn.id));
    setUnpostedTotalCount(prev => Math.max(0, prev - 1));
    await deleteTransaction(txn.id);
    loadUnpostedCount();
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  async function handleUpload(files) {
    if (!files.length) return;
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) { toast.error(`${file.name} exceeds ${MAX_FILE_SIZE_MB}MB`); return; }
      const allowed = uploadType === 'bank' ? ALLOWED_BANK_TYPES : ALLOWED_INVOICE_TYPES;
      if (!allowed.includes(file.type)) { toast.error(`${file.name} is not a supported type`); return; }
    }
    setUploading(true);
    try {
      for (const file of files) {
        const mediaType = file.type || 'application/pdf';
        if (uploadType === 'bank') {
          // Vercel Serverless Functions have a hard 4.5 MB request body limit.
          // A PDF > ~3.4 MB becomes > 4.5 MB in base64 and gets rejected with 504.
          // For large PDFs: render each page to a compressed JPEG and send page-by-page.
          // For small PDFs: send the whole file directly (preserves text-layer quality).
          const DIRECT_LIMIT = 3 * 1024 * 1024; // 3 MB raw

          let extracted;
          if (file.size > DIRECT_LIMIT) {
            setUploadProgress('Rendering PDF pages…');
            const { pdfToPageImages } = await import('../../lib/pdfPages');
            const pageImages = await pdfToPageImages(file);
            extracted = await extractBankStatementFromImages(pageImages, (page, total) => {
              setUploadProgress(`Processing page ${page} of ${total}…`);
            });
          } else {
            setUploadProgress('Extracting transactions…');
            const base64 = await fileToBase64(file);
            extracted = await extractBankStatement(base64, mediaType);
          }
          setUploadProgress('');

          const uploadResult = await uploadFile('documents', `${Date.now()}_${file.name}`, file);
          const stmt = await addBankStatement({ file_name: file.name, file_url: uploadResult?.path || '', upload_date: new Date().toISOString(), transaction_count: extracted.transactions?.length || 0 });
          if (extracted.transactions?.length) {
            for (const t of extracted.transactions) {
              const suggestedCat = fuzzyMatchCategory(t.description || '', supplierCategories);
              await addTransaction({ date: t.date, description: t.description||'', supplier: t.description||'', amount: parseFloat(t.amount)||0, type: t.type||(parseFloat(t.amount)<0?'debit':'credit'), category: suggestedCat, bank_statement_id: stmt?.id, posted: false });
            }
            toast.success(`Extracted ${extracted.transactions.length} transactions from ${file.name}`);
          }
        } else {
          const base64 = await fileToBase64(file);
          const extracted = await extractInvoice(base64, mediaType);
          const uploadResult = await uploadFile('invoices', `${Date.now()}_${file.name}`, file);
          const suggestedCat = fuzzyMatchCategory(extracted.supplier_name||'', supplierCategories);
          await addInvoice({ file_name: file.name, file_url: uploadResult?.path||'', supplier: extracted.supplier_name||'', amount: parseFloat(extracted.total_amount)||0, date: extracted.invoice_date||new Date().toISOString().slice(0,10), due_date: extracted.due_date||null, payment_terms: extracted.payment_terms||'', category: suggestedCat, status: 'pending', extracted_data: extracted });
          toast.success(`Invoice from ${extracted.supplier_name||file.name} processed`);
        }
      }
      loadUnposted();
      loadUnpostedCount();
      if (activeTab === 'invoices') loadInvoices();
    } catch (err) { toast.error(err.message || 'Upload failed'); console.error(err); }
    finally { setUploading(false); setUploadProgress(''); setShowUploadModal(false); }
  }

  // ── Manual transaction ────────────────────────────────────────────────────

  async function handleManualSubmit(e) {
    e.preventDefault();
    if (!manualForm.description || !manualForm.amount || !manualForm.date) { toast.error('Date, description, and amount are required'); return; }
    setSavingManual(true);
    try {
      await addTransaction({ date: manualForm.date, description: manualForm.description, supplier: manualForm.description, amount: Math.abs(parseFloat(manualForm.amount)), type: manualForm.type, category: manualForm.category||'', account_id: manualForm.account_id||null, reference: manualForm.reference||'', bank_statement_id: null, posted: false });
      toast.success('Transaction added');
      setShowManualModal(false);
      setManualForm({ date: new Date().toISOString().slice(0,10), description:'', amount:'', type:'debit', category:'', account_id:'', reference:'' });
      loadUnposted();
      loadUnpostedCount();
    } catch (err) { toast.error(err.message || 'Failed'); }
    finally { setSavingManual(false); }
  }

  // ── Shared row renderer ───────────────────────────────────────────────────

  function TxnRow({ t, showPost = false, showUnpost = false }) {
    const noteCount   = noteCounts[t.id] || 0;
    const notesOpen   = activeNotesTxnId === t.id;
    return (
      <>
        <tr className={`border-b border-surface-50 transition ${notesOpen ? 'bg-blue-50/30' : 'hover:bg-surface-50'}`}>
          <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(t.date)}</td>
          <td className="table-cell font-medium max-w-[200px] truncate" title={t.description}>{t.description||'—'}</td>
          <td className="table-cell">
            {editingTxn === t.id ? (
              <select autoFocus defaultValue={t.category||''} onChange={e => handleCategorize(t, e.target.value)} onBlur={() => setEditingTxn(null)} className="input-field text-xs py-1 w-44">
                <option value="">Uncategorized</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <button onClick={() => setEditingTxn(t.id)}
                className={`text-xs rounded-full px-2.5 py-0.5 transition ${t.category ? 'badge-green cursor-pointer hover:opacity-80' : 'bg-surface-100 text-surface-500 hover:bg-surface-200 cursor-pointer'}`}>
                {t.category||'+ Categorize'}
              </button>
            )}
          </td>
          <td className={`table-cell text-right font-mono text-sm ${t.type==='credit'?'text-green-600':'text-red-600'}`}>
            {t.type==='credit'?'+':'−'}{formatCurrency(Math.abs(t.amount))}
          </td>
          <td className="table-cell">
            <span className={`text-xs rounded-full px-2 py-0.5 ${t.type==='credit'?'badge-green':'bg-amber-100 text-amber-700'}`}>{t.type}</span>
          </td>
          <td className="table-cell">
            <div className="flex items-center gap-1 justify-end">
              {/* Note icon — filled/highlighted when notes exist */}
              <button
                onClick={() => setActiveNotesTxnId(notesOpen ? null : t.id)}
                title={noteCount ? `${noteCount} note${noteCount!==1?'s':''}` : 'Add note'}
                className={`p-1.5 relative transition ${noteCount > 0 ? 'text-brand-600' : 'text-surface-300 hover:text-surface-500'}`}
              >
                <MessageSquare size={14} />
                {noteCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 bg-brand-600 text-white rounded-full text-[8px] font-bold flex items-center justify-center px-0.5 leading-none">
                    {noteCount > 9 ? '9+' : noteCount}
                  </span>
                )}
              </button>
              {showPost   && <button onClick={() => handlePost(t)}      title="Post to Ledger" className="p-1.5 text-surface-400 hover:text-brand-600 transition"><BookCheck size={14} /></button>}
              {showUnpost && <button onClick={() => handleUnpost(t.id)} title="Unpost"         className="p-1.5 text-surface-400 hover:text-amber-600 transition"><RotateCcw size={14} /></button>}
              <button onClick={() => handleDeleteTxn(t)} title="Delete" className="p-1.5 text-surface-400 hover:text-red-500 transition"><Trash2 size={14} /></button>
            </div>
          </td>
        </tr>
        {notesOpen && (
          <tr>
            <td colSpan={6} className="p-0">
              <NotesPanel
                txnId={t.id}
                currentUserId={user?.id}
                isAdmin={isAdmin}
                profileMap={profileMap}
                onCountChange={(txnId, count) =>
                  setNoteCounts(prev => ({ ...prev, [txnId]: Math.max(0, count) }))
                }
              />
            </td>
          </tr>
        )}
      </>
    );
  }

  const TABLE_HEAD = (
    <thead><tr className="border-b border-surface-100">
      <th className="table-header">Date</th><th className="table-header">Description</th>
      <th className="table-header">Category</th><th className="table-header text-right">Amount</th>
      <th className="table-header">Type</th><th className="table-header w-24"></th>
    </tr></thead>
  );

  // Use the DB-sourced count so the tab always shows the real number,
  // not just what's visible on the current statement page.
  const unpostedCount = unpostedTotalCount;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Bookkeeping</h1>
          <p className="text-surface-500 text-sm mt-0.5">Upload documents, categorize and post transactions</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/bookkeeping/reconcile" className="btn-secondary flex items-center gap-2"><ArrowRightLeft size={16} /> Reconcile</Link>
          <button onClick={() => setShowManualModal(true)} className="btn-secondary flex items-center gap-2"><PenLine size={16} /> Manual Entry</button>
          <button onClick={() => { setUploadType('bank'); setShowUploadModal(true); }} className="btn-secondary flex items-center gap-2"><FileText size={16} /> Bank Statement</button>
          <button onClick={() => { setUploadType('invoice'); setShowUploadModal(true); }} className="btn-primary flex items-center gap-2"><Receipt size={16} /> Invoice</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-surface-100 rounded-lg p-1 mb-6 w-fit">
        {[
          { id:'transactions', label:'Transactions',    count: unpostedCount },
          { id:'posted',       label:'Posted',          count: postedTotal },
          { id:'statements',   label:'Bank Statements', count: stmtsTotal },
          { id:'invoices',     label:'Invoices',        count: null },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab===tab.id?'bg-white shadow-sm text-surface-900':'text-surface-500 hover:text-surface-700'}`}>
            {tab.label}{tab.count != null && <span className="ml-1 text-xs opacity-60">({tab.count.toLocaleString()})</span>}
          </button>
        ))}
      </div>

      {/* ── TRANSACTIONS TAB ── */}
      {activeTab === 'transactions' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="input-field pl-9" />
            </div>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="input-field w-auto min-w-[180px]">
              <option value="">All Categories</option>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {stmtsLoading ? <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          : unpostedCount === 0 && stmtsTotal === 0 ? (
            <EmptyState icon={FileText} title="No unposted transactions" description="Upload a bank statement or add a manual entry" action={{ label:'Upload Statement', onClick:()=>{ setUploadType('bank'); setShowUploadModal(true); } }} />
          ) : (
            <>
              <div className="space-y-3">
                {stmts.map(stmt => {
                  const grpTxns = txnsByStmt[stmt.id] || [];
                  const isCollapsed = collapsedGroups.has(stmt.id);
                  const total = grpTxns.filter(t=>t.type==='debit').reduce((s,t)=>s+Math.abs(t.amount),0);
                  return (
                    <div key={stmt.id} className="card overflow-hidden">
                      <button onClick={() => toggleGroup(stmt.id)} className="w-full flex items-center justify-between px-5 py-3 bg-surface-50 hover:bg-surface-100 transition border-b border-surface-100">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isCollapsed ? <Folder size={16} className="shrink-0 text-brand-500" /> : <FolderOpen size={16} className="shrink-0 text-brand-500" />}
                          <span className="font-medium text-sm truncate">{stmt.file_name}</span>
                          <span className="text-xs text-surface-400 shrink-0">{grpTxns.length} unposted{total>0&&` · ${formatCurrency(total)} withdrawals`}</span>
                        </div>
                        {isCollapsed ? <ChevronRight size={16} className="text-surface-400 shrink-0" /> : <ChevronDown size={16} className="text-surface-400 shrink-0" />}
                      </button>
                      {!isCollapsed && grpTxns.length > 0 && (
                        <div className="overflow-x-auto"><table className="w-full">{TABLE_HEAD}<tbody>{grpTxns.map(t => <TxnRow key={t.id} t={t} showPost />)}</tbody></table></div>
                      )}
                      {!isCollapsed && grpTxns.length === 0 && <div className="px-5 py-3 text-sm text-surface-400">All transactions in this statement are posted</div>}
                    </div>
                  );
                })}
                {manualTxns.length > 0 && (
                  <div className="card overflow-hidden">
                    <button onClick={() => toggleGroup('manual')} className="w-full flex items-center justify-between px-5 py-3 bg-surface-50 hover:bg-surface-100 transition border-b border-surface-100">
                      <div className="flex items-center gap-2.5">
                        {collapsedGroups.has('manual') ? <Folder size={16} className="text-brand-500" /> : <FolderOpen size={16} className="text-brand-500" />}
                        <span className="font-medium text-sm">Manual Transactions</span>
                        <span className="text-xs text-surface-400">{manualTxns.length} entries</span>
                      </div>
                      {collapsedGroups.has('manual') ? <ChevronRight size={16} className="text-surface-400" /> : <ChevronDown size={16} className="text-surface-400" />}
                    </button>
                    {!collapsedGroups.has('manual') && (
                      <div className="overflow-x-auto"><table className="w-full">{TABLE_HEAD}<tbody>{manualTxns.map(t => <TxnRow key={t.id} t={t} showPost />)}</tbody></table></div>
                    )}
                  </div>
                )}
              </div>
              <PageBar page={stmtsPage} total={stmtsTotal} pageSize={STMTS_PER_PAGE} onPage={setStmtsPage} />
            </>
          )}
        </>
      )}

      {/* ── POSTED TAB ── */}
      {activeTab === 'posted' && (
        postedLoading ? <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        : postedTotal === 0 ? (
          <EmptyState icon={BookCheck} title="Nothing posted yet" description="Click the post icon on any transaction" />
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full">{TABLE_HEAD}<tbody>{postedTxns.map(t => <TxnRow key={t.id} t={t} showUnpost />)}</tbody></table></div>
            <PageBar page={postedPage} total={postedTotal} pageSize={POSTED_PAGE_SIZE} onPage={setPostedPage} />
          </div>
        )
      )}

      {/* ── BANK STATEMENTS TAB ── */}
      {activeTab === 'statements' && (
        stmtsLoading ? <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        : stmts.length === 0 ? (
          <EmptyState icon={FileText} title="No bank statements" description="Upload your first bank statement PDF" action={{ label:'Upload', onClick:()=>{ setUploadType('bank'); setShowUploadModal(true); } }} />
        ) : (
          <>
            <div className="grid gap-3">
              {stmts.map(s => (
                <div key={s.id} className="card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center"><FileText size={18} className="text-brand-600" /></div>
                    <div>
                      <p className="font-medium text-sm">{s.file_name}</p>
                      <p className="text-xs text-surface-500">{formatDate(s.upload_date||s.created_at)} · {s.transaction_count||0} transactions</p>
                    </div>
                  </div>
                  {s.file_url && (
                    <button onClick={async () => {
                      try {
                        let url; try { url = await getSignedUrl('documents', s.file_url); } catch { url = await getSignedUrl('bank-statements', s.file_url); }
                        window.open(url, '_blank', 'noreferrer');
                      } catch { toast.error('Could not open file'); }
                    }} className="btn-ghost text-xs flex items-center gap-1"><Eye size={14} /> View</button>
                  )}
                </div>
              ))}
            </div>
            <PageBar page={stmtsPage} total={stmtsTotal} pageSize={STMTS_PER_PAGE} onPage={setStmtsPage} />
          </>
        )
      )}

      {/* ── INVOICES TAB ── */}
      {activeTab === 'invoices' && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <select value={invoiceYear} onChange={e => setInvoiceYear(parseInt(e.target.value))} className="input-field w-auto">
              {invoiceYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <span className="text-sm text-surface-500">{invoices.length} invoices</span>
          </div>
          {invLoading ? <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          : invoices.length === 0 ? (
            <EmptyState icon={Receipt} title={`No invoices for ${invoiceYear}`} description="Upload an invoice or select a different year" action={{ label:'Upload Invoice', onClick:()=>{ setUploadType('invoice'); setShowUploadModal(true); } }} />
          ) : (
            <div className="grid gap-3">
              {invoices.map(inv => (
                <div key={inv.id} className="card p-4 flex items-center justify-between hover:bg-surface-50 transition">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center"><Receipt size={16} className="text-purple-600" /></div>
                    <div>
                      <p className="font-medium text-sm">{inv.supplier||inv.file_name}</p>
                      <p className="text-xs text-surface-500">{formatDate(inv.date)} · {formatCurrency(inv.amount)}{inv.category?` · ${inv.category}`:''}</p>
                      {inv.due_date && <p className="text-xs text-surface-400">Due: {formatDate(inv.due_date)}</p>}
                    </div>
                  </div>
                  {inv.file_url && (
                    <button onClick={async () => {
                      try { const url = await getSignedUrl('invoices', inv.file_url); window.open(url,'_blank','noreferrer'); }
                      catch { toast.error('Could not open file'); }
                    }} className="btn-ghost text-xs flex items-center gap-1"><Eye size={14} /> View</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── UPLOAD MODAL ── */}
      <Modal open={showUploadModal} onClose={() => setShowUploadModal(false)} title={uploadType==='bank'?'Upload Bank Statement':'Upload Invoice'} size="lg">
        <div>
          <p className="text-sm text-surface-500 mb-4">
            {uploadType==='bank' ? 'Upload a bank statement PDF. Claude AI extracts withdrawals and auto-categorizes based on history.' : 'Upload an invoice (PDF or image). Claude AI extracts supplier, amount, date, and more.'}
          </p>
          {uploading ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <Spinner size="lg" />
              <p className="text-sm text-surface-500">{uploadProgress || 'Processing with Claude AI…'}</p>
              <p className="text-xs text-surface-400">Large PDFs are processed page by page — this may take up to 60s</p>
            </div>
          ) : (
            <FileDropZone accept={uploadType==='bank'?'.pdf':'.pdf,.png,.jpg,.jpeg,.webp'} multiple={true} onFiles={handleUpload} label={uploadType==='bank'?'Drop bank statement PDF here':'Drop invoice PDF or image here'} />
          )}
        </div>
      </Modal>

      {/* ── MANUAL ENTRY MODAL ── */}
      <Modal open={showManualModal} onClose={() => setShowManualModal(false)} title="Manual Transaction Entry">
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label><input type="date" value={manualForm.date} onChange={e => setManualForm({...manualForm,date:e.target.value})} className="input-field" required /></div>
            <div><label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Type</label><select value={manualForm.type} onChange={e => setManualForm({...manualForm,type:e.target.value})} className="input-field"><option value="debit">Debit (expense)</option><option value="credit">Credit (income)</option></select></div>
          </div>
          <div><label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Description</label><input type="text" value={manualForm.description} onChange={e => setManualForm({...manualForm,description:e.target.value})} className="input-field" placeholder="e.g. Payroll — May 2024" required /></div>
          <div><label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Amount</label><input type="number" min="0" step="0.01" value={manualForm.amount} onChange={e => setManualForm({...manualForm,amount:e.target.value})} className="input-field" placeholder="0.00" required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Category</label><select value={manualForm.category} onChange={e => setManualForm({...manualForm,category:e.target.value})} className="input-field"><option value="">— Uncategorized —</option>{allCategories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Reference <span className="text-surface-400 normal-case font-normal">(optional)</span></label><input type="text" value={manualForm.reference} onChange={e => setManualForm({...manualForm,reference:e.target.value})} className="input-field" placeholder="Invoice #, journal ref" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowManualModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={savingManual} className="btn-primary">{savingManual ? <Spinner size="sm" className="text-white" /> : 'Add Transaction'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
