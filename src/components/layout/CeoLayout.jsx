import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BookOpen, FileText, Filter, Flag, Gauge, LogOut, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';

// The shell for SelRic itself — the company, not a customer. A platform admin
// whose organization is internal lands here instead of in a workspace, and
// never sees a program's sidebar, because there is no program: there is the
// company, and the pilots it is watching.
//
// The entries are the pages of Oversight. They mirror the tab bar on the page
// itself, so a reader can move by rail or by tab.
const NAV = [
  { key: 'oversight', icon: Gauge,             path: '/ceo',           exact: true },
  { key: 'pilots',    icon: Activity,          path: '/ceo/pilots' },
  { key: 'funnel',    icon: Filter,            path: '/ceo/funnel' },
  { key: 'research',  icon: BookOpen,          path: '/ceo/research' },
  { key: 'model',     icon: SlidersHorizontal, path: '/ceo/model' },
  { key: 'documents', icon: FileText,          path: '/ceo/documents' },
  { key: 'plan',      icon: Flag,              path: '/ceo/plan' },
];

export default function CeoLayout() {
  const { profile, signOut } = useAuth();
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-50">
      <aside className="w-60 shrink-0 bg-brand-950 text-white flex flex-col">
        <div className="px-5 pt-6 pb-5 border-b border-white/10">
          <Link to="/ceo" className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-brand-500 text-white font-display text-lg flex items-center justify-center">S</span>
            <span className="min-w-0">
              <span className="block font-display text-[17px] leading-tight">SelRic</span>
              <span className="block text-[11px] uppercase tracking-wider text-white/50 mt-0.5">{t('nav.groups.platform')}</span>
            </span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ key, icon: Icon, path, exact }) => {
            const active = exact ? location.pathname === path || location.pathname === path + '/' : location.pathname.startsWith(path);
            return (
              <Link
                key={key}
                to={path}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  active ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                )}
              >
                <Icon size={17} /> {t(`nav.${key}`)}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-white/10 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{profile?.full_name || profile?.email || '—'}</div>
              <div className="text-[11px] text-white/50 truncate">{profile?.email}</div>
            </div>
            <LangToggle />
          </div>
          <button type="button" onClick={handleSignOut} className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white transition-colors">
            <LogOut size={16} /> {t('common.signOut')}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="px-6 lg:px-10 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
