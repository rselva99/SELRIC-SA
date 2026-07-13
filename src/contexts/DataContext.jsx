import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { fetchAll } from '../lib/fetchAll';
import { useAuth } from './AuthContext';
import { fuzzyMatchCategory } from '../lib/utils';
import { batchCategorize } from '../lib/claude';

const DataContext = createContext({});

// DataContext holds small reference tables that many pages share. Large/growing
// tables (transactions, invoices, bankStatements, inventoryLogs) are fetched
// per-page with pagination to avoid loading 20k+ rows into memory.
//
// Hardening guarantees:
// 1. Every exported function has a stable identity (useCallback). Consumers can
//    safely list them in dependency arrays without churning render loops.
// 2. `loading` always resolves — set in a `finally` block on success AND error.
// 3. Fetch errors are stored in `loadError` state, not silently swallowed.
// 4. `refresh()` is guarded by an in-flight flag, so concurrent calls collapse
//    into one and cannot stack or loop.
// 5. State updates from `loadAll` REPLACE the data atomically at the end.
//    Existing data stays visible until the new data is committed — there is no
//    intermediate "blanked" render.

export function DataProvider({ children }) {
  const { user } = useAuth();

  const [categories, setCategories]               = useState([]);
  const [accounts, setAccounts]                   = useState([]);
  const [products, setProducts]                   = useState([]);
  const [supplierCategories, setSupplierCategories] = useState({});
  const [loading, setLoading]                     = useState(false);
  const [loadError, setLoadError]                 = useState(null);

  // Refs kept in sync with state so memoized callbacks don't need state in deps.
  const supplierCategoriesRef = useRef({});
  const productsRef           = useRef([]);
  const inFlightRef           = useRef(false);

  useEffect(() => { supplierCategoriesRef.current = supplierCategories; }, [supplierCategories]);
  useEffect(() => { productsRef.current = products; }, [products]);

  // ── Load all reference data ──────────────────────────────────────────────────
  // Guarded against concurrent invocations. Sets loadError on failure. Loading
  // flag is always cleared in finally, even on throw.
  const loadAll = useCallback(async () => {
    if (!user) return;
    if (inFlightRef.current) return;        // collapse concurrent calls
    inFlightRef.current = true;
    setLoading(true);
    try {
      const [catRes, accRes, prodRes, scRes] = await Promise.all([
        supabase.from('categories').select('*').order('name'),
        supabase.from('accounts').select('*').order('name'),
        supabase.from('products').select('*').order('name'),
        supabase.from('supplier_categories').select('*'),
      ]);
      const firstErr = [catRes, accRes, prodRes, scRes].find((r) => r.error)?.error;
      if (firstErr) throw firstErr;

      // Atomic-ish commit: only update state once all fetches succeeded. Avoids
      // a half-loaded render where one table is empty while another has data.
      setCategories(catRes.data || []);
      setAccounts(accRes.data || []);
      setProducts(prodRes.data || []);
      const map = {};
      (scRes.data || []).forEach((sc) => {
        if (sc.supplier) map[sc.supplier.toLowerCase()] = sc.category;
      });
      setSupplierCategories(map);
      setLoadError(null);
    } catch (err) {
      console.error('DataContext load error:', err);
      setLoadError(err);
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [user]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── Category CRUD ─────────────────────────────────────────────────────────
  const addCategory = useCallback(async (name, type = 'expense') => {
    const { data, error } = await supabase.from('categories').insert({ name, type }).select().single();
    if (error) throw error;
    setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }, []);

  const deleteCategory = useCallback(async (id) => {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // ── Account CRUD (legacy `accounts` table — kept for compatibility) ───────
  const addAccount = useCallback(async (name, type, parentId = null) => {
    const { data, error } = await supabase.from('accounts').insert({ name, type, parent_id: parentId }).select().single();
    if (error) throw error;
    setAccounts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }, []);

  const deleteAccount = useCallback(async (id) => {
    const { error } = await supabase.from('accounts').delete().eq('id', id);
    if (error) throw error;
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Reusable helper — writes the offsetting Cash & Bank leg for a
  // bank-imported transaction, idempotent via reference='CASH-LEG-<txId>'.
  // Called from BOTH the single-row postTransaction path AND updateTransaction
  // when it detects `posted` flipping false → true. Historically only the
  // former existed, so bulk-import posting flows silently skipped the mirror
  // — see Phase 1 recon, Task 2 audit trail, and Phase 2B Task 6.
  const CASH_CATEGORY = 'Cash & Bank';
  const ensureCashLeg = useCallback(async (txnRow) => {
    if (!txnRow) return;
    if (!txnRow.bank_statement_id) return;
    if (!txnRow.amount || !txnRow.type) return;
    if (txnRow.category === CASH_CATEGORY) return;   // don't mirror the cash side of itself
    const cashRef = `CASH-LEG-${txnRow.id}`;
    const { data: dup } = await supabase
      .from('transactions').select('id').eq('reference', cashRef).limit(1);
    if (dup && dup.length > 0) return;
    await supabase.from('transactions').insert({
      date: txnRow.date,
      description: `[Cash leg] ${txnRow.description || ''}`,
      supplier: txnRow.supplier || txnRow.description || '',
      amount: txnRow.amount,
      type: txnRow.type === 'debit' ? 'credit' : 'debit',
      category: CASH_CATEGORY,
      account_id: null,
      reference: cashRef,
      bank_statement_id: txnRow.bank_statement_id,
      posted: true,
    });
  }, []);

  // ── Transaction CRUD (pure DB — pages manage their own state) ─────────────
  const updateTransaction = useCallback(async (id, updates) => {
    // Snapshot the previous posted flag so we can detect a false → true flip
    // and, when it happens on a bank-imported row, fire the cash-leg mirror.
    // Bulk categorizations and inline edits used to bypass this entirely.
    let prevPosted = null;
    if (updates?.posted === true) {
      const { data: cur } = await supabase.from('transactions').select('posted, bank_statement_id, category').eq('id', id).maybeSingle();
      prevPosted = cur?.posted ?? null;
    }
    const { data, error } = await supabase.from('transactions').update(updates).eq('id', id).select().single();
    if (error) throw error;
    if (updates?.posted === true && prevPosted === false) {
      // Fire and forget — the mirror is idempotent, and if it fails we don't
      // want to roll back the primary posting.
      ensureCashLeg(data).catch((err) => console.error('ensureCashLeg (updateTransaction) failed:', err));
    }
    return data;
  }, [ensureCashLeg]);

  const deleteTransaction = useCallback(async (id) => {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  }, []);

  // propagateCategories reads supplierCategoriesRef, so no deps churn.
  const propagateCategories = useCallback(async (supplierMap) => {
    const map = supplierMap || supplierCategoriesRef.current;
    if (!Object.keys(map).length) return 0;
    // Paginated: silently capping at 500 rows meant supplier-mapping propagation
    // only touched the newest half-page of uncategorized transactions.
    const targets = await fetchAll(
      supabase
        .from('transactions')
        .select('id, description, supplier')
        .eq('posted', false)
        .or('category.is.null,category.eq.')
        .order('id', { ascending: true })
    );
    if (!targets?.length) return 0;
    const matches = targets
      .map((t) => ({ id: t.id, cat: fuzzyMatchCategory(t.description || t.supplier || '', map) }))
      .filter(({ cat }) => !!cat);
    if (!matches.length) return 0;
    await Promise.all(
      matches.map(({ id, cat }) => supabase.from('transactions').update({ category: cat }).eq('id', id))
    );
    return matches.length;
  }, []);

  const learnSupplierCategory = useCallback(async (supplier, category) => {
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
  }, [user, propagateCategories]);

  const addTransaction = useCallback(async (txn) => {
    const { data, error } = await supabase.from('transactions').insert(txn).select().single();
    if (error) throw error;
    const supplier = txn.supplier || txn.description;
    if (supplier && txn.category) await learnSupplierCategory(supplier, txn.category);
    return data;
  }, [learnSupplierCategory]);

  const postTransaction = useCallback(async (txnId, txnData) => {
    await updateTransaction(txnId, { posted: true });
    // Delegate the mirror to the shared helper — same code path bulk imports
    // and inline edits now flow through. Historically this fn had its own
    // copy of the logic; now it's one implementation, one contract.
    await ensureCashLeg({ id: txnId, ...(txnData || {}) });
    const supplier = txnData?.description || txnData?.supplier;
    if (supplier && txnData?.category) return learnSupplierCategory(supplier, txnData.category);
    return propagateCategories();
  }, [updateTransaction, ensureCashLeg, learnSupplierCategory, propagateCategories]);

  const unpostTransaction = useCallback(async (id) => {
    return updateTransaction(id, { posted: false });
  }, [updateTransaction]);

  // ── AI batch categorization ───────────────────────────────────────────────
  const aiCategorizeUncategorized = useCallback(async (period = null) => {
    if (!user) return 0;
    let q = supabase
      .from('transactions')
      .select('id, description, supplier')
      .eq('posted', false)
      .or('category.is.null,category.eq.')
      .order('id', { ascending: true });
    if (period) {
      const [yr, mo] = period.split('-');
      const lastDay = new Date(parseInt(yr), parseInt(mo), 0).getDate();
      q = q.gte('date', `${yr}-${mo}-01`).lte('date', `${yr}-${mo}-${String(lastDay).padStart(2,'0')}`);
    }
    // Paginated: previous 500-row cap left later batches un-categorized when
    // the AI helper was invoked on a large backlog.
    let targets;
    try {
      targets = await fetchAll(q);
    } catch {
      return 0;
    }
    if (!targets?.length) return 0;

    const { data: scRows } = await supabase
      .from('supplier_categories')
      .select('supplier, category');
    const mappings = scRows || [];

    const BATCH_SIZE = 50;
    let totalCategorized = 0;
    const newSuppliers = {};
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = targets.slice(i, i + BATCH_SIZE);
      let suggestions;
      try {
        suggestions = await batchCategorize(batch, mappings);
      } catch (err) {
        console.error('batchCategorize error:', err);
        continue;
      }
      if (!suggestions?.length) continue;

      const byCategory = {};
      const txnMap = new Map(batch.map((t) => [t.id, t]));
      for (const s of suggestions) {
        if (!txnMap.has(s.id)) continue;
        (byCategory[s.category] = byCategory[s.category] || []).push(s.id);
      }
      await Promise.all(
        Object.entries(byCategory).map(async ([cat, ids]) => {
          const { error } = await supabase.from('transactions').update({ category: cat }).in('id', ids);
          if (!error) {
            totalCategorized += ids.length;
            ids.forEach((id) => {
              const t = txnMap.get(id);
              const sup = t?.description || t?.supplier;
              if (sup) newSuppliers[sup] = cat;
            });
          }
        })
      );
    }

    const supplierEntries = Object.entries(newSuppliers);
    if (supplierEntries.length) {
      try {
        await supabase.from('supplier_categories').upsert(
          supplierEntries.map(([supplier, category]) => ({ supplier, category, user_id: user.id })),
          { onConflict: 'supplier,user_id' }
        );
        const updatedMap = { ...supplierCategoriesRef.current };
        supplierEntries.forEach(([s, c]) => { updatedMap[s.toLowerCase()] = c; });
        setSupplierCategories(updatedMap);
      } catch (err) {
        console.error('supplier upsert error:', err);
      }
    }

    return totalCategorized;
  }, [user]);

  // ── Invoice CRUD ──────────────────────────────────────────────────────────
  const addInvoice = useCallback(async (invoice) => {
    const { data, error } = await supabase.from('invoices').insert(invoice).select().single();
    if (error) throw error;
    return data;
  }, []);

  const updateInvoice = useCallback(async (id, updates) => {
    const { data, error } = await supabase.from('invoices').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }, []);

  // ── Bank Statement CRUD ───────────────────────────────────────────────────
  const addBankStatement = useCallback(async (statement) => {
    const { data, error } = await supabase.from('bank_statements').insert(statement).select().single();
    if (error) throw error;
    return data;
  }, []);

  // ── Product CRUD ──────────────────────────────────────────────────────────
  const addProduct = useCallback(async (product) => {
    const { data, error } = await supabase.from('products').insert(product).select().single();
    if (error) throw error;
    setProducts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data;
  }, []);

  const updateProduct = useCallback(async (id, updates) => {
    const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single();
    if (error) throw error;
    setProducts((prev) => prev.map((p) => (p.id === id ? data : p)));
    return data;
  }, []);

  const deleteProduct = useCallback(async (id) => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // ── Inventory Log ─────────────────────────────────────────────────────────
  // Uses productsRef so products doesn't need to be a dependency.
  const addInventoryLog = useCallback(async (log) => {
    const { data, error } = await supabase.from('inventory_logs').insert(log).select().single();
    if (error) throw error;
    if (log.product_id) {
      const product = productsRef.current.find((p) => p.id === log.product_id);
      if (product) {
        let newQty = product.current_stock;
        if (log.type === 'received') newQty += log.quantity;
        else if (['sold', 'used', 'waste'].includes(log.type)) newQty -= log.quantity;
        else if (log.type === 'adjustment') newQty = log.quantity;
        await updateProduct(log.product_id, { current_stock: Math.max(0, newQty) });
      }
    }
    return data;
  }, [updateProduct]);

  // ── File storage ──────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (bucket, path, file) => {
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    return data;
  }, []);

  const getSignedUrl = useCallback(async (bucket, path) => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }, []);

  // Reads from ref so its identity is stable.
  const getSuggestedCategory = useCallback((description) => {
    return fuzzyMatchCategory(description || '', supplierCategoriesRef.current);
  }, []);

  // Stable value object — only changes when its members do, so consumers that
  // grab specific fields with destructuring don't see false-positive churn.
  const value = useMemo(() => ({
    // Reference data (small tables — fine to keep global)
    categories, accounts, products, supplierCategories,
    loading, loadError,
    // Reference CRUD
    addCategory, deleteCategory, addAccount, deleteAccount,
    addProduct, updateProduct, deleteProduct,
    // Transaction ops
    addTransaction, updateTransaction, deleteTransaction,
    postTransaction, unpostTransaction, learnSupplierCategory,
    propagateCategories,
    // Invoice / statement ops
    addInvoice, updateInvoice, addBankStatement,
    // Inventory
    addInventoryLog,
    // Utility
    getSuggestedCategory, uploadFile, getSignedUrl,
    aiCategorizeUncategorized,
    refresh: loadAll,
  }), [
    categories, accounts, products, supplierCategories, loading, loadError,
    addCategory, deleteCategory, addAccount, deleteAccount,
    addProduct, updateProduct, deleteProduct,
    addTransaction, updateTransaction, deleteTransaction,
    postTransaction, unpostTransaction, learnSupplierCategory,
    propagateCategories,
    addInvoice, updateInvoice, addBankStatement,
    addInventoryLog,
    getSuggestedCategory, uploadFile, getSignedUrl,
    aiCategorizeUncategorized,
    loadAll,
  ]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
