import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { fuzzyMatchCategory } from '../lib/utils';

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

  // Refs give async functions a non-stale view of the latest state
  // without needing to re-create those functions on every render.
  const transactionsRef = useRef([]);
  const supplierCategoriesRef = useRef({});
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);
  useEffect(() => { supplierCategoriesRef.current = supplierCategories; }, [supplierCategories]);

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

      // Build supplier→category lookup map (column is 'supplier', not 'supplier_name')
      const map = {};
      (scRes.data || []).forEach((sc) => {
        if (sc.supplier) map[sc.supplier.toLowerCase()] = sc.category;
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

    // Learn supplier→category if both are present
    const supplier = txn.supplier || txn.description;
    if (supplier && txn.category) {
      await learnSupplierCategory(supplier, txn.category);
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

  // Scan every uncategorized, unposted transaction and apply the supplier map.
  // Returns the number of transactions that were auto-assigned a category.
  async function propagateCategories(supplierMap) {
    const map = supplierMap || supplierCategoriesRef.current;
    if (Object.keys(map).length === 0) return 0;

    const targets = transactionsRef.current.filter((t) => !t.posted && !t.category);
    if (targets.length === 0) return 0;

    const matches = targets
      .map((t) => ({ t, cat: fuzzyMatchCategory(t.description || t.supplier || '', map) }))
      .filter(({ cat }) => !!cat);

    await Promise.all(
      matches.map(async ({ t, cat }) => {
        const { data } = await supabase
          .from('transactions')
          .update({ category: cat })
          .eq('id', t.id)
          .select()
          .single();
        if (data) setTransactions((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      })
    );

    return matches.length;
  }

  async function postTransaction(id) {
    const txn = transactionsRef.current.find((t) => t.id === id);
    await updateTransaction(id, { posted: true });

    // Learn from the posted transaction's category, then propagate to others.
    // If there's no category, still run propagation with existing knowledge.
    const supplier = txn?.description || txn?.supplier;
    if (supplier && txn?.category) {
      return learnSupplierCategory(supplier, txn.category);
    }
    return propagateCategories();
  }

  async function unpostTransaction(id) {
    return updateTransaction(id, { posted: false });
  }

  // --- Supplier category learning ---
  // Saves the mapping, updates local state, propagates to all uncategorized
  // transactions, and returns how many were auto-assigned.
  async function learnSupplierCategory(supplier, category) {
    if (!supplier || !category || !user) return 0;
    try {
      await supabase
        .from('supplier_categories')
        .upsert(
          { supplier, category, user_id: user.id },
          { onConflict: 'supplier,user_id' }
        );
      const updatedMap = { ...supplierCategoriesRef.current, [supplier.toLowerCase()]: category };
      setSupplierCategories(updatedMap);
      return propagateCategories(updatedMap);
    } catch (err) {
      console.error('Failed to learn supplier category:', err);
      return 0;
    }
  }

  // --- Invoice CRUD ---
  async function addInvoice(invoice) {
    const { data, error } = await supabase.from('invoices').insert(invoice).select().single();
    if (error) throw error;
    setInvoices((prev) => [data, ...prev]);
    return data;
  }

  async function updateInvoice(id, updates) {
    const { data, error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? data : inv)));
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

  // --- Fuzzy category suggestion ---
  function getSuggestedCategory(description) {
    if (!description) return '';
    return fuzzyMatchCategory(description, supplierCategories);
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

  async function getSignedUrl(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
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
    postTransaction,
    unpostTransaction,
    learnSupplierCategory,
    addInvoice,
    updateInvoice,
    addBankStatement,
    addProduct,
    updateProduct,
    deleteProduct,
    addInventoryLog,
    getSuggestedCategory,
    uploadFile,
    getSignedUrl,
    refresh: loadAll,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
