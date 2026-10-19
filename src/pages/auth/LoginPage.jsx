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
      <div className="hidden lg:flex lg:w-[45%] bg-brand-950 text-white flex-col justify-between p-12">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500 flex items-center justify-center font-display text-lg">
            S
          </div>
          <span className="font-display text-2xl">SelRic</span>
        </Link>
        <div>
          <h1 className="font-display text-4xl leading-tight">
            Run the whole business<br />from one set of books.
          </h1>
          <p className="text-brand-300 mt-4 text-lg max-w-md">
            Bookkeeping, cash, payroll, inventory and reporting — in one place that balances.
          </p>
        </div>
        <div className="text-xs text-brand-400">
          &copy; {new Date().getFullYear()} SelRic LLC, St. Louis, Missouri
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-sm">
          <Link to="/" className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center font-display text-sm text-white">
              S
            </div>
            <span className="font-display text-xl">SelRic</span>
          </Link>

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

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? <Spinner size="sm" className="text-white" /> : <><LogIn size={16} /> Sign in</>}
            </button>
          </form>

          <div className="mt-6 text-right">
            <Link to="/forgot-password" className="text-xs text-surface-500 hover:text-brand-700">Forgot your password?</Link>
          </div>

          <p className="text-center text-sm text-surface-500 mt-8">
            New to SelRic?{' '}
            <Link to="/signup" className="text-brand-700 font-medium hover:underline">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
