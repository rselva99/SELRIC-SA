import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, ArrowRight, Beef, Briefcase, CalendarClock, ChevronRight, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import Spinner from '../../components/ui/Spinner';

// The sales funnel, for the people who run SelRic. Two motions, one table:
//   • United States — the founder reaching out to businesses, one at a time
//   • Nicaragua     — a field agent gathering ranches for Batavia
// Each region gets its own funnel and its own benchmark, because a cold email
// to a St. Louis restaurant and a visit to a finca are not the same sale.
//
// Benchmarks are from published 2025–2026 B2B SaaS data (vendor blogs, not
// audited sets — treated as bands, not targets). Where no benchmark exists,
// the page says so instead of inventing one. The agent's own numbers become
// the Nicaragua benchmark once there are enough of them.

const STAGES = [
  { key: 'lead',      label: 'Lead',      hint: 'Identified. Nobody has spoken to them yet.' },
  { key: 'contacted', label: 'Contacted', hint: 'Reached out — email, call, visit — and waiting or talking.' },
  { key: 'demo',      label: 'Demo',      hint: 'They saw the product with their own kind of data.' },
  { key: 'pilot',     label: 'Pilot',     hint: 'Using it, free. The real test.' },
  { key: 'paying',    label: 'Paying',    hint: 'Invoiced and paid.' },
];
const LOST = { key: 'lost', label: 'Lost' };
// Weighted pipeline: how much of a lead's monthly price to count at each stage.
const WEIGHT = { lead: 0.05, contacted: 0.1, demo: 0.35, pilot: 0.6, paying: 1 };

// Published bands, with the source stated. Reply ≠ meeting ≠ close — each
// benchmark below names which one it is.
const BENCH = {
  us: {
    title: 'United States — founder-led outbound',
    motion: 'Cold email and calls to restaurants and Latino-owned businesses, plus referrals from Humphrey\'s.',
    steps: {
      contacted: { low: 0.03, high: 0.08, what: 'reply rate on cold outreach', src: 'B2B SaaS cold email 2025: 3–8% replies, blended 5.8% (Digital Bloom; Cleverly). SMB founders answer more often — 10–18% in one dataset, at lower meeting quality.' },
      demo:      { low: 0.01, high: 0.03, what: 'meetings booked per contact', src: 'Meetings per 100 sends: 1–2 (Digital Bloom); 1–3% of emails sent (SalesHive).' },
      pilot:     { low: 0.30, high: 0.50, what: 'demo → trial, sales-assisted', src: 'Orbix 2026 stage benchmarks; one source puts demo → closed at 15–20% for strong SDRs.' },
      paying:    { low: 0.15, high: 0.25, what: 'trial → paid, sales-assisted', src: 'Sales-assisted trial-to-paid 15–25% vs 3–5% self-serve (Orbix); median 18.5% (Prospeo).' },
    },
    cycle: '14–45 days from first contact to close for deals under $5k ACV (SaaStr; Glyphic). Cycles have lengthened 20–30% since 2021 (Boomerang).',
  },
  ni: {
    title: 'Nicaragua — agent-led, in the field',
    motion: 'A trusted person visits the finca, shows the herd on a phone, and comes back. Referral between ranchers is the second channel.',
    steps: {
      contacted: { low: null, high: null, what: 'visits that turn into a conversation', src: 'No published benchmark for agent-led agtech sales in Central America. McKinsey 2026: trusted advisers are central to farm purchase decisions — one Latin America data point at 89%. The agent\'s own rate becomes the benchmark.' },
      demo:      { low: null, high: null, what: 'conversations that see the product', src: 'Unmeasured. Record every visit; after 30 the number is real.' },
      pilot:     { low: 0.30, high: 0.50, what: 'demo → trial', src: 'Borrowed from the sales-assisted SaaS band; an in-person demo should sit at the top of it or above.' },
      paying:    { low: 0.15, high: 0.25, what: 'trial → paid', src: 'Sales-assisted band. Farmers want proof before paying (AgDaily; AgFunder): the pilot IS the proof.' },
    },
    cycle: 'Unmeasured. Expect longer than the US — a calving season is the natural trial length.',
  },
};
const SOURCES = [
  'The Digital Bloom — Cold Email Reply-Rate Benchmarks 2025',
  'Cleverly — Cold Email Strategy for B2B SaaS 2026',
  'SalesHive — B2B Digital Marketing Benchmarks 2026',
  'Orbix — B2B SaaS Conversion Rate Benchmarks 2026',
  'Prospeo — SaaS Sales Conversion Rates 2026 by ACV',
  'SaaStr; Glyphic; Boomerang — sales cycle length by ACV',
  'McKinsey — Global Farmer Insights 2026; AgFunder; AgDaily — agtech adoption',
];

const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const tierPrice = (head) => (head == null ? 50 : head > 200 ? 100 : head > 100 ? 75 : 50);
const monthly = (l) => (l.program === 'ganaderia' ? tierPrice(l.head_count) : 100);

const EMPTY = { region: 'us', program: 'business', name: '', contact: '', phone: '', email: '', head_count: '', source: 'outbound', referred_by: '', owner: 'founder', next_action: '', next_action_at: '', notes: '' };

// ── small pieces ────────────────────────────────────────────────────────────
const Card = ({ children, className = '' }) => <div className={`rounded-xl border border-surface-200 bg-white ${className}`}>{children}</div>;
const Field = ({ label, children, hint }) => (
  <label className="block"><span className="block text-xs font-medium text-surface-600 mb-1">{label}</span>{children}{hint && <span className="block text-[11px] text-surface-400 mt-1">{hint}</span>}</label>
);
const inputCls = 'w-full rounded-lg border border-surface-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500';

function FunnelColumn({ region, leads, onPick }) {
  const B = BENCH[region];
  const byStage = Object.fromEntries(STAGES.map((s) => [s.key, leads.filter((l) => l.stage === s.key)]));
  const lost = leads.filter((l) => l.stage === 'lost');
  // "Reached or passed" counts: a paying lead was also contacted, demoed, piloted.
  const order = STAGES.map((s) => s.key);
  const reached = (k) => leads.filter((l) => l.stage !== 'lost' && order.indexOf(l.stage) >= order.indexOf(k)).length + lost.filter((l) => order.indexOf(lastStage(l)) >= order.indexOf(k)).length;
  const max = Math.max(1, reached('lead'));
  const weighted = leads.filter((l) => l.stage !== 'lost').reduce((s, l) => s + monthly(l) * WEIGHT[l.stage], 0);
  const mrr = byStage.paying.reduce((s, l) => s + monthly(l), 0);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="font-medium text-surface-900">{B.title}</div><div className="mt-0.5 text-xs text-surface-500 leading-snug max-w-[46ch]">{B.motion}</div></div>
        <div className="text-right shrink-0"><div className="font-mono text-lg text-surface-900">{usd(mrr)}<span className="text-xs text-surface-500">/mo</span></div><div className="text-[11px] text-surface-500">paying · weighted {usd(weighted)}</div></div>
      </div>
      <div className="mt-4 space-y-2">
        {STAGES.map((s, i) => {
          const n = reached(s.key), here = byStage[s.key].length;
          const prev = i === 0 ? null : reached(STAGES[i - 1].key);
          const conv = prev ? n / prev : null;
          const b = B.steps[s.key];
          const inBand = b && b.low != null && conv != null && prev >= 5 ? (conv >= b.low ? (conv <= b.high ? 'in' : 'above') : 'below') : null;
          return (
            <div key={s.key}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-surface-800">{s.label} <span className="text-surface-400 text-xs">· {here} here</span></span>
                <span className="font-mono text-xs text-surface-600">{n} reached{conv != null && prev ? ` · ${pct(conv)} of ${STAGES[i - 1].label.toLowerCase()}` : ''}</span>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-surface-100 overflow-hidden"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(n / max) * 100}%` }} /></div>
              {b && (
                <div className="mt-1 flex items-center gap-2 text-[11px]">
                  <span className="text-surface-500">benchmark {b.low == null ? 'none published' : `${pct(b.low)}–${pct(b.high)}`} <span className="text-surface-400">({b.what})</span></span>
                  {inBand && <span className={`rounded-full px-1.5 py-0.5 font-medium ${inBand === 'in' ? 'bg-brand-50 text-brand-800' : inBand === 'above' ? 'bg-brand-100 text-brand-900' : 'bg-amber-50 text-amber-800'}`}>{inBand === 'in' ? 'in band' : inBand === 'above' ? 'above band' : 'below band'}</span>}
                  {!inBand && prev != null && prev < 5 && prev > 0 && <span className="text-surface-400">too few to compare</span>}
                </div>
              )}
            </div>
          );
        })}
        <div className="pt-1 flex items-baseline justify-between text-sm border-t border-surface-100">
          <span className="text-surface-500">Lost</span><span className="font-mono text-xs text-surface-600">{lost.length}</span>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-surface-500 leading-snug"><span className="font-medium text-surface-600">Cycle:</span> {B.cycle}</p>
      <div className="mt-3 space-y-1">
        {leads.filter((l) => l.stage !== 'lost').sort((a, b) => order.indexOf(b.stage) - order.indexOf(a.stage)).slice(0, 8).map((l) => (
          <button key={l.id} onClick={() => onPick(l)} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-50">
            {l.program === 'ganaderia' ? <Beef size={13} className="text-surface-400 shrink-0" /> : <Briefcase size={13} className="text-surface-400 shrink-0" />}
            <span className="flex-1 truncate text-surface-800">{l.name}</span>
            <span className="text-[11px] text-surface-500">{STAGES.find((s) => s.key === l.stage)?.label}</span>
            <ChevronRight size={13} className="text-surface-300" />
          </button>
        ))}
      </div>
    </Card>
  );
}
// For a lost lead, the furthest stage it reached before being lost.
function lastStage(l) { return l._lastStage || 'lead'; }

function LeadDrawer({ lead, events, onClose, onSave, onDelete }) {
  const [f, setF] = useState(lead);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(lead); }, [lead]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const isNew = !lead.id;
  async function save(extra = {}) {
    setBusy(true);
    const row = { ...f, ...extra, head_count: f.head_count === '' || f.head_count == null ? null : Number(f.head_count), next_action_at: f.next_action_at || null };
    for (const k of ['contact', 'phone', 'email', 'referred_by', 'next_action', 'notes', 'lost_reason']) if (row[k] === '') row[k] = null;
    delete row._lastStage; delete row.h;
    const ok = await onSave(row);
    setBusy(false);
    if (ok && isNew) onClose();
  }
  const mine = events.filter((e) => e.lead_id === lead.id);
  const daysHere = lead.stage_changed_at ? daysBetween(lead.stage_changed_at.slice(0, 10), today()) : null;
  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-white shadow-modal overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-surface-200 px-5 py-3.5 flex items-center justify-between">
          <div className="font-display text-lg text-brand-950">{isNew ? 'New lead' : f.name}</div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-surface-400 hover:bg-surface-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {!isNew && (
            <div>
              <div className="text-xs font-medium text-surface-600 mb-1.5">Stage{daysHere != null && <span className="text-surface-400 font-normal"> · {daysHere}d here</span>}</div>
              <div className="flex flex-wrap gap-1.5">
                {[...STAGES, LOST].map((s) => (
                  <button key={s.key} disabled={busy} onClick={() => { setF((x) => ({ ...x, stage: s.key })); if (s.key !== 'lost') save({ stage: s.key }); }}
                    className={`rounded-full px-3 py-1 text-xs font-medium border ${f.stage === s.key ? (s.key === 'lost' ? 'bg-red-600 text-white border-red-600' : 'bg-brand-600 text-white border-brand-600') : 'bg-white text-surface-700 border-surface-300 hover:border-surface-500'}`}>{s.label}</button>
                ))}
              </div>
              {f.stage === 'lost' && (
                <div className="mt-2 flex gap-2">
                  <input className={inputCls} placeholder="Why — the actual reason, in their words" value={f.lost_reason || ''} onChange={set('lost_reason')} />
                  <button disabled={busy} onClick={() => save({ stage: 'lost' })} className="btn-secondary shrink-0">Mark lost</button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Region"><select className={inputCls} value={f.region} onChange={set('region')}><option value="us">United States</option><option value="ni">Nicaragua</option></select></Field>
            <Field label="Program"><select className={inputCls} value={f.program} onChange={set('program')}><option value="business">Business</option><option value="ganaderia">Ganadería</option></select></Field>
          </div>
          <Field label={f.program === 'ganaderia' ? 'Finca' : 'Business'}><input className={inputCls} value={f.name} onChange={set('name')} placeholder={f.program === 'ganaderia' ? 'Finca San José' : 'The Corner Bakery'} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact"><input className={inputCls} value={f.contact || ''} onChange={set('contact')} /></Field>
            <Field label="Phone"><input className={inputCls} value={f.phone || ''} onChange={set('phone')} /></Field>
          </div>
          <Field label="Email"><input className={inputCls} value={f.email || ''} onChange={set('email')} /></Field>
          {f.program === 'ganaderia' && <Field label="Head of cattle" hint={`Decides the tier: ≤100 $50 · 101–200 $75 · >200 $100 — this one would be ${usd(tierPrice(f.head_count === '' ? null : Number(f.head_count)))}/mo`}><input type="number" min="0" className={inputCls} value={f.head_count ?? ''} onChange={set('head_count')} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source"><select className={inputCls} value={f.source} onChange={set('source')}>{['referral', 'outbound', 'event', 'agent', 'inbound', 'other'].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="Owner" hint="founder, or the agent's name"><input className={inputCls} value={f.owner} onChange={set('owner')} /></Field>
          </div>
          {f.source === 'referral' && <Field label="Referred by"><input className={inputCls} value={f.referred_by || ''} onChange={set('referred_by')} placeholder="Which customer made the introduction" /></Field>}
          <div className="grid grid-cols-[1fr_150px] gap-3">
            <Field label="Next action"><input className={inputCls} value={f.next_action || ''} onChange={set('next_action')} placeholder="Call back after the auction" /></Field>
            <Field label="By"><input type="date" className={inputCls} value={f.next_action_at || ''} onChange={set('next_action_at')} /></Field>
          </div>
          <Field label="Notes"><textarea rows={3} className={inputCls} value={f.notes || ''} onChange={set('notes')} /></Field>
          <div className="flex items-center justify-between pt-2">
            {!isNew ? <button disabled={busy} onClick={() => { if (confirm(`Delete ${f.name}? This cannot be undone.`)) onDelete(lead.id); }} className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:underline"><Trash2 size={14} /> Delete</button> : <span />}
            <button disabled={busy || !f.name.trim()} onClick={() => save()} className="btn-primary">{busy ? <Spinner size="sm" className="text-white" /> : isNew ? 'Add lead' : 'Save'}</button>
          </div>
          {!isNew && mine.length > 0 && (
            <div className="pt-3 border-t border-surface-100">
              <div className="text-xs font-medium text-surface-600 mb-1.5">History</div>
              <ul className="space-y-1 text-xs text-surface-600">{mine.map((e) => <li key={e.id} className="font-mono">{String(e.at).slice(0, 10)} · {e.from_stage ? `${e.from_stage} → ` : ''}{e.to_stage}{e.note ? ` — ${e.note}` : ''}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function FunnelPage() {
  const [leads, setLeads] = useState(null);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(null);     // a lead, or EMPTY for new

  async function load() {
    setError('');
    const [l, e] = await Promise.all([
      supabase.from('platform_leads').select('*').order('stage_changed_at', { ascending: false }),
      supabase.from('platform_lead_events').select('*').order('at', { ascending: true }),
    ]);
    if (l.error) { setError(l.error.message); setLeads([]); return; }
    const ev = e.data || [];
    // The furthest stage a lost lead reached, so it still counts in the funnel.
    const order = STAGES.map((s) => s.key);
    const furthest = {};
    for (const x of ev) if (x.to_stage !== 'lost') { const i = order.indexOf(x.to_stage); if (i > (furthest[x.lead_id] ?? -1)) furthest[x.lead_id] = i; }
    setLeads((l.data || []).map((x) => ({ ...x, _lastStage: order[furthest[x.id] ?? 0] })));
    setEvents(ev);
  }
  useEffect(() => { load(); }, []);

  async function save(row) {
    const { id, created_at, updated_at, stage_changed_at, ...rest } = row;
    const q = id ? supabase.from('platform_leads').update(rest).eq('id', id) : supabase.from('platform_leads').insert(rest);
    const { error: e } = await q;
    if (e) { toast.error(e.message.includes('platform_leads_name_program_idx') ? 'That name already exists for this program.' : e.message); return false; }
    toast.success(id ? 'Saved' : 'Lead added');
    await load();
    if (id) setPicked((p) => (p ? { ...p, ...rest } : p));
    return true;
  }
  async function remove(id) {
    const { error: e } = await supabase.from('platform_leads').delete().eq('id', id);
    if (e) { toast.error(e.message); return; }
    toast.success('Deleted'); setPicked(null); await load();
  }

  const us = useMemo(() => (leads || []).filter((l) => l.region === 'us'), [leads]);
  const ni = useMemo(() => (leads || []).filter((l) => l.region === 'ni'), [leads]);
  const week = useMemo(() => {
    const limit = new Date(); limit.setDate(limit.getDate() + 7);
    const lim = limit.toISOString().slice(0, 10);
    return (leads || []).filter((l) => l.stage !== 'lost' && l.stage !== 'paying' && l.next_action_at && l.next_action_at <= lim).sort((a, b) => a.next_action_at.localeCompare(b.next_action_at));
  }, [leads]);
  const stale = useMemo(() => (leads || []).filter((l) => !['lost', 'paying'].includes(l.stage) && !l.next_action_at && daysBetween(l.stage_changed_at.slice(0, 10), today()) > 14), [leads]);
  const velocity = useMemo(() => {
    // Median days from first event to 'paying', over leads that got there.
    const byLead = {};
    for (const e of events) (byLead[e.lead_id] ||= []).push(e);
    const d = Object.values(byLead).map((es) => { const first = es[0], paid = es.find((x) => x.to_stage === 'paying'); return paid ? daysBetween(first.at, paid.at) : null; }).filter((x) => x != null).sort((a, b) => a - b);
    return d.length ? d[Math.floor(d.length / 2)] : null;
  }, [events]);

  if (leads === null) return <div className="p-10 flex justify-center"><Spinner /></div>;
  if (error) {
    const missing = /platform_leads/.test(error) && /not find|does not exist|schema cache/.test(error);
    return (
      <Card className="mt-6 p-5 flex gap-3 items-start">
        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm text-surface-700 leading-relaxed">{missing ? <><span className="font-medium text-surface-900">The funnel table is not there yet.</span> Run <code className="font-mono text-xs">migrations/2026-10-24-platform-leads.sql</code> in the SQL Editor and refresh.</> : error}</div>
      </Card>
    );
  }

  return (
    <>
      <div className="mt-6 flex items-start justify-between gap-4">
        <p className="text-sm text-surface-600 max-w-[70ch]">Two funnels, because a cold email to a St. Louis restaurant and a visit to a finca are different sales. Each is compared to a published band where one exists, and says so where one does not. Click a lead to move it.</p>
        <div className="flex gap-2 shrink-0">
          <button onClick={load} className="btn-secondary"><RefreshCw size={15} /></button>
          <button onClick={() => setPicked({ ...EMPTY })} className="btn-primary"><Plus size={15} /> Lead</button>
        </div>
      </div>

      {(week.length > 0 || stale.length > 0) && (
        <Card className="mt-4 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-surface-900"><CalendarClock size={16} className="text-brand-700" /> This week</div>
          <div className="mt-2 divide-y divide-surface-100">
            {week.map((l) => (
              <button key={l.id} onClick={() => setPicked(l)} className="w-full flex items-center gap-3 py-2 text-left text-sm hover:bg-surface-50 rounded-lg px-1">
                <span className={`font-mono text-xs ${l.next_action_at < today() ? 'text-red-600 font-semibold' : 'text-surface-500'}`}>{l.next_action_at}</span>
                <span className="font-medium text-surface-900">{l.name}</span>
                <span className="flex-1 truncate text-surface-600">{l.next_action}</span>
                <ArrowRight size={14} className="text-surface-300" />
              </button>
            ))}
            {stale.map((l) => (
              <button key={l.id} onClick={() => setPicked(l)} className="w-full flex items-center gap-3 py-2 text-left text-sm hover:bg-surface-50 rounded-lg px-1">
                <span className="font-mono text-xs text-amber-700">no next step</span>
                <span className="font-medium text-surface-900">{l.name}</span>
                <span className="flex-1 truncate text-surface-600">{daysBetween(l.stage_changed_at.slice(0, 10), today())} days in {l.stage} with nothing scheduled</span>
                <ArrowRight size={14} className="text-surface-300" />
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-4 grid lg:grid-cols-2 gap-4">
        <FunnelColumn region="us" leads={us} onPick={setPicked} />
        <FunnelColumn region="ni" leads={ni} onPick={setPicked} />
      </div>

      <div className="mt-4 grid sm:grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-surface-500">Open leads</div><div className="mt-1 font-display text-2xl">{leads.filter((l) => !['lost', 'paying'].includes(l.stage)).length}</div><div className="text-xs text-surface-500">{leads.filter((l) => l.stage === 'lost').length} lost · {leads.filter((l) => l.stage === 'paying').length} paying</div></Card>
        <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-surface-500">Median days to paying</div><div className="mt-1 font-display text-2xl">{velocity ?? '—'}</div><div className="text-xs text-surface-500">{velocity == null ? 'Nobody has paid yet. The clock starts at the first invoice.' : 'from first touch, over closed leads'}</div></Card>
        <Card className="p-4"><div className="text-[11px] uppercase tracking-wide text-surface-500">Referrals in the funnel</div><div className="mt-1 font-display text-2xl">{leads.filter((l) => l.source === 'referral' && l.stage !== 'lost').length}</div><div className="text-xs text-surface-500">The sensitivity work says this is the number to grow.</div></Card>
      </div>

      <Card className="mt-4 p-4">
        <div className="text-sm font-medium text-surface-900">How the Nicaragua agent fits</div>
        <p className="mt-1.5 text-sm text-surface-600 leading-relaxed">Put the agent's name in <span className="font-mono text-xs">Owner</span> and <span className="font-mono text-xs">agent</span> as the source on every finca they bring. The funnel then shows their numbers apart from yours, and after thirty or so visits their visit-to-conversation and conversation-to-demo rates become the Nicaragua benchmark — there is no published one. The research says the trusted person in front of the farmer is what sells; the product is what keeps them.</p>
        <p className="mt-2 text-xs text-surface-500">Today only platform admins can write here, so the agent reports to you and you log it. A login for the agent, scoped to Nicaragua and to the funnel only, is the next migration; this table was shaped so it will not need to change.</p>
      </Card>

      <details className="mt-4 text-xs text-surface-500">
        <summary className="cursor-pointer hover:text-surface-700">Benchmark sources</summary>
        <ul className="mt-2 list-disc pl-5 space-y-0.5">{SOURCES.map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="mt-2 max-w-[75ch]">All are vendor-published 2025–2026 figures, not audited datasets. None isolates founder-led sales, which usually runs above SDR-led rates. Treat the bands as a sanity check, not a target; a band is only shown against your numbers once a stage has five or more leads behind it.</p>
      </details>

      {picked && <LeadDrawer lead={picked} events={events} onClose={() => setPicked(null)} onSave={save} onDelete={remove} />}
    </>
  );
}
