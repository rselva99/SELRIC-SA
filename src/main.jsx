import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import BookkeepingPage from './pages/bookkeeping/BookkeepingPage';
import ReconciliationPage from './pages/bookkeeping/ReconciliationPage';
import AccountsPage from './pages/accounts/AccountsPage';
import ReportsPage from './pages/reports/ReportsPage';
import InventoryPage from './pages/inventory/InventoryPage';
import ManageUsersPage from './pages/admin/ManageUsersPage';
import LedgerPage from './pages/ledger/LedgerPage';
import JournalPage from './pages/journal/JournalPage';
import TasksPage from './pages/tasks/TasksPage';
import CalendarPage from './pages/calendar/CalendarPage';
import MarketingPage from './pages/marketing/MarketingPage';
import DailySalesPage from './pages/sales/DailySalesPage';
import './index.css';

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
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
        <DataProvider>
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="bookkeeping" element={<ProtectedRoute adminOnly><BookkeepingPage /></ProtectedRoute>} />
              <Route path="bookkeeping/reconcile" element={<ProtectedRoute adminOnly><ReconciliationPage /></ProtectedRoute>} />
              <Route path="ledger" element={<ProtectedRoute adminOnly><LedgerPage /></ProtectedRoute>} />
              <Route path="journal" element={<ProtectedRoute adminOnly><JournalPage /></ProtectedRoute>} />
              <Route path="sales" element={<ProtectedRoute adminOnly><DailySalesPage /></ProtectedRoute>} />
              <Route path="calendar" element={<ProtectedRoute adminOnly><CalendarPage /></ProtectedRoute>} />
              <Route path="tasks" element={<ProtectedRoute adminOnly><TasksPage /></ProtectedRoute>} />
              <Route path="marketing" element={<ProtectedRoute adminOnly><MarketingPage /></ProtectedRoute>} />
              <Route path="accounts" element={<ProtectedRoute adminOnly><AccountsPage /></ProtectedRoute>} />
              <Route path="reports" element={<ProtectedRoute adminOnly><ReportsPage /></ProtectedRoute>} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="users" element={<ProtectedRoute adminOnly><ManageUsersPage /></ProtectedRoute>} />
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
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
