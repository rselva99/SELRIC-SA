import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useT } from '../i18n/I18nContext';
import { BUSINESS_TYPES } from '../pages/auth/SignupPage';
import Spinner from './ui/Spinner';
import { ArrowRight, MailCheck } from 'lucide-react';

// Public waitlist form (landing page). Writes one row to public.waitlist —
// anyone may insert, nobody may read it through the API.
export default function WaitlistForm({ className = '' }) {
  const { t, lang } = useT();
  const [form, setForm] = useState({ full_name: '', business_name: '', business_type: 'other', email: '' });
  const [state, setState] = useState('idle'); // idle | saving | done | already
  const [error, setError] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setState('saving');
    const { error: err } = await supabase.from('waitlist').insert({
      email: form.email.trim().toLowerCase(),
      full_name: form.full_name.trim(),
      business_name: form.business_name.trim(),
      business_type: form.business_type,
      locale: lang,
      source: 'landing',
    });
    if (!err) { setState('done'); return; }
    if (err.code === '23505') { setState('already'); return; }
    console.error('waitlist insert failed:', err);
    setError(t('waitlist.failed'));
    setState('idle');
  }

  if (state === 'done' || state === 'already') {
    return (
      <div className={`rounded-2xl bg-white border border-surface-200 p-6 sm:p-7 ${className}`}>
        <div className="w-12 h-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center">
          <MailCheck size={22} />
        </div>
        <h3 className="font-display text-2xl mt-4 text-brand-950">{t('waitlist.doneTitle')}</h3>
        <p className="text-surface-600 mt-2">
          {state === 'already' ? t('waitlist.already') : t('waitlist.doneBody', { email: form.email.trim() })}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`rounded-2xl bg-white border border-surface-200 p-6 sm:p-7 ${className}`}>
      <h3 className="font-display text-2xl text-brand-950">{t('waitlist.title')}</h3>
      <p className="text-surface-600 mt-1.5">{t('waitlist.body')}</p>

      <div className="mt-5 grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="wl-name" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.yourName')}</label>
          <input id="wl-name" type="text" value={form.full_name} onChange={set('full_name')} className="input-field" autoComplete="name" required />
        </div>
        <div>
          <label htmlFor="wl-biz" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.businessName')}</label>
          <input id="wl-biz" type="text" value={form.business_name} onChange={set('business_name')} className="input-field" autoComplete="organization" required />
        </div>
        <div>
          <label htmlFor="wl-type" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.businessType')}</label>
          <select id="wl-type" value={form.business_type} onChange={set('business_type')} className="input-field">
            {BUSINESS_TYPES.map((v) => <option key={v} value={v}>{t(`auth.businessTypes.${v}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="wl-email" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.email')}</label>
          <input id="wl-email" type="email" value={form.email} onChange={set('email')} className="input-field" autoComplete="email" required />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={state === 'saving'} className="btn-primary w-full sm:w-auto mt-5 text-base px-6 py-3">
        {state === 'saving' ? <Spinner size="sm" className="text-white" /> : <>{t('waitlist.submit')} <ArrowRight size={18} /></>}
      </button>
    </form>
  );
}
