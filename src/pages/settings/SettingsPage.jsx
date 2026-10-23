import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import { BUSINESS_TYPES } from '../auth/SignupPage';
import Spinner from '../../components/ui/Spinner';
import { Building2, BookOpen, ArrowLeftRight, Check, Languages, BadgeCheck, ArrowRight, LayoutGrid, LayoutTemplate } from 'lucide-react';
import PortalEditor from '../../components/PortalEditor';
import { cn } from '../../lib/utils';
import { PROGRAMS, getProgram, accentOf } from '../../programs';

// Workspace settings (admins only): the business, its programs, how it keeps
// its books, language and plan. Writes go to the organization row and to
// org_programs — RLS allows admins to update only their own.
export default function SettingsPage() {
  const { organization, accountingMode, updateOrganization, primaryProgram, config, updateConfig } = useAuth();
  const [savingPortal, setSavingPortal] = useState(false);

  async function savePortal(draft) {
    setSavingPortal(true);
    try {
      await updateConfig(draft);
      toast.success(t('portal.saved'));
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    } finally {
      setSavingPortal(false);
    }
  }
  const { t } = useT();
  const program = getProgram(primaryProgram) || PROGRAMS[0];
  // Accounting mode and the portal shape belong to the Business program; a
  // Ganadería workspace keeps the finca's name, program, language and plan.
  const isBusiness = program.key === 'business';

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
      <p className="text-surface-500 text-sm mt-1">{t(isBusiness ? 'settings.subtitle' : 'settings.subtitleFarm')}</p>

      {/* ── Business ─────────────────────────────────────────────────── */}
      <section className="card mt-6">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
          <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><Building2 size={18} /></span>
          <div>
            <h2 className="section-title">{t(isBusiness ? 'settings.businessTitle' : 'settings.farmTitle')}</h2>
            <p className="text-xs text-surface-500">{t('settings.businessBody')}</p>
          </div>
        </header>
        <form onSubmit={saveBusiness} className="px-5 py-5 grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="st-name" className="block text-xs font-semibold text-surface-600 mb-1.5">{t(isBusiness ? 'common.businessName' : 'common.farmName')}</label>
            <input id="st-name" type="text" value={biz.name} onChange={(e) => setBiz((b) => ({ ...b, name: e.target.value }))}
              className="input-field" autoComplete="organization" required />
          </div>
          {isBusiness && (
            <div>
              <label htmlFor="st-type" className="block text-xs font-semibold text-surface-600 mb-1.5">{t('common.businessType')}</label>
              <select id="st-type" value={biz.business_type} onChange={(e) => setBiz((b) => ({ ...b, business_type: e.target.value }))} className="input-field">
                {BUSINESS_TYPES.map((v) => <option key={v} value={v}>{t(`auth.businessTypes.${v}`)}</option>)}
              </select>
            </div>
          )}
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" disabled={!bizDirty || savingBiz} className="btn-primary">
              {savingBiz ? <Spinner size="sm" className="text-white" /> : t('common.save')}
            </button>
          </div>
        </form>
      </section>

      {/* ── Program (read-only: each program is its own workspace) ───── */}
      <section className="card mt-6">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
          <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><LayoutGrid size={18} /></span>
          <div>
            <h2 className="section-title">{t('settings.programTitle')}</h2>
            <p className="text-xs text-surface-500">{t('settings.programBody')}</p>
          </div>
        </header>
        <div className="flex items-center gap-4 px-5 py-4">
          <span className={cn('w-10 h-10 shrink-0 rounded-lg flex items-center justify-center', accentOf(program).tile)}><program.icon size={20} /></span>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-surface-500">{t('settings.programRuns')}</div>
            <div className="font-medium text-surface-900">{t(`programs.${program.key}.name`)}</div>
          </div>
          <span className="font-mono text-sm text-surface-700 shrink-0">{t(`programs.${program.key}.price`)} <span className="font-sans text-surface-500">{t('site.perMonth')}</span></span>
        </div>
      </section>

      {/* ── Accounting mode (Business) ───────────────────────────────── */}
      {isBusiness && (
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
      )}

      {/* ── Your portal (Business, Simple mode) ──────────────────────── */}
      {isBusiness && accountingMode === 'simple' && (
        <section className="card mt-6">
          <header className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
            <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center"><LayoutTemplate size={18} /></span>
            <div>
              <h2 className="section-title">{t('portal.title')}</h2>
              <p className="text-xs text-surface-500">{t('portal.body')}</p>
            </div>
          </header>
          <div className="px-5 py-5">
            <PortalEditor initial={config} onSave={savePortal} saving={savingPortal} />
          </div>
        </section>
      )}

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
