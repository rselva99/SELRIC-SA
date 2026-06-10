import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency, formatDate } from '../lib/utils';
import {
  capitalizeFromTransaction,
  latestDepreciationPeriodAtOrAfter,
  CLASS_LIVES,
  ASSET_CLASS_OPTIONS,
  DEFAULT_ASSET_CLASS,
  CAPITALIZE_REMINDER_SHORT,
  CAPITALIZE_THRESHOLD,
  PP_AND_E_CATEGORY,
} from '../lib/capitalize';
import Modal from './ui/Modal';
import toast from 'react-hot-toast';
import { Loader2, AlertCircle, ArrowRight } from 'lucide-react';

// Initial in-service date = transaction date. The class default = the class
// whose typical purpose best fits an editable expense (kitchen equipment),
// but the user can pick any class — life updates to match.
function initialForm(txn) {
  return {
    name:           txn?.description?.trim() || '',
    assetClass:     DEFAULT_ASSET_CLASS,
    lifeYears:      String(CLASS_LIVES[DEFAULT_ASSET_CLASS]),
    inServiceDate:  txn?.date || new Date().toISOString().slice(0, 10),
    notes:          txn ? `Capitalized from transaction: ${txn.description || ''} ${txn.date}` : '',
  };
}

export default function CapitalizeModal({ txn, onClose, onCapitalized }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm]   = useState(() => initialForm(txn));
  const [busy, setBusy]   = useState(false);

  // Reset when the source txn changes (modal re-used across rows).
  useEffect(() => { setForm(initialForm(txn)); }, [txn?.id]);

  // Class picker updates default life only when the user hasn't manually
  // edited it for the current class (we always reset life when class changes).
  function changeClass(newClass) {
    setForm(f => ({ ...f, assetClass: newClass, lifeYears: String(CLASS_LIVES[newClass] ?? f.lifeYears) }));
  }

  const cost = Math.abs(Number(txn?.amount || 0));
  const lifeYears = Number(form.lifeYears) || 0;
  const monthly   = lifeYears > 0 ? cost / (lifeYears * 12) : 0;

  const belowThreshold = cost > 0 && cost < CAPITALIZE_THRESHOLD;

  async function submit(e) {
    e.preventDefault();
    if (!txn) return;
    setBusy(true);
    try {
      const { asset, reference } = await capitalizeFromTransaction({ txn, form, userId: user?.id });
      toast.success(`Capitalized ${formatCurrency(cost)} → ${asset.name} (${reference})`);
      // If D&A has already been posted for any month >= the new asset's
      // in-service month, point the user at the catch-up modal so they can
      // re-run with Replace.
      const inServicePeriod = (asset.in_service_date || '').slice(0, 7);
      let latestDA = null;
      if (inServicePeriod) {
        try { latestDA = await latestDepreciationPeriodAtOrAfter(inServicePeriod); } catch {}
      }
      onCapitalized?.({ asset, reference, latestDA });
      onClose();
      if (latestDA) {
        toast((t) => (
          <span className="flex items-center gap-2">
            D&amp;A already posted through {latestDA}.
            <button
              onClick={() => { toast.dismiss(t.id); navigate(`/assets?openDA=replace&through=${latestDA}`); }}
              className="font-semibold text-brand-700 underline"
            >
              Re-run with Replace
            </button>
          </span>
        ), { duration: 8000 });
      }
    } catch (err) {
      toast.error(err.message || 'Capitalize failed');
    } finally {
      setBusy(false);
    }
  }

  if (!txn) return null;

  return (
    <Modal open={!!txn} onClose={busy ? () => {} : onClose} title="Capitalize transaction" size="lg">
      <form onSubmit={submit} className="space-y-4 p-1">
        <div className="rounded-lg border border-surface-100 bg-surface-50 p-3">
          <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Source transaction</div>
          <div className="flex items-baseline justify-between mt-1 gap-3">
            <div className="text-sm font-medium truncate">{txn.description || '—'}</div>
            <div className="font-mono text-sm">{formatCurrency(cost)}</div>
          </div>
          <div className="text-xs text-surface-500 mt-0.5">
            {formatDate(txn.date)} · {txn.category || 'uncategorized'} · the original row is preserved unchanged
          </div>
        </div>

        <ReminderCard tone={belowThreshold ? 'amber' : 'neutral'} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Asset name">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" autoFocus />
          </Field>
          <Field label="Cost">
            <input value={formatCurrency(cost)} disabled className="input-field bg-surface-50 cursor-not-allowed" />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Asset class">
            <select value={form.assetClass} onChange={e => changeClass(e.target.value)} className="input-field">
              {ASSET_CLASS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Life (yrs)">
            <input type="number" min="1" step="0.5" value={form.lifeYears} onChange={e => setForm({ ...form, lifeYears: e.target.value })} className="input-field" />
          </Field>
          <Field label="In-service date">
            <input type="date" value={form.inServiceDate} onChange={e => setForm({ ...form, inServiceDate: e.target.value })} className="input-field" />
          </Field>
        </div>

        <Field label="Notes">
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-field" rows={2} />
        </Field>

        {/* Preview */}
        <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-brand-700 font-semibold">Preview · what will happen</div>
          <ul className="text-sm text-surface-700 space-y-1.5">
            <li className="flex items-start gap-2">
              <ArrowRight size={14} className="mt-0.5 text-brand-600 flex-shrink-0" />
              <span>
                Add asset <span className="font-semibold">{form.name || '—'}</span> to the {form.assetClass} class
                ({Number(form.lifeYears) || 0}-year life, in service {form.inServiceDate || '—'}).
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight size={14} className="mt-0.5 text-brand-600 flex-shrink-0" />
              <span>
                Post a reclass JE dated {form.inServiceDate || txn.date} — <span className="font-mono">DR {PP_AND_E_CATEGORY} {formatCurrency(cost)}</span> · <span className="font-mono">CR {txn.category || 'category'} {formatCurrency(cost)}</span>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ArrowRight size={14} className="mt-0.5 text-brand-600 flex-shrink-0" />
              <span>
                The source transaction stays as-is. Future Generate D&amp;A runs add{' '}
                <span className="font-mono font-semibold">{formatCurrency(monthly)}/month</span> for this asset.
              </span>
            </li>
          </ul>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />}
            Capitalize {formatCurrency(cost)}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// Reusable reminder card — single source of wording.
export function ReminderCard({ tone = 'neutral' }) {
  const cls = tone === 'amber'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-surface-200 bg-surface-50 text-surface-600';
  return (
    <div className={`rounded-lg border ${cls} p-3 text-xs flex items-start gap-2`}>
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0 opacity-80" />
      <span>{CAPITALIZE_REMINDER_SHORT}</span>
    </div>
  );
}
