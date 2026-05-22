import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';
import { UserPlus, Eye, EyeOff } from 'lucide-react';

export default function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [role, setRole] = useState('limited');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirmPw) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await signUp(email, password, fullName, role);
      toast.success('Account created! Check your email to verify.');
      navigate('/auth/login');
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-[45%] bg-brand-950 text-white flex-col justify-between p-12">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-500 flex items-center justify-center font-display text-lg font-bold">
              SR
            </div>
            <span className="font-display text-2xl">SelRic SA</span>
          </div>
        </div>
        <div>
          <h1 className="font-display text-4xl leading-tight">
            Join your team.
          </h1>
          <p className="text-brand-300 mt-4 text-lg max-w-md">
            Create an account to start managing inventory or access full bookkeeping features.
          </p>
        </div>
        <div className="text-xs text-brand-400">&copy; {new Date().getFullYear()} SelRic SA</div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center font-display text-sm font-bold text-white">
              SR
            </div>
            <span className="font-display text-xl">SelRic SA</span>
          </div>

          <h2 className="font-display text-2xl">Create account</h2>
          <p className="text-surface-500 text-sm mt-1">Fill in your details to get started</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-field"
                placeholder="John Doe"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
                Role
              </label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="input-field">
                <option value="limited">Limited User (Inventory Only)</option>
                <option value="admin">Admin (Full Access)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? <Spinner size="sm" className="text-white" /> : <><UserPlus size={16} /> Create account</>}
            </button>
          </form>

          <p className="text-center text-sm text-surface-500 mt-8">
            Already have an account?{' '}
            <Link to="/auth/login" className="text-brand-600 hover:text-brand-700 font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
