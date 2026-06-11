import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { reopenPeriod } from '../lib/periodLock';
import Modal from './ui/Modal';
import { Loader2, AlertTriangle, Lock } from 'lucide-react';
import toast from 'react-hot-toast';

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function periodLabel(p) {
  if (!p) return '';
  const [y, m] = p.split('-');
  return `${MONTHS_FULL[+m - 1] || m} ${y}`;
}

// Reusable dialog the surfaces a PERIOD_LOCKED trigger error. Two paths:
//   • Reopen and retry — calls reopenPeriod(period), then onRetry()
//   • Cancel           — clears the dialog
// The caller owns the retry behavior so the dialog stays generic. Display
// is read-only when the user lacks admin privileges.
export default function PeriodLockedDialog({ period, onClose, onRetry, isAdmin: isAdminProp }) {
  const { user, isAdmin: isAdminCtx } = useAuth();
  const isAdmin = isAdminProp ?? isAdminCtx;
  const [busy, setBusy] = useState(false);

  if (!period) return null;

  async function handleReopen() {
    setBusy(true);
    try {
      await reopenPeriod(period, user?.id);
      toast.success(`${periodLabel(period)} reopened`);
      // Hand control back to caller so it can retry the original write.
      await onRetry?.();
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Could not reopen period');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!period} onClose={busy ? () => {} : onClose} title="Period closed">
      <div className="space-y-4 p-1">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
          <Lock size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-900">
            <div className="font-semibold">{periodLabel(period)} is closed.</div>
            <div className="text-xs text-amber-800 mt-0.5">
              Closed periods are locked at the database level — the write was rejected.
              Either reopen the period and retry, or pick a different date and try again.
            </div>
          </div>
        </div>

        {!isAdmin && (
          <div className="rounded-lg border border-surface-100 bg-surface-50 p-3 text-xs text-surface-600 flex items-start gap-2">
            <AlertTriangle size={13} className="text-surface-500 mt-0.5 flex-shrink-0" />
            Only an admin can reopen a closed period. Ask the accountant to reopen it from the Accountant page.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          {isAdmin && (
            <button type="button" onClick={handleReopen} disabled={busy} className="btn-primary flex items-center gap-2">
              {busy && <Loader2 size={14} className="animate-spin" />}
              Reopen and retry
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
