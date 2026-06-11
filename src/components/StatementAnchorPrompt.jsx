import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import { Calendar } from 'lucide-react';

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
function pad(n) { return String(n).padStart(2, '0'); }
function lastDayOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

// Asked when both header- and filename-anchor detection fail. Resolves
// with { start, end, source: 'user' } when the user picks; rejects when
// they cancel so the upload aborts cleanly.
export default function StatementAnchorPrompt({ request, fileName, onResolve, onCancel }) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  useEffect(() => {
    if (request) { setYear(now.getFullYear()); setMonth(now.getMonth()); }
  }, [request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!request) return null;

  const start = `${year}-${pad(month + 1)}-01`;
  const end   = `${year}-${pad(month + 1)}-${pad(lastDayOfMonth(year, month))}`;

  return (
    <Modal open title="What period does this statement cover?" onClose={onCancel}>
      <div className="space-y-4 p-1">
        <div className="rounded-lg border border-surface-100 bg-surface-50 p-3 text-xs text-surface-600 flex items-start gap-2">
          <Calendar size={14} className="text-surface-500 mt-0.5 flex-shrink-0" />
          <div>
            We couldn't detect the statement's date range from the PDF header or the filename
            (<span className="font-mono">{fileName || 'unknown'}</span>).
            Pick the month so the extraction can resolve any partial dates correctly.
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Month</label>
            <select value={month} onChange={e => setMonth(+e.target.value)} className="input-field">
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">Year</label>
            <input type="number" value={year} onChange={e => setYear(+e.target.value)} className="input-field" />
          </div>
        </div>
        <div className="text-xs text-surface-500">
          Anchor: <span className="font-mono">{start}</span> → <span className="font-mono">{end}</span>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn-ghost">Cancel upload</button>
          <button
            type="button"
            onClick={() => onResolve({ start, end, source: 'user' })}
            className="btn-primary"
          >
            Use this anchor
          </button>
        </div>
      </div>
    </Modal>
  );
}
