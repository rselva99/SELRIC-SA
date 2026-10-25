import { useMemo, useState } from 'react';
import { Download, History, Pencil, RotateCcw, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import Spinner from '../../components/ui/Spinner';
import { inline, parseBlocks, resolve, tableFor, TABLE_NAMES, FMT } from '../../lib/ceoDocs.js';
import { GROUPS, PARAM_TYPE, toInput } from '../../lib/ceoFields.js';
import { get } from '../../lib/ceoDocs.js';

// The Documents tab: the three files, read on screen instead of downloaded.
//
// The two Word documents are prose kept in platform_documents as sections of
// markdown with {{tokens}}; every number in them is resolved here from the
// same compute() result the rest of Oversight uses, so the text can never
// disagree with the charts. A section is edited in place and saved as a new
// version of the whole document (append-only, like the assumptions). The
// Financial Model is the Excel's sheets as live tables. Download builds the
// .docx / .xlsx in the browser from what is on screen; the frozen 24 Oct 2026
// files stay in the private bucket, labelled as such.

const DOC_TABS = [['business_plan', 'Business Plan'], ['market_gtm', 'Market Analysis & GTM'], ['model', 'Financial Model'], ['findings', 'Findings & milestones']];
const FROZEN = { business_plan: 'SelRic_Business_Plan.docx', market_gtm: 'SelRic_Market_Analysis_and_GTM.docx', model: 'SelRic_Financial_Model.xlsx' };
const Card = ({ children, className = '' }) => <div className={`rounded-xl border border-surface-200 bg-white ${className}`}>{children}</div>;
const inputCls = 'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500';

const Inline = ({ text }) => inline(text).map((r, i) => (r.bold ? <strong key={i} className="text-surface-900">{r.text}</strong> : r.italic ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>));
function DocTable({ head, rows, align = [] }) {
  const keyValue = head.every((h) => !String(h).trim());
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-surface-200">
      <table className="w-full text-sm">
        {!keyValue && <thead><tr className="bg-surface-50 text-left text-[11px] uppercase tracking-wide text-surface-500">{head.map((h, i) => <th key={i} className={`px-3 py-2 font-semibold ${align[i] === 'r' ? 'text-right' : ''}`}><Inline text={h} /></th>)}</tr></thead>}
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-surface-100 align-top">{r.map((c, j) => <td key={j} className={`px-3 py-2 text-surface-700 ${align[j] === 'r' ? 'text-right font-mono tabular-nums' : ''} ${keyValue && j === 0 ? 'font-medium text-surface-900 w-32' : ''}`}><Inline text={c} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
// A section body rendered: markdown subset, tokens resolved, computed tables inlined.
function Blocks({ body, R, docs }) {
  const r = (t) => resolve(t, R);
  return parseBlocks(body).map((b, i) => {
    if (b.type === 'h3') return <h3 key={i} className="mt-5 mb-1.5 font-display text-lg text-brand-950">{r(b.text)}</h3>;
    if (b.type === 'h4') return <h4 key={i} className="mt-4 mb-1 font-semibold text-surface-900">{r(b.text)}</h4>;
    if (b.type === 'quote') return <blockquote key={i} className="my-3 border-l-4 border-brand-600 pl-4 italic text-surface-600">{r(b.text)}</blockquote>;
    if (b.type === 'ul') return <ul key={i} className="my-2 list-disc pl-6 space-y-1 text-sm text-surface-700">{b.items.map((x, j) => <li key={j}><Inline text={r(x)} /></li>)}</ul>;
    if (b.type === 'ol') return <ol key={i} className="my-2 list-decimal pl-6 space-y-1 text-sm text-surface-700">{b.items.map((x, j) => <li key={j}><Inline text={r(x)} /></li>)}</ol>;
    if (b.type === 'table') return <DocTable key={i} head={b.head.map(r)} rows={b.rows.map((row) => row.map(r))} />;
    if (b.type === 'ttable') { const t = tableFor(b.name, R, docs); return t ? <DocTable key={i} {...t} /> : <p key={i} className="text-red-600 text-sm">⟨table:{b.name}⟩</p>; }
    if (b.type === 'rule') return <hr key={i} className="my-4 border-surface-200" />;
    return <p key={i} className="my-2 text-sm text-surface-700 leading-relaxed"><Inline text={r(b.text)} /></p>;
  });
}

function TokenHelp() {
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

// One editable section: rendered, or a textarea with Save/Cancel.
function Section({ s, R, docs, onSave, busy }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [body, setBody] = useState(s.body);
  const isCover = s.key === '_cover';
  return (
    <section className="rounded-xl border border-surface-200 bg-white px-6 py-5 scroll-mt-6" id={`doc-${s.key}`}>
      <div className="flex items-start justify-between gap-3">
        {isCover ? <h1 className="font-display text-2xl text-brand-950">{resolve(s.title, R)}</h1> : <h2 className="font-display text-xl text-brand-950">{resolve(s.title, R)}</h2>}
        {!editing && <button onClick={() => { setTitle(s.title); setBody(s.body); setEditing(true); }} className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-brand-700 shrink-0"><Pencil size={13} /> Edit</button>}
      </div>
      {editing ? (
        <div className="mt-3">
          <input className={inputCls + ' font-mono text-xs'} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className={inputCls + ' mt-2 font-mono text-xs leading-relaxed'} rows={Math.min(30, Math.max(6, body.split('\n').length + 2))} value={body} onChange={(e) => setBody(e.target.value)} />
          <TokenHelp />
          <div className="mt-2 flex items-center gap-2">
            <button disabled={busy} onClick={async () => { if (await onSave({ ...s, title, body })) setEditing(false); }} className="btn-primary">{busy ? <Spinner size="sm" className="text-white" /> : <><Save size={15} /> Save section</>}</button>
            <button disabled={busy} onClick={() => setEditing(false)} className="btn-secondary"><X size={15} /> Cancel</button>
            <span className="text-xs text-surface-400">Saves the whole document as a new version.</span>
          </div>
          <div className="mt-4 rounded-lg bg-surface-50 px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-surface-500 mb-1">Preview</div><Blocks body={body} R={R} docs={docs} /></div>
        </div>
      ) : <div className={isCover ? 'mt-2 text-surface-600' : 'mt-2'}><Blocks body={s.body} R={R} docs={docs} /></div>}
    </section>
  );
}

function Versions({ rows, current, onRestore, busy }) {
  const [open, setOpen] = useState(false);
  return (<>
    <button onClick={() => setOpen((v) => !v)} className="btn-secondary"><History size={15} /> v{current?.version ?? '—'} · {rows.length} version{rows.length === 1 ? '' : 's'}</button>
    {open && (
      <Card className="mt-3 divide-y divide-surface-100">
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

function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

// The Financial Model: the Excel's sheets as live tables.
function FinancialModel({ R, docs, version }) {
  const meta = R.meta || {};
  const asRows = [];
  for (const g of GROUPS) {
    if (g.list) { (get(R.A, g.list) || []).forEach((it) => g.fields.forEach((f) => { const type = f.type === 'auto' ? PARAM_TYPE[it.param] || 'num' : f.type; asRows.push([g.title, `${it[g.labelFrom]} — ${f.label}`, `${toInput(it[f.path], type)}${type === 'pct' ? '%' : ''}`, f.unit, f.path === 'note' ? '' : it.note || '']); })); continue; }
    for (const f of g.fields) { const v = get(R.A, f.path); const m = meta[f.meta || f.path] || {}; asRows.push([g.title, f.label, f.type === 'bool' ? (v ? 'yes' : 'no') : `${toInput(v, f.type)}${f.type === 'pct' ? '%' : ''}`, f.unit, [m.note, m.source].filter(Boolean).join(' — ')]); }
  }
  const sheets = [
    ['Summary', { head: ['', 'Year 1', 'Year 2', 'Year 3'], rows: [['Customers at year end', ...R.years.map((y) => FMT.num(y.endCustomers))], ['ARR at year end', ...R.years.map((y) => FMT.usd(y.endARR))], ['Revenue', ...R.years.map((y) => FMT.usd(y.revenue))], ['Profit after the draw', ...R.years.map((y) => FMT.usd(y.profit))], ['Cash at year end', ...R.years.map((y) => FMT.usd(y.endCash))], ['Founder draw switches on', R.drawStartsMonth || 'not within the horizon', '', ''], ['Months capped by hours', `${R.capped.count}${R.capped.first ? ` (from ${R.capped.first})` : ''}`, '', '']], align: ['l', 'r', 'r', 'r'] }],
    ['Assumptions', { head: ['Group', 'Input', 'Value', 'Unit', 'Note'], rows: asRows, align: ['l', 'l', 'r', 'l', 'l'] }],
    ['Annual', tableFor('years', R, docs)],
    ['Break-even', tableFor('breakeven', R, docs)],
    ['Scenarios', tableFor('scenarios', R, docs)],
    ['Sensitivity', tableFor('sensitivity', R, docs)],
    ['Market & Tiers — derivation', tableFor('tierDerivation', R, docs)],
    ['Market & Tiers — TAM, SAM, SOM', tableFor('tamSam', R, docs)],
    ['Unit Economics', tableFor('unit', R, docs)],
    ['Monthly', { head: ['Month', 'New (plan)', 'New (allowed)', 'Customers', 'MRR', 'Op. profit pre-draw', 'Draw', 'Cash', 'Hours needed', 'Hours available'], rows: R.monthly.map((m) => [m.label + (m.capped ? ' ·cap' : ''), FMT.num1(m.newPlan), FMT.num1(m.newActual), FMT.num1(m.total), FMT.usd(m.mrr), FMT.usd(m.opBeforeDraw), FMT.usd(m.draw), FMT.usd(m.cash), FMT.num(m.hoursNeeded), FMT.num(m.hoursAvailable)]), align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'] }],
  ];
  return sheets.map(([name, t]) => (
    <section key={name} className="rounded-xl border border-surface-200 bg-white px-5 py-4">
      <h2 className="font-display text-lg text-brand-950">{name}</h2>
      <DocTable {...t} />
    </section>
  ));
}

// Findings (markdown sections) and the plan's milestones and roadmap (rows).
function PlanEditor({ plan, R, onSave, busy }) {
  const [draft, setDraft] = useState(null);
  const d = draft || plan;
  const setM = (i, k, v) => setDraft((x) => { const n = structuredClone(x || plan); n.milestones[i][k] = v; return n; });
  const setR = (i, k, v) => setDraft((x) => { const n = structuredClone(x || plan); n.roadmap[i][k] = v; return n; });
  return (
    <section className="rounded-xl border border-surface-200 bg-white px-6 py-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xl text-brand-950">Milestones and the next twelve months</h2>
        {!draft ? <button onClick={() => setDraft(structuredClone(plan))} className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-brand-700"><Pencil size={13} /> Edit</button>
          : <div className="flex gap-2"><button disabled={busy} onClick={async () => { if (await onSave(draft)) setDraft(null); }} className="btn-primary"><Save size={15} /> Save</button><button onClick={() => setDraft(null)} className="btn-secondary"><X size={15} /></button></div>}
      </div>
      <p className="mt-1 text-xs text-surface-500">Read by the Plan tab, the Business Plan §12 and the Market Analysis §5. A milestone's text may hold tokens; its status comes from the funnel and the pilots.</p>
      <div className="mt-3 divide-y divide-surface-100 rounded-lg border border-surface-200">
        {d.milestones.map((m, i) => (
          <div key={m.key} className="grid grid-cols-[110px_1fr_120px] gap-3 px-3 py-2 text-sm items-center">
            {draft ? <input type="date" className={inputCls + ' font-mono text-xs'} value={m.due} onChange={(e) => setM(i, 'due', e.target.value)} /> : <span className="font-mono text-xs text-surface-500">{m.due}</span>}
            {draft ? <input className={inputCls} value={m.what} onChange={(e) => setM(i, 'what', e.target.value)} /> : <span className="text-surface-800">{resolve(m.what, R)}</span>}
            <span className="text-[11px] text-surface-400 font-mono">{m.metric || 'manual'}{m.target ? ` ≥ ${m.target}${m.per ? '/' + m.per : ''}` : m.targetPath ? ` ≥ ${resolve(`{{${m.targetPath}}}`, R)}` : ''}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 divide-y divide-surface-100 rounded-lg border border-surface-200">
        {d.roadmap.map((r, i) => (
          <div key={r.quarter} className="grid grid-cols-[90px_200px_1fr] gap-3 px-3 py-2 text-sm items-start">
            <span className="font-mono text-surface-500 pt-1.5">{r.quarter}</span>
            {draft ? <input className={inputCls} value={r.focus} onChange={(e) => setR(i, 'focus', e.target.value)} /> : <span className="font-medium text-surface-900 pt-1.5">{r.focus}</span>}
            {draft ? <textarea rows={2} className={inputCls} value={r.actions} onChange={(e) => setR(i, 'actions', e.target.value)} /> : <span className="text-surface-600 pt-1.5">{resolve(r.actions, R)}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function DocumentsPage({ R, docRows, assump, onSaved }) {
  const [tab, setTab] = useState('business_plan');
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const current = (doc) => docRows[doc]?.[0] || null;
  const docs = useMemo(() => ({ findings: current('findings')?.sections || [], plan: current('plan')?.sections || { milestones: [], roadmap: [] } }), [docRows]);

  async function saveDoc(doc, sections, note) {
    setBusy(true);
    const { error } = await supabase.from('platform_documents').insert({ doc, sections, note: note || null });
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success('Saved as a new version'); onSaved?.(); return true;
  }
  const saveSection = (doc) => async (s) => { const row = current(doc); const sections = row.sections.map((x) => (x.key === s.key ? { key: s.key, title: s.title, body: s.body } : x)); return saveDoc(doc, sections, `Edited "${resolve(s.title, R)}"`); };
  const restore = (doc) => (v) => saveDoc(doc, v.sections, `Restored from v${v.version}`);

  async function download(doc) {
    setDownloading(true);
    try {
      const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // local date, not UTC
      if (doc === 'model') {
        const { xlsxBlob, XLSX_FILE } = await import('./exportXlsx.js');
        saveBlob(await xlsxBlob(R, { version: assump.version, docs }), XLSX_FILE.replace('.xlsx', `_${stamp}.xlsx`));
      } else {
        const { docxBlob, DOCX_FILES } = await import('./exportDocx.js');
        const row = current(doc);
        saveBlob(await docxBlob({ sections: row.sections, R, docs, edition: `Downloaded ${stamp} — assumptions v${assump.version}, document v${row.version}` }), DOCX_FILES[doc].replace('.docx', `_${stamp}.docx`));
      }
    } catch (e) { toast.error(e.message); }
    setDownloading(false);
  }
  async function frozen(doc) {
    const { data, error } = await supabase.storage.from('platform-docs').createSignedUrl(FROZEN[doc], 3600);
    if (error || !data?.signedUrl) { toast.error(error?.message || 'Not uploaded'); return; }
    window.open(data.signedUrl, '_blank');
  }

  if (!R) return <Card className="mt-6 p-5 text-sm text-surface-700">The model is not published yet, so there is nothing to resolve the documents against.</Card>;
  const row = tab === 'model' ? null : current(tab);
  const missing = tab !== 'model' && !row;
  return (<>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <nav className="inline-flex rounded-lg border border-surface-200 bg-white p-0.5">
        {DOC_TABS.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 text-sm rounded-md ${tab === k ? 'bg-brand-600 text-white' : 'text-surface-600 hover:text-surface-900'}`}>{label}</button>)}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        {tab !== 'findings' && tab !== 'model' && <Versions rows={docRows[tab] || []} current={row} onRestore={restore(tab)} busy={busy} />}
        {tab !== 'findings' && <button disabled={downloading || missing} onClick={() => download(tab)} className="btn-primary">{downloading ? <Spinner size="sm" className="text-white" /> : <Download size={15} />} Download {tab === 'model' ? '.xlsx' : '.docx'}</button>}
        {FROZEN[tab] && <button onClick={() => frozen(tab)} className="text-xs text-surface-500 hover:text-brand-700 underline underline-offset-2">Frozen 24 Oct 2026 edition</button>}
      </div>
    </div>
    <p className="mt-2 text-xs text-surface-500">{tab === 'model' ? `Every sheet computed live from assumptions v${assump.version}. Download writes the same sheets to Excel.` : `Numbers in the text are resolved live from assumptions v${assump.version}; the prose is document v${row?.version ?? '—'}. Download builds the Word file from exactly this.`}</p>

    {missing ? <Card className="mt-4 p-5 text-sm text-surface-700">This document has not been seeded. Run <code className="font-mono text-xs">node ~/selric-business/publish.mjs</code>.</Card>
      : tab === 'model' ? <div className="mt-4 space-y-3"><FinancialModel R={R} docs={docs} version={assump.version} /></div>
      : tab === 'findings' ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2"><Versions rows={docRows.findings || []} current={current('findings')} onRestore={restore('findings')} busy={busy} /><Versions rows={docRows.plan || []} current={current('plan')} onRestore={restore('plan')} busy={busy} /></div>
          {(current('findings')?.sections || []).map((s) => <Section key={s.key} s={s} R={R} docs={docs} onSave={saveSection('findings')} busy={busy} />)}
          {current('plan') && <PlanEditor plan={current('plan').sections} R={R} onSave={(p) => saveDoc('plan', p, 'Edited milestones / roadmap')} busy={busy} />}
        </div>
      )
      : <div className="mt-4 space-y-3">{row.sections.map((s) => <Section key={s.key} s={s} R={R} docs={docs} onSave={saveSection(tab)} busy={busy} />)}</div>}
  </>);
}
