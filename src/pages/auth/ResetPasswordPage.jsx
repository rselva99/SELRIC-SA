import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n/I18nContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';

export default function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirmPw) {
      toast.error(t('auth.passwordsDiffer'));
      return;
    }
    setLoading(true);
    try {
      await updatePassword(password);
      toast.success(t('auth.passwordUpdated'));
      navigate('/app');
    } catch (err) {
      toast.error(err.message || t('auth.passwordUpdateFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-surface-50">
      <div className="w-full max-w-sm card p-8">
        <h2 className="font-display text-2xl">{t('auth.setNewTitle')}</h2>
        <p className="text-surface-500 text-sm mt-1">{t('auth.setNewBody')}</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.newPassword')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder={t('auth.passwordHint', { n: 8 })}
              required
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.confirmPassword')}</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="input-field"
              placeholder={t('auth.repeatPassword')}
              required
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Spinner size="sm" className="text-white" /> : t('auth.updatePassword')}
          </button>
        </form>
      </div>
    </div>
  );
}
