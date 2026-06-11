import Modal from './ui/Modal';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { formatStatementPeriod } from '../lib/utils';

// Shown after extraction when >=1 transaction date falls more than the
// configured tolerance outside the statement's anchor period. Three
// possible resolutions:
//   • shift  — apply the shift-year-to-anchor remediation to ALL
//              out-of-range rows and proceed with insert.
//   • insert — proceed with the originally-extracted dates (used when
//              the user is sure the statement legitimately spans into
//              another month/year).
//   • cancel — abort the upload entirely.
export default function DateAnchorWarningModal({
  request,                       // { outOfRange, anchor, totalCount }
  onShift,
  onInsertAsIs,
  onCancel,
}) {
  if (!request) return null;
  const { outOfRange, anchor, totalCount } = request;
  const showRows = (outOfRange || []).slice(0, 6);
  const anchorLabel = formatStatementPeriod(anchor.start, anchor.end) || `${anchor.start} → ${anchor.end}`;

  return (
    <Modal open title="Some dates fall outside the statement period" onClose={onCancel}>
      <div className="space-y-4 p-1">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-900">
            <div className="font-semibold">
              {outOfRange.length} of {totalCount} extracted transaction{totalCount === 1 ? '' : 's'} fall more than 15 days outside the statement period.
            </div>
            <div className="text-xs text-amber-800 mt-1">
              Statement anchor · <span className="font-mono">{anchorLabel}</span>.
              The most common cause is the model resolving a partial date (e.g. "12/05") to the wrong year.
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-surface-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-50 text-[10px] uppercase tracking-wider text-surface-500">
              <tr>
                <th className="px-3 py-1.5 text-left">Date extracted</th>
                <th className="px-3 py-1.5 text-left">Description</th>
                <th className="px-3 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {showRows.map((t, i) => (
                <tr key={i} className="border-t border-surface-50">
                  <td className="px-3 py-1 font-mono text-red-600">{t.date}</td>
                  <td className="px-3 py-1 max-w-xs truncate" title={t.description}>{t.description || '—'}</td>
                  <td className="px-3 py-1 text-right font-mono">{Number(t.amount || 0).toFixed(2)}</td>
                </tr>
              ))}
              {outOfRange.length > showRows.length && (
                <tr><td colSpan={3} className="px-3 py-1.5 text-center text-surface-400">… and {outOfRange.length - showRows.length} more</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost">Cancel upload</button>
          <button type="button" onClick={onInsertAsIs} className="btn-secondary">Insert anyway</button>
          <button type="button" onClick={onShift} className="btn-primary flex items-center gap-2">
            <RotateCcw size={14} /> Shift year to match period
          </button>
        </div>
      </div>
    </Modal>
  );
}
