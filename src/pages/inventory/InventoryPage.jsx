import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Cell, PieChart, Pie, Legend, ResponsiveContainer,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { uploadProductImage, signedProductImage, prepareImage, imageErrorKey } from '../../lib/productImages';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n/I18nContext';
import { useLabel } from '../../components/useLabel';
import { useFields, ExtraFieldInputs, ExtraFieldValues } from '../../components/ExtraFields';
import { cleanExtra } from '../../lib/workspaceConfig';
import { formatDate, formatCurrency, formatQty } from '../../lib/utils';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Plus, Package, Search, ArrowDown, ArrowUp, RotateCcw, ClipboardList,
  Edit3, Trash2, History, Camera, ChevronDown, ChevronRight,
  Minus, Printer, TrendingDown, AlertTriangle, DollarSign, BarChart2, Check, X, Tags, ShoppingBag, Boxes,
} from 'lucide-react';

// Product categories belong to the workspace: the dropdown lists whatever its
// products already use, plus "+ New category…" to type one on the spot. A
// restaurant / bar starts with the classic set; everyone else starts with
// just "Other" and builds their own (a bakery: Bread, Cakes…).
// "Other" is stored as-is and only *displayed* in the user's language (catName).
const BAR_CATEGORIES = ['Beer', 'Wine', 'Spirits', 'Soft Drinks', 'Mixers', 'Food', 'Snacks'];
const DEFAULT_CATEGORY = 'Other';
const NEW_CATEGORY = '__new__';
const catName = (t, c) => (c === DEFAULT_CATEGORY ? t('inv.other') : c);
// What a product IS. 'sale' = something you sell (price, offered in Sales);
// 'supply' = raw material or packaging you use up (stock and cost only).
// Labels live in translations under inv.kind*.
const KINDS = [
  { value: 'sale',   labelKey: 'inv.kindSale',   hintKey: 'inv.kindSaleHint',   icon: ShoppingBag },
  { value: 'supply', labelKey: 'inv.kindSupply', hintKey: 'inv.kindSupplyHint', icon: Boxes },
];
const isSupply = (p) => p?.kind === 'supply';
// Movement types; the label is t(`inv.types.${value}`).
const LOG_TYPES = [
  { value: 'received',   icon: ArrowDown,  color: 'text-green-600' },
  { value: 'sold',       icon: ArrowUp,    color: 'text-blue-600' },
  { value: 'used',       icon: Minus,      color: 'text-amber-600' },
  { value: 'adjustment', icon: RotateCcw,  color: 'text-purple-600' },
  { value: 'returned',   icon: ArrowDown,  color: 'text-teal-600' },   // stock put back (a deleted sale, a customer return)
];
const typeLabel = (t, type) => (LOG_TYPES.some((lt) => lt.value === type) ? t(`inv.types.${type}`) : type);
const PIE_COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const STOCK_STATUS = (p) =>
  (p.current_stock || 0) <= (p.reorder_level || 0) ? 'critical'
  : (p.current_stock || 0) < (p.target_stock || 0) ? 'low'
  : 'ok';
const STATUS_COLOR = { critical: '#dc2626', low: '#f59e0b', ok: '#22c55e' };


// ── Form primitives — one labelled field, and a group of them ──
// Sentence-case labels, and the hint always sits under the control so that
// neighbouring fields in a grid row end at the same height.
function Field({ label, hint, optional, children }) {
  const { t } = useT();
  return (
    <div>
      <label className="block text-sm font-medium text-surface-700 mb-1.5">
        {label}
        {optional && <span className="text-surface-400 font-normal"> · {t('inv.optional')}</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-surface-500 mt-1.5 leading-snug">{hint}</p>}
    </div>
  );
}

function Section({ divider, children }) {
  return <div className={`space-y-4${divider ? ' mt-5 pt-5 border-t border-surface-100' : ''}`}>{children}</div>;
}
// ── Thumbnail — lazy: only requests signed URL when the element scrolls into view ──
function ProductThumbnail({ imageUrl, size = 'sm' }) {
  const { t } = useT();
  const [src, setSrc]       = useState('');
  const [failed, setFailed] = useState(false);
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
    let alive = true;
    signedProductImage(imageUrl).then(({ url, error }) => {
      if (!alive) return;
      if (url) setSrc(url); else setFailed(!!error);
    });
    return () => { alive = false; };
  }, [visible, imageUrl]);

  const dim = size === 'sm' ? 'w-10 h-10' : 'w-full h-40';
  // A product that HAS a photo we cannot read is not the same as one with no
  // photo: the first is a problem worth seeing, the second is normal.
  const tone = failed ? 'bg-amber-50 text-amber-500' : 'bg-surface-100 text-surface-300';
  return src
    ? <img ref={ref} src={src} alt="" onError={() => { setSrc(''); setFailed(true); }}
        className={`${dim} rounded-lg object-cover border border-surface-200 shrink-0`} />
    : <div ref={ref} title={failed ? t('inv.imgErr.load') : undefined}
        className={`${dim} rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
        {failed ? <AlertTriangle size={size === 'sm' ? 15 : 32} /> : <Package size={size === 'sm' ? 16 : 36} className="text-surface-300" />}
      </div>;
}

// ── Expandable product row — fetches its own logs from DB on open ────────
function ExpandedRow({ p, profileMap, onLog, onEdit }) {
  const { t } = useT();
  const extraFields = useFields('products');
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
              ['category', catName(t, p.category)],
              ['unit', p.unit],
              ['cost', formatCurrency(p.cost_price || 0)],
              ['sell', formatCurrency(p.sell_price || 0)],
              ['currentStock', `${formatQty(p.current_stock ?? 0)} ${p.unit}`],
              ['targetStock', `${formatQty(p.target_stock ?? 0)} ${p.unit}`],
              ['reorderLevel', `${formatQty(p.reorder_level ?? 0)} ${p.unit}`],
              ['stockValue', formatCurrency((p.current_stock || 0) * (p.cost_price || 0))],
            ].map(([key, value]) => (
              <div key={key} className="bg-white rounded-lg p-2 border border-surface-100">
                <p className="text-[10px] text-surface-400 uppercase tracking-wider leading-none">{t(`inv.${key}`)}</p>
                <p className="text-sm font-medium mt-0.5 truncate">{value}</p>
              </div>
            ))}
            {/* The workspace's own fields (Settings → Your portal) */}
            <ExtraFieldValues fields={extraFields} value={p.extra} variant="tiles" />
          </div>
          <button onClick={onEdit} className="btn-secondary w-full text-sm flex items-center justify-center gap-2">
            <Edit3 size={13} /> {t('inv.editProduct')}
          </button>
        </div>

        {/* Right — movement ledger */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-sm text-surface-700">{t('inv.ledger')}</h4>
            <span className="text-xs text-surface-400">{t('inv.totalEntries', { n: total })}</span>
          </div>

          {total === 0 ? (
            <p className="text-sm text-surface-400 text-center py-6">{t('inv.noHistory')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-100">
                      {['date','type','qty','notes','by'].map(h => (
                        <th key={h} className="text-left pb-2 text-xs font-semibold text-surface-500 uppercase tracking-wider pr-3">{t(`inv.${h}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayed.map((log) => {
                      const lt = LOG_TYPES.find((x) => x.value === log.type);
                      return (
                        <tr key={log.id} className="border-b border-surface-50">
                          <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">{formatDate(log.date || log.created_at)}</td>
                          <td className="py-2 pr-3"><span className={`text-xs font-medium ${lt?.color || ''}`}>{typeLabel(t, log.type)}</span></td>
                          <td className={`py-2 pr-3 font-mono text-xs font-semibold whitespace-nowrap ${log.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {log.quantity >= 0 ? '+' : ''}{formatQty(log.quantity)}
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
                  {t('inv.showAll', { n: total })}
                </button>
              )}
              {showAll && totalPages > 1 && (
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-100">
                  <button onClick={() => setPage((n) => Math.max(0, n - 1))} disabled={page === 0} className="btn-ghost text-xs disabled:opacity-40">{t('inv.prev')}</button>
                  <span className="text-xs text-surface-400">{t('inv.pageOf', { page: page + 1, pages: totalPages })}</span>
                  <button onClick={() => setPage((n) => Math.min(totalPages - 1, n + 1))} disabled={page >= totalPages - 1} className="btn-ghost text-xs disabled:opacity-40">{t('inv.next')}</button>
                </div>
              )}
            </>
          )}

          {/* Quick actions */}
          <div className="flex gap-2 mt-4 pt-4 border-t border-surface-100">
            <button onClick={() => onLog('received')} className="btn-secondary text-xs flex items-center justify-center gap-1.5 flex-1">
              <ArrowDown size={13} className="text-green-600" /> {t('inv.addStock')}
            </button>
            <button onClick={() => onLog('used')} className="btn-secondary text-xs flex items-center justify-center gap-1.5 flex-1">
              <Minus size={13} className="text-amber-600" /> {t('inv.logUsage')}
            </button>
            <button onClick={() => onLog('adjustment')} className="btn-secondary text-xs flex items-center justify-center gap-1.5 flex-1">
              <RotateCcw size={13} className="text-purple-600" /> {t('inv.adjust')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Movement History tab — paginated, self-fetching ───────────────────────
function MovementHistoryTab({ products }) {
  const { t } = useT();
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
            <th className="table-header">{t('inv.date')}</th><th className="table-header">{t('inv.product')}</th>
            <th className="table-header">{t('inv.type')}</th><th className="table-header text-center">{t('inv.qty')}</th>
            <th className="table-header">{t('inv.notes')}</th>
          </tr></thead>
          <tbody>
            {logs.map(log => {
              const lt = LOG_TYPES.find(x => x.value === log.type);
              return (
                <tr key={log.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                  <td className="table-cell font-mono text-xs">{formatDate(log.date||log.created_at)}</td>
                  <td className="table-cell font-medium">{productMap[log.product_id]||'—'}</td>
                  <td className="table-cell"><span className={`text-xs font-medium ${lt?.color||''}`}>{typeLabel(t, log.type)}</span></td>
                  <td className={`table-cell text-center font-mono text-sm font-semibold ${log.quantity>=0?'text-green-600':'text-red-600'}`}>{log.quantity>=0?'+':''}{formatQty(log.quantity)}</td>
                  <td className="table-cell text-surface-500 text-xs max-w-[200px] truncate">{log.notes||'—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total === 0 && <div className="p-8 text-center text-sm text-surface-400">{t('inv.noHistory')}</div>}
      {pages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-surface-100 bg-surface-50 text-xs text-surface-500">
          <span>{t('inv.entriesPage', { n: total.toLocaleString(), page: page + 1, pages })}</span>
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
  const { products, addProduct, updateProduct, deleteProduct, addInventoryLog, refresh } = useData();
  const { isAdmin, organization } = useAuth();
  const { t, tn, locale } = useT();
  const label = useLabel();
  const extraFields = useFields('products');   // the workspace's own product fields

  // Core state
  const [activeTab, setActiveTab]         = useState('dashboard');
  const [search, setSearch]               = useState('');
  const [filterCat, setFilterCat]         = useState('');
  const [filterStatus, setFilterStatus]   = useState('');
  const [filterKind, setFilterKind]       = useState('');
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
    name: '', kind: 'sale', category: DEFAULT_CATEGORY, unit: 'units',
    cost_price: '', sell_price: '',
    reorder_level: '5', current_stock: '0', target_stock: '0',
    extra: {},
  });
  const [imageFile, setImageFile]       = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);
  const imageInputRef = useRef(null);
  const [newCategory, setNewCategory]   = useState('');
  // What this product is made of: [{ component_id, quantity }]. Sale products only.
  const [recipe, setRecipe] = useState([]);

  // Supplies are what a recipe can draw on — packaging, ingredients.
  const supplies = useMemo(
    () => products.filter(isSupply).sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );

  const recipeCost = useMemo(() => recipe.reduce((sum, r) => {
    const sp = supplies.find((x) => x.id === r.component_id);
    return sum + (Number(sp?.cost_price) || 0) * (parseFloat(r.quantity) || 0);
  }, 0), [recipe, supplies]);

  // The workspace's categories: what its products use (+ the bar starter set
  // for a restaurant / bar), "Other" always last.
  const categories = useMemo(() => {
    const set = new Set();
    if (organization?.business_type === 'restaurant_bar') BAR_CATEGORIES.forEach((c) => set.add(c));
    products.forEach((p) => { const c = (p.category || '').trim(); if (c) set.add(c); });
    set.delete(DEFAULT_CATEGORY);
    return [...set].sort((a, b) => a.localeCompare(b)).concat(DEFAULT_CATEGORY);
  }, [products, organization?.business_type]);

  function commitNewCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setProductForm((f) => ({ ...f, category: name }));
    setNewCategory('');
  }

  // ── Category manager (rename / delete across this workspace's products) ──
  const [showCatModal, setShowCatModal] = useState(false);
  const [catEdits, setCatEdits] = useState({});          // old name → draft new name
  const [catBusy, setCatBusy] = useState('');
  const countIn = (cat) => products.filter((p) => (p.category || '').trim() === cat).length;

  async function renameProductCategory(oldName) {
    const next = (catEdits[oldName] || '').trim();
    if (!next || next === oldName) return;
    setCatBusy(oldName);
    try {
      const { error } = await supabase.from('products').update({ category: next, updated_at: new Date().toISOString() }).eq('category', oldName);
      if (error) throw error;
      await refresh();
      setCatEdits((e) => { const n = { ...e }; delete n[oldName]; return n; });
      if (filterCat === oldName) setFilterCat(next);
      if (productForm.category === oldName) setProductForm((f) => ({ ...f, category: next }));
      toast.success(t('inv.renamedTo', { name: next }));
    } catch (err) { toast.error(err.message || t('inv.couldNotRename')); }
    finally { setCatBusy(''); }
  }

  async function deleteProductCategory(oldName) {
    const n = countIn(oldName);
    const vars = { name: oldName, n, other: t('inv.other') };
    const msg = !n ? t('inv.confirmDeleteCatEmpty', vars) : n === 1 ? t('inv.confirmDeleteCatOne', vars) : t('inv.confirmDeleteCat', vars);
    if (!window.confirm(msg)) return;
    setCatBusy(oldName);
    try {
      if (n) {
        const { error } = await supabase.from('products').update({ category: DEFAULT_CATEGORY, updated_at: new Date().toISOString() }).eq('category', oldName);
        if (error) throw error;
        await refresh();
      }
      if (filterCat === oldName) setFilterCat('');
      toast.success(t('inv.catDeleted', { name: oldName }));
    } catch (err) { toast.error(err.message || t('inv.couldNotDelete')); }
    finally { setCatBusy(''); }
  }

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
      (data || []).forEach((p) => { m[p.id] = p.full_name || t('inv.unknownUser'); });
      setProfileMap(m);
    });
  }, []); // eslint-disable-line

  // When editing a product, load existing image preview
  useEffect(() => {
    if (editingProduct?.image_url) {
      signedProductImage(editingProduct.image_url).then(({ url, error }) => {
        if (url) setImagePreview(url);
        else if (error) toast.error(t('inv.imgErr.load'));
      });
    }
  }, [editingProduct]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const filteredProducts = useMemo(() => {
    let list = [...products].sort((a, b) => a.name.localeCompare(b.name));
    if (search) { const q = search.toLowerCase(); list = list.filter((p) => p.name.toLowerCase().includes(q)); }
    if (filterCat) list = list.filter((p) => p.category === filterCat);
    if (filterKind) list = list.filter((p) => (filterKind === 'supply') === isSupply(p));
    if (filterStatus === 'low')    list = list.filter((p) => STOCK_STATUS(p) !== 'ok');
    if (filterStatus === 'out')    list = list.filter((p) => (p.current_stock || 0) === 0);
    if (filterStatus === 'restock') list = list.filter((p) => (p.current_stock || 0) < (p.target_stock || 0));
    return list;
  }, [products, search, filterCat, filterStatus, filterKind]);

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
      const k = p.category || DEFAULT_CATEGORY;
      m[k] = (m[k] || 0) + (p.current_stock || 0) * (p.cost_price || 0);
    });
    return Object.entries(m)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name: catName(t, name), value: Math.round(value * 100) / 100 }));
  }, [products, t]);

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

  async function handleImageSelect(e) {
    const file = e.target.files[0];
    e.target.value = '';          // same file twice in a row must re-trigger
    if (!file) return;
    try {
      // Shrink here, not at save time: the owner sees the real preview and the
      // upload is already small by the time they press Save.
      const { blob, name } = await prepareImage(file);
      setImageFile(new File([blob], name, { type: blob.type || 'image/jpeg' }));
      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target.result);
      reader.readAsDataURL(blob);
    } catch (err) {
      setImageFile(null);
      setImagePreview('');
      toast.error(t(imageErrorKey(err)));
    }
  }

  function openAddProduct() {
    setEditingProduct(null);
    // Default unit in the user's language ("units" / "unidades"); it is just text on the product.
    setProductForm({ name:'', kind:'sale', category: categories[0] || DEFAULT_CATEGORY, unit: t('inv.unitPh'), cost_price:'', sell_price:'', reorder_level:'5', current_stock:'0', target_stock:'0', extra: {} });
    setNewCategory('');
    setRecipe([]);
    setImageFile(null);
    setImagePreview('');
    setShowProductModal(true);
  }

  function openEditProduct(p) {
    setEditingProduct(p);
    setProductForm({
      name: p.name, kind: p.kind === 'supply' ? 'supply' : 'sale', category: p.category || DEFAULT_CATEGORY, unit: p.unit || 'units',
      cost_price: p.cost_price?.toString() || '', sell_price: p.sell_price?.toString() || '',
      reorder_level: p.reorder_level?.toString() || '5',
      current_stock: p.current_stock?.toString() || '0',
      target_stock: p.target_stock?.toString() || '0',
      extra: p.extra && typeof p.extra === 'object' ? { ...p.extra } : {},
    });
    setNewCategory('');
    setRecipe([]);
    if (p.kind !== 'supply') {
      supabase.from('product_components').select('component_id, quantity').eq('product_id', p.id)
        .then(({ data }) => setRecipe((data || []).map((r) => ({ component_id: r.component_id, quantity: String(r.quantity) }))));
    }
    setImageFile(null);
    setImagePreview('');
    setShowProductModal(true);
  }

  // Replace the saved recipe with what is on screen: drop the rows that are gone,
  // upsert the rest. A supply never has one.
  async function saveRecipe(productId, rows) {
    const clean = rows
      .filter((r) => r.component_id && (parseFloat(r.quantity) || 0) > 0)
      .map((r) => ({ product_id: productId, component_id: r.component_id, quantity: parseFloat(r.quantity) }));
    let del = supabase.from('product_components').delete().eq('product_id', productId);
    if (clean.length) del = del.not('component_id', 'in', `(${clean.map((r) => r.component_id).join(',')})`);
    const { error: delErr } = await del;
    if (delErr) throw delErr;
    if (clean.length) {
      const { error } = await supabase.from('product_components')
        .upsert(clean, { onConflict: 'product_id,component_id' });
      if (error) throw error;
    }
  }

  async function handleSaveProduct(e) {
    e.preventDefault();
    let category = productForm.category;
    if (category === NEW_CATEGORY) {
      category = newCategory.trim();
      if (!category) { toast.error(t('inv.typeCategoryName')); return; }
    }
    setSaving(true);
    try {
      let imageUrl = editingProduct?.image_url || '';
      if (imageFile) {
        setUploadingImg(true);
        try {
          imageUrl = await uploadProductImage(imageFile, organization?.id);
        } catch (err) {
          setUploadingImg(false);
          setSaving(false);
          toast.error(t(imageErrorKey(err)));
          return;
        }
        setUploadingImg(false);
      }
      const payload = {
        name: productForm.name,
        kind: productForm.kind === 'supply' ? 'supply' : 'sale',
        category,
        unit: productForm.unit,
        cost_price: parseFloat(productForm.cost_price) || 0,
        sell_price: productForm.kind === 'supply' ? 0 : (parseFloat(productForm.sell_price) || 0),
        reorder_level: parseFloat(productForm.reorder_level) || 0,
        current_stock: parseFloat(productForm.current_stock) || 0,
        target_stock: parseFloat(productForm.target_stock) || 0,
        image_url: imageUrl,
      };
      // Written only when the workspace has fields or the row already carries
      // the column (custom-fields migration): an older database would reject it.
      if (extraFields.length || (editingProduct && 'extra' in editingProduct)) {
        payload.extra = cleanExtra(extraFields, productForm.extra);
      }
      let productId = editingProduct?.id;
      if (editingProduct) { await updateProduct(editingProduct.id, payload); }
      else                { productId = (await addProduct(payload)).id; }
      await saveRecipe(productId, productForm.kind === 'supply' ? [] : recipe);
      toast.success(editingProduct ? t('inv.productUpdated') : t('inv.productAdded'));
      setShowProductModal(false);
      setEditingProduct(null);
    } catch (err) { toast.error(err.message || t('inv.saveFailed')); }
    finally { setSaving(false); setUploadingImg(false); }
  }

  async function handleLogEntry(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await addInventoryLog({
        product_id: logForm.product_id,
        type: logForm.type,
        quantity: parseFloat(logForm.quantity) || 0,
        notes: logForm.notes,
        date: logForm.date,
      });
      toast.success(t('inv.logged'));
      setShowLogModal(false);
      setLogForm({ product_id: '', type: 'received', quantity: '', notes: '', date: new Date().toISOString().slice(0, 10) });
    } catch (err) { toast.error(err.message || t('inv.failed')); }
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
        const counted = parseFloat(entry.counted);
        if (isNaN(counted)) continue;
        const diff = counted - entry.system_stock;
        if (diff !== 0) {
          await addInventoryLog({ product_id: entry.product_id, type: 'adjustment', quantity: counted,
            notes: t('inv.countNote', { system: formatQty(entry.system_stock), actual: formatQty(counted) }), date: new Date().toISOString().slice(0, 10) });
          n++;
        }
      }
      toast.success(tn('inv.countDone', n));
      setShowCountModal(false);
    } catch (err) { toast.error(err.message || t('inv.failed')); }
    finally { setSaving(false); }
  }

  function printRestockList() {
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rows = restockList.map((p) => `
      <tr><td>${esc(p.name)}</td><td>${esc(catName(t, p.category))}</td><td>${formatQty(p.current_stock)}</td>
      <td>${formatQty(p.target_stock || 0)}</td><td>${formatQty(p.shortfall)}</td>
      <td>$${(p.cost_price || 0).toFixed(2)}</td><td>$${p.restockCost.toFixed(2)}</td></tr>`).join('');
    const win = window.open('', '_blank');
    if (!win) { toast.error(t('inv.popupBlocked')); return; }
    const heads = ['product', 'category', 'current', 'target', 'shortfall', 'unitCost', 'restockCost'].map((k) => `<th>${esc(t(`inv.${k}`))}</th>`).join('');
    const generated = new Date().toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    win.document.write(`<!DOCTYPE html><html lang="${locale.slice(0, 2)}"><head><meta charset="utf-8"><title>${esc(t('inv.printTitle'))}</title>
      <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{padding:8px 12px;border:1px solid #ddd;text-align:left}th{background:#f5f5f5;font-weight:600}
      tfoot td{font-weight:700;background:#fafafa}</style></head>
      <body><h2>${esc(t('inv.restockList'))} — ${esc(organization?.name || 'SelRic')}</h2>
      <p style="color:#666">${esc(t('inv.printGenerated', { date: generated }))}</p>
      <table><thead><tr>${heads}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="6">${esc(t('inv.totalRestockCost'))}</td><td>$${restockTotal.toFixed(2)}</td></tr></tfoot>
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
          <h1 className="page-title">{label('inventory')}</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            {tn('inv.productsCount', products.length)}
            {stats.lowCount > 0 && <span className="text-amber-600 ml-1">{tn('inv.needAttention', stats.lowCount)}</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={startCount} className="btn-secondary flex items-center gap-2"><ClipboardList size={16} /> {t('inv.stockCount')}</button>
          <button onClick={() => openLogModal()} className="btn-secondary flex items-center gap-2"><History size={16} /> {t('inv.logEntry')}</button>
          <button onClick={openAddProduct} className="btn-primary flex items-center gap-2"><Plus size={16} /> {t('inv.addProduct')}</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-100 rounded-lg p-1 mb-6 w-fit">
        {['dashboard', 'products', 'history'].map((id) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === id ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'}`}>
            {t(`inv.tabs.${id}`)}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD TAB ── */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: t('inv.stats.total'),   value: stats.total,                      icon: Package,       color:'text-brand-600',  bg:'bg-brand-50' },
              { label: t('inv.stats.value'),   value: formatCurrency(stats.totalValue), icon: DollarSign,    color:'text-green-700',  bg:'bg-green-50' },
              { label: t('inv.stats.restock'), value: formatCurrency(stats.restockCost),icon: TrendingDown,  color:'text-amber-700',  bg:'bg-amber-50' },
              { label: t('inv.stats.low'),     value: stats.lowCount,                   icon: AlertTriangle, color:'text-red-600',    bg:'bg-red-50' },
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
              <option value="">{t('inv.allCategories')}</option>
              {categories.map((c) => <option key={c} value={c}>{catName(t, c)}</option>)}
            </select>
            <span className="text-xs text-surface-400">{tn('inv.inView', dashProducts.length)}</span>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Stock Level Bar Chart */}
            <div className="card p-5 lg:col-span-2">
              <h3 className="section-title mb-1">{t('inv.stockLevels')}</h3>
              <p className="text-xs text-surface-400 mb-4">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1"></span>{t('inv.legendOk')}
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 mx-1 ml-3"></span>{t('inv.legendLow')}
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-600 mx-1 ml-3"></span>{t('inv.legendCritical')}
              </p>
              {stockChartData.length === 0 ? (
                <EmptyState icon={BarChart2} title={t('inv.noProducts')} description={t('inv.addToSee')} />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, stockChartData.length * 36)}>
                  <BarChart data={stockChartData} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v, n) => [v, n]} />
                    <Legend />
                    <Bar dataKey="current" name={t('inv.chartCurrent')} radius={[0, 4, 4, 0]}>
                      {stockChartData.map((entry, i) => (
                        <Cell key={i} fill={STATUS_COLOR[entry.status]} />
                      ))}
                    </Bar>
                    <Bar dataKey="target" name={t('inv.chartTarget')} fill="#cbd5e1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Category Value Pie Chart */}
            <div className="card p-5">
              <h3 className="section-title mb-4">{t('inv.valueByCategory')}</h3>
              {pieData.length === 0 ? (
                <EmptyState icon={BarChart2} title={t('inv.noData')} description={t('inv.addWithCost')} />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="45%" innerRadius={55} outerRadius={90} dataKey="value" nameKey="name" paddingAngle={2}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [formatCurrency(v), t('inv.value')]} />
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
                <h3 className="font-semibold text-sm">{t('inv.restockList')}</h3>
                <p className="text-xs text-surface-400 mt-0.5">{tn('inv.belowTarget', restockList.length)}</p>
              </div>
              {restockList.length > 0 && (
                <button onClick={printRestockList} className="btn-secondary text-xs flex items-center gap-1.5">
                  <Printer size={13} /> {t('inv.printList')}
                </button>
              )}
            </div>

            {restockList.length === 0 ? (
              <div className="p-8 text-center text-sm text-surface-400">
                {t('inv.allGood')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-100">
                      {['product','category','current','target','shortfall','unitCost','restockCost'].map((h, i) => (
                        <th key={h} className={`table-header ${i >= 2 ? 'text-right' : ''}`}>{t(`inv.${h}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {restockList.map((p) => (
                      <tr key={p.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-medium">{p.name}</td>
                        <td className="table-cell"><span className="badge-green">{catName(t, p.category)}</span></td>
                        <td className="table-cell text-right font-mono text-red-600">{formatQty(p.current_stock)}</td>
                        <td className="table-cell text-right font-mono text-surface-600">{formatQty(p.target_stock)}</td>
                        <td className="table-cell text-right font-mono font-semibold text-amber-700">{formatQty(p.shortfall)}</td>
                        <td className="table-cell text-right font-mono text-sm">{formatCurrency(p.cost_price || 0)}</td>
                        <td className="table-cell text-right font-mono font-semibold">{formatCurrency(p.restockCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-surface-200 bg-surface-50">
                      <td colSpan={6} className="table-cell font-semibold">{t('inv.totalRestockCost')}</td>
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
              <input type="text" placeholder={t('inv.searchPh')} value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9" />
            </div>
            <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="input-field w-auto min-w-[140px]">
              <option value="">{t('inv.allCategories')}</option>
              {categories.map((c) => <option key={c} value={c}>{catName(t, c)}</option>)}
            </select>
            <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} className="input-field w-auto min-w-[130px]">
              <option value="">{t('inv.kindAll')}</option>
              <option value="sale">{t('inv.kindSale')}</option>
              <option value="supply">{t('inv.kindSupplies')}</option>
            </select>
            <button type="button" onClick={() => { setCatEdits({}); setShowCatModal(true); }} className="btn-secondary px-3 text-sm whitespace-nowrap" title={t('inv.categoriesTip')}>
              <Tags size={15} /> {t('inv.categories')}
            </button>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input-field w-auto min-w-[150px]">
              <option value="">{t('inv.allStock')}</option>
              <option value="low">{t('inv.lowCritical')}</option>
              <option value="out">{t('inv.outOfStock')}</option>
              <option value="restock">{t('inv.needsRestock')}</option>
            </select>
          </div>

          {filteredProducts.length === 0 ? (
            <EmptyState icon={Package} title={t('inv.noProducts')} description={t('inv.addFirst')} action={{ label: t('inv.addProduct'), onClick: openAddProduct }} />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-100">
                      <th className="table-header w-14"></th>
                      <th className="table-header">{t('inv.product')}</th>
                      <th className="table-header">{t('inv.category')}</th>
                      <th className="table-header text-center">{t('inv.stockTarget')}</th>
                      <th className="table-header text-right">{t('inv.value')}</th>
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
                            <td className="table-cell"><span className="badge-green">{catName(t, p.category)}</span>{isSupply(p) && <span className="badge bg-surface-100 text-surface-600 ml-1.5">{t('inv.kindSupply')}</span>}</td>
                            {/* Stock */}
                            <td className="table-cell text-center">
                              <span className={`font-mono font-semibold ${status === 'critical' ? 'text-red-600' : status === 'low' ? 'text-amber-600' : 'text-green-700'}`}>
                                {formatQty(p.current_stock ?? 0)}
                              </span>
                              <span className="text-xs text-surface-400 mx-1">/</span>
                              <span className="font-mono text-xs text-surface-400">{formatQty(p.target_stock ?? 0)}</span>
                              <span className="text-xs text-surface-400 ml-1">{p.unit}</span>
                              {status === 'critical' && <span className="ml-1 text-xs text-red-500 font-medium">{t('inv.lowTag')}</span>}
                            </td>
                            {/* Value */}
                            <td className="table-cell text-right font-mono text-sm">
                              {formatCurrency((p.current_stock || 0) * (p.cost_price || 0))}
                            </td>
                            {/* Actions */}
                            <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1 justify-end">
                                <button onClick={() => openLogModal(p.id, 'received')} className="p-1.5 text-surface-400 hover:text-green-600 transition" title={t('inv.addStock')} aria-label={t('inv.addStock')}>
                                  <Plus size={14} />
                                </button>
                                {isAdmin && (
                                  <>
                                    <button onClick={() => openEditProduct(p)} className="p-1.5 text-surface-400 hover:text-brand-600 transition" title={t('inv.editProduct')} aria-label={t('inv.editProduct')}><Edit3 size={14} /></button>
                                    <button onClick={() => { if (window.confirm(t('inv.confirmDeleteProduct', { name: p.name }))) deleteProduct(p.id); }} className="p-1.5 text-surface-400 hover:text-red-500 transition" title={t('inv.delete')} aria-label={t('inv.confirmDeleteProduct', { name: p.name })}><Trash2 size={14} /></button>
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
                <span className="text-sm font-medium text-surface-600">{t('inv.totalValue')}</span>
                <span className="font-mono font-semibold">{formatCurrency(stats.totalValue)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── MOVEMENT HISTORY TAB ── */}
      {activeTab === 'history' && <MovementHistoryTab products={products} />}

      {/* ── ADD / EDIT PRODUCT MODAL ── */}
      <Modal
        open={showProductModal}
        onClose={() => { setShowProductModal(false); setEditingProduct(null); }}
        title={editingProduct ? t('inv.editTitle') : t('inv.addTitle')}
        description={productForm.kind === 'supply' ? t('inv.descSupply') : t('inv.descSale')}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowProductModal(false); setEditingProduct(null); }} className="btn-ghost">{t('common.cancel')}</button>
            <button type="submit" form="product-form" disabled={saving || uploadingImg} className="btn-primary">
              {saving || uploadingImg ? <Spinner size="sm" className="text-white" /> : editingProduct ? t('inv.saveChanges') : t('inv.addProduct')}
            </button>
          </div>
        }
      >
        <form id="product-form" onSubmit={handleSaveProduct}>
          {/* What is it — the answer changes which fields below make sense. */}
          <Section>
            <Field label={t('inv.whatIsIt')}>
              <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label={t('inv.productKind')}>
                {KINDS.map(({ value, labelKey, hintKey, icon: Icon }) => {
                  const on = productForm.kind === value;
                  return (
                    <button key={value} type="button" role="radio" aria-checked={on} onClick={() => setProductForm({ ...productForm, kind: value })}
                      className={`text-left rounded-xl border px-3.5 py-3 transition ${on ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-surface-200 hover:border-surface-400 bg-white'}`}>
                      <div className={`flex items-center gap-2 text-sm font-semibold ${on ? 'text-brand-900' : 'text-surface-800'}`}><Icon size={15} /> {t(labelKey)}</div>
                      <p className="text-xs text-surface-500 mt-1 leading-snug">{t(hintKey)}</p>
                    </button>
                  );
                })}
              </div>
            </Field>
          </Section>

          {/* Identity */}
          <Section divider>
            <Field label={productForm.kind === 'supply' ? t('inv.supplyName') : t('inv.productName')}>
              <input type="text" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="input-field" placeholder={productForm.kind === 'supply' ? t('inv.supplyNamePh') : t('inv.productNamePh')} required />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label={t('inv.category')}>
                {productForm.category === NEW_CATEGORY ? (
                  <div className="flex gap-2">
                    <input
                      type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="input-field"
                      placeholder={t('inv.newCategoryPh')} autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitNewCategory(); } }}
                    />
                    <button type="button" onClick={commitNewCategory} disabled={!newCategory.trim()} className="btn-primary px-3 shrink-0" aria-label={t('inv.addCategory')}><Check size={16} /></button>
                    <button type="button" onClick={() => { setProductForm({ ...productForm, category: categories[0] || DEFAULT_CATEGORY }); setNewCategory(''); }} className="btn-ghost px-2 shrink-0" aria-label={t('common.cancel')}><X size={16} /></button>
                  </div>
                ) : (
                  <select value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} className="input-field">
                    {categories.map((c) => <option key={c} value={c}>{catName(t, c)}</option>)}
                    {productForm.category && !categories.includes(productForm.category) && (
                      <option value={productForm.category}>{productForm.category}</option>
                    )}
                    <option value={NEW_CATEGORY}>{t('inv.newCategoryOpt')}</option>
                  </select>
                )}
              </Field>
              <Field label={t('inv.unit')} hint={t('inv.unitHint')}>
                <input type="text" value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className="input-field" placeholder={t('inv.unitPh')} />
              </Field>
            </div>

            <Field label={t('inv.photo')} optional>
              <div className="flex items-center gap-4">
                {imagePreview ? (
                  <img src={imagePreview} alt="" className="w-16 h-16 rounded-xl object-cover border border-surface-200 shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-surface-100 flex items-center justify-center border border-surface-200 shrink-0">
                    <Camera size={22} className="text-surface-300" />
                  </div>
                )}
                <div className="space-y-1.5">
                  {/* No `capture` attribute: on a phone the browser then offers camera OR gallery; on a computer it opens the file picker. */}
                  <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                  <button type="button" onClick={() => imageInputRef.current?.click()} className="btn-secondary text-xs flex items-center gap-1.5">
                    <Camera size={13} /> {imagePreview ? t('inv.changePhoto') : t('inv.uploadPhoto')}
                  </button>
                  {imagePreview && (
                    <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); }} className="btn-ghost text-xs block">{t('inv.removePhoto')}</button>
                  )}
                </div>
              </div>
            </Field>
          </Section>

          {/* Money */}
          <Section divider>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label={productForm.kind === 'supply' ? t('inv.costPerUnit') : t('inv.costPrice')}
                hint={t('inv.costHint', {
                  per: productForm.unit ? t('inv.perUnit', { unit: productForm.unit }) : '',
                  margin: productForm.kind === 'supply' ? '' : t('inv.andMargin'),
                })}
              >
                <input type="number" step="0.01" min="0" value={productForm.cost_price} onChange={(e) => setProductForm({ ...productForm, cost_price: e.target.value })} className="input-field" placeholder="0.00" />
              </Field>
              {productForm.kind !== 'supply' && (
                <Field label={t('inv.sellPrice')} hint={t('inv.sellHint')}>
                  <input type="number" step="0.01" min="0" value={productForm.sell_price} onChange={(e) => setProductForm({ ...productForm, sell_price: e.target.value })} className="input-field" placeholder="0.00" />
                </Field>
              )}
            </div>
          </Section>

          {/* What it is made of. A sale product draws down its packaging and
              materials every time a unit is sold. */}
          {productForm.kind !== 'supply' && (
            <Section divider>
              <Field
                label={t('inv.madeOf')}
                hint={t('inv.madeOfHint')}
              >
                {supplies.length === 0 ? (
                  <p className="text-sm text-surface-500 bg-surface-50 rounded-lg px-3.5 py-2.5 leading-snug">
                    {/* The sentence carries the kind's name in bold, wherever the language puts it. */}
                    {t('inv.noSupplies').split('{supply}').map((part, i) => (
                      <span key={i}>{i > 0 && <span className="font-medium text-surface-700">{t('inv.kindSupply')}</span>}{part}</span>
                    ))}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {recipe.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={r.component_id}
                          onChange={(e) => setRecipe(recipe.map((x, j) => (j === i ? { ...x, component_id: e.target.value } : x)))}
                          className="input-field"
                        >
                          <option value="">{t('inv.chooseSupply')}</option>
                          {supplies.map((sp) => (
                            <option
                              key={sp.id}
                              value={sp.id}
                              disabled={sp.id !== r.component_id && recipe.some((x) => x.component_id === sp.id)}
                            >
                              {sp.name}{Number(sp.cost_price) ? ` — ${formatCurrency(sp.cost_price)} / ${sp.unit || t('inv.unitWord')}` : ''}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number" min="0.001" step="any" value={r.quantity}
                          onChange={(e) => setRecipe(recipe.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                          className="input-field w-20 text-center" aria-label={t('inv.qtyPerUnit')}
                        />
                        <button
                          type="button" onClick={() => setRecipe(recipe.filter((_, j) => j !== i))}
                          className="p-2 rounded-lg text-surface-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                          aria-label={t('inv.removeMaterial')}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button" onClick={() => setRecipe([...recipe, { component_id: '', quantity: '1' }])}
                      className="btn-secondary text-xs" disabled={recipe.length >= supplies.length}
                    >
                      <Plus size={13} /> {t('inv.addMaterial')}
                    </button>
                  </div>
                )}
              </Field>

              {recipeCost > 0 && (
                <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-brand-50 border border-brand-100 px-3.5 py-2.5">
                  <span className="text-sm text-brand-900">{t('inv.costWithMaterials')}</span>
                  <span className="font-mono text-sm text-brand-900">
                    {formatCurrency(parseFloat(productForm.cost_price) || 0)} + {formatCurrency(recipeCost)} ={' '}
                    <span className="font-semibold">{formatCurrency((parseFloat(productForm.cost_price) || 0) + recipeCost)}</span>
                  </span>
                </div>
              )}
            </Section>
          )}

          {/* Stock levels. Every field carries a hint so the three columns end level. */}
          <Section divider>
            <div className="grid grid-cols-3 gap-4">
              <Field label={t('inv.inStockNow')} hint={t('inv.inStockHint')}>
                <input type="number" min="0" step="any" value={productForm.current_stock} onChange={(e) => setProductForm({ ...productForm, current_stock: e.target.value })} className="input-field" />
              </Field>
              <Field label={t('inv.minimum')} hint={t('inv.minimumHint')}>
                <input type="number" min="0" step="any" value={productForm.reorder_level} onChange={(e) => setProductForm({ ...productForm, reorder_level: e.target.value })} className="input-field" />
              </Field>
              <Field label={t('inv.ideal')} hint={t('inv.idealHint')}>
                <input type="number" min="0" step="any" value={productForm.target_stock} onChange={(e) => setProductForm({ ...productForm, target_stock: e.target.value })} className="input-field" />
              </Field>
            </div>
          </Section>

          {/* The workspace's own fields — lot, expiry, whatever Settings → Your portal defined. */}
          {extraFields.length > 0 && (
            <Section divider>
              <p className="text-xs font-semibold uppercase tracking-wider text-surface-500">{t('portal.extraTitle')}</p>
              <ExtraFieldInputs fields={extraFields} value={productForm.extra} onChange={(extra) => setProductForm({ ...productForm, extra })} idPrefix="prod-xf"
                labelClass="block text-sm font-medium text-surface-700 mb-1.5" cols="sm:grid-cols-2 gap-4" />
            </Section>
          )}
        </form>
      </Modal>

      {/* ── CATEGORIES MODAL ── */}
      <Modal
        open={showCatModal}
        onClose={() => setShowCatModal(false)}
        title={t('inv.catsTitle')}
        description={t('inv.catsBody', { other: t('inv.other') })}
        footer={<div className="flex justify-end"><button type="button" onClick={() => setShowCatModal(false)} className="btn-ghost">{t('inv.done')}</button></div>}
      >
        {categories.filter((c) => c !== DEFAULT_CATEGORY).length === 0 ? (
          <p className="text-sm text-surface-500 py-6 text-center">{t('inv.catsNone')}</p>
        ) : (
          <ul className="divide-y divide-surface-100 border border-surface-200 rounded-lg">
            {categories.filter((c) => c !== DEFAULT_CATEGORY).map((c) => {
              const draft = catEdits[c] ?? c;
              const dirty = draft.trim() !== c && draft.trim() !== '';
              const busy = catBusy === c;
              return (
                <li key={c} className="flex items-center gap-2 px-3 py-2">
                  <input type="text" value={draft} onChange={(e) => setCatEdits((x) => ({ ...x, [c]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renameProductCategory(c); } }}
                    className="input-field py-1.5 text-sm" aria-label={t('inv.renameCat', { name: c })} />
                  <span className="text-xs text-surface-400 whitespace-nowrap w-20 text-right">{tn('inv.productsCount', countIn(c))}</span>
                  <button type="button" onClick={() => renameProductCategory(c)} disabled={!dirty || busy} className="btn-primary px-2.5 py-1.5 text-xs" aria-label={t('inv.saveName')}>
                    {busy ? <Spinner size="sm" className="text-white" /> : <Check size={14} />}
                  </button>
                  <button type="button" onClick={() => deleteProductCategory(c)} disabled={busy} className="p-1.5 rounded text-surface-400 hover:text-red-600 hover:bg-red-50" aria-label={t('inv.deleteCat', { name: c })}>
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>

      {/* ── LOG INVENTORY MODAL ── */}
      <Modal
        open={showLogModal}
        onClose={() => setShowLogModal(false)}
        title={t('inv.logTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowLogModal(false)} className="btn-ghost">{t('common.cancel')}</button>
            <button type="submit" form="log-form" disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" className="text-white" /> : t('inv.logEntry')}
            </button>
          </div>
        }
      >
        <form id="log-form" onSubmit={handleLogEntry} className="space-y-4">
          <Field label={t('inv.product')}>
            <select value={logForm.product_id} onChange={(e) => setLogForm({ ...logForm, product_id: e.target.value })} className="input-field" required>
              <option value="">{t('inv.selectProduct')}</option>
              {[...products].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                <option key={p.id} value={p.id}>{t('inv.stockParen', { name: p.name, n: formatQty(p.current_stock) })}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('inv.type')}>
              <select value={logForm.type} onChange={(e) => setLogForm({ ...logForm, type: e.target.value })} className="input-field">
                {LOG_TYPES.map((lt) => <option key={lt.value} value={lt.value}>{typeLabel(t, lt.value)}</option>)}
              </select>
            </Field>
            <Field label={t('inv.date')}>
              <input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} className="input-field" />
            </Field>
          </div>
          <Field
            label={t('inv.quantity')}
            hint={logForm.type === 'adjustment' ? t('inv.qtyHintAdjust') : logForm.type === 'received' || logForm.type === 'returned' ? t('inv.qtyHintReceived') : t('inv.qtyHintRemoved')}
          >
            <input type="number" step="any" min="0" value={logForm.quantity} onChange={(e) => setLogForm({ ...logForm, quantity: e.target.value })} className="input-field" placeholder="0" required />
          </Field>
          <Field label={t('inv.notes')} optional>
            <input type="text" value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} className="input-field" placeholder={t('inv.notesPh')} />
          </Field>
        </form>
      </Modal>

      {/* ── STOCK COUNT MODAL ── */}
      <Modal
        open={showCountModal}
        onClose={() => setShowCountModal(false)}
        title={t('inv.countTitle')}
        description={t('inv.countBody')}
        size="xl"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCountModal(false)} className="btn-ghost">{t('common.cancel')}</button>
            <button onClick={handleSubmitCount} disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" className="text-white" /> : t('inv.submitCount')}
            </button>
          </div>
        }
      >
        {/* The modal body scrolls on its own, so no inner scroller here. */}
        <div className="space-y-2">
          {countEntries.map((entry, idx) => (
            <div key={entry.product_id} className="flex items-center gap-3 px-3 py-2 bg-surface-50 rounded-lg">
              <span className="flex-1 text-sm font-medium">{entry.name}</span>
              <span className="text-xs text-surface-400 w-28 text-right">{t('inv.system', { n: formatQty(entry.system_stock) })}</span>
              <input type="number" step="any" min="0" value={entry.counted}
                onChange={(e) => { const u = [...countEntries]; u[idx] = { ...u[idx], counted: e.target.value }; setCountEntries(u); }}
                className="input-field w-24 text-center" placeholder={t('inv.countPh')} />
              {entry.counted !== '' && parseFloat(entry.counted) !== Number(entry.system_stock) && (
                <span className={`text-xs font-mono w-14 text-right ${parseFloat(entry.counted) > Number(entry.system_stock) ? 'text-green-600' : 'text-red-600'}`}>
                  {parseFloat(entry.counted) > Number(entry.system_stock) ? '+' : ''}{formatQty(parseFloat(entry.counted) - Number(entry.system_stock))}
                </span>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}