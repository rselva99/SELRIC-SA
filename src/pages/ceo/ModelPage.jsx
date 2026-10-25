import { useMemo, useState } from 'react';
import { History, RotateCcw, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import Spinner from '../../components/ui/Spinner';
import { compute } from '../../lib/ceoModel.js';
import { get } from '../../lib/ceoDocs.js';
import { GROUPS, PARAM_TYPE, fromInput, setPath, toInput } from '../../lib/ceoFields.js';
import { usd, num } from './charts';

// The Model tab: every assumption the engine runs on, editable, versioned.
//
// Nothing is stored but the assumptions object; every number on every other
// tab is computed from the newest version at load. A save is a new row in
// platform_assumptions (append-only — the version number comes from the
// trigger); Restore is a save of an old row's data. While a draft is being
// edited the strip at the top recomputes the headline numbers from it, so a
// change is seen before it is saved.

const Card = ({ children, className = '' }) => <div className={`rounded-xl border border-surface-200 bg-white ${className}`}>{children}</div>;
const inputCls = 'w-full rounded-lg border border-surface-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500';

function Field({ f, draft, setDraft, errors }) {
  const type = f.type;
  const v = get(draft, f.path);
  const metaKey = f.meta || f.path;
  const note = draft.meta?.[metaKey]?.note ?? '';
  const src = draft.meta?.[metaKey]?.source;
  const bad = errors[f.path];
  const set = (raw) => { const parsed = fromInput(raw, type); setDraft((d) => ({ ...setPath(d, f.path, parsed ?? raw), __raw: { ...(d.__raw || {}), [f.path]: raw } })); };
  const raw = draft.__raw?.[f.path];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_96px] gap-3 items-start px-4 py-2.5 border-t border-surface-100">
      <div className="min-w-0">
        <div className="text-sm text-surface-800">{f.label}</div>
        <input aria-label={`${f.label} — note`} className="mt-1 w-full bg-transparent text-xs text-surface-500 focus:outline-none focus:text-surface-800 placeholder:text-surface-300" placeholder="why this number" value={note}
          onChange={(e) => setDraft((d) => ({ ...d, meta: { ...(d.meta || {}), [metaKey]: { ...(d.meta?.[metaKey] || {}), note: e.target.value } } }))} />
        {src && <div className="text-[11px] text-surface-400">Source: {src}</div>}
      </div>
      <div>
        {type === 'bool' ? <input type="checkbox" aria-label={f.label} checked={!!v} onChange={(e) => set(e.target.checked)} className="mt-2 accent-brand-600" />
          : <input aria-label={f.label} className={`${inputCls} ${bad ? 'border-red-400 bg-red-50' : ''}`} value={raw ?? toInput(v, type)} readOnly={f.readonly} onChange={(e) => set(e.target.value)} />}
        {bad && <div className="text-[11px] text-red-600 mt-0.5">{type === 'ramp' ? 'four numbers: m1, m12, m24, m36' : 'not a number'}</div>}
      </div>
      <div className="text-xs text-surface-500 pt-2">{f.unit}</div>
    </div>
  );
}

function ListGroup({ g, draft, setDraft, errors }) {
  const items = get(draft, g.list) || [];
  return items.map((it, i) => (
    <div key={i} className="border-t border-surface-100 px-4 py-2.5">
      <div className="text-sm font-medium text-surface-900">{it[g.labelFrom]}{it.param ? <span className="ml-2 text-xs font-normal text-surface-500">moves {it.param}</span> : null}</div>
      <div className="mt-1 grid sm:grid-cols-2 gap-3">
        {g.fields.map((f) => {
          const path = `${g.list}.${i}.${f.path}`;
          const type = f.type === 'auto' ? PARAM_TYPE[it.param] || 'num' : f.type;
          const raw = draft.__raw?.[path]; const bad = errors[path];
          return (
            <label key={f.path} className="block">
              <span className="text-xs text-surface-500">{f.label}{f.unit ? ` · ${f.unit}` : ''}</span>
              <input aria-label={`${it[g.labelFrom]} — ${f.label}`} className={`${inputCls} mt-0.5 ${bad ? 'border-red-400 bg-red-50' : ''}`} value={raw ?? toInput(it[f.path], type)}
                onChange={(e) => { const parsed = fromInput(e.target.value, type); setDraft((d) => ({ ...setPath(d, path, parsed ?? e.target.value), __raw: { ...(d.__raw || {}), [path]: e.target.value } })); }} />
            </label>
          );
        })}
      </div>
    </div>
  ));
}

export default function ModelPage({ assump, versions, onSaved }) {
  const [draft, setDraft] = useState(null);     // null = not editing
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const data = draft || assump?.data;

  // Validation: a field whose raw text does not parse keeps its raw string in
  // the draft, which is what the engine must never see.
  const errors = useMemo(() => {
    const e = {}; if (!draft) return e;
    for (const g of GROUPS) {
      if (g.list) { (get(draft, g.list) || []).forEach((it, i) => { for (const f of g.fields) { const type = f.type === 'auto' ? PARAM_TYPE[it.param] || 'num' : f.type; const v = it[f.path]; if (type !== 'text' && type !== 'bool' && (v === null || (typeof v === 'string' && type !== 'month'))) e[`${g.list}.${i}.${f.path}`] = true; } }); continue; }
      for (const f of g.fields) { const v = get(draft, f.path); if (f.type === 'text' || f.type === 'bool' || f.type === 'month') continue; if (v === null || typeof v === 'string' || (f.type === 'ramp' && !Array.isArray(v))) e[f.path] = true; }
    }
    return e;
  }, [draft]);
  const valid = Object.keys(errors).length === 0;
  const preview = useMemo(() => { if (!draft || !valid) return null; try { const { __raw, ...clean } = draft; return compute(clean); } catch { return null; } }, [draft, valid]);
  const current = useMemo(() => (assump ? compute(assump.data) : null), [assump]);

  async function save(dataToSave, noteText) {
    setBusy(true);
    const { error } = await supabase.from('platform_assumptions').insert({ data: dataToSave, note: noteText || null });
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success('Saved as a new version'); setDraft(null); setNote(''); onSaved?.(); return true;
  }
  const { __raw, ...clean } = draft || {};

  if (!assump) {
    return (
      <Card className="mt-6 p-5 text-sm text-surface-700 leading-relaxed">
        <span className="font-medium text-surface-900">No assumptions published yet.</span> Run <code className="font-mono text-xs">migrations/2026-10-24-platform-model.sql</code>, then <code className="font-mono text-xs">node ~/selric-business/publish.mjs</code>, and refresh.
      </Card>
    );
  }

  const delta = (k, f = usd) => preview && current ? <span className="font-mono">{f(current[k])} → <span className={preview[k] === current[k] ? 'text-surface-500' : 'text-brand-800 font-semibold'}>{f(preview[k])}</span></span> : null;
  return (<>
    <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
      <p className="text-sm text-surface-600 max-w-[70ch]">Every input the model runs on, grouped the way the Excel groups them. Change one, read the strip, save it as a version with a note. Nothing else is stored: every number on every tab is recomputed from the newest version.</p>
      <div className="flex gap-2 shrink-0">
        <button onClick={() => setShowVersions((v) => !v)} className="btn-secondary"><History size={15} /> v{assump.version} · {versions.length} version{versions.length === 1 ? '' : 's'}</button>
        {!draft && <button onClick={() => setDraft(structuredClone(assump.data))} className="btn-primary">Edit</button>}
      </div>
    </div>

    {showVersions && (
      <Card className="mt-4 divide-y divide-surface-100">
        {versions.map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="font-mono text-surface-900 w-10">v{v.version}</span>
            <span className="font-mono text-xs text-surface-500 w-36">{String(v.created_at).slice(0, 16).replace('T', ' ')}</span>
            <span className="flex-1 text-surface-700 truncate">{v.note || '—'}</span>
            {v.version === assump.version ? <span className="text-xs text-brand-700 font-medium">current</span>
              : <button disabled={busy} onClick={() => { if (confirm(`Restore v${v.version} as a new version?`)) save(v.data, `Restored from v${v.version}`); }} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"><RotateCcw size={13} /> Restore</button>}
          </div>
        ))}
      </Card>
    )}

    {draft && (
      <div className="sticky top-0 z-10 mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="font-medium text-brand-900">Draft</span>
          {preview ? (<>
            <span className="text-surface-700">Year-3 ARR {delta('years', (x) => usd(x[2].endARR))}</span>
            <span className="text-surface-700">customers {delta('years', (x) => num(x[2].endCustomers))}</span>
            <span className="text-surface-700">founder paid from <span className="font-mono">{current.drawStartsMonth || '—'} → <span className={preview.drawStartsMonth === current.drawStartsMonth ? 'text-surface-500' : 'text-brand-800 font-semibold'}>{preview.drawStartsMonth || '—'}</span></span></span>
            <span className="text-surface-700">break-even {delta('breakeven', (b) => num(b.fixedPlusHelp, 1))}</span>
          </>) : <span className="text-red-700">{valid ? 'The engine could not run this draft.' : 'Fix the fields marked in red.'}</span>}
        </div>
        <div className="mt-2 flex gap-2">
          <input aria-label="Version note" className={inputCls + ' font-sans'} placeholder="Why this version — e.g. Ganadería mid tier to $80 after the Batavia call" value={note} onChange={(e) => setNote(e.target.value)} />
          <button disabled={busy || !valid || !preview} onClick={() => save(clean, note)} className="btn-primary shrink-0">{busy ? <Spinner size="sm" className="text-white" /> : <><Save size={15} /> Save as v{assump.version + 1}</>}</button>
          <button disabled={busy} onClick={() => { setDraft(null); setNote(''); }} className="btn-secondary shrink-0"><X size={15} /></button>
        </div>
      </div>
    )}

    <div className="mt-4 grid xl:grid-cols-2 gap-3 items-start">
      {GROUPS.map((g) => (
        <Card key={g.key} className={g.list ? 'xl:col-span-2' : ''}>
          <div className="px-4 py-3"><div className="font-medium text-surface-900">{g.title}</div>{data.meta?.[g.key]?.note && <div className="text-xs text-surface-500 mt-0.5">{data.meta[g.key].note}</div>}</div>
          {g.list ? <ListGroup g={g} draft={draft || data} setDraft={draft ? setDraft : () => {}} errors={errors} />
            : g.fields.map((f) => draft ? <Field key={f.path} f={f} draft={draft} setDraft={setDraft} errors={errors} />
              : (
                <div key={f.path} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_96px] gap-3 items-start px-4 py-2.5 border-t border-surface-100">
                  <div className="min-w-0"><div className="text-sm text-surface-800">{f.label}</div>{data.meta?.[f.meta || f.path]?.note && <div className="text-xs text-surface-500">{data.meta[f.meta || f.path].note}{data.meta[f.meta || f.path].source ? ` — ${data.meta[f.meta || f.path].source}` : ''}</div>}</div>
                  <div className="font-mono text-sm text-surface-900 pt-0.5">{f.type === 'bool' ? (get(data, f.path) ? 'yes' : 'no') : toInput(get(data, f.path), f.type)}{f.type === 'pct' ? '%' : ''}</div>
                  <div className="text-xs text-surface-500 pt-1">{f.unit}</div>
                </div>
              ))}
        </Card>
      ))}
    </div>
  </>);
}
