import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';

export default function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirmPw) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      toast.success('Password updated!');
      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-surface-50">
      <div className="w-full max-w-sm card p-8">
        <h2 className="font-display text-2xl">Set new password</h2>
        <p className="text-surface-500 text-sm mt-1">Choose a strong password for your account.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
              New Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="Min 6 characters"
              required
              minLength={6}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="input-field"
              placeholder="Repeat password"
              required
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Spinner size="sm" className="text-white" /> : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
