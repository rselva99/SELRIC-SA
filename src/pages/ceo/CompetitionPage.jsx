import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip } from 'recharts';
import { Download, Pencil, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import Spinner from '../../components/ui/Spinner';
import { useT } from '../../i18n/I18nContext';
import { resolve } from '../../lib/ceoDocs.js';
import { ladderRows, stats, matrix, sortByFeature, featureTotal } from '../../lib/ceoCompetition.js';
import { C, usd, NumAxisX, CatAxisY, useNarrow, ChartCard } from './charts';
import { Card, Section, Versions, Blocks, DocTable, saveBlob, localStamp } from './docParts';
import CompetitorForm from './CompetitorForm';

// Competition — the field, for the eye. Prose and the competitor dataset come
// from the `competition` document (platform_documents); our own prices come
// from the model, so the ladders move when the Model tab does. Two markets,
// each: a KPI strip, the price ladder, the feature matrix, the two columns of
// cards, the implications as a callout — the document's sections in between,
// editable in place like every other document.

const MARKETS = ['business', 'ganaderia'];
const money = (n) => (n == null ? '—' : n === 0 ? '$0' : Number.isInteger(n) ? usd(n) : '$' + n.toFixed(2));

// ── KPI strip ───────────────────────────────────────────────────────────────
function Kpis({ S, T }) {
  const tile = (label, value, sub) => (
    <div className="rounded-xl bg-white border border-surface-200 p-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-surface-500">{label}</div>
      <div className="mt-1.5 font-display text-2xl leading-none text-surface-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-surface-500">{sub}</div>}
    </div>
  );
  const ours = S.ticks.length > 1 ? S.ticks.map((x) => usd(x.price)).join(' / ') : money(S.ours);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <div className="rounded-xl bg-brand-50 border border-brand-200 p-3.5 col-span-2 lg:col-span-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-brand-800">{T('ours')}</div>
        <div className="mt-1.5 font-display text-2xl leading-none text-brand-950">{ours}</div>
        <div className="mt-1 text-xs text-brand-800">{S.ticks.length > 1 ? T('byHerd') : T('perMonth')} · {T('fromModel')}</div>
      </div>
      {tile(T('medianEntry'), money(S.medianEntry), T('perMonth'))}
      {tile(T('medianComparable'), money(S.medianComparable), T('perMonth'))}
      {tile(T('cheaper'), S.cheaper ?? '—', T('ofTotal', { n: S.total }))}
      {tile(T('freeTier'), S.freeTier, T('ofTotal', { n: S.total }))}
    </div>
  );
}

// ── Price ladder ────────────────────────────────────────────────────────────
// Horizontal bars of every competitor's comparable price; the light marker is
// the entry price; SelRic in the brand colour with its tiers as ticks. The log
// toggle puts AgriWebb and the free tiers on one readable axis.
function LadderTip({ active, payload, T }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const max = Math.max(...(r.tiers || []).map((t) => t.usdMonth || 0), 1);
  return (
    <div className="rounded-lg border border-surface-200 bg-white px-3 py-2 shadow-card text-xs max-w-[260px]">
      <div className="font-medium text-surface-900">{r.name}</div>
      <div className="text-surface-500">{r.region}{r.model ? ` · ${r.model}` : ''}</div>
      <div className="mt-1.5 flex gap-3"><span><span className="font-semibold text-surface-900 tabular-nums">{money(r.comparable)}</span> <span className="text-surface-500">{T('comparable')}</span></span><span><span className="font-semibold text-surface-900 tabular-nums">{money(r.entry)}</span> <span className="text-surface-500">{T('entry')}</span></span></div>
      {r.note && <div className="mt-0.5 text-surface-500">{r.note}</div>}
      {r.tiers?.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-surface-400">{T('tiers')}</div>
          {r.tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-24 truncate text-surface-600">{t.name}</span>
              <span className="flex-1 h-2 rounded-sm bg-surface-100 overflow-hidden"><span className="block h-full rounded-sm" style={{ width: `${Math.max(2, ((t.usdMonth || 0) / max) * 100)}%`, background: r.self ? C.brand : C.gray }} /></span>
              <span className="w-14 text-right font-mono tabular-nums text-surface-800">{money(t.usdMonth)}</span>
              {t.users ? <span className="w-12 text-surface-400">{t.users} {T('perUsers')}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Ladder({ rows, log, T, narrow, onLog, title, hint }) {
  const positives = rows.flatMap((r) => [r.comparable, r.entry, ...r.ticks.map((x) => x.price)]).filter((v) => v > 0);
  const floor = Math.max(0.5, Math.min(...positives) / 2), max = Math.max(...positives);
  // Only what the chart needs: recharts hands every data field to the bar shape as a prop.
  const data = rows.map((r) => ({ key: r.key, name: r.name, self: r.self, region: r.region, model: r.model, note: r.note, entry: r.entry, comparable: r.comparable, ticks: r.ticks, tiers: r.tiers, value: r.comparable == null ? null : log ? Math.max(r.comparable, floor) : r.comparable }));
  // The marker positions are derived from the bar's own geometry, so they hold on both scales.
  const px = (bar, v, r) => { const base = r.value || floor; if (v == null || v <= 0 || base <= 0) return null; const f = log ? Math.log(v / floor) / Math.log(base / floor) : v / base; return bar.x + bar.width * Math.max(0, Math.min(1.6, f)); };
  // LabelList hands the bar's geometry and index; the row comes from `data`.
  const Marks = (p) => {
    const r = p.payload || data[p.index]; if (!r) return null;
    const cy = p.y + p.height / 2;
    const label = r.comparable == null ? T('na') : r.comparable === 0 ? T('free') : money(r.comparable);
    const out = [<text key="v" x={p.x + p.width + 6} y={cy + 3.5} fontSize={10} fill={C.text}>{label}</text>];
    // Tier ticks alternate above and below the bar so close prices do not overprint.
    if (r.comparable == null) return <g><text x={p.x + 6} y={cy + 3.5} fontSize={10} fill={C.text}>{label}</text></g>;
    if (r.self) r.ticks.forEach((tk, i) => { const x = px(p, tk.price, r); if (x != null) out.push(<g key={'t' + i}><line x1={x} x2={x} y1={p.y - 3} y2={p.y + p.height + 3} stroke={C.ink} strokeWidth={2} /><text x={x} y={i % 2 ? p.y + p.height + 11 : p.y - 5} fontSize={9} textAnchor="middle" fill={C.text}>{usd(tk.price)}</text></g>); });
    else if (r.entry != null && r.entry !== r.comparable) { const x = px(p, r.entry, r); if (x != null) out.push(<circle key="e" cx={x} cy={cy} r={4} fill="#fff" stroke={C.gray} strokeWidth={2} />); else out.push(<text key="e0" x={p.x + 2} y={p.y - 4} fontSize={9} fill={C.text}>{T('entry')}: {T('free')}</text>); }
    return <g>{out}</g>;
  };
  const fmtMoney = (v) => (v == null ? T('na') : v === 0 ? T('free') : money(v));
  return (
    <ChartCard title={title} hint={hint} height={30 * rows.length + 28}
      legend={[{ label: T('selric'), color: C.brand }, { label: T('comparable'), color: C.gray }, { label: T('entry'), color: C.gray, kind: 'dot' }]}
      right={<div className="inline-flex rounded-lg border border-surface-200 overflow-hidden text-xs shrink-0">{[[false, T('linear')], [true, T('log')]].map(([v, l]) => <button key={l} onClick={() => onLog(v)} className={`px-2.5 py-1 ${log === v ? 'bg-surface-100 text-surface-900 font-medium' : 'text-surface-500 hover:text-surface-800'}`}>{l}</button>)}</div>}
      table={{ cols: [{ key: 'name', label: T('competitor'), fmt: (s) => s, right: false }, { key: 'region', label: T('region'), fmt: (s) => s || '—', right: false }, { key: 'entry', label: T('entry'), fmt: fmtMoney }, { key: 'comparable', label: T('comparable'), fmt: fmtMoney }, { key: 'note', label: T('comparableNote'), fmt: (s) => s || '', right: false }], rows }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 14, right: 64, left: 4, bottom: 0 }} barCategoryGap={6}>
          {NumAxisX({ fmt: usd, scale: log ? 'log' : 'linear', domain: log ? [floor, max * 1.5] : [0, max * 1.12], allowDataOverflow: true, hide: true })}
          {CatAxisY({ width: narrow ? 118 : 180 })}
          <Tooltip content={<LadderTip T={T} />} cursor={{ fill: C.grid, opacity: 0.5 }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
            {data.map((r) => <Cell key={r.key} fill={r.self ? C.brand : C.gray} />)}
            <LabelList dataKey="value" content={<Marks />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ── Feature matrix ──────────────────────────────────────────────────────────
const CELL = ['bg-surface-50 text-surface-300', 'bg-brand-200 text-brand-900', 'bg-brand-600 text-white'];
const GLYPH = ['○', '◐', '●'];
function Matrix({ M, T }) {
  const [sortKey, setSortKey] = useState(null);
  const rows = useMemo(() => sortByFeature(M.rows, sortKey), [M, sortKey]);
  const groupLabel = { infra: T('groupInfra'), market: T('groupMarket'), ours: T('groupOurs') };
  const groupTone = { infra: 'bg-surface-100 text-surface-600', market: 'bg-brand-50 text-brand-800', ours: 'bg-brand-100 text-brand-900' };
  return (
    <div className="overflow-x-auto rounded-lg border border-surface-200">
      <table className="text-xs border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left font-medium text-surface-500 border-b border-surface-200" rowSpan={2}>{sortKey ? <button onClick={() => setSortKey(null)} className="text-brand-700 hover:underline">{T('clearSort')}</button> : ''}</th>
            {M.groups.map((g, i) => <th key={g.key} colSpan={g.features.length} className={`px-2 py-1 text-[10px] uppercase tracking-wider font-semibold ${groupTone[g.key]} ${i > 0 ? 'border-l-2 border-white' : ''}`}>{groupLabel[g.key]}</th>)}
            <th className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold bg-surface-100 text-surface-600 border-l-2 border-white" rowSpan={2}>{T('total')}</th>
          </tr>
          <tr>
            {M.groups.flatMap((g, gi) => g.features.map((f, fi) => (
              <th key={f.key} className={`align-bottom px-0.5 pb-1.5 pt-2 border-b border-surface-200 ${gi > 0 && fi === 0 ? 'border-l-2 border-l-white' : ''}`}>
                <button onClick={() => setSortKey(f.key === sortKey ? null : f.key)} title={f.label} className={`block mx-auto h-[92px] w-5 text-[10px] leading-none ${sortKey === f.key ? 'font-semibold text-brand-800' : 'text-surface-600 hover:text-surface-900'}`} style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{f.label.length > 22 ? f.label.slice(0, 21) + '…' : f.label}</button>
              </th>
            )))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.self ? 'bg-brand-50/60' : ''}>
              <td className={`sticky left-0 z-10 px-3 py-1 whitespace-nowrap border-b border-surface-100 ${r.self ? 'bg-brand-50 font-semibold text-brand-950' : 'bg-white text-surface-800'}`}>{r.name}</td>
              {M.groups.flatMap((g, gi) => g.features.map((f, fi) => { const v = r.scores[f.key] ?? 0; return <td key={f.key} className={`p-0.5 border-b border-surface-100 ${gi > 0 && fi === 0 ? 'border-l-2 border-l-white' : ''}`}><div className={`w-6 h-6 mx-auto rounded-sm flex items-center justify-center text-[11px] ${CELL[v]}`} title={`${r.name} — ${f.label}: ${v}`}>{GLYPH[v]}</div></td>; }))}
              <td className="px-2 py-1 text-center font-mono tabular-nums text-surface-700 border-b border-surface-100 border-l-2 border-l-white">{featureTotal(r, M.groups)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Cards: where they beat us / where we differ ─────────────────────────────
function Bullets({ title, rows, field, tone }) {
  const items = rows.filter((r) => !r.self && (r[field] || []).length);
  return (
    <Card className="p-4">
      <div className={`text-sm font-medium ${tone === 'red' ? 'text-red-800' : 'text-brand-900'}`}>{title}</div>
      <div className="mt-2 space-y-2">
        {items.map((r) => (
          <div key={r.key} className="text-xs">
            <div className="font-medium text-surface-800">{r.name}</div>
            <ul className="mt-0.5 flex flex-wrap gap-1">{r[field].map((b, i) => <li key={i} className={`rounded-full px-2 py-0.5 ${tone === 'red' ? 'bg-red-50 text-red-800' : 'bg-brand-50 text-brand-800'}`}>{b}</li>)}</ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── The page ────────────────────────────────────────────────────────────────
export default function CompetitionPage({ R, docRows, docs, assump, onSaved, embedded = false }) {
  const { t, lang } = useT();
  const T = (k, vars) => t(`ceoComp.${k}`, vars);
  const narrow = useNarrow();
  const [log, setLog] = useState({ business: false, ganaderia: true });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const row = docRows.competition?.[0] || null;
  const dataset = docs?.competition || null;
  const prose = useMemo(() => (row?.sections || []).filter((s) => s.kind !== 'json'), [row]);
  const sec = (key) => prose.find((s) => s.key === key);
  const byMarket = useMemo(() => Object.fromEntries(MARKETS.map((m) => [m, dataset?.[m] ? { S: stats(dataset[m], R), rows: ladderRows(dataset[m], R), M: matrix(dataset[m], lang) } : null])), [dataset, R, lang]);

  async function saveDoc(sections, note) {
    setBusy(true);
    const { error } = await supabase.from('platform_documents').insert({ doc: 'competition', sections, note: note || null });
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success(T('saved')); onSaved?.(); return true;
  }
  const saveSection = async (s) => saveDoc(row.sections.map((x) => (x.key === s.key ? { ...x, title: s.title, body: s.body } : x)), `Edited "${resolve(s.title, R)}"`);
  const saveDataset = async (data, note) => { const ok = await saveDoc(row.sections.map((x) => (x.kind === 'json' ? { ...x, data } : x)), note); if (ok) setEditing(false); };
  const restore = (v) => saveDoc(v.sections, `Restored from v${v.version}`);
  async function download() {
    setDownloading(true);
    try { const { docxBlob, DOCX_FILES } = await import('./exportDocx.js'); saveBlob(await docxBlob({ sections: row.sections, R, docs, edition: `Downloaded ${localStamp()} — assumptions v${assump?.version ?? '—'}, document v${row.version}` }), DOCX_FILES.competition.replace('.docx', `_${localStamp()}.docx`)); } catch (e) { toast.error(e.message); }
    setDownloading(false);
  }
  async function frozen() { const { data, error } = await supabase.storage.from('platform-docs').createSignedUrl('SelRic_Competition.docx', 3600); if (error || !data?.signedUrl) { toast.error(error?.message || '—'); return; } window.open(data.signedUrl, '_blank'); }

  if (!row || !dataset) return <Card className="mt-6 p-5 text-sm text-surface-700">{T('notSeeded')} <code className="font-mono text-xs">node ~/selric-business/publish.mjs</code></Card>;
  const sectionProps = { R, docs, onSave: saveSection, busy };
  return (<>
    <div className="mt-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {!embedded && <h2 className="font-display text-2xl text-brand-950">{T('title')}</h2>}
        <p className="mt-1 text-sm text-surface-600 max-w-[70ch]">{T('intro')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Versions rows={docRows.competition || []} current={row} onRestore={restore} busy={busy} />
        <button onClick={() => setEditing(true)} className="btn-secondary"><Pencil size={15} /> {T('editDataset')}</button>
        <button disabled={downloading} onClick={download} className="btn-primary">{downloading ? <Spinner size="sm" className="text-white" /> : <Download size={15} />} {T('download')}</button>
        <button onClick={frozen} className="text-xs text-surface-500 hover:text-brand-700 underline underline-offset-2">{T('frozen')}</button>
      </div>
    </div>

    <div className="mt-4 space-y-4">
      {sec('_cover') && <Section s={sec('_cover')} {...sectionProps} />}
      {sec('inventory') && <Section s={sec('inventory')} {...sectionProps} />}

      {MARKETS.map((m) => {
        const X = byMarket[m]; if (!X) return null;
        return (
          <div key={m} className="space-y-4" id={`comp-${m}`}>
            <div className="flex items-baseline gap-3 pt-4"><h3 className="font-display text-xl text-brand-950">{T(m)}</h3><span className="text-xs text-surface-500">{X.S.total} {T('competitor').toLowerCase()}s</span></div>
            <Kpis S={X.S} T={T} />
            <Ladder rows={X.rows} log={log[m]} onLog={(v) => setLog((s) => ({ ...s, [m]: v }))} T={T} narrow={narrow} title={T('ladder')} hint={T('ladderHint')} />
            {sec(`${m}-field`) && <Section s={sec(`${m}-field`)} {...sectionProps} skipTables titleAs="h3" />}
            <Card className="p-4">
              <div className="font-medium text-surface-900">{T('matrix')}</div>
              <div className="mt-0.5 text-xs text-surface-500">{T('matrixHint')}</div>
              <div className="mt-3"><Matrix M={X.M} T={T} /></div>
            </Card>
            <div className="grid md:grid-cols-2 gap-3">
              <Bullets title={T('beatUs')} rows={X.rows} field="betterAtUs" tone="red" />
              <Bullets title={T('differ')} rows={X.rows} field="weakerThanUs" tone="green" />
            </div>
            {sec(`${m}-better`) && <Section s={sec(`${m}-better`)} {...sectionProps} titleAs="h3" />}
            {sec(`${m}-different`) && <Section s={sec(`${m}-different`)} {...sectionProps} skipTables titleAs="h3" />}
            {sec(`${m}-implications`) && (
              <div className="space-y-2">
                <Section s={sec(`${m}-implications`)} {...sectionProps} tone="callout" titleAs="h3" />
                {m === 'ganaderia' && <Link to="/ceo/model" className="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline"><SlidersHorizontal size={14} /> {T('runScenario')}</Link>}
              </div>
            )}
          </div>
        );
      })}

      {sec('summary') && <Section s={sec('summary')} {...sectionProps} tone="callout" />}
      <Card className="p-4">
        <div className="font-medium text-surface-900">{T('sources')}</div>
        <DocTable compact head={[T('product'), T('source'), T('checked')]} rows={MARKETS.flatMap((m) => (dataset[m]?.competitors || []).map((c) => [c.name, c.source || '', c.checked || '']))} align={['l', 'l', 'l']} />
      </Card>
      {sec('sources') && <Section s={sec('sources')} {...sectionProps} />}
    </div>

    {editing && <CompetitorForm dataset={dataset} onSave={saveDataset} onClose={() => setEditing(false)} busy={busy} />}
  </>);
}
