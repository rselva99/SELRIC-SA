import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { DEFAULT_CATEGORIES } from '../lib/utils';

const DataContext = createContext({});

export function DataProvider({ children }) {
  const { user } = useAuth();

  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [bankStatements, setBankStatements] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventoryLogs, setInventoryLogs] = useState([]);
  const [supplierCategories, setSupplierCategories] = useState({});
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [catRes, accRes, txnRes, invRes, bsRes, prodRes, logRes, scRes] = await Promise.all([
        supabase.from('categories').select('*').order('name'),
        supabase.from('accounts').select('*').order('name'),
        supabase.from('transactions').select('*').order('date', { ascending: false }),
        supabase.from('invoices').select('*').order('created_at', { ascending: false }),
        supabase.from('bank_statements').select('*').order('created_at', { ascending: false }),
        supabase.from('products').select('*').order('name'),
        supabase.from('inventory_logs').select('*').order('created_at', { ascending: false }),
        supabase.from('supplier_categories').select('*'),
      ]);

      setCategories(catRes.data || []);
      setAccounts(accRes.data || []);
      setTransactions(txnRes.data || []);
      setInvoices(invRes.data || []);
      setBankStatements(bsRes.data || []);
      setProducts(prodRes.data || []);
      setInventoryLogs(logRes.data || []);

      // Build supplier->category map
      const map = {};
      (scRes.data || []).forEach((sc) => {
        map[sc.supplier_name.toLowerCase()] = sc.category;
      });
      setSupplierCategories(map);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // --- Category CRUD ---
  async function addCategory(name, type = 'expense') {
    const { data, error } = await supabase
      .from('categories')
      .insert({ name, type })
      .select()
      .single();
    if (error) throw error;
    setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }

  async function deleteCategory(id) {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }

  // --- Account CRUD ---
  async function addAccount(name, type, parentId = null) {
    const { data, error } = await supabase
      .from('accounts')
      .insert({ name, type, parent_id: parentId })
      .select()
      .single();
    if (error) throw error;
    setAccounts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }

  async function deleteAccount(id) {
    const { error } = await supabase.from('accounts').delete().eq('id', id);
    if (error) throw error;
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  // --- Transaction CRUD ---
  async function addTransaction(txn) {
    const { data, error } = await supabase.from('transactions').insert(txn).select().single();
    if (error) throw error;
    setTransactions((prev) => [data, ...prev]);

    // Remember supplier -> category
    if (txn.supplier_name && txn.category) {
      await supabase
        .from('supplier_categories')
        .upsert(
          { supplier_name: txn.supplier_name, category: txn.category },
          { onConflict: 'supplier_name' }
        );
      setSupplierCategories((prev) => ({
        ...prev,
        [txn.supplier_name.toLowerCase()]: txn.category,
      }));
    }

    return data;
  }

  async function updateTransaction(id, updates) {
    const { data, error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setTransactions((prev) => prev.map((t) => (t.id === id ? data : t)));
    return data;
  }

  async function deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  // --- Invoice CRUD ---
  async function addInvoice(invoice) {
    const { data, error } = await supabase.from('invoices').insert(invoice).select().single();
    if (error) throw error;
    setInvoices((prev) => [data, ...prev]);
    return data;
  }

  // --- Bank Statement CRUD ---
  async function addBankStatement(statement) {
    const { data, error } = await supabase.from('bank_statements').insert(statement).select().single();
    if (error) throw error;
    setBankStatements((prev) => [data, ...prev]);
    return data;
  }

  // --- Product CRUD ---
  async function addProduct(product) {
    const { data, error } = await supabase.from('products').insert(product).select().single();
    if (error) throw error;
    setProducts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }

  async function updateProduct(id, updates) {
    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === id ? data : p)));
    return data;
  }

  async function deleteProduct(id) {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  // --- Inventory Log ---
  async function addInventoryLog(log) {
    const { data, error } = await supabase.from('inventory_logs').insert(log).select().single();
    if (error) throw error;
    setInventoryLogs((prev) => [data, ...prev]);

    // Update product stock
    if (log.product_id) {
      const product = products.find((p) => p.id === log.product_id);
      if (product) {
        let newQty = product.current_stock;
        if (log.type === 'received') newQty += log.quantity;
        else if (log.type === 'sold' || log.type === 'used' || log.type === 'waste')
          newQty -= log.quantity;
        else if (log.type === 'adjustment') newQty = log.quantity;

        await updateProduct(log.product_id, { current_stock: Math.max(0, newQty) });
      }
    }

    return data;
  }

  // --- Supplier category suggestion ---
  function getSuggestedCategory(supplierName) {
    if (!supplierName) return null;
    return supplierCategories[supplierName.toLowerCase()] || null;
  }

  // --- File storage ---
  async function uploadFile(bucket, path, file) {
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw error;
    return data;
  }

  function getFileUrl(bucket, path) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  const value = {
    categories,
    accounts,
    transactions,
    invoices,
    bankStatements,
    products,
    inventoryLogs,
    supplierCategories,
    loading,
    addCategory,
    deleteCategory,
    addAccount,
    deleteAccount,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addInvoice,
    addBankStatement,
    addProduct,
    updateProduct,
    deleteProduct,
    addInventoryLog,
    getSuggestedCategory,
    uploadFile,
    getFileUrl,
    refresh: loadAll,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
