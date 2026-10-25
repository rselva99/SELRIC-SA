import { useState } from 'react';
import { History, Pencil, RotateCcw, Save, X } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { inline, parseBlocks, resolve, tableFor, TABLE_NAMES, FMT } from '../../lib/ceoDocs.js';

// The pieces a document is drawn with on screen — shared by the Documents tab
// and the Competition page: inline markup, a table, a section body, a section
// with its in-place editor, a version list, and a download helper. Nothing in
// here is prose or a number; all of that arrives in `body`, `R` and `docs`.

export const Card = ({ children, className = '' }) => <div className={`rounded-xl border border-surface-200 bg-white ${className}`}>{children}</div>;
export const inputCls = 'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500';

export const Inline = ({ text }) => inline(text).map((r, i) => (r.bold ? <strong key={i} className="text-surface-900">{r.text}</strong> : r.italic ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>));

export function DocTable({ head, rows, align = [], compact = false }) {
  const keyValue = head.every((h) => !String(h).trim());
  const cellCls = compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm';
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-surface-200">
      <table className="w-full">
        {!keyValue && <thead><tr className="bg-surface-50 text-left text-[11px] uppercase tracking-wide text-surface-500">{head.map((h, i) => <th key={i} className={`${cellCls} font-semibold ${align[i] === 'r' ? 'text-right' : align[i] === 'c' ? 'text-center' : ''}`}><Inline text={h} /></th>)}</tr></thead>}
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-surface-100 align-top">{r.map((c, j) => <td key={j} className={`${cellCls} text-surface-700 ${align[j] === 'r' ? 'text-right font-mono tabular-nums' : align[j] === 'c' ? 'text-center' : ''} ${keyValue && j === 0 ? 'font-medium text-surface-900 w-32' : ''}`}><Inline text={c} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// A section body rendered: markdown subset, tokens resolved, computed tables
// inlined. `skipTables` leaves the {{table:…}} tokens out — the Competition
// page draws those as charts instead.
export function Blocks({ body, R, docs, skipTables = false }) {
  const r = (t) => resolve(t, R);
  return parseBlocks(body).map((b, i) => {
    if (b.type === 'h3') return <h3 key={i} className="mt-5 mb-1.5 font-display text-lg text-brand-950">{r(b.text)}</h3>;
    if (b.type === 'h4') return <h4 key={i} className="mt-4 mb-1 font-semibold text-surface-900">{r(b.text)}</h4>;
    if (b.type === 'quote') return <blockquote key={i} className="my-3 border-l-4 border-brand-600 pl-4 italic text-surface-600">{r(b.text)}</blockquote>;
    if (b.type === 'ul') return <ul key={i} className="my-2 list-disc pl-6 space-y-1 text-sm text-surface-700">{b.items.map((x, j) => <li key={j}><Inline text={r(x)} /></li>)}</ul>;
    if (b.type === 'ol') return <ol key={i} className="my-2 list-decimal pl-6 space-y-1 text-sm text-surface-700">{b.items.map((x, j) => <li key={j}><Inline text={r(x)} /></li>)}</ol>;
    if (b.type === 'table') return <DocTable key={i} head={b.head.map(r)} rows={b.rows.map((row) => row.map(r))} />;
    if (b.type === 'ttable') { if (skipTables) return null; const t = tableFor(b.name, R, docs); return t ? <DocTable key={i} {...t} compact={t.head.length > 8} /> : <p key={i} className="text-red-600 text-sm">⟨table:{b.name}⟩</p>; }
    if (b.type === 'rule') return <hr key={i} className="my-4 border-surface-200" />;
    return <p key={i} className="my-2 text-sm text-surface-700 leading-relaxed"><Inline text={r(b.text)} /></p>;
  });
}

export function TokenHelp() {
  return (
    <details className="mt-2 text-[11px] text-surface-500">
      <summary className="cursor-pointer hover:text-surface-700">Tokens</summary>
      <div className="mt-1 space-y-1 font-mono">
        <div>{'{{years.2.endARR|usd}}  {{affordability.bizNi|pct}}  {{A.churn.steadyMonthly|pct1}}  {{sens.hours.swing|usd}}  {{tiers.1.price|usd}}  {{pilots.total|word}}'}</div>
        <div>formats: {Object.keys(FMT).join(' ')}</div>
        <div>tables: {TABLE_NAMES.map((n) => `{{table:${n}}}`).join(' ')}</div>
      </div>
    </details>
  );
}

// One editable section: rendered, or a textarea with Save/Cancel. `tone`
// 'callout' draws it as a brand-edged note; `skipTables` as in Blocks.
export function Section({ s, R, docs, onSave, busy, tone = 'card', skipTables = false, titleAs }) {
  titleAs = titleAs || (s.level === 3 ? 'h3' : 'h2');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [body, setBody] = useState(s.body);
  const isCover = s.key === '_cover';
  const Title = isCover ? 'h1' : titleAs;
  const cls = tone === 'callout' ? 'rounded-xl border border-brand-200 bg-brand-50/40 border-l-4 border-l-brand-600 px-6 py-5' : 'rounded-xl border border-surface-200 bg-white px-6 py-5';
  return (
    <section className={`${cls} scroll-mt-6`} id={`doc-${s.key}`}>
      <div className="flex items-start justify-between gap-3">
        <Title className={isCover ? 'font-display text-2xl text-brand-950' : titleAs === 'h3' ? 'font-display text-lg text-brand-950' : 'font-display text-xl text-brand-950'}>{resolve(s.title, R)}</Title>
        {!editing && onSave && <button onClick={() => { setTitle(s.title); setBody(s.body); setEditing(true); }} className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-brand-700 shrink-0"><Pencil size={13} /> Edit</button>}
      </div>
      {editing ? (
        <div className="mt-3">
          <input className={inputCls + ' font-mono text-xs'} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={inputCls + ' mt-2 font-mono text-xs leading-relaxed'} rows={Math.min(30, Math.max(6, body.split('\n').length + 2))} value={body} onChange={(e) => setBody(e.target.value)} />
          <TokenHelp />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={async () => { if (await onSave({ ...s, title, body })) setEditing(false); }} className="btn-primary">{busy ? <Spinner size="sm" className="text-white" /> : <><Save size={15} /> Save section</>}</button>
            <button disabled={busy} onClick={() => setEditing(false)} className="btn-secondary"><X size={15} /> Cancel</button>
            <span className="text-xs text-surface-400">Saves the whole document as a new version.</span>
          </div>
          <div className="mt-4 rounded-lg bg-surface-50 px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-surface-500 mb-1">Preview</div><Blocks body={body} R={R} docs={docs} /></div>
        </div>
      ) : <div className={isCover ? 'mt-2 text-surface-600' : 'mt-2'}><Blocks body={s.body} R={R} docs={docs} skipTables={skipTables} /></div>}
    </section>
  );
}

export function Versions({ rows, current, onRestore, busy }) {
  const [open, setOpen] = useState(false);
  return (<>
    <button onClick={() => setOpen((v) => !v)} className="btn-secondary"><History size={15} /> v{current?.version ?? '—'} · {rows.length} version{rows.length === 1 ? '' : 's'}</button>
    {open && (
      <Card className="mt-3 divide-y divide-surface-100 w-full basis-full">
        {rows.map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="font-mono text-surface-900 w-10">v{v.version}</span>
            <span className="font-mono text-xs text-surface-500 w-36">{String(v.created_at).slice(0, 16).replace('T', ' ')}</span>
            <span className="flex-1 text-surface-700 truncate">{v.note || '—'}</span>
            {v.version === current?.version ? <span className="text-xs text-brand-700 font-medium">current</span>
              : <button disabled={busy} onClick={() => { if (confirm(`Restore v${v.version} as a new version?`)) onRestore(v); }} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"><RotateCcw size={13} /> Restore</button>}
          </div>
        ))}
      </Card>
    )}
  </>);
}

export function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
export const localStamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
