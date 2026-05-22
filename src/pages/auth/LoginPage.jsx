import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';
import { Eye, EyeOff, LogIn } from 'lucide-react';

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Login failed');
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
          <p className="text-brand-300 text-sm mt-2 uppercase tracking-widest">College Bar Finance & Inventory</p>
        </div>
        <div>
          <h1 className="font-display text-4xl leading-tight">
            Your bar's finances,<br />organized.
          </h1>
          <p className="text-brand-300 mt-4 text-lg max-w-md">
            Bookkeeping, inventory tracking, and financial reporting — all in one place.
          </p>
        </div>
        <div className="text-xs text-brand-400">
          &copy; {new Date().getFullYear()} SelRic SA. Built for efficiency.
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center font-display text-sm font-bold text-white">
              SR
            </div>
            <span className="font-display text-xl">SelRic SA</span>
          </div>

          <h2 className="font-display text-2xl">Sign in</h2>
          <p className="text-surface-500 text-sm mt-1">Enter your credentials to continue</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-10"
                  placeholder="••••••••"
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

            <div className="flex items-center justify-end">
              <Link to="/auth/forgot-password" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
                Forgot password?
              </Link>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? <Spinner size="sm" className="text-white" /> : <><LogIn size={16} /> Sign in</>}
            </button>
          </form>

          <p className="text-center text-sm text-surface-500 mt-8">
            Don't have an account?{' '}
            <Link to="/auth/register" className="text-brand-600 hover:text-brand-700 font-medium">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
