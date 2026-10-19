import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';
import { Eye, EyeOff, UserPlus, MailCheck } from 'lucide-react';

export const BUSINESS_TYPES = ['restaurant_bar', 'retail', 'services', 'contractor', 'health', 'nonprofit', 'other'];

const MIN_PASSWORD = 8;

export default function SignupPage() {
  const { signUp } = useAuth();
  const { t, lang } = useT();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    org_name: '',
    business_type: 'other',
    email: '',
    password: '',
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.password.length < MIN_PASSWORD) {
      toast.error(t('auth.passwordTooShort', { n: MIN_PASSWORD }));
      return;
    }
    setLoading(true);
    try {
      const data = await signUp(form.email.trim(), form.password, {
        full_name: form.full_name.trim(),
        org_name: form.org_name.trim(),
        business_type: form.business_type,
        locale: lang,
      });
      if (data?.session) {
        toast.success(t('auth.welcomeNew', { name: form.full_name.trim().split(' ')[0] || '' }));
        navigate('/');
      } else {
        // Email confirmation is on in Supabase: no session until they click the link.
        setNeedsConfirm(true);
      }
    } catch (err) {
      toast.error(err.message || t('auth.signupFailed'));
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
          <h1 className="font-display text-4xl leading-tight max-w-md">{t('auth.signupPanelTitle')}</h1>
          <p className="text-brand-300 mt-4 text-lg max-w-md">{t('auth.signupPanelBody')}</p>
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

          {needsConfirm ? (
            <div>
              <div className="w-12 h-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center">
                <MailCheck size={22} />
              </div>
              <h2 className="font-display text-2xl mt-5">{t('auth.checkEmailTitle')}</h2>
              <p className="text-surface-600 text-sm mt-2 leading-relaxed">
                {t('auth.checkEmailBody', { email: form.email })}
              </p>
              <Link to="/login" className="btn-primary w-full mt-8">{t('auth.goToSignIn')}</Link>
            </div>
          ) : (
            <>
              <h2 className="font-display text-2xl">{t('common.createYourAccount')}</h2>
              <p className="text-surface-500 text-sm mt-1">{t('auth.signupSub')}</p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <div>
                  <label htmlFor="su-name" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.yourName')}</label>
                  <input id="su-name" type="text" value={form.full_name} onChange={set('full_name')}
                    className="input-field" placeholder="Maria Lopez" autoComplete="name" required />
                </div>
                <div>
                  <label htmlFor="su-org" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.businessName')}</label>
                  <input id="su-org" type="text" value={form.org_name} onChange={set('org_name')}
                    className="input-field" placeholder="Lopez Bakery LLC" autoComplete="organization" required />
                </div>
                <div>
                  <label htmlFor="su-type" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.businessType')}</label>
                  <select id="su-type" value={form.business_type} onChange={set('business_type')} className="input-field">
                    {BUSINESS_TYPES.map((value) => (
                      <option key={value} value={value}>{t(`auth.businessTypes.${value}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="su-email" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.email')}</label>
                  <input id="su-email" type="email" value={form.email} onChange={set('email')}
                    className="input-field" placeholder="you@yourbusiness.com" autoComplete="email" required />
                </div>
                <div>
                  <label htmlFor="su-pw" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.password')}</label>
                  <div className="relative">
                    <input id="su-pw" type={showPw ? 'text' : 'password'} value={form.password} onChange={set('password')}
                      className="input-field pr-10" placeholder={t('auth.passwordHint', { n: MIN_PASSWORD })}
                      autoComplete="new-password" minLength={MIN_PASSWORD} required />
                    <button type="button" onClick={() => setShowPw((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600"
                      aria-label={showPw ? 'Hide password' : 'Show password'}>
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? <Spinner size="sm" className="text-white" /> : <><UserPlus size={16} /> {t('common.createAccount')}</>}
                </button>
              </form>

              <p className="text-center text-sm text-surface-500 mt-8">
                {t('auth.haveAccount')}{' '}
                <Link to="/login" className="text-brand-700 font-medium hover:underline">{t('common.signIn')}</Link>
              </p>
              <p className="text-center text-xs text-surface-400 mt-3">{t('auth.joiningHint')}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
