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
  ListChecks,
  BookText,
  Calculator,
  Wrench,
  Receipt,
  Users2,
  ArrowLeftRight,
  Settings,
  ShoppingBag,
  Contact,
  Home,
  Beef,
  ClipboardList,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { PROGRAMS, DEFAULT_PROGRAM, accentOf } from '../../programs';
import { MODULES } from '../../lib/workspaceConfig';

// Sidebar, grouped by what an owner is doing. Labels are translation keys.
// Which groups show depends on the workspace's accounting mode
// (Settings → Accounting):
//   full    — the complete package (bookkeeping, cash, ledger, journal,
//             chart of accounts, accountant) plus payroll and assets.
//   simple  — one Transactions tab instead of the accounting pages; payroll
//             and assets stay out of the way too.
const FULL_GROUPS = [
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
    { key: 'tasks',     icon: ListChecks,   path: '/tasks' },
  ]},
  { key: 'close', items: [
    { key: 'accountant', icon: Calculator, path: '/accountant' },
    { key: 'reports',    icon: BarChart3,  path: '/reports' },
  ]},
  { key: 'settings', items: [
    { key: 'users',    icon: Users,    path: '/users' },
    { key: 'settings', icon: Settings, path: '/settings' },
  ]},
];

// Simple mode: the sidebar follows the workspace's portal config — which
// modules are on and what the business calls them (Settings → Your portal).
// `module` ties an item to a config key; items without one are the core.
const MODULE_ICONS = { sales: ShoppingBag, customers: Contact, inventory: Package, tasks: ListChecks, reports: BarChart3 };
function simpleGroups(config) {
  const on = (k) => config?.modules?.[k] !== false;
  const item = (k) => ({ key: k === 'sales' ? 'salesSimple' : k, module: k, icon: MODULE_ICONS[k], path: MODULES.find((m) => m.key === k).path });
  return [
    { key: 'overview', items: [
      { key: 'dashboard', icon: LayoutDashboard, path: '/' },
    ]},
    { key: 'money', items: [
      { key: 'transactions', icon: ArrowLeftRight, path: '/transactions' },
      ...(on('reports') ? [item('reports')] : []),
    ]},
    { key: 'operations', items: ['sales', 'customers', 'inventory', 'tasks'].filter(on).map(item) },
    { key: 'settings', items: [
      { key: 'users',    icon: Users,    path: '/users' },
      { key: 'settings', icon: Settings, path: '/settings' },
    ]},
  ].filter((g) => g.items.length);
}

const LIMITED_GROUPS = [
  { key: 'overview', items: [
    { key: 'dashboard', icon: LayoutDashboard, path: '/' },
  ]},
  { key: 'operations', items: [
    { key: 'inventory', icon: Package, path: '/inventory' },
  ]},
];

// Batavia Ganadería: the finca's pages, then the shared Team and Settings.
// `exact` keeps Inicio from lighting up on every /ganaderia/* page.
const GANADERIA_GROUPS = [
  { key: 'finca', items: [
    { key: 'lvHome',    icon: Home,          path: '/ganaderia', exact: true },
    { key: 'lvAnimals', icon: Beef,          path: '/ganaderia/animales' },
    { key: 'lvEvents',  icon: ClipboardList, path: '/ganaderia/eventos' },
  ]},
  { key: 'settings', items: [
    { key: 'users',    icon: Users,    path: '/users' },
    { key: 'settings', icon: Settings, path: '/settings' },
  ]},
];
const GANADERIA_LIMITED_GROUPS = [GANADERIA_GROUPS[0]];

// Two-letter monogram for the business tile: "Lopez Bakery" → "LB".
function monogram(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'S';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function AppLayout() {
  const { profile, organization, accountingMode, primaryProgram, isAdmin, signOut, config } = useAuth();
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // The program this workspace runs (each SelRic program is its own workspace).
  const program = PROGRAMS.find((p) => p.key === primaryProgram) || PROGRAMS.find((p) => p.key === DEFAULT_PROGRAM);
  const currentProgram = program.key;
  const groups = currentProgram === 'ganaderia'
    ? (isAdmin ? GANADERIA_GROUPS : GANADERIA_LIMITED_GROUPS)
    : !isAdmin ? LIMITED_GROUPS : accountingMode === 'simple' ? simpleGroups(config) : FULL_GROUPS;
  // A module's custom name (Settings → Your portal) wins over the translation.
  const labelOf = (item) => (item.module && config?.labels?.[item.module]) || t(`nav.${item.key}`);
  const businessName = organization?.name || 'SelRic';
  const tile = currentProgram === 'business' ? 'bg-brand-500' : accentOf(program).tile;

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  function isActive(item) {
    const { path, exact } = typeof item === 'string' ? { path: item } : item;
    return path === '/' || exact ? location.pathname === path : location.pathname.startsWith(path);
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
            <div className="flex items-center gap-3 min-w-0">
              <Link to={program.home} className={cn('w-11 h-11 shrink-0 rounded-xl flex items-center justify-center font-display text-base tracking-wide', tile)}>
                {monogram(businessName)}
              </Link>
              <div className="min-w-0">
                <Link to={program.home} className="block font-display text-[17px] leading-tight truncate" title={businessName}>
                  {businessName}
                </Link>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-brand-300">
                  <span>{t(`programs.${currentProgram}.name`)}</span>
                  {organization?.plan === 'pilot' && (
                    <span className="rounded px-1.5 py-px bg-brand-500/30 text-brand-100 text-[10px] tracking-wide">{t('common.pilot')}</span>
                  )}
                </div>
              </div>
            </div>
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
                  const active = isActive(item);
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
                      <span className="truncate">{labelOf(item)}</span>
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
