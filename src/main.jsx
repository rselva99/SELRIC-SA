import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import { I18nProvider } from './i18n/I18nContext';
import AppLayout from './components/layout/AppLayout';
import LandingPage from './pages/public/LandingPage';
import ProgramPage from './pages/public/ProgramPage';
import ProgramPendingPage from './pages/public/ProgramPendingPage';
import { getProgram } from './programs';
import LoginPage from './pages/auth/LoginPage';
import SignupPage from './pages/auth/SignupPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import BookkeepingPage from './pages/bookkeeping/BookkeepingPage';
import ReconciliationPage from './pages/bookkeeping/ReconciliationPage';
import AccountsPage from './pages/accounts/AccountsPage';
import ReportsPage from './pages/reports/ReportsPage';
import FY2024CorrectedClosePage from './pages/reports/FY2024CorrectedClosePage';
import InventoryPage from './pages/inventory/InventoryPage';
import ManageUsersPage from './pages/admin/ManageUsersPage';
import LedgerPage from './pages/ledger/LedgerPage';
import JournalPage from './pages/journal/JournalPage';
import TasksPage from './pages/tasks/TasksPage';
import DailySalesPage from './pages/sales/DailySalesPage';
import SalesPage from './pages/sales/SalesPage';
import CustomersPage from './pages/customers/CustomersPage';
import AccountantPage from './pages/accountant/AccountantPage';
import StatementReviewMatch from './pages/accountant/StatementReviewMatch';
import BookBalanceSheetPage from './pages/accountant/BookBalanceSheetPage';
import AssetsPage from './pages/assets/AssetsPage';
import CashManagementPage from './pages/cash-management/CashManagementPage';
import PayrollPage from './pages/payroll/PayrollPage';
import TransactionsPage from './pages/transactions/TransactionsPage';
import SettingsPage from './pages/settings/SettingsPage';
import PinGate from './components/PinGate';
import './index.css';

// `fullOnly` pages belong to the full accounting package. A workspace in
// simple mode is sent to its Transactions tab instead. While the organization
// is still loading (accountingMode null) nothing is redirected.
function ProtectedRoute({ children, adminOnly = false, fullOnly = false }) {
  const { user, loading, isAdmin, accountingMode } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  if (fullOnly && accountingMode === 'simple') return <Navigate to="/transactions" replace />;
  return children;
}

// "/" is the public landing page for visitors and the app for signed-in users.
// Any other app path still bounces a visitor to /login as before.
function RootGate() {
  const { user, loading, primaryProgram } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (!user) {
    return location.pathname === '/' ? <LandingPage /> : <Navigate to="/login" replace />;
  }
  // A workspace whose program is not built yet (a Ganadería pilot invite used
  // before phase 2 ships) gets a holding page instead of the Business app.
  const program = primaryProgram ? getProgram(primaryProgram) : null;
  if (program && program.status !== 'live') return <ProgramPendingPage program={program} />;
  return <AppLayout />;
}

// /sales depends on the accounting mode: Simple records each sale with its
// items (stock comes off inventory, money lands in Transactions); Full keeps
// the Daily Sales page (POS totals + analytics).
function SalesRoute() {
  const { accountingMode } = useAuth();
  return accountingMode === 'simple' ? <SalesPage /> : <DailySalesPage />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <I18nProvider>
        <DataProvider>
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
            <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {/* Public page per program — readable signed in or out. */}
            <Route path="/programs/:key" element={<ProgramPage />} />

            <Route path="/" element={<RootGate />}>
              <Route index element={<DashboardPage />} />
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
              <Route path="sales" element={<ProtectedRoute adminOnly><SalesRoute /></ProtectedRoute>} />
              <Route path="customers" element={<ProtectedRoute adminOnly><CustomersPage /></ProtectedRoute>} />
              <Route path="tasks" element={<ProtectedRoute adminOnly><TasksPage /></ProtectedRoute>} />
              <Route path="reports" element={<ProtectedRoute adminOnly><ReportsPage /></ProtectedRoute>} />
              <Route path="reports/fy2024-corrected" element={<ProtectedRoute adminOnly><FY2024CorrectedClosePage /></ProtectedRoute>} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="users" element={<ProtectedRoute adminOnly><ManageUsersPage /></ProtectedRoute>} />
              <Route path="settings" element={<ProtectedRoute adminOnly><SettingsPage /></ProtectedRoute>} />
              {/* /calendar and /marketing were retired on 2026-10-19 — the "*" route below sends old links to the dashboard. */}
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
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
