import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Menu, X } from 'lucide-react';
import { useT, LangToggle } from '../../i18n/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { PROGRAMS, accentOf } from '../../programs';

// Public-site header shared by the home page and every program page.
// Section links point at the home page's anchors, so they work from anywhere.
export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useT();
  // "/" is the public site for everyone now, so a signed-in visitor needs a
  // visible way back into their workspace. /app knows which program that is.
  const { user } = useAuth();

  const statusLabel = (p) => t(p.status === 'live' ? 'site.statusLive' : p.status === 'pilot' ? 'site.statusPilot' : 'site.statusSoon');

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-surface-200">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
        <Link to="/" className="flex items-center gap-2.5" aria-label="SelRic home">
          <span className="w-8 h-8 rounded-lg bg-brand-600 text-white font-display text-base flex items-center justify-center">S</span>
          <span className="font-display text-xl text-brand-950">SelRic</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-surface-700">
          <div className="relative group">
            <button type="button" className="inline-flex items-center gap-1 hover:text-brand-700 py-2" aria-haspopup="true">
              {t('site.navPrograms')} <ChevronDown size={14} />
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 top-full pt-2 hidden group-hover:block group-focus-within:block">
              <div className="w-72 rounded-xl bg-white border border-surface-200 shadow-modal p-2">
                {PROGRAMS.map((p) => {
                  const a = accentOf(p);
                  return (
                    <Link key={p.key} to={`/programs/${p.key}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-50">
                      <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${a.soft}`}><p.icon size={16} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-surface-900">{t(`programs.${p.key}.name`)}</span>
                        <span className="block text-xs text-surface-500">{statusLabel(p)}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
          <Link to="/#how-it-works" className="hover:text-brand-700">{t('site.navHow')}</Link>
          <Link to="/#who-we-are" className="hover:text-brand-700">{t('site.navWho')}</Link>
          <Link to="/#pricing" className="hover:text-brand-700">{t('site.navPricing')}</Link>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <LangToggle />
          {user ? (
            <Link to="/app" className="btn-primary">{t('site.goToApp')} <ArrowRight size={16} /></Link>
          ) : (
            <>
              <Link to="/login" className="btn-ghost text-surface-700">{t('common.signIn')}</Link>
              <Link to="/#waitlist" className="btn-primary">{t('landing.joinWaitlist')}</Link>
            </>
          )}
        </div>

        <button
          className="md:hidden p-2 text-surface-700"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-label={t('nav.menu')}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-surface-200 bg-white px-5 py-4 space-y-1 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 pt-1 pb-1">{t('site.navPrograms')}</div>
          {PROGRAMS.map((p) => (
            <Link key={p.key} to={`/programs/${p.key}`} onClick={() => setMenuOpen(false)} className="flex items-center justify-between py-2">
              <span>{t(`programs.${p.key}.name`)}</span>
              <span className="text-xs text-surface-500">{statusLabel(p)}</span>
            </Link>
          ))}
          <div className="border-t border-surface-100 my-2" />
          <Link to="/#how-it-works" onClick={() => setMenuOpen(false)} className="block py-2">{t('site.navHow')}</Link>
          <Link to="/#who-we-are" onClick={() => setMenuOpen(false)} className="block py-2">{t('site.navWho')}</Link>
          <Link to="/#pricing" onClick={() => setMenuOpen(false)} className="block py-2">{t('site.navPricing')}</Link>
          <div className="pt-3 flex items-center gap-3">
            <LangToggle />
            {user ? (
              <Link to="/app" onClick={() => setMenuOpen(false)} className="btn-primary flex-1">{t('site.goToApp')} <ArrowRight size={16} /></Link>
            ) : (
              <>
                <Link to="/login" className="btn-secondary flex-1">{t('common.signIn')}</Link>
                <Link to="/#waitlist" onClick={() => setMenuOpen(false)} className="btn-primary flex-1">{t('landing.joinWaitlist')}</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
