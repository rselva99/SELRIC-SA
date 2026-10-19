import { useState } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useT, LangToggle } from '../../i18n/I18nContext';
import {
  LayoutDashboard,
  BookOpen,
  Landmark,
  FileText,
  BarChart3,
  Package,
  Users,
  LogOut,
  Menu,
  X,
  TrendingUp,
  CalendarDays,
  ListChecks,
  Megaphone,
  BookText,
  Calculator,
  Wrench,
  Receipt,
  Users2,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// Sidebar, grouped by what an owner is doing. Labels are translation keys.
const ADMIN_GROUPS = [
  { key: 'overview', items: [
    { key: 'dashboard', icon: LayoutDashboard, path: '/' },
  ]},
  { key: 'money', items: [
    { key: 'bookkeeping', icon: BookOpen,  path: '/bookkeeping' },
    { key: 'cash',        icon: Receipt,   path: '/cash-management' },
    { key: 'ledger',      icon: Landmark,  path: '/ledger' },
    { key: 'journal',     icon: BookText,  path: '/journal' },
    { key: 'accounts',    icon: FileText,  path: '/accounts' },
  ]},
  { key: 'operations', items: [
    { key: 'sales',     icon: TrendingUp,   path: '/sales' },
    { key: 'inventory', icon: Package,      path: '/inventory' },
    { key: 'payroll',   icon: Users2,       path: '/payroll' },
    { key: 'assets',    icon: Wrench,       path: '/assets' },
    { key: 'calendar',  icon: CalendarDays, path: '/calendar' },
    { key: 'tasks',     icon: ListChecks,   path: '/tasks' },
  ]},
  { key: 'growth', items: [
    { key: 'marketing', icon: Megaphone, path: '/marketing' },
  ]},
  { key: 'close', items: [
    { key: 'accountant', icon: Calculator, path: '/accountant' },
    { key: 'reports',    icon: BarChart3,  path: '/reports' },
  ]},
  { key: 'settings', items: [
    { key: 'users', icon: Users, path: '/users' },
  ]},
];

const LIMITED_GROUPS = [
  { key: 'overview', items: [
    { key: 'dashboard', icon: LayoutDashboard, path: '/' },
  ]},
  { key: 'operations', items: [
    { key: 'inventory', icon: Package, path: '/inventory' },
  ]},
];

// Two-letter monogram for the business tile: "Lopez Bakery" → "LB".
function monogram(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'S';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function AppLayout() {
  const { profile, organization, isAdmin, signOut } = useAuth();
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const groups = isAdmin ? ADMIN_GROUPS : LIMITED_GROUPS;
  const businessName = organization?.name || 'SelRic';

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  function isActive(path) {
    return path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-50">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-[17rem] bg-brand-950 text-white flex flex-col transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Business header */}
        <div className="px-4 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-start justify-between gap-3">
            <Link to="/" className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 shrink-0 rounded-xl bg-brand-500 flex items-center justify-center font-display text-base tracking-wide">
                {monogram(businessName)}
              </div>
              <div className="min-w-0">
                <div className="font-display text-[17px] leading-tight truncate" title={businessName}>
                  {businessName}
                </div>
                <div className="text-[11px] text-brand-300 mt-0.5 flex items-center gap-1.5">
                  SelRic
                  {organization?.plan === 'pilot' && (
                    <span className="rounded px-1.5 py-px bg-brand-500/30 text-brand-100 text-[10px] tracking-wide">{t('common.pilot')}</span>
                  )}
                </div>
              </div>
            </Link>
            <button className="lg:hidden text-white/60 hover:text-white mt-1" onClick={() => setSidebarOpen(false)} aria-label={t('nav.menu')}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Grouped navigation */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.key} className="mb-4">
              <div className="px-3 pb-1.5 text-[11px] font-medium text-brand-400">
                {t(`nav.groups.${g.key}`)}
              </div>
              <div className="space-y-0.5">
                {g.items.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'relative flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] transition-colors duration-150',
                        active
                          ? 'bg-brand-600 text-white font-medium'
                          : 'text-brand-100/90 hover:bg-white/[0.06] hover:text-white'
                      )}
                    >
                      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-brand-200" />}
                      <item.icon size={17} className={active ? 'text-white' : 'text-brand-300'} />
                      <span className="truncate">{t(`nav.${item.key}`)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User + language + sign out */}
        <div className="px-3 py-3 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 shrink-0 rounded-full bg-brand-700 flex items-center justify-center text-xs font-bold uppercase">
              {profile?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{profile?.full_name || 'User'}</div>
              <div className="text-[11px] text-brand-300">
                {profile?.role === 'admin' ? t('common.admin') : t('common.limited')}
              </div>
            </div>
            <LangToggle tone="dark" />
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 mt-0.5 w-full rounded-lg text-sm text-brand-300 hover:bg-white/[0.06] hover:text-white transition-colors"
          >
            <LogOut size={16} />
            {t('common.signOut')}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center gap-4 px-4 py-3 bg-white border-b border-surface-200">
          <button onClick={() => setSidebarOpen(true)} className="text-surface-600" aria-label={t('nav.menu')}>
            <Menu size={22} />
          </button>
          <div className="font-display text-lg truncate">{businessName}</div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
