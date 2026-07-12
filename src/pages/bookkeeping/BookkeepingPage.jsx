import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { extractBankStatementFromText, extractBankStatementFromImages, extractInvoice } from '../../lib/claude';
import { validateExtractedStatement } from '../../lib/statementValidation';
import { partitionNewRows } from '../../lib/statementDedupe';
import { formatCurrency, formatDate, fileToBase64, fuzzyMatchCategory, DEFAULT_CATEGORIES, formatStatementPeriod } from '../../lib/utils';
import { isBalanceSheetType } from '../../lib/finance';
import FileDropZone from '../../components/ui/FileDropZone';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  FileText, Receipt, ArrowRightLeft, Search, Eye, Trash2,
  ChevronDown, ChevronRight, BookCheck, RotateCcw,
  FolderOpen, Folder, MessageSquare, Layers, X, Sparkles, Pencil,
  Landmark, MoreVertical,
} from 'lucide-react';
import CapitalizeModal from '../../components/CapitalizeModal';
import { CAPITALIZE_THRESHOLD } from '../../lib/capitalize';
import { debitOf } from '../../lib/finance';
import { fetchStatementTotals } from '../../lib/statementTotals';
import DeleteStatementDialog from '../../components/DeleteStatementDialog';
import StatementAnchorPrompt from '../../components/StatementAnchorPrompt';
import DateAnchorWarningModal from '../../components/DateAnchorWarningModal';
import {
  parseStatementPeriodFromText,
  parseStatementPeriodFromFilename,
  findOutOfAnchorDates,
  shiftOutOfAnchorTransactionDates,
} from '../../lib/statementPeriod';
import { isPeriodLockedError, periodFromLockedError, wrapIfPeriodLocked } from '../../lib/periodLock';
import PeriodLockedDialog from '../../components/PeriodLockedDialog';

const ALLOWED_BANK_TYPES    = ['application/pdf'];
const ALLOWED_INVOICE_TYPES = ['application/pdf','image/png','image/jpeg','image/webp'];
// Bank statements: no size limit — text is extracted locally by PDF.js,
// so the file itself is never sent to the server.
// Invoices: keep a reasonable cap since those are sent as base64.
const MAX_INVOICE_SIZE_MB   = 10;
const MAX_BANK_SIZE_MB      = 100;
const POSTED_PAGE_SIZE      = 50;
const STMTS_PER_PAGE        = 8;
const INV_YEAR              = new Date().getFullYear();
const TXN_BATCH             = 1000; // Supabase's per-request row limit

// Extract the first 1-2 meaningful tokens from a bank description for vendor grouping.
// "SYSCO FOOD SERVICE 0483 TX" → "SYSCO FOOD"
// "VENMO PAYMENT *JOE" → "VENMO PAYMENT"
function vendorKey(desc) {
  if (!desc) return 'Other';
  const tokens = desc.toUpperCase().replace(/[*#@.,]/g, ' ').split(/\s+/);
  const meaningful = tokens.filter(t => t.length >= 3 && !/^\d+$/.test(t));
  return meaningful.slice(0, 2).join(' ') || tokens[0]?.slice(0, 10) || 'Other';
}

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
    propagateCategories, aiCategorizeUncategorized,
    addBankStatement, addInvoice, updateInvoice,
    uploadFile, getSignedUrl,
  } = useData();

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]       = useState('transactions');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadType, setUploadType]     = useState('bank');
  const [uploading, setUploading]         = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [search, setSearch]             = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [editingField, setEditingField] = useState(null); // {id, field: 'category'|'description'|'amount'}
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [collapsedYears, setCollapsedYears]   = useState(new Set());

  // ── Bulk selection & smart filters ───────────────────────────────────────
  const [selectedTxnIds, setSelectedTxnIds] = useState(new Set());
  const [groupBy,      setGroupBy]      = useState('none');   // 'none'|'category'|'vendor'
  const [quickFilter,  setQuickFilter]  = useState('all');    // 'all'|'categorized'|'uncategorized'
  const [bulkPosting,  setBulkPosting]  = useState(false);
  const [aiCategorizing, setAiCategorizing] = useState(false);

  // ── Notes state ───────────────────────────────────────────────────────────
  const [activeNotesTxnId, setActiveNotesTxnId] = useState(null);
  const [noteCounts, setNoteCounts]             = useState({});
  const [profileMap, setProfileMap]             = useState({});
  const [capitalizeTxn, setCapitalizeTxn]       = useState(null);
  const [openRowMenu, setOpenRowMenu]           = useState(null);
  const [lockedPeriod, setLockedPeriod]         = useState(null);
  const [lockedRetry,  setLockedRetry]          = useState(null);
  const [deleteStmt,   setDeleteStmt]           = useState(null);
  // Promise-driven modal handles. Each holds the deferred resolve/reject
  // so the async upload pipeline can `await` user input.
  const [anchorPrompt, setAnchorPrompt]         = useState(null);   // { id, fileName, resolve, reject }
  const [dateWarning,  setDateWarning]          = useState(null);   // { id, outOfRange, anchor, totalCount, resolve }

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
  // Totals across ALL linked transactions per statement (posted + unposted),
  // for the "Pulled from PDF" header line.
  const [stmtTotals, setStmtTotals]         = useState(new Map());
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

    const hasFilter = !!(search || filterCategory);

    let stmtTxnData = [];
    let manData     = [];

    if (hasFilter) {
      // SEARCH/FILTER MODE — query ALL unposted transactions DB-wide, regardless
      // of statement pagination. The statement folders shown below are derived
      // from whichever statements have matching transactions.
      const allMatches = await fetchAllPages((f, t) => {
        let q = supabase.from('transactions').select('*')
          .eq('posted', false)
          .order('date', { ascending: false }).range(f, t);
        if (search) q = q.ilike('description', `%${search}%`);
        if (filterCategory) q = q.eq('category', filterCategory);
        return q;
      });

      const grouped = {};
      allMatches.forEach(t => {
        if (t.bank_statement_id) (grouped[t.bank_statement_id] = grouped[t.bank_statement_id] || []).push(t);
        else manData.push(t);
      });
      stmtTxnData = allMatches.filter(t => t.bank_statement_id);
      setTxnsByStmt(grouped);
      setManualTxns(manData);

      // Pull metadata for every statement referenced (for the folder headers)
      const stmtIds = Object.keys(grouped);
      if (stmtIds.length) {
        const { data: matchedStmts } = await supabase.from('bank_statements')
          .select('*').in('id', stmtIds)
          .order('upload_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false });
        setStmts(matchedStmts || []);
        setStmtsTotal(matchedStmts?.length || 0);
        // PDF-pull totals across every linked txn (posted or not).
        try { setStmtTotals(await fetchStatementTotals((matchedStmts || []).map(s => s.id))); } catch {}
      } else {
        setStmts([]); setStmtsTotal(0);
      }
    } else {
      // DEFAULT MODE — paginate by bank statement, load that page's txns.
      const from = stmtsPage * STMTS_PER_PAGE;
      const { data: stmtData, count: stmtCount } = await supabase
        .from('bank_statements').select('*', { count: 'exact' })
        .order('upload_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(from, from + STMTS_PER_PAGE - 1);
      setStmts(stmtData || []);
      setStmtsTotal(stmtCount || 0);
      // PDF-pull totals across every linked txn (posted or not).
      try { setStmtTotals(await fetchStatementTotals((stmtData || []).map(s => s.id))); } catch {}

      if (stmtData?.length) {
        const ids = stmtData.map(s => s.id);
        stmtTxnData = await fetchAllPages((f, t) =>
          supabase.from('transactions').select('*')
            .eq('posted', false).in('bank_statement_id', ids)
            .order('date', { ascending: false }).range(f, t)
        );
        const grouped = {};
        stmtTxnData.forEach(t => { (grouped[t.bank_statement_id] = grouped[t.bank_statement_id] || []).push(t); });
        setTxnsByStmt(grouped);
      } else {
        setTxnsByStmt({});
      }

      manData = await fetchAllPages((f, t) =>
        supabase.from('transactions').select('*')
          .eq('posted', false).is('bank_statement_id', null)
          .order('date', { ascending: false }).range(f, t)
      );
      setManualTxns(manData);
    }

    // Load note counts for everything currently visible
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

  // Close row-action overflow menu on any outside click.
  useEffect(() => {
    if (openRowMenu === null) return;
    const close = () => setOpenRowMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openRowMenu]);

  const loadPosted = useCallback(async () => {
    setPostedLoading(true);
    const from = postedPage * POSTED_PAGE_SIZE;
    const { data, count } = await supabase.from('transactions').select('*', { count: 'exact' })
      .eq('posted', true).eq('voided', false).order('date', { ascending: false }).range(from, from + POSTED_PAGE_SIZE - 1);
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

  // Run fuzzy-match propagation once on mount so any newly-learned supplier
  // mappings get applied to historical uncategorized transactions automatically.
  const propagatedOnMount = useRef(false);
  useEffect(() => {
    if (propagatedOnMount.current || !Object.keys(supplierCategories).length) return;
    propagatedOnMount.current = true;
    (async () => {
      try {
        const n = await propagateCategories();
        if (n > 0) {
          toast.success(`Auto-categorized ${n} transaction${n !== 1 ? 's' : ''} from history`);
          loadUnposted();
          loadUnpostedCount();
        }
      } catch (err) { console.error('propagateCategories on mount:', err); }
    })();
  }, [supplierCategories, propagateCategories, loadUnposted, loadUnpostedCount]);

  useEffect(() => { if (activeTab === 'posted') loadPosted(); }, [loadPosted, activeTab]);
  useEffect(() => { if (activeTab === 'invoices') loadInvoices(); }, [loadInvoices, activeTab]);
  useEffect(() => { setStmtsPage(0); }, [search, filterCategory]);
  useEffect(() => { setPostedPage(0); }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  // Drop balance-sheet (asset/liability/equity) and archived categories — they
  // belong in journal entries, not day-to-day transaction categorization.
  const allCategories = useMemo(() => {
    const archivedNames = new Set(categories.filter(c => c.archived).map(c => c.name));
    const bsNames       = new Set(categories.filter(c => isBalanceSheetType(c.type)).map(c => c.name));
    const set = new Set([
      ...DEFAULT_CATEGORIES,
      ...categories.filter(c => !c.archived && !isBalanceSheetType(c.type)).map(c => c.name),
    ]);
    for (const n of archivedNames) set.delete(n);
    for (const n of bsNames)       set.delete(n);
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
    setEditingField(null);
    await updateTransaction(txn.id, { category });
    const supplier = txn.description || txn.supplier;
    if (supplier && category) {
      const propagated = await learnSupplierCategory(supplier, category);
      if (propagated > 0) { toast.success(`Auto-categorized ${propagated} more transaction${propagated!==1?'s':''}`); loadUnposted(); }
    }
  }

  // Inline editor for description / amount on a transaction row.
  // Validates, applies an optimistic local update, then persists to Supabase.
  async function handleEditField(txn, field, rawValue) {
    let value = rawValue;
    if (field === 'amount') {
      const n = parseFloat(rawValue);
      if (Number.isNaN(n) || n < 0) { setEditingField(null); return; }
      value = n;
    }
    if (field === 'description') {
      value = (rawValue || '').trim();
      if (!value || value === txn.description) { setEditingField(null); return; }
    }
    if (field === 'amount' && value === Math.abs(txn.amount)) { setEditingField(null); return; }

    const patch = { [field]: value };
    // Keep `supplier` aligned with `description` since both are stored
    if (field === 'description') patch.supplier = value;

    if (txn.bank_statement_id) {
      setTxnsByStmt(prev => ({
        ...prev,
        [txn.bank_statement_id]: (prev[txn.bank_statement_id]||[]).map(t => t.id===txn.id ? {...t, ...patch} : t),
      }));
    } else {
      setManualTxns(prev => prev.map(t => t.id===txn.id ? {...t, ...patch} : t));
    }
    setEditingField(null);
    try {
      await updateTransaction(txn.id, patch);
    } catch (err) {
      toast.error(err.message || 'Update failed');
      loadUnposted();
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

  // ── Derived flat lists for bulk/group operations ─────────────────────────

  const allVisibleTxns = useMemo(() => {
    const fromStmts = Object.values(txnsByStmt).flat();
    return [...fromStmts, ...manualTxns];
  }, [txnsByStmt, manualTxns]);

  const filteredTxns = useMemo(() => {
    if (quickFilter === 'categorized')   return allVisibleTxns.filter(t => t.category);
    if (quickFilter === 'uncategorized') return allVisibleTxns.filter(t => !t.category);
    return allVisibleTxns;
  }, [allVisibleTxns, quickFilter]);

  const categorizedCount = useMemo(
    () => allVisibleTxns.filter(t => t.category).length,
    [allVisibleTxns]
  );
  const uncategorizedCount = useMemo(
    () => allVisibleTxns.filter(t => !t.category).length,
    [allVisibleTxns]
  );

  const categoryGroups = useMemo(() => {
    if (groupBy !== 'category') return [];
    const groups = {};
    filteredTxns.forEach(t => {
      const key = t.category || 'Uncategorized';
      (groups[key] = groups[key] || []).push(t);
    });
    return Object.entries(groups).sort(([a,,], [b,,]) => {
      if (a === 'Uncategorized') return 1;
      if (b === 'Uncategorized') return -1;
      return groups[b].length - groups[a].length;
    });
  }, [filteredTxns, groupBy]);

  const vendorGroups = useMemo(() => {
    if (groupBy !== 'vendor') return [];
    const groups = {};
    filteredTxns.forEach(t => {
      const key = vendorKey(t.description || t.supplier || '');
      (groups[key] = groups[key] || []).push(t);
    });
    return Object.entries(groups).sort(([, a], [, b]) => b.length - a.length);
  }, [filteredTxns, groupBy]);

  // ── Bulk handlers ─────────────────────────────────────────────────────────

  function toggleSelectTxn(id, checked) {
    setSelectedTxnIds(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function selectGroup(txns, checked) {
    setSelectedTxnIds(prev => {
      const next = new Set(prev);
      txns.forEach(t => checked ? next.add(t.id) : next.delete(t.id));
      return next;
    });
  }

  async function bulkPostTxns(txns) {
    if (!txns.length) return;
    setBulkPosting(true);
    try {
      const ids = txns.map(t => t.id);
      const idSet = new Set(ids);
      const { error } = await supabase.from('transactions').update({ posted: true }).in('id', ids);
      if (error) throw wrapIfPeriodLocked(error);
      // Optimistic: remove from local state
      setTxnsByStmt(prev => {
        const next = {};
        for (const [k, v] of Object.entries(prev)) next[k] = v.filter(t => !idSet.has(t.id));
        return next;
      });
      setManualTxns(prev => prev.filter(t => !idSet.has(t.id)));
      setSelectedTxnIds(new Set());
      setUnpostedTotalCount(prev => Math.max(0, prev - ids.length));
      toast.success(`Posted ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`);
      loadUnpostedCount();
    } catch (err) {
      const period = err?.period || periodFromLockedError(err);
      if (isPeriodLockedError(err) && period) {
        setLockedPeriod(period);
        setLockedRetry(() => () => bulkPostTxns(txns));
        loadUnposted();
        return;
      }
      toast.error(err.message || 'Bulk post failed');
      loadUnposted();
    } finally {
      setBulkPosting(false);
    }
  }

  async function handleBulkCategorize(category) {
    if (!selectedTxnIds.size || !category) return;
    const ids = [...selectedTxnIds];
    const idSet = new Set(ids);
    // Optimistic update
    setTxnsByStmt(prev => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) next[k] = v.map(t => idSet.has(t.id) ? { ...t, category } : t);
      return next;
    });
    setManualTxns(prev => prev.map(t => idSet.has(t.id) ? { ...t, category } : t));
    await supabase.from('transactions').update({ category }).in('id', ids);
    toast.success(`Set category "${category}" on ${ids.length} transactions`);
  }

  async function handleAiCategorize() {
    if (aiCategorizing) return;
    setAiCategorizing(true);
    const loadingId = toast.loading('Asking Claude to categorize the rest…');
    try {
      const n = await aiCategorizeUncategorized();
      toast.dismiss(loadingId);
      if (n > 0) {
        toast.success(`AI categorized ${n} transaction${n !== 1 ? 's' : ''}`);
        loadUnposted();
      } else {
        toast('No new matches — try uploading more bank statements to teach the model', { icon: 'ℹ️' });
      }
    } catch (err) {
      toast.dismiss(loadingId);
      toast.error(err.message || 'AI categorization failed');
    } finally {
      setAiCategorizing(false);
    }
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  async function handleUpload(files) {
    if (!files.length) return;
    for (const file of files) {
      const maxMB = uploadType === 'bank' ? MAX_BANK_SIZE_MB : MAX_INVOICE_SIZE_MB;
      if (file.size > maxMB * 1024 * 1024) { toast.error(`${file.name} exceeds ${maxMB}MB`); return; }
      const allowed = uploadType === 'bank' ? ALLOWED_BANK_TYPES : ALLOWED_INVOICE_TYPES;
      if (!allowed.includes(file.type)) { toast.error(`${file.name} is not a supported type`); return; }
    }
    setUploading(true);
    try {
      for (const file of files) {
        const mediaType = file.type || 'application/pdf';
        if (uploadType === 'bank') {
          // PRIMARY PATH: extract the PDF's text layer in the browser with PDF.js.
          // The resulting plain text is typically 20–100 KB regardless of PDF file
          // size, completely bypassing Vercel's 4.5 MB request body limit.
          //
          // FALLBACK: if the PDF is image-only (scanned paper statement) PDF.js
          // returns no text. We then fall back to page-by-page JPEG rendering,
          // which keeps each request under ~400 KB.

          setUploadProgress('Reading PDF…');
          const { extractPdfText, pdfToPageImages, getPdfPageCount } = await import('../../lib/pdfPages');
          // Pre-flight refuses anything we know the Anthropic API will reject
          // BEFORE the request leaves the browser. Cheaper for the user, and
          // the toast points at the actual cause (oversized file / too many
          // pages) instead of the generic upstream 400.
          const pageCount = await getPdfPageCount(file);
          if (pageCount > 100) {
            setUploadProgress('');
            throw new Error(`${file.name}: ${pageCount} pages exceeds the 100-page Anthropic limit. Split the PDF and re-upload.`);
          }

          const pdfText = await extractPdfText(file);

          // ── Anchor period detection ────────────────────────────────────
          // PDF header → filename → ask the user. The anchor flows into
          // the extraction prompts so partial dates resolve to this
          // period's year and never to the model's calendar-default.
          let anchorPeriod =
            parseStatementPeriodFromText(pdfText) ||
            parseStatementPeriodFromFilename(file.name);
          if (!anchorPeriod) {
            setUploadProgress('');
            anchorPeriod = await new Promise((resolve, reject) => {
              setAnchorPrompt({
                id: crypto.randomUUID(),
                fileName: file.name,
                resolve,
                reject,
              });
            }).finally(() => setAnchorPrompt(null));
          }
          if (!anchorPeriod) throw new Error('No statement period selected; upload aborted.');

          let extracted;
          const hasText = pdfText.replace(/[-\s|]/g, '').length > 200;

          if (hasText) {
            // Digital PDF — send text only (tiny payload, no size issues).
            // Still check the text isn't pathologically large; Anthropic's
            // hard input cap rarely matters here but we surface a clear
            // message just in case.
            if (pdfText.length > 1_500_000) {
              setUploadProgress('');
              throw new Error(`${file.name}: extracted text is ${(pdfText.length / 1024).toFixed(0)} KB, too large for one request. Split the PDF and re-upload.`);
            }
            setUploadProgress(`Analyzing ${pageCount}-page statement…`);
            extracted = await extractBankStatementFromText(pdfText, anchorPeriod);
          } else {
            // Scanned/image PDF — fall back to page-by-page JPEG.
            setUploadProgress(`Scanned PDF — rendering ${pageCount} page${pageCount === 1 ? '' : 's'}…`);
            const pageImages = await pdfToPageImages(file);
            extracted = await extractBankStatementFromImages(
              pageImages,
              (pg, total) => setUploadProgress(`Processing page ${pg} of ${total}…`),
              anchorPeriod,
            );
          }
          setUploadProgress('');

          // ── Sanity gate: dates within ±15 days of the anchor ──────────
          let txnsForInsert = extracted.transactions || [];
          const outOfRange = findOutOfAnchorDates(txnsForInsert, anchorPeriod, 15);
          if (outOfRange.length > 0) {
            const decision = await new Promise(resolve => {
              setDateWarning({
                id: crypto.randomUUID(),
                outOfRange,
                anchor: anchorPeriod,
                totalCount: txnsForInsert.length,
                resolve,
              });
            }).finally(() => setDateWarning(null));
            if (decision === 'cancel') throw new Error('Upload canceled by user after date warning.');
            if (decision === 'shift') {
              const { transactions: shifted, shifted: count } =
                shiftOutOfAnchorTransactionDates(txnsForInsert, anchorPeriod, 15);
              txnsForInsert = shifted;
              if (count > 0) toast(`Shifted ${count} date${count === 1 ? '' : 's'} into ${anchorPeriod.start.slice(0, 7)}`, { icon: '↪️' });
            }
            // 'insert' → keep original dates
          }
          extracted = { ...extracted, transactions: txnsForInsert };

          // Pre-insert gate: refuse implausible extractions (zero deposits or
          // a summary block that doesn't reconcile). Fails LOUDLY so we never
          // silently import a debits-only view of the month again.
          validateExtractedStatement(extracted);

          // Namespace the storage path with a uuid AND timestamp so re-uploading
          // a file with the same name (e.g. Dec-24.pdf after a delete) can never
          // collide with whatever the storage bucket still has lingering.
          const safeName = file.name.replace(/[^\w.\-]/g, '_');
          const uploadPath = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
          const uploadResult = await uploadFile('documents', uploadPath, file);
          // Period range comes from the ANCHOR, not from the extracted txns.
          // The anchor is the statement's own self-reported period (or the
          // user's pick when the PDF/filename didn't say); the dates on
          // individual transactions can drift if extraction was imperfect,
          // but the anchor is the contract for "what period this statement
          // covers" and it's what every downstream filter should respect.
          const stmt = await addBankStatement({
            file_name: file.name,
            file_url: uploadResult?.path || '',
            upload_date: new Date().toISOString(),
            transaction_count: extracted.transactions?.length || 0,
            statement_totals: extracted.statement_totals || null,
            period_start: anchorPeriod?.start || null,
            period_end:   anchorPeriod?.end   || null,
          });
          if (extracted.transactions?.length) {
            const candidates = extracted.transactions.map((t) => ({
              date: t.date,
              description: t.description || '',
              supplier: t.description || '',
              amount: parseFloat(t.amount) || 0,
              type: t.type || (parseFloat(t.amount) < 0 ? 'debit' : 'credit'),
              category: fuzzyMatchCategory(t.description || '', supplierCategories),
              bank_statement_id: stmt?.id,
              posted: false,
            }));
            const { data: existing } = await supabase
              .from('transactions')
              .select('id, date, amount, description, bank_statement_id')
              .eq('bank_statement_id', stmt?.id);
            const { toInsert } = partitionNewRows(existing || [], candidates);
            for (const row of toInsert) {
              await addTransaction(row);
            }
            toast.success(`Extracted ${toInsert.length} transactions from ${file.name}`);
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

      // After a bank statement upload, run the AI second-pass on whatever
      // the fuzzy match left uncategorized. Fire-and-forget so the modal
      // closes immediately — the user gets a toast when results land.
      if (uploadType === 'bank') {
        (async () => {
          try {
            const n = await aiCategorizeUncategorized();
            if (n > 0) {
              toast.success(`AI categorized ${n} more transaction${n !== 1 ? 's' : ''}`);
              loadUnposted();
            }
          } catch (err) { console.error('post-upload AI categorize:', err); }
        })();
      }
    } catch (err) { toast.error(err.message || 'Upload failed'); console.error(err); }
    finally { setUploading(false); setUploadProgress(''); setShowUploadModal(false); }
  }

  // ── Shared row renderer ───────────────────────────────────────────────────

  function TxnRow({ t, showPost = false, showUnpost = false, selectable = false }) {
    const noteCount  = noteCounts[t.id] || 0;
    const notesOpen  = activeNotesTxnId === t.id;
    const isSelected = selectedTxnIds.has(t.id);
    const colSpan    = selectable ? 7 : 6;
    return (
      <>
        <tr className={`border-b border-surface-50 transition ${notesOpen ? 'bg-blue-50/30' : isSelected ? 'bg-brand-50/40' : 'hover:bg-surface-50'}`}>
          {selectable && (
            <td className="pl-4 pr-1 py-2 w-10">
              <input type="checkbox" checked={isSelected}
                onChange={e => toggleSelectTxn(t.id, e.target.checked)}
                className="rounded accent-brand-600 cursor-pointer"
              />
            </td>
          )}
          <td className="table-cell font-mono text-xs whitespace-nowrap">{formatDate(t.date)}</td>
          <td className="table-cell font-medium max-w-[240px]" title={t.description}>
            {editingField?.id === t.id && editingField?.field === 'description' ? (
              <input type="text" autoFocus defaultValue={t.description||''}
                onBlur={e => handleEditField(t, 'description', e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                  else if (e.key === 'Escape') setEditingField(null);
                }}
                className="input-field text-sm py-1 w-full"
              />
            ) : (
              <button onClick={() => setEditingField({ id: t.id, field: 'description' })}
                title="Click to edit"
                className="group/desc text-left w-full truncate hover:bg-surface-100/60 rounded px-1 -mx-1 py-0.5 transition cursor-text">
                <span className="align-middle">{t.description||'—'}</span>
                <Pencil size={10} className="inline ml-1 opacity-0 group-hover/desc:opacity-50 text-surface-400 align-middle" />
              </button>
            )}
          </td>
          <td className="table-cell">
            {editingField?.id === t.id && editingField?.field === 'category' ? (
              <select autoFocus defaultValue={t.category||''} onChange={e => handleCategorize(t, e.target.value)} onBlur={() => setEditingField(null)} className="input-field text-xs py-1 w-44">
                <option value="">Uncategorized</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={() => setEditingField({ id: t.id, field: 'category' })}
                  className={`text-xs rounded-full px-2.5 py-0.5 transition ${t.category ? 'badge-green cursor-pointer hover:opacity-80' : 'bg-surface-100 text-surface-500 hover:bg-surface-200 cursor-pointer'}`}>
                  {t.category||'+ Categorize'}
                </button>
                {t.capitalized_asset_id && (
                  <Link to="/assets" title="Capitalized to an asset" className="text-[10px] uppercase tracking-wider bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full inline-flex items-center gap-1 hover:bg-brand-200 transition">
                    <Landmark size={9} /> Capitalized
                  </Link>
                )}
              </div>
            )}
          </td>
          <td className={`table-cell text-right font-mono text-sm ${t.type==='credit'?'text-green-600':'text-red-600'}`}>
            {editingField?.id === t.id && editingField?.field === 'amount' ? (
              <input type="number" step="0.01" min="0" autoFocus defaultValue={Math.abs(t.amount)}
                onBlur={e => handleEditField(t, 'amount', e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.target.blur();
                  else if (e.key === 'Escape') setEditingField(null);
                }}
                className="input-field text-sm py-1 w-28 text-right font-mono"
              />
            ) : (
              <button onClick={() => setEditingField({ id: t.id, field: 'amount' })}
                title="Click to edit"
                className="group/amt hover:bg-surface-100/60 rounded px-1 -mx-1 py-0.5 transition cursor-text inline-flex items-center gap-1 justify-end">
                <span>{t.type==='credit'?'+':'−'}{formatCurrency(Math.abs(t.amount))}</span>
                <Pencil size={10} className="opacity-0 group-hover/amt:opacity-50 text-surface-400" />
              </button>
            )}
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
              {showUnpost && t.type === 'debit' && !t.capitalized_asset_id && (
                <div className="relative" onMouseDown={e => e.stopPropagation()}>
                  <button onClick={() => setOpenRowMenu(openRowMenu === t.id ? null : t.id)}
                    title="More actions"
                    className="p-1.5 text-surface-400 hover:text-brand-600 transition">
                    <MoreVertical size={14} />
                  </button>
                  {openRowMenu === t.id && (
                    <div className="absolute right-0 top-full mt-1 z-20 bg-white shadow-lg rounded-lg border border-surface-100 py-1 min-w-[180px]">
                      <button
                        onClick={() => { setOpenRowMenu(null); setCapitalizeTxn(t); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-surface-50 flex items-center gap-2"
                      >
                        <Landmark size={13} className="text-brand-600" />
                        <span>Capitalize…</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button onClick={() => handleDeleteTxn(t)} title="Delete" className="p-1.5 text-surface-400 hover:text-red-500 transition"><Trash2 size={14} /></button>
            </div>
          </td>
        </tr>
        {notesOpen && (
          <tr>
            <td colSpan={colSpan} className="p-0">
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

  // Table header without checkbox (Posted tab, group sub-tables)
  const TABLE_HEAD = (
    <thead><tr className="border-b border-surface-100">
      <th className="table-header">Date</th><th className="table-header">Description</th>
      <th className="table-header">Category</th><th className="table-header text-right">Amount</th>
      <th className="table-header">Type</th><th className="table-header w-24"></th>
    </tr></thead>
  );

  // Table header with global select-all checkbox (Transactions tab, 'none' groupBy)
  const allPageChecked = allVisibleTxns.length > 0 && allVisibleTxns.every(t => selectedTxnIds.has(t.id));
  const TABLE_HEAD_SEL = (
    <thead><tr className="border-b border-surface-100">
      <th className="pl-4 pr-1 py-3 w-10">
        <input type="checkbox" checked={allPageChecked}
          onChange={e => setSelectedTxnIds(e.target.checked ? new Set(allVisibleTxns.map(t => t.id)) : new Set())}
          className="rounded accent-brand-600 cursor-pointer"
        />
      </th>
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
          {/* Search + category filter row */}
          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="input-field pl-9" />
            </div>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="input-field w-auto min-w-[180px]">
              <option value="">All Categories</option>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Smart filter toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* Quick filter pills */}
            <div className="flex gap-1 bg-surface-100 rounded-lg p-1 text-xs">
              {[['all','All'],['categorized','Categorized'],['uncategorized','Uncategorized']].map(([val, lbl]) => (
                <button key={val} onClick={() => setQuickFilter(val)}
                  className={`px-3 py-1.5 rounded-md font-medium transition ${quickFilter===val?'bg-white shadow-sm text-surface-900':'text-surface-500 hover:text-surface-700'}`}>
                  {lbl}
                </button>
              ))}
            </div>

            {/* Group by */}
            <div className="flex items-center gap-1.5">
              <Layers size={14} className="text-surface-400" />
              <select value={groupBy} onChange={e => { setGroupBy(e.target.value); setSelectedTxnIds(new Set()); }}
                className="input-field w-auto text-sm py-1.5">
                <option value="none">By Statement</option>
                <option value="category">By Category</option>
                <option value="vendor">By Vendor</option>
              </select>
            </div>

            {/* AI Categorize Remaining — second-pass classifier */}
            {uncategorizedCount > 0 && (
              <button onClick={handleAiCategorize} disabled={aiCategorizing}
                className="btn-secondary text-sm flex items-center gap-2 ml-auto disabled:opacity-50">
                {aiCategorizing ? <Spinner size="sm" /> : <Sparkles size={14} className="text-purple-600" />}
                AI Categorize Remaining ({uncategorizedCount})
              </button>
            )}

            {/* Post All Categorized — the power move */}
            {categorizedCount > 0 && (
              <button onClick={() => bulkPostTxns(allVisibleTxns.filter(t => t.category))}
                disabled={bulkPosting}
                className={`btn-primary text-sm flex items-center gap-2 ${uncategorizedCount > 0 ? '' : 'ml-auto'}`}>
                {bulkPosting ? <Spinner size="sm" className="text-white" /> : <BookCheck size={14} />}
                Post All Categorized ({categorizedCount})
              </button>
            )}
          </div>

          {/* Sticky bulk action bar — appears when rows are selected */}
          {selectedTxnIds.size > 0 && (
            <div className="sticky top-2 z-20 bg-brand-700 text-white rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 mb-4 shadow-xl">
              <span className="font-semibold text-sm">{selectedTxnIds.size} selected</span>
              <div className="flex-1" />
              <button onClick={() => bulkPostTxns([...selectedTxnIds].map(id => allVisibleTxns.find(t => t.id === id)).filter(Boolean))}
                disabled={bulkPosting}
                className="bg-white text-brand-700 text-xs px-3 py-1.5 rounded-lg font-semibold hover:bg-brand-50 transition flex items-center gap-1.5">
                {bulkPosting ? <Spinner size="sm" /> : <BookCheck size={13} />} Post Selected
              </button>
              <select onChange={e => { if (e.target.value) { handleBulkCategorize(e.target.value); e.target.value = ''; } }}
                defaultValue=""
                className="bg-brand-600 text-white text-xs px-2 py-1.5 rounded-lg border border-brand-500 hover:bg-brand-500 transition cursor-pointer">
                <option value="" disabled>Categorize Selected…</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => setSelectedTxnIds(new Set())} className="bg-brand-600 hover:bg-brand-500 text-white text-xs px-3 py-1.5 rounded-lg transition flex items-center gap-1">
                <X size={12} /> Deselect All
              </button>
            </div>
          )}

          {stmtsLoading ? <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          : allVisibleTxns.length === 0 && stmtsTotal === 0 ? (
            <EmptyState icon={FileText} title="No unposted transactions" description="Upload a bank statement or add a manual entry" action={{ label:'Upload Statement', onClick:()=>{ setUploadType('bank'); setShowUploadModal(true); } }} />
          ) : filteredTxns.length === 0 && groupBy !== 'none' ? (
            // For category / vendor group views, no filtered txns means truly
            // empty. Keep the original empty message. Statement view falls
            // through so the folder list + PageBar still render.
            <div className="card p-8 text-center text-sm text-surface-400">
              No {quickFilter === 'categorized' ? 'categorized' : 'uncategorized'} transactions on this page.
            </div>
          ) : groupBy === 'none' ? (
            /* ── Original bank-statement folder view ── */
            <>
              <div className="space-y-3">
                {stmts.map(stmt => {
                  const grpTxns = (txnsByStmt[stmt.id] || []).filter(t =>
                    quickFilter === 'categorized'   ? !!t.category :
                    quickFilter === 'uncategorized' ? !t.category  : true
                  );
                  const isCollapsed = collapsedGroups.has(stmt.id);
                  const total = grpTxns.reduce((s,t)=>s+debitOf(t),0);
                  const pull  = stmtTotals.get(stmt.id);
                  const allSelected = grpTxns.length > 0 && grpTxns.every(t => selectedTxnIds.has(t.id));
                  return (
                    <div key={stmt.id} className="card overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 bg-surface-50 border-b border-surface-100">
                        <input type="checkbox" checked={allSelected}
                          onChange={e => selectGroup(grpTxns, e.target.checked)}
                          className="rounded accent-brand-600 cursor-pointer shrink-0"
                        />
                        <button onClick={() => toggleGroup(stmt.id)} className="flex-1 flex items-center gap-2.5 min-w-0 text-left">
                          {isCollapsed ? <Folder size={16} className="shrink-0 text-brand-500" /> : <FolderOpen size={16} className="shrink-0 text-brand-500" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">{stmt.file_name}</span>
                              {formatStatementPeriod(stmt.period_start, stmt.period_end) && (
                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-brand-100 text-brand-800 shrink-0">
                                  {formatStatementPeriod(stmt.period_start, stmt.period_end)}
                                </span>
                              )}
                              <span className="text-xs text-surface-400 shrink-0">{grpTxns.length} unposted{total>0&&` · ${formatCurrency(total)}`}</span>
                            </div>
                            {pull && pull.count > 0 && (
                              <div className="text-[11px] text-surface-500 mt-0.5">
                                <span className="uppercase tracking-wider text-surface-400 mr-1">Pulled from PDF:</span>
                                {pull.count} transaction{pull.count !== 1 ? 's' : ''} · <span className="font-mono text-red-600">{formatCurrency(pull.debits)} debits</span> · <span className="font-mono text-green-600">{formatCurrency(pull.credits)} credits</span>
                              </div>
                            )}
                          </div>
                        </button>
                        {grpTxns.length > 0 && (
                          <button onClick={() => bulkPostTxns(grpTxns)} disabled={bulkPosting} className="btn-ghost text-xs flex items-center gap-1 shrink-0">
                            <BookCheck size={12} /> Post All
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteStmt(stmt); }}
                            title="Delete statement and every linked transaction"
                            className="p-1.5 text-surface-400 hover:text-red-600 transition shrink-0">
                            <Trash2 size={14} />
                          </button>
                        )}
                        <button onClick={() => toggleGroup(stmt.id)} className="shrink-0">
                          {isCollapsed ? <ChevronRight size={16} className="text-surface-400" /> : <ChevronDown size={16} className="text-surface-400" />}
                        </button>
                      </div>
                      {!isCollapsed && grpTxns.length > 0 && (
                        <div className="overflow-x-auto"><table className="w-full">{TABLE_HEAD_SEL}<tbody>{grpTxns.map(t => <TxnRow key={t.id} t={t} showPost selectable />)}</tbody></table></div>
                      )}
                      {!isCollapsed && grpTxns.length === 0 && <div className="px-5 py-3 text-sm text-surface-400">No matching transactions in this statement</div>}
                    </div>
                  );
                })}
                {manualTxns.filter(t => quickFilter==='categorized'?!!t.category:quickFilter==='uncategorized'?!t.category:true).length > 0 && (() => {
                  const grpTxns = manualTxns.filter(t => quickFilter==='categorized'?!!t.category:quickFilter==='uncategorized'?!t.category:true);
                  const allSel = grpTxns.every(t => selectedTxnIds.has(t.id));
                  return (
                    <div className="card overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 bg-surface-50 border-b border-surface-100">
                        <input type="checkbox" checked={allSel}
                          onChange={e => selectGroup(grpTxns, e.target.checked)}
                          className="rounded accent-brand-600 cursor-pointer shrink-0"
                        />
                        <button onClick={() => toggleGroup('manual')} className="flex-1 flex items-center gap-2.5 text-left">
                          {collapsedGroups.has('manual') ? <Folder size={16} className="text-brand-500" /> : <FolderOpen size={16} className="text-brand-500" />}
                          <span className="font-medium text-sm">Manual Transactions</span>
                          <span className="text-xs text-surface-400">{grpTxns.length} entries</span>
                        </button>
                        <button onClick={() => bulkPostTxns(grpTxns)} disabled={bulkPosting} className="btn-ghost text-xs flex items-center gap-1 shrink-0">
                          <BookCheck size={12} /> Post All
                        </button>
                        <button onClick={() => toggleGroup('manual')}>
                          {collapsedGroups.has('manual') ? <ChevronRight size={16} className="text-surface-400" /> : <ChevronDown size={16} className="text-surface-400" />}
                        </button>
                      </div>
                      {!collapsedGroups.has('manual') && (
                        <div className="overflow-x-auto"><table className="w-full">{TABLE_HEAD_SEL}<tbody>{grpTxns.map(t => <TxnRow key={t.id} t={t} showPost selectable />)}</tbody></table></div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <PageBar page={stmtsPage} total={stmtsTotal} pageSize={STMTS_PER_PAGE} onPage={setStmtsPage} />
            </>
          ) : groupBy === 'category' ? (
            /* ── Category group view ── */
            <div className="space-y-3">
              {categoryGroups.map(([catName, txns]) => {
                const allSel = txns.every(t => selectedTxnIds.has(t.id));
                const total  = txns.reduce((s,t)=>s+debitOf(t),0);
                return (
                  <div key={catName} className="card overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-surface-50 border-b border-surface-100">
                      <input type="checkbox" checked={allSel}
                        onChange={e => selectGroup(txns, e.target.checked)}
                        className="rounded accent-brand-600 cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm">{catName}</span>
                        <span className="text-xs text-surface-400 ml-2">{txns.length} txns · {formatCurrency(total)}</span>
                      </div>
                      <button onClick={() => bulkPostTxns(txns)} disabled={bulkPosting} className="btn-secondary text-xs flex items-center gap-1">
                        <BookCheck size={12} /> Post Group
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">{TABLE_HEAD}<tbody>{txns.map(t => <TxnRow key={t.id} t={t} showPost selectable />)}</tbody></table>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Vendor similarity group view ── */
            <div className="space-y-3">
              {vendorGroups.map(([vendor, txns]) => {
                const allSel = txns.every(t => selectedTxnIds.has(t.id));
                const total  = txns.reduce((s,t)=>s+debitOf(t),0);
                return (
                  <div key={vendor} className="card overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-surface-50 border-b border-surface-100">
                      <input type="checkbox" checked={allSel}
                        onChange={e => selectGroup(txns, e.target.checked)}
                        className="rounded accent-brand-600 cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-sm font-mono">{vendor}</span>
                        <span className="text-xs text-surface-400 ml-2">{txns.length} txns · {formatCurrency(total)}</span>
                      </div>
                      <button onClick={() => bulkPostTxns(txns)} disabled={bulkPosting} className="btn-secondary text-xs flex items-center gap-1">
                        <BookCheck size={12} /> Post Group
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">{TABLE_HEAD}<tbody>{txns.map(t => <TxnRow key={t.id} t={t} showPost selectable />)}</tbody></table>
                    </div>
                  </div>
                );
              })}
            </div>
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

      <CapitalizeModal
        txn={capitalizeTxn}
        onClose={() => setCapitalizeTxn(null)}
        onCapitalized={({ asset }) => {
          // Optimistically flag the originating row so the badge appears + the
          // menu action disables without a full refetch.
          setPostedTxns(prev => prev.map(t => t.id === capitalizeTxn?.id ? { ...t, capitalized_asset_id: asset.id } : t));
        }}
      />

      <PeriodLockedDialog
        period={lockedPeriod}
        onClose={() => { setLockedPeriod(null); setLockedRetry(null); }}
        onRetry={lockedRetry}
      />

      <DeleteStatementDialog
        statement={deleteStmt}
        onClose={() => setDeleteStmt(null)}
        onDeleted={async () => { await loadUnposted(); await loadUnpostedCount(); }}
      />

      <StatementAnchorPrompt
        request={anchorPrompt}
        fileName={anchorPrompt?.fileName}
        onResolve={(anchor) => anchorPrompt?.resolve?.(anchor)}
        onCancel={() => anchorPrompt?.reject?.(new Error('Anchor selection canceled'))}
      />

      <DateAnchorWarningModal
        request={dateWarning}
        onShift={()      => dateWarning?.resolve?.('shift')}
        onInsertAsIs={() => dateWarning?.resolve?.('insert')}
        onCancel={()     => dateWarning?.resolve?.('cancel')}
      />

    </div>
  );
}
