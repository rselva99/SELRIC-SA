import { useState, useMemo } from 'react';
import { useData } from '../../contexts/DataContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate, formatCurrency } from '../../lib/utils';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Plus, Package, Search, ArrowDown, ArrowUp, RotateCcw, ClipboardList,
  Edit3, Trash2, Eye, TrendingDown, TrendingUp, Minus, History,
} from 'lucide-react';

const PRODUCT_CATEGORIES = ['Beer', 'Wine', 'Spirits', 'Soft Drinks', 'Mixers', 'Food', 'Snacks', 'Other'];
const LOG_TYPES = [
  { value: 'received', label: 'Received (Purchase)', icon: ArrowDown, color: 'text-green-600' },
  { value: 'sold', label: 'Sold', icon: ArrowUp, color: 'text-blue-600' },
  { value: 'used', label: 'Used / Consumed', icon: Minus, color: 'text-amber-600' },
  { value: 'adjustment', label: 'Count Adjustment', icon: RotateCcw, color: 'text-purple-600' },
];

export default function InventoryPage() {
  const {
    products, inventoryLogs, addProduct, updateProduct, deleteProduct, addInventoryLog,
  } = useData();
  const { isAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState('products');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showCountModal, setShowCountModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [saving, setSaving] = useState(false);

  const [productForm, setProductForm] = useState({
    name: '', category: 'Beer', unit: 'units', cost_price: '', sell_price: '',
    reorder_level: '5', current_stock: '0',
  });

  const [logForm, setLogForm] = useState({
    product_id: '', type: 'received', quantity: '', notes: '', date: new Date().toISOString().slice(0, 10),
  });

  const [countEntries, setCountEntries] = useState([]);

  const filteredProducts = useMemo(() => {
    let list = [...products].sort((a, b) => a.name.localeCompare(b.name));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (filterCat) list = list.filter((p) => p.category === filterCat);
    return list;
  }, [products, search, filterCat]);

  const productLogs = useMemo(() => {
    if (!selectedProduct) return [];
    return inventoryLogs
      .filter((l) => l.product_id === selectedProduct.id)
      .sort((a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at));
  }, [selectedProduct, inventoryLogs]);

  const lowStockCount = products.filter((p) => p.current_stock <= (p.reorder_level || 5)).length;

  async function handleSaveProduct(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...productForm,
        cost_price: parseFloat(productForm.cost_price) || 0,
        sell_price: parseFloat(productForm.sell_price) || 0,
        reorder_level: parseInt(productForm.reorder_level) || 5,
        current_stock: parseInt(productForm.current_stock) || 0,
      };
      if (editingProduct) {
        await updateProduct(editingProduct.id, payload);
        toast.success('Product updated');
      } else {
        await addProduct(payload);
        toast.success('Product added');
      }
      setShowAddProduct(false);
      setEditingProduct(null);
      resetProductForm();
    } catch (err) {
      toast.error(err.message || 'Failed');
    } finally {
      setSaving(false);
    }
  }

  function resetProductForm() {
    setProductForm({ name: '', category: 'Beer', unit: 'units', cost_price: '', sell_price: '', reorder_level: '5', current_stock: '0' });
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
    } catch (err) {
      toast.error(err.message || 'Failed');
    } finally {
      setSaving(false);
    }
  }

  function startCount() {
    const entries = products.map((p) => ({
      product_id: p.id,
      name: p.name,
      system_stock: p.current_stock,
      counted: '',
    }));
    setCountEntries(entries);
    setShowCountModal(true);
  }

  async function handleSubmitCount() {
    setSaving(true);
    try {
      let adjustments = 0;
      for (const entry of countEntries) {
        const counted = parseInt(entry.counted);
        if (isNaN(counted)) continue;
        const diff = counted - entry.system_stock;
        if (diff !== 0) {
          await addInventoryLog({
            product_id: entry.product_id,
            type: 'adjustment',
            quantity: diff,
            notes: `Count: system=${entry.system_stock}, actual=${counted}`,
            date: new Date().toISOString().slice(0, 10),
          });
          adjustments++;
        }
      }
      toast.success(`Count complete. ${adjustments} adjustment(s) made.`);
      setShowCountModal(false);
    } catch (err) {
      toast.error(err.message || 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            {products.length} products · {lowStockCount > 0 && <span className="text-amber-600">{lowStockCount} low stock</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={startCount} className="btn-secondary flex items-center gap-2">
            <ClipboardList size={16} /> Stock Count
          </button>
          <button
            onClick={() => {
              setLogForm({ ...logForm, product_id: products[0]?.id || '' });
              setShowLogModal(true);
            }}
            className="btn-secondary flex items-center gap-2"
          >
            <History size={16} /> Log Entry
          </button>
          <button
            onClick={() => { resetProductForm(); setEditingProduct(null); setShowAddProduct(true); }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={16} /> Add Product
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-100 rounded-lg p-1 mb-6 w-fit">
        {[
          { id: 'products', label: 'Products' },
          { id: 'history', label: 'Movement History' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === tab.id ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'products' && (
        <>
          {/* Search & Filter */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-9"
              />
            </div>
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="input-field w-auto min-w-[150px]"
            >
              <option value="">All Categories</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {filteredProducts.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No products"
              description="Add your first product to start tracking inventory"
              action={{ label: 'Add Product', onClick: () => { resetProductForm(); setShowAddProduct(true); } }}
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-100">
                      <th className="table-header">Product</th>
                      <th className="table-header">Category</th>
                      <th className="table-header text-center">Stock</th>
                      <th className="table-header text-right">Cost</th>
                      <th className="table-header text-right">Sell</th>
                      <th className="table-header text-right">Value</th>
                      <th className="table-header w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p) => {
                      const isLow = p.current_stock <= (p.reorder_level || 5);
                      return (
                        <tr key={p.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                          <td className="table-cell font-medium">{p.name}</td>
                          <td className="table-cell">
                            <span className="badge-green">{p.category}</span>
                          </td>
                          <td className="table-cell text-center">
                            <span className={`font-mono font-semibold ${isLow ? 'text-red-600' : 'text-surface-800'}`}>
                              {p.current_stock}
                            </span>
                            <span className="text-xs text-surface-400 ml-1">{p.unit}</span>
                            {isLow && <span className="ml-1 text-xs text-red-500">↓ Low</span>}
                          </td>
                          <td className="table-cell text-right font-mono text-sm">{formatCurrency(p.cost_price || 0)}</td>
                          <td className="table-cell text-right font-mono text-sm">{formatCurrency(p.sell_price || 0)}</td>
                          <td className="table-cell text-right font-mono text-sm">
                            {formatCurrency((p.current_stock || 0) * (p.cost_price || 0))}
                          </td>
                          <td className="table-cell">
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => setSelectedProduct(p)}
                                className="p-1.5 text-surface-400 hover:text-brand-600 transition"
                                title="View history"
                              >
                                <Eye size={14} />
                              </button>
                              <button
                                onClick={() => {
                                  setLogForm({
                                    product_id: p.id, type: 'received', quantity: '', notes: '',
                                    date: new Date().toISOString().slice(0, 10),
                                  });
                                  setShowLogModal(true);
                                }}
                                className="p-1.5 text-surface-400 hover:text-green-600 transition"
                                title="Log entry"
                              >
                                <Plus size={14} />
                              </button>
                              {isAdmin && (
                                <>
                                  <button
                                    onClick={() => {
                                      setEditingProduct(p);
                                      setProductForm({
                                        name: p.name, category: p.category || 'Beer', unit: p.unit || 'units',
                                        cost_price: p.cost_price?.toString() || '', sell_price: p.sell_price?.toString() || '',
                                        reorder_level: p.reorder_level?.toString() || '5',
                                        current_stock: p.current_stock?.toString() || '0',
                                      });
                                      setShowAddProduct(true);
                                    }}
                                    className="p-1.5 text-surface-400 hover:text-brand-600 transition"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  <button
                                    onClick={() => { if (confirm(`Delete ${p.name}?`)) deleteProduct(p.id); }}
                                    className="p-1.5 text-surface-400 hover:text-red-500 transition"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Total inventory value */}
              <div className="px-5 py-3 bg-surface-50 border-t border-surface-100 flex items-center justify-between">
                <span className="text-sm font-medium text-surface-600">Total Inventory Value</span>
                <span className="font-mono font-semibold text-surface-800">
                  {formatCurrency(products.reduce((s, p) => s + (p.current_stock || 0) * (p.cost_price || 0), 0))}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Movement History Tab */}
      {activeTab === 'history' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="table-header">Date</th>
                  <th className="table-header">Product</th>
                  <th className="table-header">Type</th>
                  <th className="table-header text-center">Qty</th>
                  <th className="table-header">Notes</th>
                </tr>
              </thead>
              <tbody>
                {[...inventoryLogs]
                  .sort((a, b) => new Date(b.date || b.created_at) - new Date(a.date || a.created_at))
                  .slice(0, 100)
                  .map((log) => {
                    const product = products.find((p) => p.id === log.product_id);
                    const logType = LOG_TYPES.find((lt) => lt.value === log.type);
                    return (
                      <tr key={log.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                        <td className="table-cell font-mono text-xs">{formatDate(log.date || log.created_at)}</td>
                        <td className="table-cell font-medium">{product?.name || '—'}</td>
                        <td className="table-cell">
                          <span className={`text-xs font-medium ${logType?.color || ''}`}>{logType?.label || log.type}</span>
                        </td>
                        <td className="table-cell text-center font-mono">
                          <span className={log.quantity >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {log.quantity >= 0 ? '+' : ''}{log.quantity}
                          </span>
                        </td>
                        <td className="table-cell text-surface-500 text-xs max-w-[200px] truncate">{log.notes || '—'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {inventoryLogs.length === 0 && (
            <div className="p-8 text-center text-sm text-surface-400">No movement history yet</div>
          )}
        </div>
      )}

      {/* Product History Modal */}
      <Modal
        open={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        title={selectedProduct ? `${selectedProduct.name} — History` : ''}
        size="lg"
      >
        {selectedProduct && (
          <div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-surface-50 rounded-lg p-3 text-center">
                <p className="text-xs text-surface-500">Current Stock</p>
                <p className="text-xl font-display mt-1">{selectedProduct.current_stock}</p>
              </div>
              <div className="bg-surface-50 rounded-lg p-3 text-center">
                <p className="text-xs text-surface-500">Cost Price</p>
                <p className="text-xl font-display mt-1">{formatCurrency(selectedProduct.cost_price || 0)}</p>
              </div>
              <div className="bg-surface-50 rounded-lg p-3 text-center">
                <p className="text-xs text-surface-500">Stock Value</p>
                <p className="text-xl font-display mt-1">{formatCurrency((selectedProduct.current_stock || 0) * (selectedProduct.cost_price || 0))}</p>
              </div>
            </div>
            {productLogs.length === 0 ? (
              <p className="text-sm text-surface-400 text-center py-6">No movement history for this product</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {productLogs.map((log) => {
                  const logType = LOG_TYPES.find((lt) => lt.value === log.type);
                  return (
                    <div key={log.id} className="flex items-center justify-between px-3 py-2 bg-surface-50 rounded-lg">
                      <div>
                        <span className={`text-sm font-medium ${logType?.color || ''}`}>{logType?.label || log.type}</span>
                        <p className="text-xs text-surface-400 mt-0.5">
                          {formatDate(log.date || log.created_at)}
                          {log.notes ? ` · ${log.notes}` : ''}
                        </p>
                      </div>
                      <span className={`font-mono font-semibold ${log.quantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {log.quantity >= 0 ? '+' : ''}{log.quantity}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Add/Edit Product Modal */}
      <Modal
        open={showAddProduct}
        onClose={() => { setShowAddProduct(false); setEditingProduct(null); }}
        title={editingProduct ? 'Edit Product' : 'Add Product'}
      >
        <form onSubmit={handleSaveProduct} className="space-y-4 p-1">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Product Name</label>
            <input
              type="text"
              value={productForm.name}
              onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
              className="input-field"
              placeholder="e.g., Castle Lager 500ml"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Category</label>
              <select
                value={productForm.category}
                onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                className="input-field"
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Unit</label>
              <input
                type="text"
                value={productForm.unit}
                onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}
                className="input-field"
                placeholder="units, bottles, cases"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Cost Price (USD)</label>
              <input
                type="number"
                step="0.01"
                value={productForm.cost_price}
                onChange={(e) => setProductForm({ ...productForm, cost_price: e.target.value })}
                className="input-field"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Sell Price (USD)</label>
              <input
                type="number"
                step="0.01"
                value={productForm.sell_price}
                onChange={(e) => setProductForm({ ...productForm, sell_price: e.target.value })}
                className="input-field"
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Opening Stock</label>
              <input
                type="number"
                value={productForm.current_stock}
                onChange={(e) => setProductForm({ ...productForm, current_stock: e.target.value })}
                className="input-field"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Reorder Level</label>
              <input
                type="number"
                value={productForm.reorder_level}
                onChange={(e) => setProductForm({ ...productForm, reorder_level: e.target.value })}
                className="input-field"
                placeholder="5"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => { setShowAddProduct(false); setEditingProduct(null); }} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" className="text-white" /> : editingProduct ? 'Update' : 'Add Product'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Log Inventory Modal */}
      <Modal open={showLogModal} onClose={() => setShowLogModal(false)} title="Log Inventory">
        <form onSubmit={handleLogEntry} className="space-y-4 p-1">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Product</label>
            <select
              value={logForm.product_id}
              onChange={(e) => setLogForm({ ...logForm, product_id: e.target.value })}
              className="input-field"
              required
            >
              <option value="">Select product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (Stock: {p.current_stock})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Type</label>
            <select
              value={logForm.type}
              onChange={(e) => setLogForm({ ...logForm, type: e.target.value })}
              className="input-field"
            >
              {LOG_TYPES.map((lt) => (
                <option key={lt.value} value={lt.value}>{lt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
              Quantity {logForm.type === 'received' || logForm.type === 'adjustment' ? '(positive = add)' : '(will be subtracted)'}
            </label>
            <input
              type="number"
              value={logForm.quantity}
              onChange={(e) => setLogForm({ ...logForm, quantity: e.target.value })}
              className="input-field"
              placeholder="10"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label>
            <input
              type="date"
              value={logForm.date}
              onChange={(e) => setLogForm({ ...logForm, date: e.target.value })}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Notes (optional)</label>
            <input
              type="text"
              value={logForm.notes}
              onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })}
              className="input-field"
              placeholder="e.g., Delivery from SAB"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowLogModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" className="text-white" /> : 'Log Entry'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Stock Count Modal */}
      <Modal open={showCountModal} onClose={() => setShowCountModal(false)} title="Periodic Stock Count" size="xl">
        <div>
          <p className="text-sm text-surface-500 mb-4">
            Enter the actual counted quantity for each product. Only products where the count differs from the system stock will be adjusted.
          </p>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {countEntries.map((entry, idx) => (
              <div key={entry.product_id} className="flex items-center gap-3 px-3 py-2 bg-surface-50 rounded-lg">
                <span className="flex-1 text-sm font-medium">{entry.name}</span>
                <span className="text-xs text-surface-400 w-24 text-right">System: {entry.system_stock}</span>
                <input
                  type="number"
                  value={entry.counted}
                  onChange={(e) => {
                    const updated = [...countEntries];
                    updated[idx] = { ...updated[idx], counted: e.target.value };
                    setCountEntries(updated);
                  }}
                  className="input-field w-24 text-center"
                  placeholder="Count"
                />
                {entry.counted !== '' && parseInt(entry.counted) !== entry.system_stock && (
                  <span className={`text-xs font-mono w-16 text-right ${
                    parseInt(entry.counted) > entry.system_stock ? 'text-green-600' : 'text-red-600'
                  }`}>
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
