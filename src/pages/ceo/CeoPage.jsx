import { useState, useEffect, useMemo } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Beef, Briefcase, CheckCircle2, Circle,
  DollarSign, Flag, Globe, RefreshCw, Target, TrendingUp, Users,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import Spinner from '../../components/ui/Spinner';

// CEO oversight. Not a customer page — this is the only view in the product
// that looks across every workspace at once, and it exists because the founder
// could not otherwise tell that a pilot had gone quiet.
//
// The numbers from the business plan live here rather than in the document,
// because a plan nobody reopens is a plan nobody uses. Anything hard-coded
// below is a decision from that plan, and it is labelled as such.

// ── The plan's figures, so the dashboard can mark progress against them ─────
const BARS = [
  { n: 4.3,  label: 'Cover platform + accountant', detail: '$3,240/yr of fixed cost' },
  { n: 18.8, label: 'Cover fixed + contract help', detail: '$14,040/yr' },
  { n: 68.8, label: 'Pay the founder $4,000/mo', detail: 'The point this becomes a job' },
];
const PRICING = [
  { what: 'Business — United States',   now: 100, rec: 100, note: 'Hold. Above QuickBooks Plus, below Square Premium.' },
  { what: 'Business — Nicaragua',       now: 100, rec: 35,  note: '$1,200/yr is over half of GDP per capita.' },
  { what: 'Ganadería — Nicaragua',      now: 150, rec: 40,  note: 'Competitive set is $7-$85. Opens 8,200 ranches → ~49,000.' },
  { what: 'Ganadería — export tier',    now: null, rec: 120, note: 'Needs export traceability, which is not built.' },
];
const MARKET = [
  { seg: 'Ganadería — all NI producers',      n: '136,687', val: '$65.6M', src: 'CENAGRO 2011' },
  { seg: 'Ganadería — reachable at $40/mo',   n: '~49,200', val: '$23.6M', src: 'Large + upper medium' },
  { seg: 'Ganadería — reachable at $150/mo',  n: '8,201',   val: '$14.8M', src: 'Large herds only', warn: true },
  { seg: 'Business — US Latino-owned firms',  n: '465,202', val: '$558M',  src: 'Stanford SOLE 2023' },
  { seg: 'Business — reachable in 3 years',   n: '~57,400', val: '$46.5M', src: 'MO restaurants + NI MIPYMES' },
];
const MILESTONES = [
  { due: '2026-11-30', what: 'Finca Batavia live with its herd loaded', key: 'batavia' },
  { due: '2026-12-31', what: 'First invoice issued and paid',           key: 'firstPaid' },
  { due: '2026-12-31', what: 'Regional pricing live',                   key: 'pricing' },
  { due: '2026-12-31', what: 'Paid infrastructure tiers',               key: 'infra' },
  { due: '2027-03-31', what: '3 of 4 pilots converted to paid',         key: 'convert3' },
  { due: '2027-06-30', what: '10 paying customers, churn measured',     key: 'ten' },
  { due: '2027-12-31', what: '19 paying — fixed costs covered',         key: 'nineteen' },
  { due: '2027-12-31', what: 'Ganadería: 3 paying ranches, or archive', key: 'ganDecision' },
];

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
const daysSince = (d) => {
  if (!d || d < '2000-01-01') return null;
  return Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);
};

// A pilot's health, stated plainly. "Never used" is its own state because it
// is a different problem from "used and went quiet".
function health(w) {
  const touched = Object.entries(w.counts).filter(([k]) => k !== 'transactions').reduce((s, [, v]) => s + v, 0);
  const d = daysSince(w.last_activity);
  if (touched === 0) return { key: 'never', label: 'Never used', tone: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' };
  if (d === null || d > 30) return { key: 'dormant', label: `Quiet ${d ?? '—'}d`, tone: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' };
  if (d > 14) return { key: 'slowing', label: `${d}d ago`, tone: 'bg-amber-50 text-amber-700 border-amber-100', dot: 'bg-amber-400' };
  return { key: 'active', label: `${d}d ago`, tone: 'bg-brand-50 text-brand-800 border-brand-200', dot: 'bg-brand-600' };
}

function Stat({ icon: Icon, label, value, sub, tone = 'text-surface-900' }) {
  return (
    <div className="rounded-xl bg-white border border-surface-200 p-4">
      <div className="flex items-center gap-2 text-surface-500">
        <Icon size={15} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className={`mt-2 font-display text-3xl leading-none ${tone}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-surface-500 leading-snug">{sub}</div>}
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline gap-2.5">
        <Icon size={18} className="text-brand-700 translate-y-0.5" />
        <h2 className="font-display text-xl text-brand-950">{title}</h2>
      </div>
      {hint && <p className="mt-1 text-sm text-surface-500 max-w-[70ch]">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function CeoPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError('');
    const { data: d, error: e } = await supabase.rpc('ceo_overview');
    if (e) setError(e.message); else setData(d);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const ws = useMemo(() => (data?.workspaces || []).map((w) => ({ ...w, h: health(w) })), [data]);
  const paying = data?.platform?.paying ?? 0;
  const mrr = 0;  // nothing is billed yet; when billing exists this reads from it
  const animals = ws.reduce((s, w) => s + (w.counts?.animals || 0), 0);
  const neverUsed = ws.filter((w) => w.h.key === 'never');
  const quiet = ws.filter((w) => w.h.key === 'dormant' || w.h.key === 'slowing');

  const milestoneState = (k) => {
    if (k === 'batavia') return animals > 0 ? 'done' : 'open';
    if (k === 'firstPaid' || k === 'convert3' || k === 'ten' || k === 'nineteen') return paying > 0 ? 'partial' : 'open';
    return 'open';
  };

  if (loading) return <div className="p-10 flex justify-center"><Spinner /></div>;

  if (error) {
    const denied = /NOT_PLATFORM_ADMIN/.test(error);
    return (
      <div className="max-w-xl mx-auto mt-16 rounded-xl border border-surface-200 bg-white p-7 text-center">
        <AlertTriangle className="mx-auto text-amber-500" size={28} />
        <h1 className="mt-3 font-display text-xl text-brand-950">{denied ? 'Not a platform admin' : 'Could not load'}</h1>
        <p className="mt-2 text-sm text-surface-600 leading-relaxed">
          {denied
            ? 'This page looks across every workspace, so it is limited to the people who run SelRic. Add yourself in the platform_admins table.'
            : error}
        </p>
        <button onClick={load} className="btn-secondary mt-5"><RefreshCw size={15} /> Try again</button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-1 pb-16">
      <div className="flex items-start justify-between gap-4 pt-2">
        <div>
          <h1 className="font-display text-3xl text-brand-950">Oversight</h1>
          <p className="mt-1 text-surface-600">Every workspace at once — what is alive, what is not, and how far the plan has actually moved.</p>
        </div>
        <button onClick={load} className="btn-secondary shrink-0"><RefreshCw size={15} /> Refresh</button>
      </div>

      {/* ── The honest headline ─────────────────────────────────────────── */}
      <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={DollarSign} label="Paying customers" value={paying}
          tone={paying === 0 ? 'text-red-600' : 'text-brand-900'}
          sub={paying === 0 ? 'Nobody has ever been billed. This is the number that matters.' : null} />
        <Stat icon={TrendingUp} label="MRR" value={money(mrr)} sub="All four workspaces are free pilots." />
        <Stat icon={Users} label="Workspaces" value={data.platform.workspaces}
          sub={`${data.platform.users} user${data.platform.users === 1 ? '' : 's'} across all of them`} />
        <Stat icon={Beef} label="Animals in Ganadería" value={animals}
          tone={animals === 0 ? 'text-red-600' : 'text-brand-900'}
          sub={animals === 0 ? 'The program shipped and has no user.' : null} />
      </div>

      {(neverUsed.length > 0 || animals === 0) && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900 leading-relaxed">
              <span className="font-semibold">Needs attention. </span>
              {neverUsed.length > 0 && (
                <>{neverUsed.map((w) => w.name).join(', ')} {neverUsed.length === 1 ? 'has' : 'have'} never been used — an account was created and nothing was ever put in it. </>
              )}
              {animals === 0 && <>Batavia Ganadería is in production with zero animals; the invitation exists and is unused.</>}
            </div>
          </div>
        </div>
      )}

      {/* ── Break-even ──────────────────────────────────────────────────── */}
      <Section icon={Target} title="Distance to break-even"
        hint="From the financial model. Four paying customers covers the servers and the accountant; sixty-nine makes this a job.">
        <div className="grid sm:grid-cols-3 gap-3">
          {BARS.map((b) => {
            const pct = Math.min(100, (paying / b.n) * 100);
            return (
              <div key={b.label} className="rounded-xl bg-white border border-surface-200 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-surface-800">{b.label}</span>
                  <span className="font-mono text-sm text-surface-900">{paying} / {b.n}</span>
                </div>
                <div className="mt-2.5 h-2 rounded-full bg-surface-100 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 text-xs text-surface-500">{b.detail}</div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Pilot health ────────────────────────────────────────────────── */}
      <Section icon={Activity} title="Pilot health"
        hint="Last activity counts anything a person put in: a sale, a customer, a stock movement, an animal. Bookkeeping you back-filled yourself still counts, so a workspace that looks quiet here is definitely quiet.">
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">
                <th className="px-4 py-2.5 font-semibold">Workspace</th>
                <th className="px-3 py-2.5 font-semibold">Program</th>
                <th className="px-3 py-2.5 font-semibold">Mode</th>
                <th className="px-3 py-2.5 font-semibold text-right">Users</th>
                <th className="px-3 py-2.5 font-semibold text-right">30-day activity</th>
                <th className="px-3 py-2.5 font-semibold">Last activity</th>
                <th className="px-3 py-2.5 font-semibold">Portal</th>
              </tr>
            </thead>
            <tbody>
              {ws.map((w) => (
                <tr key={w.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-medium text-surface-900">{w.name}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5 text-surface-700">
                      {w.program?.includes('ganaderia') ? <Beef size={14} /> : <Briefcase size={14} />}
                      {w.program}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-surface-600">{w.accounting_mode}</td>
                  <td className="px-3 py-3 text-right font-mono">{w.users}</td>
                  <td className={`px-3 py-3 text-right font-mono ${w.activity_30d === 0 ? 'text-red-600' : 'text-surface-900'}`}>{w.activity_30d}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${w.h.tone}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${w.h.dot}`} />{w.h.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-surface-600">{w.configured ? 'set up' : <span className="text-amber-700">not set up</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── What is actually in each one ────────────────────────────────── */}
      <Section icon={Users} title="What is actually in each workspace"
        hint="A pilot with one product and one sale is a demo, not usage. This is the difference between someone signing up and someone adopting.">
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">
                <th className="px-4 py-2.5 font-semibold">Workspace</th>
                {['Transactions', 'Sales', 'Products', 'Customers', 'Stock moves', 'Animals', 'Herd events'].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-semibold text-right">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ws.map((w) => (
                <tr key={w.id} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-medium text-surface-900">{w.name}</td>
                  {['transactions', 'sales', 'products', 'customers', 'inventory_logs', 'animals', 'herd_events'].map((k) => (
                    <td key={k} className={`px-3 py-3 text-right font-mono ${w.counts[k] ? 'text-surface-900' : 'text-surface-300'}`}>
                      {w.counts[k] || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Milestones ──────────────────────────────────────────────────── */}
      <Section icon={Flag} title="Milestones"
        hint="Commercial, not technical. A feature that ships to nobody is not progress. Status is computed from the data above where it can be.">
        <div className="rounded-xl border border-surface-200 bg-white divide-y divide-surface-100">
          {MILESTONES.map((m) => {
            const st = milestoneState(m.key);
            const overdue = st !== 'done' && m.due < new Date().toISOString().slice(0, 10);
            return (
              <div key={m.key + m.due} className="flex items-center gap-3 px-4 py-3">
                {st === 'done'
                  ? <CheckCircle2 size={17} className="text-brand-600 shrink-0" />
                  : <Circle size={17} className={`shrink-0 ${overdue ? 'text-red-500' : 'text-surface-300'}`} />}
                <span className={`flex-1 text-sm ${st === 'done' ? 'text-surface-500 line-through' : 'text-surface-800'}`}>{m.what}</span>
                <span className={`font-mono text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-surface-500'}`}>
                  {m.due}{overdue ? ' · overdue' : ''}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Pricing decision ────────────────────────────────────────────── */}
      <Section icon={DollarSign} title="The pricing decision"
        hint="The largest single lever in the plan, and the one still unmade. Ganadería at $150 is above every competitor in a $7-$85 market, in a country where GDP per capita is about $2,250.">
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">
                <th className="px-4 py-2.5 font-semibold">Program and market</th>
                <th className="px-3 py-2.5 font-semibold text-right">Today</th>
                <th className="px-3 py-2.5 font-semibold text-right">Recommended</th>
                <th className="px-3 py-2.5 font-semibold">Why</th>
              </tr>
            </thead>
            <tbody>
              {PRICING.map((p) => (
                <tr key={p.what} className="border-t border-surface-100">
                  <td className="px-4 py-3 font-medium text-surface-900">{p.what}</td>
                  <td className="px-3 py-3 text-right font-mono text-surface-600">{p.now ? `$${p.now}` : '—'}</td>
                  <td className={`px-3 py-3 text-right font-mono font-semibold ${p.now && p.rec !== p.now ? 'text-red-600' : 'text-surface-900'}`}>${p.rec}</td>
                  <td className="px-3 py-3 text-surface-600 leading-snug">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Market ──────────────────────────────────────────────────────── */}
      <Section icon={Globe} title="The market, for reference"
        hint="From the market analysis. The plan's Year-3 target is 151 customers — about 0.26% of the reachable market, which is why market size is not what limits this.">
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">
                <th className="px-4 py-2.5 font-semibold">Segment</th>
                <th className="px-3 py-2.5 font-semibold text-right">Businesses</th>
                <th className="px-3 py-2.5 font-semibold text-right">Value / year</th>
                <th className="px-3 py-2.5 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {MARKET.map((m) => (
                <tr key={m.seg} className={`border-t border-surface-100 ${m.warn ? 'text-red-600' : ''}`}>
                  <td className="px-4 py-3 font-medium">{m.seg}</td>
                  <td className="px-3 py-3 text-right font-mono">{m.n}</td>
                  <td className="px-3 py-3 text-right font-mono">{m.val}</td>
                  <td className="px-3 py-3 text-surface-500">{m.src}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Invites ─────────────────────────────────────────────────────── */}
      <Section icon={ArrowRight} title="Invitations"
        hint="An unused invite is a sale that has not happened.">
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">
                <th className="px-4 py-2.5 font-semibold">Code</th>
                <th className="px-3 py-2.5 font-semibold">For</th>
                <th className="px-3 py-2.5 font-semibold">Program</th>
                <th className="px-3 py-2.5 font-semibold text-right">Used</th>
              </tr>
            </thead>
            <tbody>
              {(data.invites || []).map((i) => {
                const open = i.uses < i.max_uses;
                return (
                  <tr key={i.code} className="border-t border-surface-100">
                    <td className="px-4 py-3 font-mono text-surface-900">{i.code}</td>
                    <td className="px-3 py-3 text-surface-700">{i.label}</td>
                    <td className="px-3 py-3 text-surface-600">{i.program}</td>
                    <td className={`px-3 py-3 text-right font-mono ${open ? 'text-amber-700 font-semibold' : 'text-surface-400'}`}>
                      {i.uses} / {i.max_uses}{open ? ' · open' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="mt-10 text-xs text-surface-400 leading-relaxed max-w-[75ch]">
        Counts come from <code>ceo_overview()</code>, which returns aggregates only — never another workspace's rows.
        Market and pricing figures come from the business plan and the financial model in <code>business/</code>.
        Generated {data.generated_at ? String(data.generated_at).slice(0, 19).replace('T', ' ') : '—'}.
      </p>
    </div>
  );
}
