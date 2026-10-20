import { useEffect, useState } from 'react';
import { useT } from '../i18n/I18nContext';
import { TEMPLATES, MODULES, DASHBOARD_SECTIONS, getTemplate } from '../lib/workspaceConfig';
import { cn } from '../lib/utils';
import { Factory, Store, Wrench, UtensilsCrossed, Check, ShoppingBag, Contact, Package, ListChecks, BarChart3 } from 'lucide-react';

const TEMPLATE_ICONS = { maker: Factory, retail: Store, services: Wrench, restaurant: UtensilsCrossed };
const MODULE_ICONS = { sales: ShoppingBag, customers: Contact, inventory: Package, tasks: ListChecks, reports: BarChart3 };

// The portal editor: template → modules → names → dashboard. Used by the
// one-step setup screen (compact) and by Settings → Your portal (full).
// It owns a draft; the parent saves it with `onSave(draft)`.
export default function PortalEditor({ initial, onSave, saving, compact = false, submitLabel }) {
  const { t } = useT();
  const [draft, setDraft] = useState(() => ({
    template: initial.template,
    modules: { ...initial.modules },
    labels: { ...initial.labels },
    dashboard: { ...initial.dashboard },
  }));
  const [showNames, setShowNames] = useState(() => Object.keys(initial.labels || {}).length > 0);

  useEffect(() => {
    setDraft({ template: initial.template, modules: { ...initial.modules }, labels: { ...initial.labels }, dashboard: { ...initial.dashboard } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.template, JSON.stringify(initial.modules), JSON.stringify(initial.labels), JSON.stringify(initial.dashboard)]);

  // Picking a template resets modules and dashboard to its defaults; names stay.
  function pickTemplate(key) {
    const tpl = getTemplate(key);
    if (!tpl) return;
    setDraft((d) => ({ ...d, template: key, modules: { ...tpl.modules }, dashboard: { ...tpl.dashboard } }));
  }

  const toggleModule = (k) => setDraft((d) => ({ ...d, modules: { ...d.modules, [k]: !d.modules[k] } }));
  const toggleSection = (k) => setDraft((d) => ({ ...d, dashboard: { ...d.dashboard, [k]: !d.dashboard[k] } }));
  const setLabel = (k, v) => setDraft((d) => ({ ...d, labels: { ...d.labels, [k]: v } }));

  const enabledModules = MODULES.filter((m) => draft.modules[m.key]);

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(draft); }} className="space-y-6">
      {/* ── Template ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-2">{t('portal.templateTitle')}</h3>
        <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label={t('portal.templateTitle')}>
          {TEMPLATES.map((tpl) => {
            const Icon = TEMPLATE_ICONS[tpl.key];
            const on = draft.template === tpl.key;
            return (
              <button key={tpl.key} type="button" role="radio" aria-checked={on} onClick={() => pickTemplate(tpl.key)}
                className={cn('text-left rounded-xl border-2 p-4 transition-colors', on ? 'border-brand-600 bg-brand-50/60' : 'border-surface-200 hover:border-surface-300 bg-white')}>
                <div className="flex items-start justify-between gap-3">
                  <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', on ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600')}><Icon size={18} /></span>
                  {on && <Check size={16} className="text-brand-600" />}
                </div>
                <div className="font-display text-lg text-brand-950 mt-3">{t(`portal.templates.${tpl.key}.name`)}</div>
                <p className="text-xs text-surface-600 mt-1 leading-snug">{t(`portal.templates.${tpl.key}.body`)}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Modules ───────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-1">{t('portal.modulesTitle')}</h3>
        <p className="text-xs text-surface-500 mb-2">{t('portal.modulesBody')}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {MODULES.map((m) => {
            const Icon = MODULE_ICONS[m.key];
            const on = !!draft.modules[m.key];
            return (
              <button key={m.key} type="button" role="switch" aria-checked={on} onClick={() => toggleModule(m.key)}
                className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors', on ? 'border-brand-300 bg-brand-50/60' : 'border-surface-200 bg-white hover:border-surface-300')}>
                <span className={cn('w-8 h-8 rounded-md flex items-center justify-center shrink-0', on ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-400')}><Icon size={15} /></span>
                <span className="flex-1 min-w-0">
                  <span className={cn('block text-sm font-medium truncate', on ? 'text-brand-900' : 'text-surface-600')}>{draft.labels[m.key]?.trim() || t(m.labelKey)}</span>
                  <span className="block text-[11px] text-surface-500 truncate">{t(`portal.modules.${m.key}`)}</span>
                </span>
                <span className={cn('w-9 h-5 rounded-full relative transition-colors shrink-0', on ? 'bg-brand-600' : 'bg-surface-300')}>
                  <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-surface-400 mt-2">{t('portal.alwaysOn')}</p>
      </section>

      {/* ── Names ─────────────────────────────────────────────────────── */}
      <section>
        <button type="button" onClick={() => setShowNames((v) => !v)} className="text-xs font-semibold uppercase tracking-wider text-surface-500 hover:text-brand-700">
          {showNames ? '▾' : '▸'} {t('portal.namesTitle')}
        </button>
        {showNames && (
          <>
            <p className="text-xs text-surface-500 mt-1 mb-2">{t('portal.namesBody')}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {enabledModules.map((m) => (
                <label key={m.key} className="block">
                  <span className="block text-[11px] text-surface-500 mb-1">{t(m.labelKey)}</span>
                  <input type="text" value={draft.labels[m.key] || ''} onChange={(e) => setLabel(m.key, e.target.value)} maxLength={40}
                    className="input-field py-1.5 text-sm" placeholder={t(m.labelKey)} />
                </label>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Dashboard ─────────────────────────────────────────────────── */}
      {!compact && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-1">{t('portal.dashboardTitle')}</h3>
          <p className="text-xs text-surface-500 mb-2">{t('portal.dashboardBody')}</p>
          <div className="flex flex-wrap gap-2">
            {DASHBOARD_SECTIONS.map((k) => {
              const on = draft.dashboard[k] !== false;
              const disabled = k === 'products' && !draft.modules.inventory;
              return (
                <button key={k} type="button" role="switch" aria-checked={on && !disabled} disabled={disabled} onClick={() => toggleSection(k)}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-40',
                    on && !disabled ? 'border-brand-300 bg-brand-50 text-brand-900' : 'border-surface-200 bg-white text-surface-500')}>
                  {on && !disabled ? <Check size={13} /> : null} {t(`portal.sections.${k}`)}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? '…' : (submitLabel || t('common.save'))}
        </button>
      </div>
    </form>
  );
}
