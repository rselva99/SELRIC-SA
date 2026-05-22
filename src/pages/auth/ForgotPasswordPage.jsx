import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';
import { Mail, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
      toast.success('Password reset email sent!');
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-surface-50">
      <div className="w-full max-w-sm">
        <Link to="/auth/login" className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-8">
          <ArrowLeft size={14} /> Back to login
        </Link>

        <div className="card p-8">
          <h2 className="font-display text-2xl">Reset password</h2>

          {sent ? (
            <div className="mt-4">
              <div className="w-12 h-12 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center mx-auto mb-4">
                <Mail size={24} />
              </div>
              <p className="text-surface-600 text-sm text-center">
                We sent a password reset link to <strong>{email}</strong>. Check your inbox and follow the link to reset your password.
              </p>
            </div>
          ) : (
            <>
              <p className="text-surface-500 text-sm mt-1">
                Enter your email address and we'll send you a link to reset your password.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? <Spinner size="sm" className="text-white" /> : 'Send reset link'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
