import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { translations, LANGS } from './translations';

// Language for the SelRic UI.
//
// Where the choice lives, in priority order:
//   1. localStorage 'selric.lang' — the user toggled it on this device
//      (works signed-out too, on the landing and auth pages).
//   2. profiles.locale — the user's saved choice; follows them across devices.
//   3. The browser language: Spanish browsers get Spanish, everyone else English.
//
// Toggling writes both 1 and 2 (when signed in), so a choice made on the
// landing page before signing up is carried into the new account.

const STORAGE_KEY = 'selric.lang';
const I18nContext = createContext(null);

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function browserDefault() {
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function lookup(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function fill(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

export function I18nProvider({ children }) {
  const { user, profile } = useAuth();
  const [lang, setLangState] = useState(() => readStored() || browserDefault());

  // Profile loaded: a saved locale wins over the browser default, but never
  // over an explicit choice made on this device.
  useEffect(() => {
    if (!profile) return;
    const stored = readStored();
    const saved = LANGS.includes(profile.locale) ? profile.locale : null;
    if (stored) {
      if (saved !== stored) persistToProfile(stored);
    } else if (saved) {
      setLangState(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.locale]);

  useEffect(() => {
    try { document.documentElement.lang = lang; } catch { /* non-browser */ }
  }, [lang]);

  async function persistToProfile(next) {
    if (!user) return;
    // Column may not exist until the locale migration runs — swallow quietly.
    const { error } = await supabase.from('profiles').update({ locale: next }).eq('id', user.id);
    if (error) console.warn('locale not saved to profile:', error.message);
  }

  const setLang = useCallback((next) => {
    if (!LANGS.includes(next)) return;
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
    persistToProfile(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const t = useCallback((key, vars) => {
    const v = lookup(translations[lang], key) ?? lookup(translations.en, key);
    if (v == null) return key;
    return typeof v === 'string' ? fill(v, vars) : v;
  }, [lang]);

  // Count-aware: tn('dash.overdueTasks', 1) → the 'overdueTasksOne' string when it exists.
  const tn = useCallback((key, n) => {
    if (n === 1 && lookup(translations[lang], key + 'One') != null) return t(key + 'One', { n });
    return t(key, { n });
  }, [lang, t]);

  const value = useMemo(() => ({
    lang,
    setLang,
    t,
    tn,
    // Locale tag for Intl / toLocaleDateString.
    locale: lang === 'es' ? 'es-US' : 'en-US',
  }), [lang, setLang, t, tn]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used within I18nProvider');
  return ctx;
}

// Compact EN / ES switch. `tone="dark"` for the sidebar, default for light pages.
export function LangToggle({ tone = 'light', className = '' }) {
  const { lang, setLang, t } = useT();
  const dark = tone === 'dark';
  const base = 'inline-flex rounded-lg p-0.5 text-xs font-semibold ' +
    (dark ? 'bg-white/10' : 'bg-surface-100');
  const btn = (code) => {
    const on = lang === code;
    return 'px-2.5 py-1 rounded-md transition-colors ' + (
      on
        ? (dark ? 'bg-white text-brand-950' : 'bg-white text-brand-900 shadow-card')
        : (dark ? 'text-brand-200 hover:text-white' : 'text-surface-500 hover:text-surface-800')
    );
  };
  return (
    <div className={`${base} ${className}`} role="group" aria-label={t('common.language')}>
      <button type="button" className={btn('en')} onClick={() => setLang('en')} aria-pressed={lang === 'en'}>EN</button>
      <button type="button" className={btn('es')} onClick={() => setLang('es')} aria-pressed={lang === 'es'}>ES</button>
    </div>
  );
}
