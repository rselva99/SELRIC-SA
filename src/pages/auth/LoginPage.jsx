import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';
import { Eye, EyeOff, LogIn } from 'lucide-react';

export default function LoginPage() {
  const { signIn } = useAuth();
  const { t } = useT();
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
      toast.success(t('common.welcomeBack'));
      navigate('/');
    } catch (err) {
      toast.error(err.message || t('common.loginFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-[45%] bg-brand-950 text-white flex-col justify-between p-12">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500 flex items-center justify-center font-display text-lg">S</div>
          <span className="font-display text-2xl">SelRic</span>
        </Link>
        <div>
          <h1 className="font-display text-4xl leading-tight max-w-md">{t('auth.panelTitle')}</h1>
          <p className="text-brand-300 mt-4 text-lg max-w-md">{t('auth.panelBody')}</p>
        </div>
        <div className="text-xs text-brand-400">&copy; {new Date().getFullYear()} {t('landing.footerCompany')}</div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-white relative">
        <div className="absolute top-5 right-5"><LangToggle /></div>
        <div className="w-full max-w-sm">
          <Link to="/" className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center font-display text-sm text-white">S</div>
            <span className="font-display text-xl">SelRic</span>
          </Link>

          <h2 className="font-display text-2xl">{t('common.signIn')}</h2>
          <p className="text-surface-500 text-sm mt-1">{t('auth.signInSub')}</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="li-email" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.email')}</label>
              <input id="li-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="input-field" placeholder="you@yourbusiness.com" autoComplete="email" required />
            </div>
            <div>
              <label htmlFor="li-pw" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.password')}</label>
              <div className="relative">
                <input id="li-pw" type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-10" placeholder="••••••••" autoComplete="current-password" required />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
                  aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? <Spinner size="sm" className="text-white" /> : <><LogIn size={16} /> {t('common.signIn')}</>}
            </button>
          </form>

          <div className="mt-6 text-right">
            <Link to="/forgot-password" className="text-xs text-surface-500 hover:text-brand-700">{t('auth.forgot')}</Link>
          </div>

          <p className="text-center text-sm text-surface-500 mt-8">
            {t('auth.newHere')}{' '}
            <Link to="/signup" className="text-brand-700 font-medium hover:underline">{t('auth.createOne')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
