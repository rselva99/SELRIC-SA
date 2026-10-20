import { useAuth } from '../contexts/AuthContext';
import { useT } from '../i18n/I18nContext';
import { formatDate, cn } from '../lib/utils';

// Custom fields (Settings → Your portal → Your own fields) as they appear on
// a form and on a row. The definitions come from config.fields[entity]; the
// values live in the row's `extra` jsonb. See lib/workspaceConfig.js.

// The definitions for one entity ('products' | 'customers' | 'sales').
export function useFields(entity) {
  const { config } = useAuth();
  return config?.fields?.[entity] || [];
}

// One value, as text. '' when empty.
export function formatExtra(def, value) {
  if (value == null || value === '') return '';
  if (def.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 3 }) : String(value);
  }
  if (def.type === 'date') {
    try { return formatDate(String(value).slice(0, 10)); } catch { return String(value); }
  }
  return String(value);
}

// Inputs for every definition. `value` is the draft `extra` object; `onChange`
// receives the next one. Lays out in a grid so it drops into any form.
export function ExtraFieldInputs({ fields, value, onChange, idPrefix = 'xf', cols = 'sm:grid-cols-2 lg:grid-cols-3 gap-3', className, labelClass = 'block text-xs font-semibold text-surface-600 mb-1.5', inputClass = 'input-field' }) {
  const { t } = useT();
  if (!fields?.length) return null;
  const extra = value && typeof value === 'object' ? value : {};
  const set = (key, v) => onChange({ ...extra, [key]: v });
  return (
    <div className={cn('grid grid-cols-1', cols, className)}>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const v = extra[f.key] ?? '';
        return (
          <div key={f.key}>
            <label htmlFor={id} className={labelClass}>{f.label}</label>
            {f.type === 'list' ? (
              <select id={id} value={v} onChange={(e) => set(f.key, e.target.value)} className={inputClass}>
                <option value="">{t('portal.pickOne')}</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                {v && !(f.options || []).includes(v) && <option value={v}>{v}</option>}
              </select>
            ) : f.type === 'number' ? (
              <input id={id} type="number" inputMode="decimal" step="any" value={v} onChange={(e) => set(f.key, e.target.value)} className={inputClass} />
            ) : f.type === 'date' ? (
              <input id={id} type="date" value={v} onChange={(e) => set(f.key, e.target.value)} className={inputClass} />
            ) : (
              <input id={id} type="text" value={v} onChange={(e) => set(f.key, e.target.value)} className={inputClass} maxLength={200} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// The filled-in values on a row. `tiles` matches the Inventory detail grid;
// `inline` is a compact "Label: value · Label: value" line for list rows.
export function ExtraFieldValues({ fields, value, variant = 'inline', className }) {
  const extra = value && typeof value === 'object' ? value : {};
  const shown = (fields || []).map((f) => [f, formatExtra(f, extra[f.key])]).filter(([, s]) => s !== '');
  if (!shown.length) return null;
  if (variant === 'tiles') {
    return shown.map(([f, s]) => (
      <div key={f.key} className={cn('bg-white rounded-lg p-2 border border-surface-100', className)}>
        <p className="text-[10px] text-surface-400 uppercase tracking-wider leading-none truncate">{f.label}</p>
        <p className="text-sm font-medium mt-0.5 truncate" title={s}>{s}</p>
      </div>
    ));
  }
  return (
    <div className={cn('flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-surface-500', className)}>
      {shown.map(([f, s]) => (
        <span key={f.key} className="truncate max-w-[14rem]" title={`${f.label}: ${s}`}>
          <span className="text-surface-400">{f.label}:</span> <span className="text-surface-700">{s}</span>
        </span>
      ))}
    </div>
  );
}
