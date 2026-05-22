import { useState, useMemo } from 'react';
import { useData } from '../../contexts/DataContext';
import { formatCurrency, formatDate, getMonthLabel, DEFAULT_CATEGORIES } from '../../lib/utils';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Plus, Layers, ChevronRight, Edit3, Trash2, DollarSign, BookOpen, Search,
} from 'lucide-react';

const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

export default function AccountsPage() {
  const {
    categories, transactions, addCategory, deleteCategory,
    addTransaction,
  } = useData();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [showEquityModal, setShowEquityModal] = useState(false);
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState({ name: '', type: 'Expense', description: '' });
  const [equityForm, setEquityForm] = useState({ description: '', amount: '', date: new Date().toISOString().slice(0, 10) });

  const allAccounts = useMemo(() => {
    const custom = categories.map((c) => ({ ...c, source: 'custom' }));
    const defaults = DEFAULT_CATEGORIES
      .filter((name) => !categories.find((c) => c.name === name))
      .map((name) => ({ id: `default-${name}`, name, type: 'Expense', source: 'default' }));
    return [...custom, ...defaults].sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  const filteredAccounts = useMemo(() => {
    if (!search) return allAccounts;
    const q = search.toLowerCase();
    return allAccounts.filter(
      (a) => a.name.toLowerCase().includes(q) || a.type?.toLowerCase().includes(q)
    );
  }, [allAccounts, search]);

  const accountsByType = useMemo(() => {
    const map = {};
    ACCOUNT_TYPES.forEach((t) => { map[t] = []; });
    filteredAccounts.forEach((a) => {
      const type = a.type || 'Expense';
      if (!map[type]) map[type] = [];
      map[type].push(a);
    });
    return map;
  }, [filteredAccounts]);

  const ledger = useMemo(() => {
    if (!selectedAccount) return [];
    return transactions
      .filter((t) => t.category === selectedAccount.name)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [selectedAccount, transactions]);

  const ledgerByMonth = useMemo(() => {
    const map = {};
    ledger.forEach((t) => {
      const key = getMonthLabel(t.date);
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return Object.entries(map);
  }, [ledger]);

  async function handleSaveAccount(e) {
    e.preventDefault();
    if (!formData.name.trim()) { toast.error('Name required'); return; }
    try {
      if (editingAccount) {
        // For editing, delete old and create new since we don't have updateCategory
        await deleteCategory(editingAccount.id);
        await addCategory(formData.name, formData.type);
        toast.success('Account updated');
      } else {
        await addCategory(formData.name, formData.type);
        toast.success('Account created');
      }
      setShowAddModal(false);
      setEditingAccount(null);
      setFormData({ name: '', type: 'Expense', description: '' });
    } catch (err) {
      toast.error(err.message || 'Failed');
    }
  }

  async function handleDeleteAccount(acct) {
    if (acct.source === 'default') { toast.error('Cannot delete default categories'); return; }
    if (!confirm(`Delete account "${acct.name}"?`)) return;
    await deleteCategory(acct.id);
    if (selectedAccount?.id === acct.id) setSelectedAccount(null);
    toast.success('Deleted');
  }

  async function handleEquityEntry(e) {
    e.preventDefault();
    try {
      await addTransaction({
        date: equityForm.date,
        description: equityForm.description || 'Equity adjustment',
        supplier: 'Equity Adjustment',
        amount: parseFloat(equityForm.amount),
        type: parseFloat(equityForm.amount) >= 0 ? 'credit' : 'debit',
        category: "Owner's Equity",
      });
      toast.success('Equity entry added');
      setShowEquityModal(false);
      setEquityForm({ description: '', amount: '', date: new Date().toISOString().slice(0, 10) });
    } catch (err) {
      toast.error(err.message || 'Failed');
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="text-surface-500 text-sm mt-0.5">{allAccounts.length} accounts · Click any account to view ledger</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowEquityModal(true)} className="btn-secondary flex items-center gap-2">
            <DollarSign size={16} /> Equity Entry
          </button>
          <button
            onClick={() => { setEditingAccount(null); setFormData({ name: '', type: 'Expense', description: '' }); setShowAddModal(true); }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus size={16} /> New Account
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
            <input
              type="text"
              placeholder="Search accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>

          <div className="space-y-4">
            {ACCOUNT_TYPES.map((type) => {
              const accts = accountsByType[type] || [];
              if (accts.length === 0) return null;
              return (
                <div key={type}>
                  <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-2">{type}</h3>
                  <div className="space-y-1">
                    {accts.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setSelectedAccount(a)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between transition text-sm ${
                          selectedAccount?.name === a.name
                            ? 'bg-brand-50 text-brand-700 font-medium'
                            : 'hover:bg-surface-100 text-surface-700'
                        }`}
                      >
                        <span className="truncate">{a.name}</span>
                        <div className="flex items-center gap-1">
                          {a.source === 'custom' && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingAccount(a); setFormData({ name: a.name, type: a.type || 'Expense', description: a.description || '' }); setShowAddModal(true); }}
                                className="p-1 hover:text-brand-600"
                              >
                                <Edit3 size={12} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteAccount(a); }}
                                className="p-1 hover:text-red-500"
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                          <ChevronRight size={14} className="text-surface-300" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2">
          {!selectedAccount ? (
            <EmptyState
              icon={BookOpen}
              title="Select an account"
              description="Click any account on the left to view its transaction ledger"
            />
          ) : (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg text-surface-900">{selectedAccount.name}</h3>
                  <p className="text-xs text-surface-400">
                    {selectedAccount.type} · {ledger.length} transactions ·
                    Total: {formatCurrency(ledger.reduce((s, t) => s + Math.abs(t.amount), 0))}
                  </p>
                </div>
              </div>

              {ledger.length === 0 ? (
                <div className="p-8 text-center text-sm text-surface-400">No transactions in this account</div>
              ) : (
                <div className="divide-y divide-surface-50">
                  {ledgerByMonth.map(([month, txns]) => (
                    <div key={month}>
                      <div className="px-5 py-2 bg-surface-50 flex items-center justify-between">
                        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">{month}</span>
                        <span className="text-xs font-mono text-surface-500">
                          {formatCurrency(txns.reduce((s, t) => s + Math.abs(t.amount), 0))}
                        </span>
                      </div>
                      {txns.map((t) => (
                        <div key={t.id} className="px-5 py-3 flex items-center justify-between hover:bg-surface-50 transition">
                          <div>
                            <p className="text-sm font-medium">{t.supplier || t.description || '—'}</p>
                            <p className="text-xs text-surface-400 font-mono">{formatDate(t.date)}</p>
                          </div>
                          <span className={`font-mono text-sm font-semibold ${t.type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                            {t.type === 'credit' ? '+' : '-'}{formatCurrency(Math.abs(t.amount))}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal open={showAddModal} onClose={() => { setShowAddModal(false); setEditingAccount(null); }} title={editingAccount ? 'Edit Account' : 'New Account'}>
        <form onSubmit={handleSaveAccount} className="space-y-4 p-1">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Account Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="input-field"
              placeholder="e.g., Bar Supplies"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Account Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              className="input-field"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Description (optional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input-field"
              rows={2}
              placeholder="What this account tracks"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => { setShowAddModal(false); setEditingAccount(null); }} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">{editingAccount ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={showEquityModal} onClose={() => setShowEquityModal(false)} title="Equity Adjustment">
        <form onSubmit={handleEquityEntry} className="space-y-4 p-1">
          <p className="text-sm text-surface-500">Add a manual equity entry (owner investment, withdrawal, retained earnings adjustment).</p>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Description</label>
            <input
              type="text"
              value={equityForm.description}
              onChange={(e) => setEquityForm({ ...equityForm, description: e.target.value })}
              className="input-field"
              placeholder="e.g., Owner capital injection"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Amount (positive = credit, negative = debit)</label>
            <input
              type="number"
              step="0.01"
              value={equityForm.amount}
              onChange={(e) => setEquityForm({ ...equityForm, amount: e.target.value })}
              className="input-field"
              placeholder="5000.00"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Date</label>
            <input
              type="date"
              value={equityForm.date}
              onChange={(e) => setEquityForm({ ...equityForm, date: e.target.value })}
              className="input-field"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowEquityModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">Add Entry</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
