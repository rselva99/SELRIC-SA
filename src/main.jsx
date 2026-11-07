import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import { I18nProvider } from './i18n/I18nContext';
import { getProgram } from './programs';
import PinGate from './components/PinGate';
import Spinner from './components/ui/Spinner';

// Every layout and page is its own chunk, fetched the first time it is
// opened: the first load carries only React, the router, Supabase, the
// providers and the gates below. The shells wrap their <Outlet /> in Suspense,
// so moving between pages keeps the sidebar and shows a spinner in the page.
const AppLayout = React.lazy(() => import('./components/layout/AppLayout'));
const CeoLayout = React.lazy(() => import('./components/layout/CeoLayout'));
const LandingPage = React.lazy(() => import('./pages/public/LandingPage'));
const ProgramPage = React.lazy(() => import('./pages/public/ProgramPage'));
const ProgramPendingPage = React.lazy(() => import('./pages/public/ProgramPendingPage'));
const LoginPage = React.lazy(() => import('./pages/auth/LoginPage'));
const SignupPage = React.lazy(() => import('./pages/auth/SignupPage'));
const ForgotPasswordPage = React.lazy(() => import('./pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = React.lazy(() => import('./pages/auth/ResetPasswordPage'));
const DashboardPage = React.lazy(() => import('./pages/dashboard/DashboardPage'));
const BookkeepingPage = React.lazy(() => import('./pages/bookkeeping/BookkeepingPage'));
const ReconciliationPage = React.lazy(() => import('./pages/bookkeeping/ReconciliationPage'));
const AccountsPage = React.lazy(() => import('./pages/accounts/AccountsPage'));
const ReportsPage = React.lazy(() => import('./pages/reports/ReportsPage'));
const SimpleReportsPage = React.lazy(() => import('./pages/reports/SimpleReportsPage'));
const FY2024CorrectedClosePage = React.lazy(() => import('./pages/reports/FY2024CorrectedClosePage'));
const InventoryPage = React.lazy(() => import('./pages/inventory/InventoryPage'));
const ManageUsersPage = React.lazy(() => import('./pages/admin/ManageUsersPage'));
const LedgerPage = React.lazy(() => import('./pages/ledger/LedgerPage'));
const JournalPage = React.lazy(() => import('./pages/journal/JournalPage'));
const TasksPage = React.lazy(() => import('./pages/tasks/TasksPage'));
const DailySalesPage = React.lazy(() => import('./pages/sales/DailySalesPage'));
const SalesPage = React.lazy(() => import('./pages/sales/SalesPage'));
const CustomersPage = React.lazy(() => import('./pages/customers/CustomersPage'));
const AccountantPage = React.lazy(() => import('./pages/accountant/AccountantPage'));
const StatementReviewMatch = React.lazy(() => import('./pages/accountant/StatementReviewMatch'));
const BookBalanceSheetPage = React.lazy(() => import('./pages/accountant/BookBalanceSheetPage'));
const AssetsPage = React.lazy(() => import('./pages/assets/AssetsPage'));
const CashManagementPage = React.lazy(() => import('./pages/cash-management/CashManagementPage'));
const PayrollPage = React.lazy(() => import('./pages/payroll/PayrollPage'));
const TransactionsPage = React.lazy(() => import('./pages/transactions/TransactionsPage'));
const SettingsPage = React.lazy(() => import('./pages/settings/SettingsPage'));
const ChecksPage = React.lazy(() => import('./pages/checks/ChecksPage'));
const CeoPage = React.lazy(() => import('./pages/ceo/CeoPage'));
const SetupPage = React.lazy(() => import('./pages/setup/SetupPage'));
const HerdRoot = React.lazy(() => import('./programs/ganaderia/HerdRoot'));
const GanaderiaHomePage = React.lazy(() => import('./programs/ganaderia/HomePage'));
const AnimalsPage = React.lazy(() => import('./programs/ganaderia/AnimalsPage'));
const AnimalPage = React.lazy(() => import('./programs/ganaderia/AnimalPage'));
const EventsPage = React.lazy(() => import('./programs/ganaderia/EventsPage'));
const LotsPage = React.lazy(() => import('./programs/ganaderia/LotsPage'));
const InformesPage = React.lazy(() => import('./programs/ganaderia/InformesPage'));
import './index.css';

// The Ganadería component kit, for the dev server only: the production build
// replaces import.meta.env.DEV with false and drops the import with it.
const GanaderiaKitPage = import.meta.env.DEV ? React.lazy(() => import('./programs/ganaderia/KitPage')) : null;

// `fullOnly` pages belong to the full accounting package. A workspace in
// simple mode is sent to its Transactions tab instead. While the organization
// is still loading (accountingMode null) nothing is redirected.
// `module` names a portal module (Settings → Your portal); a Simple-mode
// workspace that turned it off is sent to the dashboard.
// `program` is the SelRic program the page belongs to ('business' by default,
// 'ganaderia' for the pages under /ganaderia, null for pages every program
// shares such as Team and Settings). A workspace on another program is sent
// to its own home.
function ProtectedRoute({ children, adminOnly = false, fullOnly = false, module = null, program = 'business' }) {
  const { user, loading, isAdmin, accountingMode, config, primaryProgram, isInternal } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // SelRic's own account has no program; every program page sends it home.
  if (isInternal && program) return <Navigate to="/ceo" replace />;
  if (program && primaryProgram && primaryProgram !== program) return <Navigate to={getProgram(primaryProgram)?.home || '/'} replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/dashboard" replace />;
  if (fullOnly && accountingMode === 'simple') return <Navigate to="/transactions" replace />;
  if (module && accountingMode === 'simple' && config?.modules?.[module] === false) return <Navigate to="/dashboard" replace />;
  return children;
}

// "/" is the public landing page for EVERYONE, signed in or out. Being signed
// in no longer hijacks the front door: the app is reached through /app, or by
// going straight to any of its own paths. Any other app path still bounces a
// visitor to /login as before.
function RootGate() {
  const { user, loading, primaryProgram, isInternal } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (location.pathname === '/') return <LandingPage />;
  if (!user) return <Navigate to="/login" replace />;
  // SelRic itself gets its own shell. No sidebar of programs, because there is
  // no program: there is the company and the pilots it is watching.
  if (isInternal) return <CeoLayout />;
  // A workspace whose program is not built yet gets a holding page instead of
  // the app. Live programs render inside the shared shell; each one's pages
  // live under its own prefix (Business keeps /transactions, /reports…).
  const program = primaryProgram ? getProgram(primaryProgram) : null;
  if (program && !program.built) return <ProgramPendingPage program={program} />;
  return <AppLayout />;
}

// /app — the way in. The public site is the front door; this is the one link
// that takes a signed-in workspace straight to its own program, whichever that
// is, and sends a visitor to sign in first.
function AppEntry() {
  const { user, loading, primaryProgram, accountingMode, config, isAdmin, isInternal } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  const program = primaryProgram ? getProgram(primaryProgram) : null;
  if (program && !program.built) return <ProgramPendingPage program={program} />;
  if (isInternal) return <Navigate to="/ceo" replace />;
  // A Simple-mode Business admin who has not shaped the portal yet does that
  // first (one screen; everything is editable later in Settings → Your portal).
  if ((!program || program.key === 'business') && accountingMode === 'simple' && isAdmin && config && !config.configured) {
    return <Navigate to="/setup" replace />;
  }
  return <Navigate to={program?.home || '/dashboard'} replace />;
}

// /ganaderia/* — the Batavia Ganadería program. One herd context for all its
// pages (HerdRoot); a Business workspace that lands here is sent back to its
// dashboard.
function GanaderiaRoot() {
  return (
    <ProtectedRoute program="ganaderia">
      <HerdRoot />
    </ProtectedRoute>
  );
}

// What a page shows while its chunk arrives.
function PageLoading() {
  return <div className="min-h-screen flex items-center justify-center"><Spinner size="lg" /></div>;
}

// /setup is only for an admin whose Simple-mode workspace is not configured.
function SetupGate() {
  const { user, loading, accountingMode, isAdmin, isInternal } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (isInternal) return <Navigate to="/ceo" replace />;
  if (accountingMode !== 'simple' || !isAdmin) return <Navigate to="/app" replace />;
  return <SetupPage />;
}

// /sales depends on the accounting mode: Simple records each sale with its
// items (stock comes off inventory, money lands in Transactions); Full keeps
// the Daily Sales page (POS totals + analytics).
function SalesRoute() {
  const { accountingMode } = useAuth();
  return accountingMode === 'simple' ? <SalesPage /> : <DailySalesPage />;
}

// /reports likewise: Simple gets the owner's reports (P&L, products, trends,
// customers, inventory, cash); Full keeps the accountant reports page.
function ReportsRoute() {
  const { accountingMode } = useAuth();
  return accountingMode === 'simple' ? <SimpleReportsPage /> : <ReportsPage />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <I18nProvider>
        <DataProvider>
          <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
            <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Public page per program — readable signed in or out. */}
            <Route path="/programs/:key" element={<ProgramPage />} />
            <Route path="/setup" element={<SetupGate />} />
            {/* The one link that goes straight into the app. */}
            <Route path="/app" element={<AppEntry />} />

            <Route path="/" element={<RootGate />}>
              <Route path="dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
              {/* Batavia Ganadería */}
              <Route path="ganaderia" element={<GanaderiaRoot />}>
                <Route index element={<GanaderiaHomePage />} />
                <Route path="animales" element={<AnimalsPage />} />
                <Route path="animales/:slug" element={<AnimalPage />} />
                <Route path="eventos" element={<EventsPage />} />
                <Route path="lotes" element={<LotsPage />} />
                <Route path="informes" element={<InformesPage />} />
                {GanaderiaKitPage && <Route path="_kit" element={<React.Suspense fallback={null}><GanaderiaKitPage /></React.Suspense>} />}
              </Route>
              {/* Full accounting package — hidden (and redirected) in simple mode */}
              <Route path="accountant" element={<ProtectedRoute adminOnly fullOnly><PinGate><AccountantPage /></PinGate></ProtectedRoute>} />
              <Route path="accountant/review-match/:id" element={<ProtectedRoute adminOnly fullOnly><PinGate><StatementReviewMatch /></PinGate></ProtectedRoute>} />
              <Route path="accountant/book-balance-sheet" element={<ProtectedRoute adminOnly fullOnly><PinGate><BookBalanceSheetPage /></PinGate></ProtectedRoute>} />
              <Route path="bookkeeping" element={<ProtectedRoute adminOnly fullOnly><BookkeepingPage /></ProtectedRoute>} />
              <Route path="bookkeeping/reconcile" element={<ProtectedRoute adminOnly fullOnly><ReconciliationPage /></ProtectedRoute>} />
              <Route path="ledger" element={<ProtectedRoute adminOnly fullOnly><LedgerPage /></ProtectedRoute>} />
              <Route path="journal" element={<ProtectedRoute adminOnly fullOnly><JournalPage /></ProtectedRoute>} />
              <Route path="accounts" element={<ProtectedRoute adminOnly fullOnly><AccountsPage /></ProtectedRoute>} />
              <Route path="cash-management" element={<ProtectedRoute adminOnly fullOnly><CashManagementPage /></ProtectedRoute>} />
              <Route path="assets"   element={<ProtectedRoute adminOnly fullOnly><AssetsPage /></ProtectedRoute>} />
              <Route path="payroll" element={<ProtectedRoute adminOnly fullOnly><PayrollPage /></ProtectedRoute>} />
              {/* Simple mode */}
              <Route path="transactions" element={<ProtectedRoute adminOnly><TransactionsPage /></ProtectedRoute>} />
              {/* Both modes — /sales picks the page by mode (see SalesRoute) */}
              <Route path="sales" element={<ProtectedRoute adminOnly module="sales"><SalesRoute /></ProtectedRoute>} />
              <Route path="customers" element={<ProtectedRoute adminOnly module="customers"><CustomersPage /></ProtectedRoute>} />
              <Route path="tasks" element={<ProtectedRoute adminOnly module="tasks"><TasksPage /></ProtectedRoute>} />
              <Route path="reports" element={<ProtectedRoute adminOnly module="reports"><ReportsRoute /></ProtectedRoute>} />
              <Route path="reports/fy2024-corrected" element={<ProtectedRoute adminOnly><FY2024CorrectedClosePage /></ProtectedRoute>} />
              <Route path="checks" element={<ProtectedRoute adminOnly><ChecksPage /></ProtectedRoute>} />
              <Route path="inventory" element={<ProtectedRoute module="inventory"><InventoryPage /></ProtectedRoute>} />
              {/* Shared by every program */}
              <Route path="users" element={<ProtectedRoute adminOnly program={null}><ManageUsersPage /></ProtectedRoute>} />
              <Route path="settings" element={<ProtectedRoute adminOnly program={null}><SettingsPage /></ProtectedRoute>} />
              {/* Cross-workspace oversight for whoever runs SelRic. Belongs to no
                  program; the real gate is in the database, not in this route. */}
              <Route path="ceo/*" element={<ProtectedRoute program={null}><CeoPage /></ProtectedRoute>} />
              {/* /calendar and /marketing were retired on 2026-10-19 — the "*" route below sends old links to the public site. */}
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3500,
              style: { borderRadius: '10px', background: '#1a1a1a', color: '#fff', fontSize: '14px' },
            }}
          />
        </DataProvider>
        </I18nProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
