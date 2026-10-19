import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n/I18nContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';
import { Mail, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
      toast.success(t('auth.resetSentToast'));
    } catch (err) {
      toast.error(err.message || t('auth.resetFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-surface-50">
      <div className="w-full max-w-sm">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 mb-8">
          <ArrowLeft size={14} /> {t('auth.backToLogin')}
        </Link>

        <div className="card p-8">
          <h2 className="font-display text-2xl">{t('auth.resetTitle')}</h2>

          {sent ? (
            <div className="mt-4">
              <div className="w-12 h-12 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center mx-auto mb-4">
                <Mail size={24} />
              </div>
              <p className="text-surface-600 text-sm text-center">{t('auth.resetSent', { email })}</p>
            </div>
          ) : (
            <>
              <p className="text-surface-500 text-sm mt-1">{t('auth.resetBody')}</p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.email')}</label>
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
                  {loading ? <Spinner size="sm" className="text-white" /> : t('auth.sendReset')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
