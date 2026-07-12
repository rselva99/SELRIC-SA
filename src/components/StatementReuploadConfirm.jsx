import Modal from './ui/Modal';
import { AlertTriangle } from 'lucide-react';

// Shown when a bank statement upload targets a period that ALREADY has a
// bank_statements row and imported transactions. The unsafe legacy path
// created a second bank_statements row and inserted every extracted line
// again — silently doubling categorized rows on the P&L. The safe path
// reuses the existing bank_statements id, updates its summary block, and
// inserts only rows the multiplicity-aware dedupe says are genuinely
// missing. This modal makes the user pick one explicitly.
export default function StatementReuploadConfirm({
  open,
  period,
  fileName,
  existingCount,
  categorizedCount,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Re-uploading ${period} — dedupe or cancel?`}
      size="md"
    >
      <div className="space-y-4 p-1">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-900 space-y-2">
            <div>
              <b>{period}</b> already has <b>{existingCount}</b> transaction
              {existingCount === 1 ? '' : 's'} on file
              {categorizedCount > 0 && (
                <> — <b>{categorizedCount}</b> already categorized</>
              )}
              .
            </div>
            <div>
              Continuing will keep the existing <code>bank_statements</code> row
              and every categorized row exactly as-is. Only rows the extractor
              finds that the DB does NOT already hold (matched by <i>date +
              amount + description</i>, per count) will be inserted, uncategorized.
              Legitimate same-day bank multiplicity (two Apple charges on the
              same day, an ATM withdrawal plus its fee twice) is preserved.
            </div>
          </div>
        </div>

        <div className="text-sm text-surface-700">
          File: <code>{fileName || '—'}</code>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="btn-ghost text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-primary text-sm"
          >
            Continue with safe dedupe
          </button>
        </div>
      </div>
    </Modal>
  );
}
