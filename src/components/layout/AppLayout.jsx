import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  BarChart3,
  Package,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';

const adminNav = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'Bookkeeping', icon: BookOpen, path: '/bookkeeping' },
  { label: 'Chart of Accounts', icon: FileText, path: '/accounts' },
  { label: 'Reports', icon: BarChart3, path: '/reports' },
  { label: 'Inventory', icon: Package, path: '/inventory' },
];

const limitedNav = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'Inventory', icon: Package, path: '/inventory' },
];

export default function AppLayout({ children }) {
  const { profile, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = isAdmin ? adminNav : limitedNav;

  async function handleSignOut() {
    await signOut();
    navigate('/auth/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-50 w-64 bg-brand-950 text-white flex flex-col transition-transform duration-200 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500 flex items-center justify-center font-display text-sm font-bold">
              SR
            </div>
            <div>
              <div className="font-display text-lg leading-none">SelRic SA</div>
              <div className="text-[10px] text-brand-300 uppercase tracking-widest mt-0.5">
                College Bar
              </div>
            </div>
          </Link>
          <button className="lg:hidden text-white/60 hover:text-white" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active =
              item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  active
                    ? 'bg-brand-600 text-white shadow-md'
                    : 'text-brand-200 hover:bg-white/8 hover:text-white'
                )}
              >
                <item.icon size={18} />
                {item.label}
                {active && <ChevronRight size={14} className="ml-auto opacity-60" />}
              </Link>
            );
          })}
        </nav>

        {/* User info */}
        <div className="px-3 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold uppercase">
              {profile?.full_name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{profile?.full_name || 'User'}</div>
              <div className="text-[10px] uppercase tracking-wider text-brand-300">
                {profile?.role || 'user'}
              </div>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2 mt-1 w-full rounded-lg text-sm text-brand-300 hover:bg-white/8 hover:text-white transition-all"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-4 px-4 py-3 bg-white border-b border-surface-200">
          <button onClick={() => setSidebarOpen(true)} className="text-surface-600">
            <Menu size={22} />
          </button>
          <div className="font-display text-lg">SelRic SA</div>
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
