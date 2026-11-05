import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Tag, ClipboardList, Layers, FileBarChart, Users, Settings, Gauge, LogOut, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import { LANGS } from '../../i18n/translations';
import { cn } from '../../lib/utils';
import { HerdProvider } from './HerdContext';
import { RegistrarProvider, useRegistrar } from './RegistrarSheet';
import { ActionSheet } from './Sheet';
import BottomNav from './BottomNav';
import { btnClay } from './components';

// The Batavia Ganadería shell. AppLayout hands over to it when the workspace
// runs Ganadería, so the Business shell is untouched.
//
//   ≥ 768 px  a forest sidebar: the finca's pages, the clay Registrar button,
//             Team and Settings for admins, the user, language and sign out.
//   < 768 px  no sidebar: the bottom nav, and "Más" for everything else.
//
// The herd and Registrar are mounted here (not only under /ganaderia), so the
// Registrar button works on the shared pages too.

const FINCA = [
  { key: 'home', icon: Home, path: '/ganaderia', exact: true, label: (t) => t('nav.lvHome') },
  { key: 'animals', icon: Tag, path: '/ganaderia/animales', label: (t) => t('nav.lvAnimals') },
  { key: 'events', icon: ClipboardList, path: '/ganaderia/eventos', label: (t) => t('nav.lvEvents') },
  { key: 'lots', icon: Layers, path: '/ganaderia/lotes', label: (t) => t('lv.shell.lots') },
  { key: 'reports', icon: FileBarChart, path: '/ganaderia/informes', label: (t) => t('lv.shell.reports'), soon: true },
];

function monogram(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'S';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function GanaderiaShell() {
  return (
    <HerdProvider>
      <RegistrarProvider>
        <ShellFrame />
      </RegistrarProvider>
    </HerdProvider>
  );
}

function ShellFrame() {
  const { profile, organization, isAdmin, isPlatformAdmin, signOut } = useAuth();
  const { t, lang, setLang } = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const registrar = useRegistrar();
  const [moreOpen, setMoreOpen] = useState(false);
  const businessName = organization?.name || 'SelRic';

  const isOn = (item) => (item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path));
  const shared = [
    ...(isAdmin ? [
      { key: 'users', icon: Users, path: '/users', label: (tt) => tt('nav.users') },
      { key: 'settings', icon: Settings, path: '/settings', label: (tt) => tt('nav.settings') },
    ] : []),
    ...(isPlatformAdmin ? [{ key: 'oversight', icon: Gauge, path: '/ceo', label: (tt) => tt('nav.oversight') }] : []),
  ];

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  const navLink = (item) => {
    const active = isOn(item);
    return (
      <Link key={item.key} to={item.path} aria-current={active ? 'page' : undefined}
        className={cn('flex items-center gap-3 min-h-[44px] px-3 rounded-xl text-[15px] transition-colors',
          active ? 'bg-white/[0.12] text-white font-semibold' : 'text-finca-mist hover:bg-white/[0.06] hover:text-white')}>
        <item.icon size={19} className="shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate">{item.label(t)}</span>
        {item.soon && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-white/10 text-finca-mist">{t('lv.shell.soon')}</span>}
      </Link>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-finca-paper text-finca-ink">
      <aside className="hidden md:flex w-[15rem] lg:w-[16.5rem] shrink-0 flex-col bg-finca-forest text-white" aria-label={t('lv.shell.nav')}>
        <div className="px-4 pt-5 pb-4 flex items-center gap-3 min-w-0">
          <Link to="/ganaderia" className="w-11 h-11 shrink-0 rounded-xl bg-finca-green flex items-center justify-center font-display text-base">{monogram(businessName)}</Link>
          <div className="min-w-0">
            <Link to="/ganaderia" className="block font-display text-[18px] leading-tight truncate" title={businessName}>{businessName}</Link>
            <div className="text-[12px] text-finca-mist truncate">{t('programs.ganaderia.name')}</div>
          </div>
        </div>
        <div className="px-3">
          <button type="button" onClick={() => registrar.open()} className={cn(btnClay, 'w-full')} data-testid="lv-register-side">
            <Plus size={20} strokeWidth={2.5} /> {t('lv.recordEvent')}
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-0.5">{FINCA.map(navLink)}</div>
          {shared.length > 0 && (
            <div className="mt-5 pt-4 border-t border-white/10 space-y-0.5">{shared.map(navLink)}</div>
          )}
        </nav>
        <div className="px-3 py-3 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 shrink-0 rounded-full bg-finca-green flex items-center justify-center text-xs font-bold uppercase">{profile?.full_name?.charAt(0) || 'U'}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{profile?.full_name || 'User'}</div>
              <div className="text-[11px] text-finca-mist">{profile?.role === 'admin' ? t('common.admin') : t('common.limited')}</div>
            </div>
            <LangToggle tone="dark" />
          </div>
          <button type="button" onClick={handleSignOut} className="flex items-center gap-3 min-h-[44px] px-3 w-full rounded-xl text-[14px] text-finca-mist hover:bg-white/[0.06] hover:text-white transition-colors">
            <LogOut size={17} aria-hidden="true" /> {t('common.signOut')}
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto pb-nav">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 pt-4 md:pt-8">
          <Outlet />
        </div>
      </main>

      <BottomNav onRegister={() => registrar.open()} onMore={() => setMoreOpen(true)} moreOpen={moreOpen} />

      <ActionSheet open={moreOpen} onClose={() => setMoreOpen(false)} title={businessName} subtitle={profile?.full_name || null}
        actions={[
          ...FINCA.slice(3).map((item) => ({ key: item.key, label: item.label(t), icon: item.icon, hint: item.soon ? t('lv.shell.soon') : null, onClick: () => navigate(item.path) })),
          ...shared.map((item) => ({ key: item.key, label: item.label(t), icon: item.icon, onClick: () => navigate(item.path) })),
          { key: 'signout', label: t('common.signOut'), icon: LogOut, onClick: handleSignOut },
        ]}>
        <div className="flex items-center justify-between gap-3 min-h-[52px]">
          <span className="text-[16px] font-medium">{t('common.language')}</span>
          <div className="flex gap-1 p-1 rounded-[14px] bg-finca-lineSoft" role="group" aria-label={t('common.language')}>
            {LANGS.map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                className={cn('min-w-[56px] min-h-[44px] rounded-[11px] text-[15px] font-semibold uppercase', lang === l ? 'bg-finca-surface text-finca-ink shadow-finca' : 'text-finca-ink2')}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </ActionSheet>
    </div>
  );
}
