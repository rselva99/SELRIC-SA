import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, PieChart, Pie, Legend, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate, formatCurrency } from '../../lib/utils';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Plus, Package, Search, ArrowDown, ArrowUp, RotateCcw, ClipboardList,
  Edit3, Trash2, History, Camera, ChevronDown, ChevronRight,
  Minus, Printer, TrendingDown, AlertTriangle, DollarSign, BarChart2,
} from 'lucide-react';

const PRODUCT_CATEGORIES = ['Beer', 'Wine', 'Spirits', 'Soft Drinks', 'Mixers', 'Food', 'Snacks', 'Other'];
const LOG_TYPES = [
  { value: 'received',   label: 'Received',   icon: ArrowDown,  color: 'text-green-600' },
  { value: 'sold',       label: 'Sold',        icon: ArrowUp,    color: 'text-blue-600' },
  { value: 'used',       label: 'Used',        icon: Minus,      color: 'text-amber-600' },
  { value: 'adjustment', label: 'Adjustment',  icon: RotateCcw,  color: 'text-purple-600' },
];
const PIE_COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const STOCK_STATUS = (p) =>
  (p.current_stock || 0) <= (p.reorder_level || 0) ? 'critical'
  : (p.current_stock || 0) < (p.target_stock || 0) ? 'low'
  : 'ok';
const STATUS_COLOR = { critical: '#dc2626', low: '#f59e0b', ok: '#22c55e' };

// ── Thumbnail — lazy: only requests signed URL when the element scrolls into view ──
function ProductThumbnail({ imageUrl, size = 'sm' }) {
  const [src, setSrc]       = useState('');
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!imageUrl) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [imageUrl]);

  useEffect(() => {
    if (!visible || !imageUrl) return;
    supabase.storage.from('product-images').createSignedUrl(imageUrl, 3600)
      .then(({ data }) => { if (data) setSrc(data.signedUrl); });
  }, [visible, imageUrl]);

  const dim = size === 'sm' ? 'w-10 h-10' : 'w-full h-40';
  return src
    ? <img ref={ref} src={src} alt="" className={`${dim} rounded-lg object-cover border border-surface-200 shrink-0`} />
    : <div ref={ref} className={`${dim} rounded-lg bg-surface-100 flex items-center justify-center shrink-0`}><Package size={size==='sm'?16:36} className="text-surface-300" /></div>;
}

// ── Expandable product row — fetches its own logs from DB on open ────────
function ExpandedRow({ p, profileMap, onLog, onEdit }) {
  const [logs, setLogs]         = useState([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [total, setTotal]       = useState(0);
  const [showAll, setShowAll]   = useState(false);
  const [page, setPage]         = useState(0);
  const PAGE_SIZE = 10;

  const load = useCallback(async (pg, all) => {
    const from = all ? 0 : pg * PAGE_SIZE;
    const to   = all ? 999 : from + (showAll ? PAGE_SIZE - 1 : 4);
    const { data, count } = await supabase
      .from('inventory_logs').select('*', { count: 'exact' })
      .eq('product_id', p.id)
      .order('created_at', { ascending: false })
      .order('id',         { ascending: true })  // stable tiebreaker
      .range(from, to);
    setLogs(data || []);
    setTotal(count || 0);
    setLogsLoading(false);
  }, [p.id, showAll]);

  useEffect(() => { load(page, false); }, []); // eslint-disable-line
  useEffect(() => { if (!logsLoading) load(page, showAll); }, [page, showAll]); // eslint-disable-line

  const displayed = logs;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const status = STOCK_STATUS(p);

  return (
    <div className="px-4 py-5 bg-brand-50/20 border-t border-surface-100 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left — image + details */}
        <div className="space-y-3">
          <ProductThumbnail imageUrl={p.image_url} size="lg" />
          <div className="grid grid-cols-2 gap-1.5">
            {[
              ['Category', p.category],
              ['Unit', p.unit],
              ['Cost', formatCurrency(p.cost_price || 0)],
              ['Sell', formatCurrency(p.sell_price || 0)],
              ['Current Stock', `${p.current_stock ?? 0} ${p.unit}`],
              ['Target Stock', `${p.target_stock ?? 0} ${p.unit}`],
              ['Reorder Level', `${p.reorder_level ?? 0} ${p.unit}`],
              ['Stock Value', formatCurrency((p.current_stock || 0) * (p.cost_price || 0))],
            ].map(([label, value]) => (
              <div key={label} className="bg-white rounded-lg p-2 border border-surface-100">
                <p className="text-[10px] text-surface-400 uppercase tracking-wider leading-none">{label}</p>
                <p className="text-sm font-medium mt-0.5 truncate">{value}</p>
              </div>
            ))}
          </div>
          <button onClick={onEdit} className="btn-secondary w-full text-sm flex items-center justify-center gap-2">
            <Edit3 size={13} /> Edit Product
          </button>
        </div>

        {/* Right — movement ledger */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-sm text-surface-700">Movement Ledger</h4>
            <span className="text-xs text-surface-400">{total} total entries</span>
          </div>

          {total === 0 ? (
            <p className="text-sm text-surface-400 text-center py-6">No movement history yet</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-100">
                      {['Date','Type','Qty','Notes','By'].map(h => (
                        <th key={h} className="text-left pb-2 text-xs font-semibold text-surface-500 uppercase tracking-wider pr-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((log) => {
                      const lt = LOG_TYPES.find((t) => t.value === log.type);
                      return (
                        <tr key={log.id} className="border-b border-surface-50">
                          <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">{formatDate(log.date || log.created_at)}</td>
                          <td className="py-2 pr-3"><span className={`text-xs font-medium ${lt?.color || ''}`}>{lt?.label || log.type}</span></td>
                          <td className={`py-2 pr-3 font-mono text-xs font-semibold whitespace-nowrap ${log.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {log.quantity >= 0 ? '+' : ''}{log.quantity}
                          </td>
                          <td className="py-2 pr-3 text-xs text-surface-500 max-w-[140px] truncate">{log.notes || '—'}</td>
                          <td className="py-2 text-xs text-surface-400">{profileMap[log.user_id] || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!showAll && total > 5 && (
                <button onClick={() => setShowAll(true)} className="btn-ghost w-full text-xs mt-2">
                  Show All ({total} entries)
                </button>
              )}
              {showAll && totalPages > 1 && (
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-100">
                  <button onClick={() => setPage((n) => Math.max(0, n - 1))} disabled={page === 0} className="btn-ghost text-xs disabled:opacity-40">← Prev</button>
                  <span className="text-xs text-surface-400">Page {page + 1} of {totalPages}</span>
                  <button onClick={() => setPage((n) => Math.min(totalPages - 1, n + 1))} disabled={page >= totalPages - 1} className="btn-ghost text-xs disabled:opacity-40">Next →</button>
                </div>
              )}
            </>
          )}

          {/* Quick actions */}
          <div className="flex gap-2 mt-4 pt-4 border-t border-surface-100">
            <button onClick={() => onLog('received')} className="btn-secondary text-xs flex items-center justify-center gap-1.5 flex-1">
              <ArrowDown size={13} className="text-green-600" /> Add Stock
            </button>
            <button onClick={() => onLog('used')} className="btn-secondary text-xs flex items-center justify-center gap-1.5 flex-1">
              <Minus size={13} className="text-amber-600" /> Log Usage
            </button>
            <button onClick={() => onLog('adjustment')} className="btn-secondary text-xs flex items-center justify-center gap-1.5 flex-1">
              <RotateCcw size={13} className="text-purple-600" /> Adjust
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Movement History tab — paginated, self-fetching ───────────────────────
function MovementHistoryTab({ products }) {
  const [logs, setLogs]   = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    const from = page * PAGE_SIZE;
    supabase.from('inventory_logs').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id',         { ascending: true })  // stable tiebreaker
      .range(from, from + PAGE_SIZE - 1)
      .then(({ data, count }) => { setLogs(data || []); setTotal(count || 0); });
  }, [page]);

  const productMap = useMemo(() => { const m = {}; products.forEach(p => { m[p.id] = p.name; }); return m; }, [products]);
  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b border-surface-100">
            <th className="table-header">Date</th><th className="table-header">Product</th>
            <th className="table-header">Type</th><th className="table-header text-center">Qty</th>
            <th className="table-header">Notes</th>
          </tr></thead>
          <tbody>
            {logs.map(log => {
              const lt = LOG_TYPES.find(t => t.value === log.type);
              return (
                <tr key={log.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                  <td className="table-cell font-mono text-xs">{formatDate(log.date||log.created_at)}</td>
                  <td className="table-cell font-medium">{productMap[log.product_id]||'—'}</td>
                  <td className="table-cell"><span className={`text-xs font-medium ${lt?.color||''}`}>{lt?.label||log.type}</span></td>
                  <td className={`table-cell text-center font-mono text-sm font-semibold ${log.quantity>=0?'text-green-600':'text-red-600'}`}>{log.quantity>=0?'+':''}{log.quantity}</td>
                  <td className="table-cell text-surface-500 text-xs max-w-[200px] truncate">{log.notes||'—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total === 0 && <div className="p-8 text-center text-sm text-surface-400">No movement history yet</div>}
      {pages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-surface-100 bg-surface-50 text-xs text-surface-500">
          <span>{total.toLocaleString()} entries · page {page+1} / {pages}</span>
          <div className="flex gap-1">
            {[['‹',page-1],['›',page+1]].map(([l,p]) => (
              <button key={l} onClick={() => setPage(p)} disabled={p<0||p>=pages} className="btn-ghost px-2 py-1 text-xs disabled:opacity-30">{l}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const { products, addProduct, updateProduct, deleteProduct, addInventoryLog } = useData();
  const { isAdmin } = useAuth();

  // Core state
  const [activeTab, setActiveTab]         = useState('dashboard');
  const [search, setSearch]               = useState('');
  const [filterCat, setFilterCat]         = useState('');
  const [filterStatus, setFilterStatus]   = useState('');
  const [expandedId, setExpandedId]       = useState(null);
  const [profileMap, setProfileMap]       = useState({});

  // Modals
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct]     = useState(null);
  const [showLogModal, setShowLogModal]         = useState(false);
  const [showCountModal, setShowCountModal]     = useState(false);
  const [saving, setSaving]                     = useState(false);
  const [countEntries, setCountEntries]         = useState([]);

  // Product form
  const [productForm, setProductForm] = useState({
    name: '', category: 'Beer', unit: 'units',
    cost_price: '', sell_price: '',
    reorder_level: '5', current_stock: '0', target_stock: '0',
  });
  const [imageFile, setImageFile]       = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);
  const imageInputRef = useRef(null);

  // Log form
  const [logForm, setLogForm] = useState({
    product_id: '', type: 'received', quantity: '', notes: '',
    date: new Date().toISOString().slice(0, 10),
  });

  // Dashboard filter
  const [dashCat, setDashCat] = useState('');

  // Load profiles for user name display in ledger
  useEffect(() => {
    supabase.from('profiles').select('id,full_name').then(({ data }) => {
      const m = {};
      (data || []).forEach((p) => { m[p.id] = p.full_name || 'Unknown'; });
      setProfileMap(m);
    });
  }, []);

  // When editing a product, load existing image preview
  useEffect(() => {
    if (editingProduct?.image_url) {
      supabase.storage.from('product-images').createSignedUrl(editingProduct.image_url, 3600)
        .then(({ data }) => { if (data) setImagePreview(data.signedUrl); });
    }
  }, [editingProduct]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const filteredProducts = useMemo(() => {
    let list = [...products].sort((a, b) => a.name.localeCompare(b.name));
    if (search) { const q = search.toLowerCase(); list = list.filter((p) => p.name.toLowerCase().includes(q)); }
    if (filterCat) list = list.filter((p) => p.category === filterCat);
    if (filterStatus === 'low')    list = list.filter((p) => STOCK_STATUS(p) !== 'ok');
    if (filterStatus === 'out')    list = list.filter((p) => (p.current_stock || 0) === 0);
    if (filterStatus === 'restock') list = list.filter((p) => (p.current_stock || 0) < (p.target_stock || 0));
    return list;
  }, [products, search, filterCat, filterStatus]);

  // ── Dashboard data ────────────────────────────────────────────────────────

  const dashProducts = useMemo(() =>
    dashCat ? products.filter((p) => p.category === dashCat) : products,
    [products, dashCat]
  );

  const stats = useMemo(() => {
    const totalValue   = products.reduce((s, p) => s + (p.current_stock || 0) * (p.cost_price || 0), 0);
    const restockCost  = products
      .filter((p) => (p.current_stock || 0) < (p.target_stock || 0))
      .reduce((s, p) => s + ((p.target_stock || 0) - (p.current_stock || 0)) * (p.cost_price || 0), 0);
    const lowCount     = products.filter((p) => STOCK_STATUS(p) !== 'ok').length;
    return { total: products.length, totalValue, restockCost, lowCount };
  }, [products]);

  const stockChartData = useMemo(() =>
    [...dashProducts]
      .sort((a, b) => ((b.target_stock || 0) - (b.current_stock || 0)) - ((a.target_stock || 0) - (a.current_stock || 0)))
      .slice(0, 20)
      .map((p) => ({
        name: p.name.length > 22 ? p.name.slice(0, 22) + '…' : p.name,
        current: p.current_stock || 0,
        target: p.target_stock || 0,
        status: STOCK_STATUS(p),
      })),
    [dashProducts]
  );

  const pieData = useMemo(() => {
    const m = {};
    products.forEach((p) => {
      const k = p.category || 'Other';
      m[k] = (m[k] || 0) + (p.current_stock || 0) * (p.cost_price || 0);
    });
    return Object.entries(m)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  }, [products]);

  const restockList = useMemo(() =>
    products
      .filter((p) => (p.current_stock || 0) < (p.target_stock || 0))
      .map((p) => ({
        ...p,
        shortfall: (p.target_stock || 0) - (p.current_stock || 0),
        restockCost: ((p.target_stock || 0) - (p.current_stock || 0)) * (p.cost_price || 0),
      }))
      .sort((a, b) => b.restockCost - a.restockCost),
    [products]
  );

  const restockTotal = restockList.reduce((s, p) => s + p.restockCost, 0);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }

  function openAddProduct() {
    setEditingProduct(null);
    setProductForm({ name:'', category:'Beer', unit:'units', cost_price:'', sell_price:'', reorder_level:'5', current_stock:'0', target_stock:'0' });
    setImageFile(null);
    setImagePreview('');
    setShowProductModal(true);
  }

  function openEditProduct(p) {
    setEditingProduct(p);
    setProductForm({
      name: p.name, category: p.category || 'Beer', unit: p.unit || 'units',
      cost_price: p.cost_price?.toString() || '', sell_price: p.sell_price?.toString() || '',
      reorder_level: p.reorder_level?.toString() || '5',
      current_stock: p.current_stock?.toString() || '0',
      target_stock: p.target_stock?.toString() || '0',
    });
    setImageFile(null);
    setImagePreview('');
    setShowProductModal(true);
  }

  async function handleSaveProduct(e) {
    e.preventDefault();
    setSaving(true);
    try {
      let imageUrl = editingProduct?.image_url || '';
      if (imageFile) {
        setUploadingImg(true);
        const path = `${Date.now()}_${imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { data: upData, error: upErr } = await supabase.storage.from('product-images').upload(path, imageFile);
        setUploadingImg(false);
        if (upErr) throw upErr;
        imageUrl = upData.path;
      }
      const payload = {
        name: productForm.name,
        category: productForm.category,
        unit: productForm.unit,
        cost_price: parseFloat(productForm.cost_price) || 0,
        sell_price: parseFloat(productForm.sell_price) || 0,
        reorder_level: parseInt(productForm.reorder_level) || 5,
        current_stock: parseInt(productForm.current_stock) || 0,
        target_stock: parseInt(productForm.target_stock) || 0,
        image_url: imageUrl,
      };
      if (editingProduct) { await updateProduct(editingProduct.id, payload); toast.success('Product updated'); }
      else                { await addProduct(payload); toast.success('Product added'); }
      setShowProductModal(false);
      setEditingProduct(null);
    } catch (err) { toast.error(err.message || 'Failed to save'); }
    finally { setSaving(false); setUploadingImg(false); }
  }

  async function handleLogEntry(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await addInventoryLog({
        product_id: logForm.product_id,
        type: logForm.type,
        quantity: parseInt(logForm.quantity) || 0,
        notes: logForm.notes,
        date: logForm.date,
      });
      toast.success('Inventory logged');
      setShowLogModal(false);
      setLogForm({ product_id: '', type: 'received', quantity: '', notes: '', date: new Date().toISOString().slice(0, 10) });
    } catch (err) { toast.error(err.message || 'Failed'); }
    finally { setSaving(false); }
  }

  function openLogModal(productId, type = 'received') {
    setLogForm({ product_id: productId || products[0]?.id || '', type, quantity: '', notes: '', date: new Date().toISOString().slice(0, 10) });
    setShowLogModal(true);
  }

  function startCount() {
    setCountEntries(products.map((p) => ({ product_id: p.id, name: p.name, system_stock: p.current_stock, counted: '' })));
    setShowCountModal(true);
  }

  async function handleSubmitCount() {
    setSaving(true);
    try {
      let n = 0;
      for (const entry of countEntries) {
        const counted = parseInt(entry.counted);
        if (isNaN(counted)) continue;
        const diff = counted - entry.system_stock;
        if (diff !== 0) {
          await addInventoryLog({ product_id: entry.product_id, type: 'adjustment', quantity: counted,
            notes: `Count: system=${entry.system_stock}, actual=${counted}`, date: new Date().toISOString().slice(0, 10) });
          n++;
        }
      }
      toast.success(`Count complete. ${n} adjustment(s) made.`);
      setShowCountModal(false);
    } catch (err) { toast.error(err.message || 'Failed'); }
    finally { setSaving(false); }
  }

  function printRestockList() {
    const rows = restockList.map((p) => `
      <tr><td>${p.name}</td><td>${p.category}</td><td>${p.current_stock}</td>
      <td>${p.target_stock || 0}</td><td>${p.shortfall}</td>
      <td>$${(p.cost_price || 0).toFixed(2)}</td><td>$${p.restockCost.toFixed(2)}</td></tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) { toast.error('Pop-up blocked'); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>Restock List</title>
      <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{padding:8px 12px;border:1px solid #ddd;text-align:left}th{background:#f5f5f5;font-weight:600}
      tfoot td{font-weight:700;background:#fafafa}</style></head>
      <body><h2>Restock Shopping List — TheBar</h2>
      <p style="color:#666">Generated: ${new Date().toLocaleDateString('en-US', { weekday:'long',year:'numeric',month:'long',day:'numeric' })}</p>
      <table><thead><tr><th>Product</th><th>Category</th><th>Current</th><th>Target</th><th>Shortfall</th><th>Unit Cost</th><th>Restock Cost</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="6">Total Restock Cost</td><td>$${restockTotal.toFixed(2)}</td></tr></tfoot>
      </table></body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            {products.length} products
            {stats.lowCount > 0 && <span className="text-amber-600 ml-1">· {stats.lowCount} need attention</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={startCount} className="btn-secondary flex items-center gap-2"><ClipboardList size={16} /> Stock Count</button>
          <button onClick={() => openLogModal()} className="btn-secondary flex items-center gap-2"><History size={16} /> Log Entry</button>
          <button onClick={openAddProduct} className="btn-primary flex items-center gap-2"><Plus size={16} /> Add Product</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-100 rounded-lg p-1 mb-6 w-fit">
        {[{ id:'dashboard', label:'Dashboard' }, { id:'products', label:'Products' }, { id:'history', label:'Movement History' }].map((t) => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === t.id ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD TAB ── */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label:'Total Products',    value: stats.total,                      icon: Package,       color:'text-brand-600',  bg:'bg-brand-50' },
              { label:'Inventory Value',   value: formatCurrency(stats.totalValue), icon: DollarSign,    color:'text-green-700',  bg:'bg-green-50' },
              { label:'Restock Cost',      value: formatCurrency(stats.restockCost),icon: TrendingDown,  color:'text-amber-700',  bg:'bg-amber-50' },
              { label:'Low / Critical',    value: stats.lowCount,                   icon: AlertTriangle, color:'text-red-600',    bg:'bg-red-50' },
            ].map((s) => (
              <div key={s.label} className="card p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 ${s.bg} rounded-lg flex items-center justify-center shrink-0`}>
                    <s.icon size={18} className={s.color} />
                  </div>
                  <div>
                    <p className="text-xs text-surface-500 leading-none">{s.label}</p>
                    <p className={`font-mono font-semibold text-lg mt-0.5 ${s.color}`}>{s.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Category filter for charts */}
          <div className="flex items-center gap-3">
            <select value={dashCat} onChange={(e) => setDashCat(e.target.value)} className="input-field w-auto">
              <option value="">All Categories</option>
              {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-xs text-surface-400">{dashProducts.length} products in view</span>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Stock Level Bar Chart */}
            <div className="card p-5 lg:col-span-2">
              <h3 className="section-title mb-1">Stock Levels</h3>
              <p className="text-xs text-surface-400 mb-4">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1"></span>At/Above target
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 mx-1 ml-3"></span>Below target
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-600 mx-1 ml-3"></span>At/Below reorder
              </p>
              {stockChartData.length === 0 ? (
                <EmptyState icon={BarChart2} title="No products" description="Add products to see stock levels" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, stockChartData.length * 36)}>
                  <BarChart data={stockChartData} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v, n) => [v, n]} />
                    <Legend />
                    <Bar dataKey="current" name="Current Stock" radius={[0, 4, 4, 0]}>
                      {stockChartData.map((entry, i) => (
                        <Cell key={i} fill={STATUS_COLOR[entry.status]} />
                      ))}
                    </Bar>
                    <Bar dataKey="target" name="Target Stock" fill="#cbd5e1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Category Value Pie Chart */}
            <div className="card p-5">
              <h3 className="section-title mb-4">Value by Category</h3>
              {pieData.length === 0 ? (
                <EmptyState icon={BarChart2} title="No data" description="Add products with cost prices" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="45%" innerRadius={55} outerRadius={90} dataKey="value" nameKey="name" paddingAngle={2}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [formatCurrency(v), 'Value']} />
                    <Legend iconType="circle" iconSize={10} formatter={(v) => <span style={{ fontSize: 11 }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Restock Shopping List */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3 bg-surface-50 border-b border-surface-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">Restock Shopping List</h3>
                <p className="text-xs text-surface-400 mt-0.5">{restockList.length} products below target</p>
              </div>
              {restockList.length > 0 && (
                <button onClick={printRestockList} className="btn-secondary text-xs flex items-center gap-1.5">
                  <Printer size={13} /> Print List
                </button>
              )}
            </div>

            {restockList.length === 0 ? (
              <div className="p-8 text-center text-sm text-surface-400">
                🎉 All products are at or above target stock levels
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-100">
                      {['Product','Category','Current','Target','Shortfall','Unit Cost','Restock Cost'].map((h) => (
                        <th key={h} className={`table-header ${h.includes('Cost') || h === 'Shortfall' || h === 'Current' || h === 'Target' ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {restockList.map((p) => (
                      <tr key={p.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-medium">{p.name}</td>
                        <td className="table-cell"><span className="badge-green">{p.category}</span></td>
                        <td className="table-cell text-right font-mono text-red-600">{p.current_stock}</td>
                        <td className="table-cell text-right font-mono text-surface-600">{p.target_stock}</td>
                        <td className="table-cell text-right font-mono font-semibold text-amber-700">{p.shortfall}</td>
                        <td className="table-cell text-right font-mono text-sm">{formatCurrency(p.cost_price || 0)}</td>
                        <td className="table-cell text-right font-mono font-semibold">{formatCurrency(p.restockCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-surface-200 bg-surface-50">
                      <td colSpan={6} className="table-cell font-semibold">Total Restock Cost</td>
                      <td className="table-cell text-right font-mono font-bold text-surface-900">{formatCurrency(restockTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PRODUCTS TAB ── */}
      {activeTab === 'products' && (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input type="text" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9" />
            </div>
            <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="input-field w-auto min-w-[140px]">
              <option value="">All Categories</option>
              {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input-field w-auto min-w-[150px]">
              <option value="">All Stock</option>
              <option value="low">Low / Critical</option>
              <option value="out">Out of Stock</option>
              <option value="restock">Needs Restock</option>
            </select>
          </div>

          {filteredProducts.length === 0 ? (
            <EmptyState icon={Package} title="No products" description="Add your first product" action={{ label: 'Add Product', onClick: openAddProduct }} />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-100">
                      <th className="table-header w-14"></th>
                      <th className="table-header">Product</th>
                      <th className="table-header">Category</th>
                      <th className="table-header text-center">Stock / Target</th>
                      <th className="table-header text-right">Value</th>
                      <th className="table-header w-28"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p) => {
                      const status  = STOCK_STATUS(p);
                      const isOpen  = expandedId === p.id;
                      return (
                        <>
                          <tr
                            key={p.id}
                            onClick={() => setExpandedId(isOpen ? null : p.id)}
                            className={`border-b border-surface-50 cursor-pointer transition ${isOpen ? 'bg-brand-50/30' : 'hover:bg-surface-50'}`}
                          >
                            {/* Thumbnail */}
                            <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center">
                                <ProductThumbnail imageUrl={p.image_url} />
                              </div>
                            </td>
                            {/* Name */}
                            <td className="table-cell">
                              <div className="flex items-center gap-2">
                                {isOpen ? <ChevronDown size={14} className="text-brand-500 shrink-0" /> : <ChevronRight size={14} className="text-surface-300 shrink-0" />}
                                <span className="font-medium">{p.name}</span>
                              </div>
                            </td>
                            {/* Category */}
                            <td className="table-cell"><span className="badge-green">{p.category}</span></td>
                            {/* Stock */}
                            <td className="table-cell text-center">
                              <span className={`font-mono font-semibold ${status === 'critical' ? 'text-red-600' : status === 'low' ? 'text-amber-600' : 'text-green-700'}`}>
                                {p.current_stock ?? 0}
                              </span>
                              <span className="text-xs text-surface-400 mx-1">/</span>
                              <span className="font-mono text-xs text-surface-400">{p.target_stock ?? 0}</span>
                              <span className="text-xs text-surface-400 ml-1">{p.unit}</span>
                              {status === 'critical' && <span className="ml-1 text-xs text-red-500 font-medium">↓ Low</span>}
                            </td>
                            {/* Value */}
                            <td className="table-cell text-right font-mono text-sm">
                              {formatCurrency((p.current_stock || 0) * (p.cost_price || 0))}
                            </td>
                            {/* Actions */}
                            <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1 justify-end">
                                <button onClick={() => openLogModal(p.id, 'received')} className="p-1.5 text-surface-400 hover:text-green-600 transition" title="Add stock">
                                  <Plus size={14} />
                                </button>
                                {isAdmin && (
                                  <>
                                    <button onClick={() => openEditProduct(p)} className="p-1.5 text-surface-400 hover:text-brand-600 transition"><Edit3 size={14} /></button>
                                    <button onClick={() => { if (window.confirm(`Delete ${p.name}?`)) deleteProduct(p.id); }} className="p-1.5 text-surface-400 hover:text-red-500 transition"><Trash2 size={14} /></button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr key={`${p.id}-expanded`}>
                              <td colSpan={6} className="p-0">
                                <ExpandedRow
                                  p={p}
                                  profileMap={profileMap}
                                  onLog={(type) => openLogModal(p.id, type)}
                                  onEdit={() => openEditProduct(p)}
                                />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 bg-surface-50 border-t border-surface-100 flex items-center justify-between">
                <span className="text-sm font-medium text-surface-600">Total Inventory Value</span>
                <span className="font-mono font-semibold">{formatCurrency(stats.totalValue)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── MOVEMENT HISTORY TAB ── */}
      {activeTab === 'history' && <MovementHistoryTab products={products} />}

      {/* ── ADD / EDIT PRODUCT MODAL ── */}
      <Modal open={showProductModal} onClose={() => { setShowProductModal(false); setEditingProduct(null); }} title={editingProduct ? 'Edit Product' : 'Add Product'} size="lg">
        <form onSubmit={handleSaveProduct} className="space-y-4">
          {/* Photo */}
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-2">Product Photo</label>
            <div className="flex items-center gap-4">
              {imagePreview ? (
                <img src={imagePreview} alt="Preview" className="w-16 h-16 rounded-xl object-cover border border-surface-200 shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-surface-100 flex items-center justify-center border border-surface-200 shrink-0">
                  <Camera size={22} className="text-surface-300" />
                </div>
              )}
              <div className="space-y-1.5">
                <input ref={imageInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageSelect} className="hidden" />
                <button type="button" onClick={() => imageInputRef.current?.click()} className="btn-secondary text-xs flex items-center gap-1.5">
                  <Camera size={13} /> {imagePreview ? 'Change Photo' : 'Take Photo / Upload'}
                </button>
                {imagePreview && (
                  <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); }} className="btn-ghost text-xs block">Remove</button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Product Name</label>
            <input type="text" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="input-field" placeholder="e.g., Bud Light 12-pack" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Category</label>
              <select value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} className="input-field">
                {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Unit</label>
              <input type="text" value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className="input-field" placeholder="bottles, cases, units" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Cost Price</label>
              <input type="number" step="0.01" min="0" value={productForm.cost_price} onChange={(e) => setProductForm({ ...productForm, cost_price: e.target.value })} className="input-field" placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Sell Price</label>
              <input type="number" step="0.01" min="0" value={productForm.sell_price} onChange={(e) => setProductForm({ ...productForm, sell_price: e.target.value })} className="input-field" placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Current Stock</label>
              <input type="number" min="0" value={productForm.current_stock} onChange={(e) => setProductForm({ ...productForm, current_stock: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Target Stock</label>
              <input type="number" min="0" value={productForm.target_stock} onChange={(e) => setProductForm({ ...productForm, target_stock: e.target.value })} className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Reorder Level</label>
              <input type="number" min="0" value={productForm.reorder_level} onChange={(e) => setProductForm({ ...productForm, reorder_level: e.target.value })} className="input-field" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => { setShowProductModal(false); setEditingProduct(null); }} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || uploadingImg} className="btn-primary">
              {saving || uploadingImg ? <Spinner size="sm" className="text-white" /> : editingProduct ? 'Update Product' : 'Add Product'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── LOG INVENTORY MODAL ── */}
      <Modal open={showLogModal} onClose={() => setShowLogModal(false)} title="Log Inventory Movement">
        <form onSubmit={handleLogEntry} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Product</label>
            <select value={logForm.product_id} onChange={(e) => setLogForm({ ...logForm, product_id: e.target.value })} className="input-field" required>
              <option value="">Select product</option>
              {[...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                <option key={p.id} value={p.id}>{p.name} (Stock: {p.current_stock})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Type</label>
            <select value={logForm.type} onChange={(e) => setLogForm({ ...logForm, type: e.target.value })} className="input-field">
              {LOG_TYPES.map((lt) => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
              Quantity
              {logForm.type === 'adjustment' ? ' (new absolute stock level)' : logForm.type === 'received' ? ' (units received)' : ' (units removed)'}
            </label>
            <input type="number" value={logForm.quantity} onChange={(e) => setLogForm({ ...logForm, quantity: e.target.value })} className="input-field" placeholder="0" required />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label>
            <input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Notes <span className="text-surface-400 normal-case font-normal">(optional)</span></label>
            <input type="text" value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} className="input-field" placeholder="e.g. Received from supplier" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowLogModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" className="text-white" /> : 'Log Entry'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── STOCK COUNT MODAL ── */}
      <Modal open={showCountModal} onClose={() => setShowCountModal(false)} title="Periodic Stock Count" size="xl">
        <div>
          <p className="text-sm text-surface-500 mb-4">Enter the actual counted quantity. Only changed items will be adjusted.</p>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {countEntries.map((entry, idx) => (
              <div key={entry.product_id} className="flex items-center gap-3 px-3 py-2 bg-surface-50 rounded-lg">
                <span className="flex-1 text-sm font-medium">{entry.name}</span>
                <span className="text-xs text-surface-400 w-28 text-right">System: {entry.system_stock}</span>
                <input type="number" value={entry.counted}
                  onChange={(e) => { const u = [...countEntries]; u[idx] = { ...u[idx], counted: e.target.value }; setCountEntries(u); }}
                  className="input-field w-24 text-center" placeholder="Count" />
                {entry.counted !== '' && parseInt(entry.counted) !== entry.system_stock && (
                  <span className={`text-xs font-mono w-14 text-right ${parseInt(entry.counted) > entry.system_stock ? 'text-green-600' : 'text-red-600'}`}>
                    {parseInt(entry.counted) > entry.system_stock ? '+' : ''}{parseInt(entry.counted) - entry.system_stock}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-surface-100">
            <button onClick={() => setShowCountModal(false)} className="btn-ghost">Cancel</button>
            <button onClick={handleSubmitCount} disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" className="text-white" /> : 'Submit Count'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
