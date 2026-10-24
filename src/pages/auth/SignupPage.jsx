import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import toast from 'react-hot-toast';
import Spinner from '../../components/ui/Spinner';
import { Eye, EyeOff, UserPlus, MailCheck, Ticket, Lock } from 'lucide-react';

export const BUSINESS_TYPES = ['restaurant_bar', 'retail', 'services', 'contractor', 'health', 'nonprofit', 'other'];

const MIN_PASSWORD = 8;

export default function SignupPage() {
  const { signUp } = useAuth();
  const { t, lang } = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteCode = (params.get('invite') || '').trim().toUpperCase();

  // Gate: 'checking' → 'open' | 'invited' | 'invalid' | 'closed'.
  //   open     — public sign-up (payments live, or the gate migration not applied yet)
  //   invited  — invite-only mode and this link's code is valid
  //   invalid  — invite-only mode, a code was given but it is used/expired/unknown
  //   closed   — invite-only mode, no code: send them to the waitlist
  const [gate, setGate] = useState('checking');
  const [inviteLabel, setInviteLabel] = useState('');
  const [invitePlan, setInvitePlan] = useState('');
  // The program the invite is for: a Ganadería invite asks for the finca's
  // name and skips the business type (check_invite returns it; older
  // deployments return nothing and the form stays the Business one).
  const [inviteProgram, setInviteProgram] = useState('business');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: mode, error } = await supabase.rpc('get_signup_mode');
      if (cancelled) return;
      if (error || mode !== 'invite') { setGate('open'); return; }   // RPC missing = gate not deployed = open
      if (!inviteCode) { setGate('closed'); return; }
      const { data: res } = await supabase.rpc('check_invite', { p_code: inviteCode });
      if (cancelled) return;
      if (res?.valid) {
        setInviteLabel(res.label || '');
        setInvitePlan(res.plan || '');
        setInviteProgram(res.program || 'business');
        setGate('invited');
      } else {
        setGate('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [inviteCode]);
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
        invite_code: inviteCode,
      });
      if (data?.session) {
        toast.success(t('auth.welcomeNew', { name: form.full_name.trim().split(' ')[0] || '' }));
        navigate('/app');
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

          {gate === 'checking' ? (
            <div className="flex items-center gap-3 text-surface-500 text-sm"><Spinner size="sm" /> {t('common.loading')}</div>
          ) : gate === 'closed' || gate === 'invalid' ? (
            <div>
              <div className="w-12 h-12 rounded-full bg-surface-100 text-surface-600 flex items-center justify-center">
                <Lock size={22} />
              </div>
              <h2 className="font-display text-2xl mt-5">{t('auth.inviteOnlyTitle')}</h2>
              <p className="text-surface-600 text-sm mt-2 leading-relaxed">
                {gate === 'invalid' ? t('auth.inviteInvalid') : t('auth.inviteOnlyBody')}
              </p>
              <Link to="/#waitlist" className="btn-primary w-full mt-8">{t('landing.joinWaitlist')}</Link>
              <p className="text-center text-sm text-surface-500 mt-6">
                {t('auth.haveAccount')}{' '}
                <Link to="/login" className="text-brand-700 font-medium hover:underline">{t('common.signIn')}</Link>
              </p>
            </div>
          ) : needsConfirm ? (
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
              {gate === 'invited' && (
                <div className="mt-4 flex items-start gap-3 rounded-xl bg-brand-50 border border-brand-100 px-4 py-3">
                  <Ticket size={18} className="text-brand-700 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium text-brand-900">{t('auth.invitedAs', { label: inviteLabel || inviteCode })}</div>
                    {invitePlan === 'pilot' && <div className="text-brand-700 mt-0.5">{t('auth.pilotNote')}</div>}
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <div>
                  <label htmlFor="su-name" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.yourName')}</label>
                  <input id="su-name" type="text" value={form.full_name} onChange={set('full_name')}
                    className="input-field" placeholder="Maria Lopez" autoComplete="name" required />
                </div>
                <div>
                  <label htmlFor="su-org" className="block text-xs font-semibold text-surface-600 mb-1.5">{t(inviteProgram === 'ganaderia' ? 'common.farmName' : 'common.businessName')}</label>
                  <input id="su-org" type="text" value={form.org_name} onChange={set('org_name')}
                    className="input-field" placeholder={inviteProgram === 'ganaderia' ? 'Finca Batavia' : 'Lopez Bakery LLC'} autoComplete="organization" required />
                </div>
                {inviteProgram !== 'ganaderia' && (
                  <div>
                    <label htmlFor="su-type" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.businessType')}</label>
                    <select id="su-type" value={form.business_type} onChange={set('business_type')} className="input-field">
                      {BUSINESS_TYPES.map((value) => (
                        <option key={value} value={value}>{t(`auth.businessTypes.${value}`)}</option>
                      ))}
                    </select>
                  </div>
                )}
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
