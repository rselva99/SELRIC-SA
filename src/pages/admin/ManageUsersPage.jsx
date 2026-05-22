import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import { Plus, Users, Trash2, Eye, EyeOff, Shield, User } from 'lucide-react';

export default function ManageUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'limited',
  });

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error loading users:', err);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    if (!formData.email || !formData.password || !formData.full_name) {
      toast.error('All fields are required');
      return;
    }
    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setSaving(true);
    try {
      // Create the auth user via Supabase signUp
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.full_name,
            role: formData.role,
          },
        },
      });
      if (authError) throw authError;

      // Check if profile was auto-created by trigger, if not create it
      if (authData.user) {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', authData.user.id)
          .single();

        if (!existingProfile) {
          const { error: profileError } = await supabase
            .from('profiles')
            .insert({
              id: authData.user.id,
              full_name: formData.full_name,
              email: formData.email,
              role: formData.role,
            });
          if (profileError) throw profileError;
        } else {
          // Update the profile with correct role
          await supabase
            .from('profiles')
            .update({ full_name: formData.full_name, role: formData.role })
            .eq('id', authData.user.id);
        }
      }

      toast.success(`Account created for ${formData.full_name}`);
      setShowAddModal(false);
      setFormData({ full_name: '', email: '', password: '', role: 'limited' });
      loadUsers();
    } catch (err) {
      toast.error(err.message || 'Failed to create user');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleRole(profile) {
    const newRole = profile.role === 'admin' ? 'limited' : 'admin';
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', profile.id);
      if (error) throw error;
      setUsers((prev) => prev.map((u) => u.id === profile.id ? { ...u, role: newRole } : u));
      toast.success(`${profile.full_name} is now ${newRole}`);
    } catch (err) {
      toast.error(err.message || 'Failed to update role');
    }
  }

  async function handleDeleteUser(profile) {
    if (profile.id === currentUser?.id) {
      toast.error("You can't delete your own account");
      return;
    }
    if (!confirm(`Delete user "${profile.full_name}"? This removes their profile but not their auth account.`)) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', profile.id);
      if (error) throw error;
      setUsers((prev) => prev.filter((u) => u.id !== profile.id));
      toast.success('User deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete user');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title">Manage Users</h1>
          <p className="text-surface-500 text-sm mt-0.5">{users.length} users · Create and manage accounts</p>
        </div>
        <button
          onClick={() => { setFormData({ full_name: '', email: '', password: '', role: 'limited' }); setShowAddModal(true); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={16} /> Create Account
        </button>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No users yet"
          description="Create your first user account"
          action={{ label: 'Create Account', onClick: () => setShowAddModal(true) }}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="table-header">Name</th>
                  <th className="table-header">Email</th>
                  <th className="table-header">Role</th>
                  <th className="table-header">Created</th>
                  <th className="table-header w-24"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-surface-50 hover:bg-surface-50 transition">
                    <td className="table-cell font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold uppercase">
                          {u.full_name?.charAt(0) || '?'}
                        </div>
                        {u.full_name || '—'}
                        {u.id === currentUser?.id && <span className="text-xs text-surface-400">(you)</span>}
                      </div>
                    </td>
                    <td className="table-cell text-surface-500">{u.email}</td>
                    <td className="table-cell">
                      <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium ${
                        u.role === 'admin' ? 'bg-brand-100 text-brand-700' : 'bg-surface-100 text-surface-600'
                      }`}>
                        {u.role === 'admin' ? 'Admin' : 'Limited'}
                      </span>
                    </td>
                    <td className="table-cell text-xs text-surface-400 font-mono">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => handleToggleRole(u)}
                          className="p-1.5 text-surface-400 hover:text-brand-600 transition"
                          title={u.role === 'admin' ? 'Demote to limited' : 'Promote to admin'}
                        >
                          {u.role === 'admin' ? <User size={14} /> : <Shield size={14} />}
                        </button>
                        {u.id !== currentUser?.id && (
                          <button
                            onClick={() => handleDeleteUser(u)}
                            className="p-1.5 text-surface-400 hover:text-red-500 transition"
                            title="Delete user"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Create User Account">
        <form onSubmit={handleCreateUser} className="space-y-4 p-1">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Full Name</label>
            <input
              type="text"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              className="input-field"
              placeholder="John Smith"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="input-field"
              placeholder="john@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="input-field pr-10"
                placeholder="Min 6 characters"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              className="input-field"
            >
              <option value="limited">Limited — Dashboard & Inventory only</option>
              <option value="admin">Admin — Full access</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowAddModal(false)} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" className="text-white" /> : 'Create Account'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
