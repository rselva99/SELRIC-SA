import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowRight, Check, Plus, Settings } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n/I18nContext';
import { PROGRAMS, accentOf } from '../../programs';
import Spinner from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';

// /hub — the programs this workspace runs, and the ones it could turn on.
// Opened from the program label in the sidebar. Turning a program on is the
// same action as in Settings → Programs (admins only).
export default function HubPage() {
  const { organization, programKeys, isAdmin, enableProgram } = useAuth();
  const { t } = useT();
  const [busy, setBusy] = useState('');

  async function turnOn(key) {
    setBusy(key);
    try {
      await enableProgram(key);
      toast.success(t('settings.programEnabled', { name: t(`programs.${key}.name`) }));
    } catch (err) {
      toast.error(err.message || t('settings.saveFailed'));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">{t('hub.title')}</h1>
      <p className="text-surface-500 text-sm mt-1">{t('hub.body', { business: organization?.name || 'SelRic' })}</p>

      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PROGRAMS.map((p) => {
          const a = accentOf(p);
          const on = programKeys.includes(p.key);
          const live = p.status === 'live';
          return (
            <div key={p.key} className={cn('card p-5 flex flex-col', on && a.border)}>
              <div className="flex items-start justify-between gap-3">
                <span className={cn('w-11 h-11 rounded-xl flex items-center justify-center', on ? a.tile : 'bg-surface-100 text-surface-500')}><p.icon size={22} /></span>
                {on ? (
                  <span className="badge-green inline-flex items-center gap-1"><Check size={12} /> {t('hub.on')}</span>
                ) : (
                  <span className="badge-amber">{t(live ? 'site.statusLive' : 'site.statusPilot')}</span>
                )}
              </div>
              <h2 className="font-display text-xl text-brand-950 mt-4">{t(`programs.${p.key}.name`)}</h2>
              <p className="text-sm text-surface-600 mt-1.5 leading-relaxed flex-1">
                {on || live ? t(`programs.${p.key}.tagline`) : t('hub.pilotBody')}
              </p>
              <div className="mt-5">
                {on ? (
                  <Link to={p.home} className="btn-primary w-full">{t('hub.open')} <ArrowRight size={16} /></Link>
                ) : live && isAdmin ? (
                  <button type="button" onClick={() => turnOn(p.key)} disabled={busy === p.key} className="btn-secondary w-full">
                    {busy === p.key ? <Spinner size="sm" /> : t('settings.turnOn')}
                  </button>
                ) : (
                  <Link to={`/programs/${p.key}`} className="btn-secondary w-full">{t('site.seeProgram', { name: t(`programs.${p.key}.short`) })}</Link>
                )}
              </div>
            </div>
          );
        })}

        {isAdmin && (
          <Link to="/settings" className="rounded-xl border-2 border-dashed border-surface-300 hover:border-brand-400 p-5 flex flex-col transition-colors">
            <span className="w-11 h-11 rounded-xl flex items-center justify-center bg-surface-100 text-surface-500"><Plus size={22} /></span>
            <h2 className="font-display text-xl text-brand-950 mt-4">{t('hub.addTitle')}</h2>
            <p className="text-sm text-surface-600 mt-1.5 leading-relaxed flex-1">{t('hub.addBody')}</p>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 mt-5"><Settings size={15} /> {t('hub.manage')}</span>
          </Link>
        )}
      </div>
    </div>
  );
}
