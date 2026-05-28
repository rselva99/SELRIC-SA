import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { fuzzyMatchCategory } from '../lib/utils';

const DataContext = createContext({});

// DataContext holds only small reference tables that are needed across many pages.
// Large/growing tables (transactions, invoices, bankStatements, inventoryLogs)
// are fetched per-page with pagination to avoid loading 20k+ rows into memory.

export function DataProvider({ children }) {
  const { user } = useAuth();

  const [categories, setCategories]               = useState([]);
  const [accounts, setAccounts]                   = useState([]);
  const [products, setProducts]                   = useState([]);
  const [supplierCategories, setSupplierCategories] = useState({});
  const [loading, setLoading]                     = useState(false);

  const supplierCategoriesRef = useRef({});
  useEffect(() => { supplierCategoriesRef.current = supplierCategories; }, [supplierCategories]);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [catRes, accRes, prodRes, scRes] = await Promise.all([
        supabase.from('categories').select('*').order('name'),
        supabase.from('accounts').select('*').order('name'),
        supabase.from('products').select('*').order('name'),
        supabase.from('supplier_categories').select('*'),
      ]);
      setCategories(catRes.data || []);
      setAccounts(accRes.data || []);
      setProducts(prodRes.data || []);
      const map = {};
      (scRes.data || []).forEach((sc) => {
        if (sc.supplier) map[sc.supplier.toLowerCase()] = sc.category;
      });
      setSupplierCategories(map);
    } catch (err) {
      console.error('DataContext load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Category CRUD ─────────────────────────────────────────────────────────
  async function addCategory(name, type = 'expense') {
    const { data, error } = await supabase.from('categories').insert({ name, type }).select().single();
    if (error) throw error;
    setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }
  async function deleteCategory(id) {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }

  // ── Account CRUD ──────────────────────────────────────────────────────────
  async function addAccount(name, type, parentId = null) {
    const { data, error } = await supabase.from('accounts').insert({ name, type, parent_id: parentId }).select().single();
    if (error) throw error;
    setAccounts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }
  async function deleteAccount(id) {
    const { error } = await supabase.from('accounts').delete().eq('id', id);
    if (error) throw error;
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  // ── Transaction CRUD (pure DB ops — pages manage their own state) ─────────
  async function addTransaction(txn) {
    const { data, error } = await supabase.from('transactions').insert(txn).select().single();
    if (error) throw error;
    const supplier = txn.supplier || txn.description;
    if (supplier && txn.category) await learnSupplierCategory(supplier, txn.category);
    return data;
  }
  async function updateTransaction(id, updates) {
    const { data, error } = await supabase.from('transactions').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  async function deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  }

  // Scan all uncategorized unposted transactions in DB and apply fuzzy matching.
  // Returns the count of auto-assigned transactions.
  async function propagateCategories(supplierMap) {
    const map = supplierMap || supplierCategoriesRef.current;
    if (!Object.keys(map).length) return 0;
    const { data: targets } = await supabase
      .from('transactions')
      .select('id, description, supplier')
      .eq('posted', false)
      .or('category.is.null,category.eq.')
      .limit(500);
    if (!targets?.length) return 0;
    const matches = targets
      .map((t) => ({ id: t.id, cat: fuzzyMatchCategory(t.description || t.supplier || '', map) }))
      .filter(({ cat }) => !!cat);
    if (!matches.length) return 0;
    await Promise.all(
      matches.map(({ id, cat }) => supabase.from('transactions').update({ category: cat }).eq('id', id))
    );
    return matches.length;
  }

  // Post/unpost — returns propagation count for toast feedback in the caller.
  async function postTransaction(txnId, txnData) {
    await updateTransaction(txnId, { posted: true });
    const supplier = txnData?.description || txnData?.supplier;
    if (supplier && txnData?.category) return learnSupplierCategory(supplier, txnData.category);
    return propagateCategories();
  }
  async function unpostTransaction(id) {
    return updateTransaction(id, { posted: false });
  }

  // ── Supplier category learning ─────────────────────────────────────────────
  async function learnSupplierCategory(supplier, category) {
    if (!supplier || !category || !user) return 0;
    try {
      await supabase.from('supplier_categories')
        .upsert({ supplier, category, user_id: user.id }, { onConflict: 'supplier,user_id' });
      const updatedMap = { ...supplierCategoriesRef.current, [supplier.toLowerCase()]: category };
      setSupplierCategories(updatedMap);
      return propagateCategories(updatedMap);
    } catch (err) {
      console.error('learnSupplierCategory error:', err);
      return 0;
    }
  }

  // ── Invoice CRUD (pure DB ops) ────────────────────────────────────────────
  async function addInvoice(invoice) {
    const { data, error } = await supabase.from('invoices').insert(invoice).select().single();
    if (error) throw error;
    return data;
  }
  async function updateInvoice(id, updates) {
    const { data, error } = await supabase.from('invoices').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  // ── Bank Statement CRUD (pure DB ops) ─────────────────────────────────────
  async function addBankStatement(statement) {
    const { data, error } = await supabase.from('bank_statements').insert(statement).select().single();
    if (error) throw error;
    return data;
  }

  // ── Product CRUD (keeps products in global state — small table) ───────────
  async function addProduct(product) {
    const { data, error } = await supabase.from('products').insert(product).select().single();
    if (error) throw error;
    setProducts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }
  async function updateProduct(id, updates) {
    const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single();
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === id ? data : p)));
    return data;
  }
  async function deleteProduct(id) {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  // ── Inventory Log (pure DB op — InventoryPage fetches its own logs) ───────
  async function addInventoryLog(log) {
    const { data, error } = await supabase.from('inventory_logs').insert(log).select().single();
    if (error) throw error;
    // Update product stock in global products state
    if (log.product_id) {
      const product = products.find((p) => p.id === log.product_id);
      if (product) {
        let newQty = product.current_stock;
        if (log.type === 'received') newQty += log.quantity;
        else if (['sold', 'used', 'waste'].includes(log.type)) newQty -= log.quantity;
        else if (log.type === 'adjustment') newQty = log.quantity;
        await updateProduct(log.product_id, { current_stock: Math.max(0, newQty) });
      }
    }
    return data;
  }

  // ── File storage ──────────────────────────────────────────────────────────
  async function uploadFile(bucket, path, file) {
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    return data;
  }
  async function getSignedUrl(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  function getSuggestedCategory(description) {
    return fuzzyMatchCategory(description || '', supplierCategories);
  }

  const value = {
    // Reference data (small tables — fine to keep global)
    categories, accounts, products, supplierCategories, loading,
    // Reference CRUD
    addCategory, deleteCategory, addAccount, deleteAccount,
    addProduct, updateProduct, deleteProduct,
    // Transaction ops (pure DB — pages manage their own state)
    addTransaction, updateTransaction, deleteTransaction,
    postTransaction, unpostTransaction, learnSupplierCategory,
    // Invoice / statement ops
    addInvoice, updateInvoice, addBankStatement,
    // Inventory
    addInventoryLog,
    // Utility
    getSuggestedCategory, uploadFile, getSignedUrl,
    refresh: loadAll,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
