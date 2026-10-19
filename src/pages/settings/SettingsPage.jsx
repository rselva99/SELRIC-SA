import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import { BUSINESS_TYPES } from '../auth/SignupPage';
import Spinner from '../../components/ui/Spinner';
import { Building2, BookOpen, ArrowLeftRight, Check, Languages, BadgeCheck, ArrowRight, LayoutGrid } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PROGRAMS, accentOf } from '../../programs';

// Workspace settings (admins only): the business, its programs, how it keeps
// its books, language and plan. Writes go to the organization row and to
// org_programs — RLS allows admins to update only their own.
export default function SettingsPage() {
  const { organization, accountingMode, updateOrganization, programKeys, enableProgram } = useAuth();
  const { t } = useT();

  // ── Programs ─────────────────────────────────────────────────────────────
  const [busyProgram, setBusyProgram] = useState('');
  async function turnOn(key) {
    setBusyProgram(key);
    try {
      await enableProgram(key);
      toast.success(t('settings.programEnabled', { name: t(`programs.${key}.name`) }));
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    } finally {
      setBusyProgram('');
    }
  }

  // ── Business ─────────────────────────────────────────────────────────────
  const [biz, setBiz] = useState({ name: '', business_type: 'other' });
  const [savingBiz, setSavingBiz] = useState(false);
  useEffect(() => {
    if (organization) setBiz({ name: organization.name || '', business_type: organization.business_type || 'other' });
  }, [organization]);
  const bizDirty = organization && (biz.name.trim() !== (organization.name || '') || biz.business_type !== (organization.business_type || 'other'));

  async function saveBusiness(e) {
    e.preventDefault();
    if (!biz.name.trim()) { toast.error(t('settings.nameRequired')); return; }
    setSavingBiz(true);
    try {
      await updateOrganization({ name: biz.name.trim(), business_type: biz.business_type });
      toast.success(t('settings.saved'));
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    } finally {
      setSavingBiz(false);
    }
  }

  // ── Accounting mode ──────────────────────────────────────────────────────
  const [mode, setMode] = useState(accountingMode || 'full');
  const [savingMode, setSavingMode] = useState(false);
  useEffect(() => { if (accountingMode) setMode(accountingMode); }, [accountingMode]);
  const modeDirty = accountingMode && mode !== accountingMode;

  async function saveMode() {
    setSavingMode(true);
    try {
      await updateOrganization({ accounting_mode: mode });
      toast.success(t(mode === 'simple' ? 'settings.modeSavedSimple' : 'settings.modeSavedFull'));
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    } finally {
      setSavingMode(false);
    }
  }

  const MODES = [
    { key: 'simple', icon: ArrowLeftRight },
    { key: 'full',   icon: BookOpen },
  ];

  if (!organization) {
    return <div className="flex items-center gap-3 text-surface-500 text-sm"><Spinner size="sm" /> {t('common.loading')}</div>;
  }

  return (
    <div className="animate-fade-in max-w-3xl">
      <h1 className="page-title">{t('settings.title')}</h1>
      <p className="text-surface-500 text-sm mt-1">{t('settings.subtitle')}</p>

      {/* ── Business ─────────────────────────────────────────────────── */}
      <section className="card mt-6">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
          <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><Building2 size={18} /></span>
          <div>
            <h2 className="section-title">{t('settings.businessTitle')}</h2>
            <p className="text-xs text-surface-500">{t('settings.businessBody')}</p>
          </div>
        </header>
        <form onSubmit={saveBusiness} className="px-5 py-5 grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="st-name" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.businessName')}</label>
            <input id="st-name" type="text" value={biz.name} onChange={(e) => setBiz((b) => ({ ...b, name: e.target.value }))}
              className="input-field" autoComplete="organization" required />
          </div>
          <div>
            <label htmlFor="st-type" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.businessType')}</label>
            <select id="st-type" value={biz.business_type} onChange={(e) => setBiz((b) => ({ ...b, business_type: e.target.value }))} className="input-field">
              {BUSINESS_TYPES.map((v) => <option key={v} value={v}>{t(`auth.businessTypes.${v}`)}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" disabled={!bizDirty || savingBiz} className="btn-primary">
              {savingBiz ? <Spinner size="sm" className="text-white" /> : t('common.save')}
            </button>
          </div>
        </form>
      </section>

      {/* ── Programs ─────────────────────────────────────────────────── */}
      <section className="card mt-6">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
          <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><LayoutGrid size={18} /></span>
          <div>
            <h2 className="section-title">{t('settings.programsTitle')}</h2>
            <p className="text-xs text-surface-500">{t('settings.programsBody')}</p>
          </div>
        </header>
        <ul className="divide-y divide-surface-100">
          {PROGRAMS.map((p) => {
            const a = accentOf(p);
            const on = programKeys.includes(p.key);
            const live = p.status === 'live';
            return (
              <li key={p.key} className="flex items-center gap-4 px-5 py-4">
                <span className={cn('w-10 h-10 shrink-0 rounded-lg flex items-center justify-center', on ? a.tile : 'bg-surface-100 text-surface-500')}><p.icon size={20} /></span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-surface-900">{t(`programs.${p.key}.name`)}</div>
                  <div className="text-sm text-surface-500 truncate">{t(`programs.${p.key}.tagline`)}</div>
                </div>
                {on ? (
                  <span className="badge-green inline-flex items-center gap-1 shrink-0"><Check size={12} /> {t('settings.programOn')}</span>
                ) : live ? (
                  <button type="button" onClick={() => turnOn(p.key)} disabled={busyProgram === p.key} className="btn-secondary px-3 py-1.5 text-sm shrink-0">
                    {busyProgram === p.key ? <Spinner size="sm" /> : t('settings.turnOn')}
                  </button>
                ) : (
                  <span className="text-xs text-surface-500 text-right shrink-0 max-w-[10rem]">{t('settings.programPilot')}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Accounting mode ──────────────────────────────────────────── */}
      <section className="card mt-6">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
          <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><BookOpen size={18} /></span>
          <div>
            <h2 className="section-title">{t('settings.accountingTitle')}</h2>
            <p className="text-xs text-surface-500">{t('settings.accountingBody')}</p>
          </div>
        </header>
        <div className="px-5 py-5">
          <div className="grid sm:grid-cols-2 gap-4" role="radiogroup" aria-label={t('settings.accountingTitle')}>
            {MODES.map(({ key, icon: Icon }) => {
              const selected = mode === key;
              const current = accountingMode === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(key)}
                  className={cn(
                    'relative text-left rounded-xl border-2 p-5 transition-colors',
                    selected ? 'border-brand-600 bg-brand-50/60' : 'border-surface-200 hover:border-surface-300 bg-white'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn('w-10 h-10 rounded-lg flex items-center justify-center', selected ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600')}>
                      <Icon size={20} />
                    </span>
                    {current && <span className="badge-green">{t('settings.current')}</span>}
                  </div>
                  <div className="font-display text-xl text-brand-950 mt-4">{t(`settings.modes.${key}.title`)}</div>
                  <p className="text-sm text-surface-600 mt-1.5 leading-relaxed">{t(`settings.modes.${key}.body`)}</p>
                  <ul className="mt-4 space-y-1.5">
                    {t(`settings.modes.${key}.includes`).map((line) => (
                      <li key={line} className="flex items-start gap-2 text-sm text-surface-700">
                        <Check size={15} className="text-brand-600 shrink-0 mt-0.5" /> {line}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-surface-500 max-w-md">{t('settings.modeNote')}</p>
            <button type="button" onClick={saveMode} disabled={!modeDirty || savingMode} className="btn-primary shrink-0">
              {savingMode ? <Spinner size="sm" className="text-white" /> : t('settings.applyMode')}
            </button>
          </div>
          {accountingMode === 'simple' && !modeDirty && (
            <Link to="/transactions" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:text-brand-800 font-medium mt-4">
              {t('settings.goToTransactions')} <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </section>

      {/* ── Language + plan ──────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 gap-6 mt-6">
        <section className="card p-5">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><Languages size={18} /></span>
            <h2 className="section-title">{t('common.language')}</h2>
          </div>
          <p className="text-sm text-surface-600 mt-3">{t('settings.languageBody')}</p>
          <div className="mt-4"><LangToggle /></div>
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><BadgeCheck size={18} /></span>
            <h2 className="section-title">{t('settings.planTitle')}</h2>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="font-display text-xl text-brand-950">
              {organization.plan === 'pilot' ? t('settings.planPilot') : t('settings.planPaid')}
            </span>
            {organization.plan === 'pilot' && <span className="badge-green">{t('common.pilot')}</span>}
          </div>
          <p className="text-sm text-surface-600 mt-2">
            {organization.plan === 'pilot' ? t('settings.planPilotBody') : t('settings.planPaidBody')}
          </p>
        </section>
      </div>
    </div>
  );
}
