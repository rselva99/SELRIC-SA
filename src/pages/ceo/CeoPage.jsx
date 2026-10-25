import { Fragment, useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity, AlertTriangle, Beef, Briefcase, CheckCircle2, ChevronDown, ChevronRight, Circle, Clock,
  DollarSign, Filter, Flag, Gauge, Globe, RefreshCw, Target, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, Cell, ComposedChart, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from '../../lib/supabase';
import Spinner from '../../components/ui/Spinner';
import { compute } from '../../lib/ceoModel.js';
import { get, plain, resolve, tableFor } from '../../lib/ceoDocs.js';
import FunnelPage, { WEIGHT, monthly } from './FunnelPage';
import ModelPage from './ModelPage';
import DocumentsPage from './DocumentsPage';
import { C, SEG, usd, usdK, num, pct, mon, nowLabel, Grid, MonthAxis, NumAxis, NumAxisX, CatAxisY, Tip, ChartCard } from './charts';

// CEO oversight — the only view that looks across every workspace at once.
// Seven pages under /ceo: Overview, Pilots, Funnel, Research, Model,
// Documents, Plan.
//
// Four sources, one picture, and nothing stored that could be computed:
//   • the pilots come from ceo_overview()
//   • the funnel from platform_leads
//   • the model is computed here, at load, by src/lib/ceoModel.js from the
//     newest row of platform_assumptions — the engine holds no constants
//   • the prose (findings, milestones, the two documents) comes from
//     platform_documents, with its numbers resolved from that same run
// Every page reads the same result, so the plan is always drawn against what
// actually happened: the model's path is the yardstick, the funnel's paying
// leads are the actuals, and the pilots are the people the model expects to
// convert first. Nothing confidential is in this file or in the bundle; the
// tables and the RPC are readable only when is_platform_admin().

const usd2 = (n) => '$' + Number(n).toFixed(2);
const daysSince = (d) => (!d || d < '2000-01-01') ? null : Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);
// Each finding (by its section key) maps to the chart that proves it.
const FINDING_LINKS = { capacity: '/ceo/research#capacity', driver: '/ceo/funnel', draw: '/ceo/research#cash', price: '/ceo/research#price' };

// A pilot's health, stated plainly. "Never used" is its own state because it is
// a different problem from "used and went quiet".
function health(w) {
  const touched = Object.entries(w.counts).filter(([k]) => k !== 'transactions').reduce((s, [, v]) => s + v, 0);
  const d = daysSince(w.last_activity);
  if (touched === 0) return { key: 'never', label: 'Never used', tone: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' };
  if (d === null || d > 30) return { key: 'dormant', label: `Quiet ${d ?? '—'}d`, tone: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' };
  if (d > 14) return { key: 'slowing', label: `${d}d ago`, tone: 'bg-amber-50 text-amber-700 border-amber-100', dot: 'bg-amber-400' };
  return { key: 'active', label: `${d}d ago`, tone: 'bg-brand-50 text-brand-800 border-brand-200', dot: 'bg-brand-600' };
}

// What the funnel says actually happened, month by month, on the model's own
// calendar — so the two can be drawn on one axis. A lead counts as paying from
// its first 'paying' event until a later 'lost' one.
function actualSeries(leads, events, labels) {
  const firstPay = {}, lostAfter = {};
  for (const e of events) {
    const m = String(e.at).slice(0, 7);
    if (e.to_stage === 'paying' && !firstPay[e.lead_id]) firstPay[e.lead_id] = m;
    if (e.to_stage === 'lost' && firstPay[e.lead_id]) lostAfter[e.lead_id] = m;
  }
  for (const l of leads) if (l.stage === 'paying' && !firstPay[l.id]) firstPay[l.id] = String(l.stage_changed_at).slice(0, 7);
  const now = nowLabel();
  return labels.map((L) => {
    if (L > now) return null;
    let cust = 0, mrr = 0;
    for (const l of leads) { const p = firstPay[l.id]; if (p && p <= L && !(lostAfter[l.id] && lostAfter[l.id] <= L)) { cust++; mrr += monthly(l); } }
    return { cust, mrr };
  });
}

// Everything the pages share, derived once: where today falls on the plan,
// what the funnel holds, and what the next ninety days of the plan ask for.
function useModel(R, leads, events) {
  return useMemo(() => {
    const now = nowLabel();
    const open = leads.filter((l) => !['lost', 'paying'].includes(l.stage));
    const paying = leads.filter((l) => l.stage === 'paying');
    const out = {
      now, paying, payingNow: paying.length, mrrNow: paying.reduce((s, l) => s + monthly(l), 0),
      payingGan: paying.filter((l) => l.program === 'ganaderia').length,
      referrals: leads.filter((l) => l.source === 'referral' && l.stage !== 'lost').length,
      pipeline: { demo: leads.filter((l) => l.stage === 'demo').length, pilot: leads.filter((l) => l.stage === 'pilot').length, open: open.length, weighted: open.reduce((s, l) => s + monthly(l) * WEIGHT[l.stage], 0) },
    };
    if (!R) return out;
    const labels = R.monthly.map((m) => m.label);
    const nowIdx = labels.indexOf(now);
    const next = R.monthly.filter((m) => m.label > now).slice(0, 3);
    const pilotLabel = R.pilots.monthLabel;
    return {
      ...out, labels, nowIdx, planNow: nowIdx >= 0 ? R.monthly[nowIdx] : null, actual: actualSeries(leads, events, labels),
      pilotLabel, pilotsN: R.pilots.total, pilotsConv: R.pilots.converting,
      next90: { months: next, need: next.reduce((s, m) => s + m.newPlan, 0), pilots: next.some((m) => m.label === pilotLabel) ? R.pilots.converting : 0, until: next[next.length - 1]?.label },
      atMonth: (ym) => R.monthly.find((m) => m.label === ym) || (ym > labels[labels.length - 1] ? R.monthly[R.monthly.length - 1] : null),
    };
  }, [R, leads, events]);
}

// ── small pieces ────────────────────────────────────────────────────────────
function Stat({ icon: Icon, label, value, sub, tone = 'text-surface-900', to }) {
  const body = (<>
    <div className="flex items-center gap-2 text-surface-500"><Icon size={15} /><span className="text-xs font-medium uppercase tracking-wide">{label}</span></div>
    <div className={`mt-2 font-display text-3xl leading-none ${tone}`}>{value}</div>
    {sub && <div className="mt-1.5 text-xs text-surface-500 leading-snug">{sub}</div>}
  </>);
  const cls = 'block rounded-xl bg-white border border-surface-200 p-4 transition-colors';
  return to ? <Link to={to} className={`${cls} hover:border-brand-300 hover:bg-brand-50/30`}>{body}</Link> : <div className={cls}>{body}</div>;
}
function Section({ icon: Icon, title, hint, children, right, id }) {
  return (
    <section className="mt-8 scroll-mt-6" id={id}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-2.5"><Icon size={18} className="text-brand-700 translate-y-0.5" /><h2 className="font-display text-xl text-brand-950">{title}</h2></div>
          {hint && <p className="mt-1 text-sm text-surface-500 max-w-[70ch]">{hint}</p>}
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
const Card = ({ children, className = '' }) => <div className={`rounded-xl border border-surface-200 bg-white ${className}`}>{children}</div>;
const TH = ({ children, right }) => <th className={`px-3 py-2.5 font-semibold ${right ? 'text-right' : ''}`}>{children}</th>;
const TD = ({ children, right, mono, className = '' }) => <td className={`px-3 py-3 ${right ? 'text-right' : ''} ${mono ? 'font-mono' : ''} ${className}`}>{children}</td>;
const Table = ({ head, children }) => (
  <Card className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-surface-50 text-left text-xs uppercase tracking-wide text-surface-500">{head}</tr></thead><tbody>{children}</tbody></table></Card>
);
const Meter = ({ value, max, tone = 'bg-brand-600' }) => <div className="h-2 rounded-full bg-brand-100 overflow-hidden"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }} /></div>;
const Note = ({ children }) => (
  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
    <div className="flex items-start gap-2.5"><AlertTriangle size={17} className="shrink-0 mt-0.5 text-amber-600" /><div className="text-sm leading-relaxed text-amber-900">{children}</div></div>
  </div>
);
const EndLabel = ({ x, y, index, last, text }) => (index === last ? <text x={x + 6} y={y + 3} fontSize={10} fill={C.text}>{text}</text> : null);

// Shown wherever the model would be, until the migration has run and
// publish.mjs has seeded version 1.
function NotPublished() {
  return (
    <Card className="p-5 flex gap-3 items-start">
      <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
      <div className="text-sm text-surface-700 leading-relaxed">
        <span className="font-medium text-surface-900">The model has no assumptions to run on yet.</span> Run <code className="font-mono text-xs">migrations/2026-10-24-platform-model.sql</code> in the SQL Editor, then <code className="font-mono text-xs">node ~/selric-business/publish.mjs</code> from outside the repo, and refresh.
      </div>
    </Card>
  );
}

// ── the path: plan against actual, the one chart every page points back to ──
function PathChart({ R, M, height = 300 }) {
  const S = R.scenarios;
  const rows = R.monthly.map((m, i) => ({ label: m.label, plan: m.total, band: [S.downside.total[i], S.upside.total[i]], actual: M.actual[i]?.cust ?? null }));
  const inRange = M.nowIdx >= 0;
  return (
    <ChartCard id="path" title="The path, and where we are on it" height={height}
      hint={`Paying customers, month by month. The line is the base case; the wash is downside to upside; the dots are the funnel's paying leads. ${inRange ? `Today is month ${M.nowIdx + 1} of ${R.horizon}.` : `The plan starts ${mon(R.startMonth)}.`}`}
      legend={[{ label: 'Plan (base)', color: C.brand, kind: 'line' }, { label: 'Downside – upside', color: C.brand, kind: 'band' }, { label: 'Actual', color: C.ink, kind: 'dot' }]}
      table={{ cols: [{ key: 'label', label: 'Month', fmt: mon, right: false }, { key: 'plan', label: 'Plan', fmt: (n) => num(n, 1) }, { key: 'low', label: 'Downside', fmt: (n) => num(n, 1) }, { key: 'high', label: 'Upside', fmt: (n) => num(n, 1) }, { key: 'actual', label: 'Actual' }], rows: rows.map((r) => ({ ...r, low: r.band[0], high: r.band[1] })) }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
          {Grid()}{MonthAxis()}{NumAxis()}
          <Tooltip content={<Tip fmt={(n) => num(n, 1)} />} cursor={{ stroke: C.grayL }} />
          <Area dataKey="band" name="Downside – upside" stroke="none" fill={C.brand} fillOpacity={0.12} isAnimationActive={false} />
          <Line dataKey="plan" name="Plan" stroke={C.brand} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="actual" name="Actual" stroke={C.ink} strokeWidth={2} dot={{ r: 4, fill: C.ink, stroke: '#fff', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
          {inRange && <ReferenceLine x={M.now} stroke={C.gray} strokeDasharray="3 3" label={{ value: 'today', position: 'insideTopLeft', fontSize: 10, fill: C.text }} />}
          {R.drawStartsMonth && <ReferenceLine x={R.drawStartsMonth} stroke={C.gray} strokeDasharray="3 3" label={{ value: 'founder paid', position: 'insideTopRight', fontSize: 10, fill: C.text }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ── pages ───────────────────────────────────────────────────────────────────
function Overview({ data, ws, animals, neverUsed, R, M, findings }) {
  const alive = ws.filter((w) => ['active', 'slowing'].includes(w.h.key)).length;
  const orgPaying = data.platform.paying ?? 0;
  const P = M.pipeline, N = M.next90;
  return (<>
    <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat icon={DollarSign} label="Paying customers" value={M.payingNow} tone={M.payingNow === 0 ? 'text-red-600' : 'text-brand-900'} to="/ceo/funnel"
        sub={!R ? (M.payingNow === 0 ? 'Nobody has ever been billed.' : null) : M.planNow ? `Plan for ${mon(M.now)}: ${num(M.planNow.total, 1)}` : `Nobody has been billed. The plan starts ${mon(R.startMonth)}.`} />
      <Stat icon={TrendingUp} label="MRR" value={usd(M.mrrNow)} to="/ceo/research#path"
        sub={!R ? 'From paying leads in the funnel.' : M.planNow ? `Plan for ${mon(M.now)}: ${usd(M.planNow.mrr)}` : `Year 1 ends at ${usd(R.years[0].endMRR)} a month in the base case.`} />
      <Stat icon={Filter} label="In demo or pilot" value={P.demo + P.pilot} to="/ceo/funnel"
        sub={R && N ? `The plan books ${num(N.need + N.pilots)} paying by ${mon(N.until)} — ${num(N.pilots)} converted pilots, ${num(N.need, 1)} from this funnel. Weighted pipeline ${usd(P.weighted)}/mo.` : `${P.open} open leads · weighted ${usd(P.weighted)}/mo`} />
      <Stat icon={Activity} label="Pilots alive" value={`${alive} / ${ws.length}`} tone={alive === 0 ? 'text-red-600' : 'text-brand-900'} to="/ceo/pilots"
        sub={R ? `The model books ${num(M.pilotsConv)} of ${M.pilotsN} as paying in ${mon(M.pilotLabel)}.` : 'Used in the last 30 days.'} />
    </div>

    {(neverUsed.length > 0 || animals === 0 || orgPaying !== M.payingNow) && (
      <Note>
        <span className="font-semibold">Needs attention. </span>
        {neverUsed.length > 0 && <>{neverUsed.map((w) => w.name).join(', ')} {neverUsed.length === 1 ? 'has' : 'have'} never been used. </>}
        {animals === 0 && <>Ganadería is in production with zero animals; the Batavia invitation is unused. </>}
        {orgPaying !== M.payingNow && <>{orgPaying} workspace{orgPaying === 1 ? ' is' : 's are'} on a paid plan but {M.payingNow} funnel lead{M.payingNow === 1 ? ' is' : 's are'} marked paying — the two should agree. </>}
        <Link to="/ceo/pilots" className="underline underline-offset-2 font-medium">See pilots →</Link>
      </Note>
    )}

    <div className="mt-4">{R ? <PathChart R={R} M={M} /> : <NotPublished />}</div>

    {R && findings.length > 0 && (
      <Section icon={Flag} title="What decides this" hint="The findings, with their numbers resolved from the current assumptions; each points at the chart that proves it." right={<Link to="/ceo/research" className="text-sm text-brand-700 hover:underline shrink-0">The research →</Link>}>
        <div className="grid md:grid-cols-2 gap-3">
          {findings.map((f, i) => (
            <Link key={f.key} to={FINDING_LINKS[f.key] || '/ceo/research'} className="rounded-xl border border-surface-200 bg-white p-4 hover:border-brand-300 hover:bg-brand-50/30 transition-colors">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Finding {i + 1}</div>
              <div className="mt-1 font-medium text-surface-900 leading-snug">{f.title}</div>
              <p className="mt-2 text-sm text-surface-600 leading-relaxed">{f.body}</p>
              <div className="mt-2 text-xs text-brand-700">See the chart →</div>
            </Link>
          ))}
        </div>
      </Section>
    )}

    {R && (
      <Section icon={Target} title="Distance to break-even" hint={`At the blended price of ${usd2(R.breakeven.blendedArpu)} a month. Counted from the funnel's paying leads.`}>
        <div className="grid sm:grid-cols-3 gap-3">
          {[{ n: R.breakeven.fixed, label: 'Cover platform + accountant' }, { n: R.breakeven.fixedPlusHelp, label: 'Cover fixed + contract help' }, { n: R.breakeven.founderDraw, label: `Pay the founder ${usd(R.costs.founderDraw)}/mo` }].map((b) => (
            <Card key={b.label} className="p-4">
              <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium text-surface-800">{b.label}</span><span className="font-mono text-sm">{M.payingNow} / {num(b.n, 1)}</span></div>
              <div className="mt-2.5"><Meter value={M.payingNow} max={b.n} /></div>
            </Card>
          ))}
        </div>
      </Section>
    )}

    <Section icon={Activity} title="Pilot health at a glance" right={<Link to="/ceo/pilots" className="text-sm text-brand-700 hover:underline shrink-0">All pilots →</Link>}>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {ws.map((w) => (
          <Link key={w.id} to="/ceo/pilots" className={`rounded-xl border p-4 transition-colors hover:shadow-sm ${w.h.tone}`}>
            <div className="flex items-center justify-between gap-2"><span className="font-medium truncate">{w.name}</span><span className={`w-2 h-2 rounded-full shrink-0 ${w.h.dot}`} /></div>
            <div className="mt-1.5 text-xs opacity-80">{w.h.label} · {w.activity_30d} actions in 30d</div>
          </Link>
        ))}
      </div>
    </Section>
  </>);
}

function Pilots({ data, ws, R, M }) {
  const [open, setOpen] = useState(null);
  const COUNTS = [['transactions', 'Transactions'], ['sales', 'Sales'], ['products', 'Products'], ['customers', 'Customers'], ['inventory_logs', 'Stock moves'], ['animals', 'Animals'], ['herd_events', 'Herd events']];
  const conv = R?.sens.pilotConv;
  return (<>
    {R && (
      <Card className="mt-6 p-4 text-sm text-surface-700 leading-relaxed">
        <span className="font-medium text-surface-900">What the model expects of these {ws.length}. </span>
        {num(M.pilotsConv)} of {M.pilotsN} convert to paying in {mon(M.pilotLabel)} ({pct(R.pilots.conversion)}) — and after that the model stops depending on them: {conv ? <>moving conversion from {conv.hiLabel} to {conv.loLabel} changes Year-3 ARR by only {usd(conv.swing)}.</> : null} Their value is the introduction, not the invoice. <Link to="/ceo/funnel" className="text-brand-700 hover:underline">Log the referrals in the funnel →</Link>
      </Card>
    )}
    <Section icon={Activity} title="Pilot health" hint="Click a row for what is actually inside. Last activity counts anything a person put in — a sale, a customer, a stock move, an animal. Bookkeeping you back-filled yourself still counts, so a workspace that looks quiet here is definitely quiet.">
      <Table head={<><TH>Workspace</TH><TH>Program</TH><TH>Mode</TH><TH right>Users</TH><TH right>30-day activity</TH><TH>Last activity</TH><TH>Portal</TH><TH /></>}>
        {ws.map((w) => {
          const isOpen = open === w.id;
          const touched = COUNTS.filter(([k]) => k !== 'transactions').reduce((s, [k]) => s + (w.counts[k] || 0), 0);
          return (<Fragment key={w.id}>
            <tr onClick={() => setOpen(isOpen ? null : w.id)} className={`border-t border-surface-100 cursor-pointer hover:bg-surface-50 ${isOpen ? 'bg-surface-50' : ''}`}>
              <TD className="font-medium text-surface-900">{w.name}</TD>
              <TD><span className="inline-flex items-center gap-1.5 text-surface-700">{w.program?.includes('ganaderia') ? <Beef size={14} /> : <Briefcase size={14} />}{w.program}</span></TD>
              <TD className="text-surface-600">{w.accounting_mode}</TD>
              <TD right mono>{w.users}</TD>
              <TD right mono className={w.activity_30d === 0 ? 'text-red-600' : ''}>{w.activity_30d}</TD>
              <TD><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${w.h.tone}`}><span className={`w-1.5 h-1.5 rounded-full ${w.h.dot}`} />{w.h.label}</span></TD>
              <TD className="text-surface-600">{w.configured ? 'set up' : <span className="text-amber-700">not set up</span>}</TD>
              <TD right className="text-surface-400">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</TD>
            </tr>
            {isOpen && (
              <tr key={w.id + '-d'} className="bg-surface-50/60">
                <td colSpan={8} className="px-4 pb-4 pt-1">
                  <div className="grid sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    {COUNTS.map(([k, label]) => (
                      <div key={k} className="rounded-lg bg-white border border-surface-200 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-surface-500">{label}</div>
                        <div className={`font-mono text-lg ${w.counts[k] ? 'text-surface-900' : 'text-surface-300'}`}>{w.counts[k] || '—'}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-surface-500 leading-relaxed">
                    Created {String(w.created_at).slice(0, 10)} · plan <span className="font-mono">{w.plan}</span> · {touched === 0 ? 'An account was created and nothing was ever put in it. This is a conversation, not a support ticket.' : touched < 5 ? 'A product and a sale is a demo, not adoption. Ask what stopped them.' : 'Real data is in here. This one is a reference customer in the making.'}
                  </p>
                </td>
              </tr>
            )}
          </Fragment>);
        })}
      </Table>
    </Section>

    <Section icon={Users} title="Invitations" hint="An unused invite is a sale that has not happened.">
      <Table head={<><TH>Code</TH><TH>For</TH><TH>Program</TH><TH right>Used</TH></>}>
        {(data.invites || []).map((i) => {
          const openInv = i.uses < i.max_uses;
          return (
            <tr key={i.code} className="border-t border-surface-100">
              <TD mono className="text-surface-900">{i.code}</TD><TD className="text-surface-700">{i.label}</TD><TD className="text-surface-600">{i.program}</TD>
              <TD right mono className={openInv ? 'text-amber-700 font-semibold' : 'text-surface-400'}>{i.uses} / {i.max_uses}{openInv ? ' · open' : ''}</TD>
            </tr>
          );
        })}
      </Table>
    </Section>
  </>);
}

function Research({ R, M, findings, assump }) {
  if (!R) return <div className="mt-6"><NotPublished /></div>;
  const S = R.scenarios, A = R.A, Y = R.years, order = R.scenarioOrder;
  const seg = R.monthly.map((m) => ({ label: m.label, ...m.cust, capped: m.capped }));
  const mrrSeg = R.monthly.map((m) => ({ label: m.label, ...m.mrrBy }));
  const pnl = R.monthly.map((m) => ({ label: m.label, profit: m.profit, draw: m.draw, cash: m.cash }));
  const hours = R.monthly.map((m) => ({ label: m.label, needed: m.hoursNeeded, founder: A.capacity.founderSellingHours, available: m.hoursAvailable, cappedAt: m.capped ? m.hoursNeeded : null, plan: m.newPlan, allowed: m.newActual }));
  const scen = R.monthly.map((m, i) => ({ label: m.label, ...Object.fromEntries(order.map((k) => [k, S[k].mrr[i]])) }));
  const sens = R.sensitivity.map((s) => ({ name: s.name, range: [s.low, s.high], low: s.low, high: s.high, swing: s.swing }));
  const herd = [...R.competitors.herd.map((c) => ({ name: c.name, price: c.price })), ...R.tiers.map((t) => ({ name: `SelRic — ${t.tier.toLowerCase()}`, price: t.price }))].sort((a, b) => a.price - b.price);
  const biz = [...R.competitors.business.map((c) => ({ name: c.name, price: c.price })), { name: 'SelRic Business', price: R.prices.business }].sort((a, b) => a.price - b.price);
  const last = R.monthly.length - 1;
  const segLegend = SEG.map((s) => ({ label: s.label, color: s.color }));
  const segCols = [{ key: 'label', label: 'Month', fmt: mon, right: false }, ...SEG.map((s) => ({ key: s.key, label: s.label }))];
  const monthCol = { key: 'label', label: 'Month', fmt: mon, right: false };
  const money = (n) => num(n, 1);
  const assumptionsTable = tableFor('assumptions', R);
  const maxHerd = Math.max(...herd.map((x) => x.price)) * 1.3, maxBiz = Math.max(...biz.map((x) => x.price)) * 1.15;
  return (<>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
      <p className="text-sm text-surface-600 max-w-[70ch]">Thirty-six months of customer cohorts, acquired on a ramp and capped by the hours available to land and support them; churn front-loaded; cash tracked month by month; the founder paid only once the business can carry it. Every chart below is one run of the engine on assumptions v{assump?.version}, computed when this page loaded.</p>
      <Link to="/ceo/model" className="text-sm text-brand-700 hover:underline shrink-0">Change an assumption →</Link>
    </div>
    <div className="mt-4 grid sm:grid-cols-3 gap-3">
      {Y.map((y) => (
        <Card key={y.year} className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Year {y.year} · ends {mon(y.label)}</div>
          <div className="mt-1.5 flex items-baseline gap-2"><span className="font-display text-2xl text-surface-900">{usd(y.endARR)}</span><span className="text-xs text-surface-500">ARR · {num(y.endCustomers)} customers</span></div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div><div className="text-surface-500">Revenue</div><div className="font-mono text-surface-800">{usd(y.revenue)}</div></div>
            <div><div className="text-surface-500">After draw</div><div className={`font-mono ${y.profit < 0 ? 'text-red-600' : 'text-surface-800'}`}>{usd(y.profit)}</div></div>
            <div><div className="text-surface-500">Cash, end</div><div className="font-mono text-surface-800">{usd(y.endCash)}</div></div>
          </div>
        </Card>
      ))}
    </div>

    {findings.length > 0 && (
      <Section icon={Flag} title="The findings" hint="Prose from the findings document, every number resolved from this run. Edit the wording on the Documents tab; the numbers follow the Model tab.">
        <div className="space-y-3">
          {findings.map((f, i) => (
            <Card key={f.key} className="p-4 flex gap-4"><div className="font-display text-2xl text-brand-300 leading-none">{i + 1}</div><div><div className="font-medium text-surface-900">{f.title}</div><p className="mt-1 text-sm text-surface-600 leading-relaxed">{f.body}</p></div></Card>
          ))}
        </div>
      </Section>
    )}

    <Section icon={Users} title="Who is paying, and for what" hint="Three segments, three ramps. Ganadería is the smallest in revenue and the largest in count by Year 3 — the tiered price does that.">
      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCard id="path" title="Paying customers by segment" legend={segLegend} table={{ cols: segCols, rows: seg }}>
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={seg} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {Grid()}{MonthAxis()}{NumAxis()}<Tooltip content={<Tip fmt={money} />} cursor={{ stroke: C.grayL }} />
            {SEG.map((s) => <Area key={s.key} dataKey={s.key} name={s.label} stackId="1" stroke="#fff" strokeWidth={2} fill={s.color} fillOpacity={0.9} isAnimationActive={false} />)}
          </AreaChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="MRR by segment" legend={segLegend} table={{ cols: [monthCol, ...SEG.map((s) => ({ key: s.key, label: s.label, fmt: usd }))], rows: mrrSeg }}>
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={mrrSeg} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {Grid()}{MonthAxis()}{NumAxis({ fmt: usdK, width: 48 })}<Tooltip content={<Tip fmt={usd} />} cursor={{ stroke: C.grayL }} />
            {SEG.map((s) => <Area key={s.key} dataKey={s.key} name={s.label} stackId="1" stroke="#fff" strokeWidth={2} fill={s.color} fillOpacity={0.9} isAnimationActive={false} />)}
          </AreaChart></ResponsiveContainer>
        </ChartCard>
      </div>
    </Section>

    <Section id="cash" icon={Wallet} title="Profit, the draw, and cash" hint={`A ${usd(R.costs.founderDraw)} monthly draw switches on when trailing ${A.cost.drawTrailingMonths}-month profit covers it${R.drawStartsMonth ? ` — ${mon(R.drawStartsMonth)} in the base case` : ' — not inside the horizon'}. Cash opens at ${usd(A.cost.openingCash)} and bottoms at ${usd(R.cashLow.cash)} in ${mon(R.cashLow.label)}.`}>
      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCard title="Operating profit by month" hint="The gray on top of each bar is the founder's draw; the green is what is left after it." legend={[{ label: 'Profit after draw', color: C.brand }, { label: 'Founder draw', color: C.gray }]}
          table={{ cols: [monthCol, { key: 'profit', label: 'After draw', fmt: usd }, { key: 'draw', label: 'Draw', fmt: usd }, { key: 'cash', label: 'Cash', fmt: usd }], rows: pnl }}>
          <ResponsiveContainer width="100%" height="100%"><BarChart data={pnl} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
            {Grid()}{MonthAxis()}{NumAxis({ fmt: usdK, width: 48 })}<Tooltip content={<Tip fmt={usd} />} cursor={{ fill: C.grid, opacity: 0.5 }} />
            <ReferenceLine y={0} stroke={C.gray} />
            <Bar dataKey="profit" name="Profit after draw" stackId="p" fill={C.brand} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey="draw" name="Founder draw" stackId="p" fill={C.gray} maxBarSize={18} isAnimationActive={false} />
          </BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Cash on hand" hint={`Annual prepay — ${A.price.annualPrepayMonthsFree} months free, taken by ${pct(A.price.annualPrepayShare)} of joiners — is what keeps the first year above zero.`} table={{ cols: [monthCol, { key: 'cash', label: 'Cash', fmt: usd }], rows: pnl }}>
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={pnl} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            {Grid()}{MonthAxis()}{NumAxis({ fmt: usdK, width: 48 })}<Tooltip content={<Tip fmt={usd} />} cursor={{ stroke: C.grayL }} />
            <ReferenceLine y={0} stroke={C.gray} />
            {R.drawStartsMonth && <ReferenceLine x={R.drawStartsMonth} stroke={C.gray} strokeDasharray="3 3" label={{ value: 'founder paid', position: 'insideTopLeft', fontSize: 10, fill: C.text }} />}
            <Area dataKey="cash" name="Cash" stroke={C.brand} strokeWidth={2} fill={C.brand} fillOpacity={0.1} isAnimationActive={false} />
          </AreaChart></ResponsiveContainer>
        </ChartCard>
      </div>
    </Section>

    <Section id="capacity" icon={Clock} title="Hours — the constraint" hint={`${R.capped.count} of ${R.horizon} months are capped by hours${R.capped.first ? `, from ${mon(R.capped.first)}` : ''}. The plan asks for ${num(R.totals.planNew)} new customers in three years; the hours allow ${num(R.totals.allowedNew)}. Contract help — ${A.capacity.contractHours.join(' → ')} hours a month at months 1/12/24/36 — is what lifts the ceiling.`}>
      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCard title="Hours needed a month" hint={`${A.capacity.hoursPerNewCustomer}h to land a customer, ${A.capacity.supportHoursPerCustomer}h a month to keep one.`}
          legend={[{ label: 'Hours needed', color: C.brand }, { label: 'Founder alone', color: C.gray, kind: 'line' }, { label: 'With contract help', color: C.ink, kind: 'line' }, { label: 'Capped month', color: C.amber, kind: 'dot' }]}
          table={{ cols: [monthCol, { key: 'needed', label: 'Needed' }, { key: 'founder', label: 'Founder' }, { key: 'available', label: 'With help' }], rows: hours }}>
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={hours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {Grid()}{MonthAxis()}{NumAxis()}<Tooltip content={<Tip />} cursor={{ stroke: C.grayL }} />
            <Area dataKey="needed" name="Hours needed" stroke={C.brand} strokeWidth={2} fill={C.brand} fillOpacity={0.1} isAnimationActive={false} />
            <Line dataKey="founder" name="Founder alone" stroke={C.gray} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="available" name="With contract help" stroke={C.ink} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="cappedAt" name="Capped month" stroke="none" dot={{ r: 4, fill: C.amber, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
          </ComposedChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="New customers a month: the plan, and what the hours allow" hint="Where the two lines part is the cost of being one person. The 'No capacity cap' scenario below is this gap, compounded."
          legend={[{ label: 'Plan', color: C.gray, kind: 'line' }, { label: 'Allowed by hours', color: C.brand, kind: 'line' }]}
          table={{ cols: [monthCol, { key: 'plan', label: 'Plan', fmt: money }, { key: 'allowed', label: 'Allowed', fmt: money }], rows: hours }}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={hours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {Grid()}{MonthAxis()}{NumAxis({ fmt: money })}<Tooltip content={<Tip fmt={money} />} cursor={{ stroke: C.grayL }} />
            <Line dataKey="plan" name="Plan" stroke={C.gray} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="allowed" name="Allowed by hours" stroke={C.brand} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>
        </ChartCard>
      </div>
    </Section>

    <Section id="scenarios" icon={TrendingUp} title="Five futures" hint="The same engine with one thing changed. 'No capacity cap' is the plan as written if hours were unlimited — the distance to Base is the argument for the hire.">
      <ChartCard title="MRR under each scenario" legend={[{ label: 'Base', color: C.brand, kind: 'line' }, { label: 'Other scenarios', color: C.gray, kind: 'line' }]} height={300}
        table={{ cols: [monthCol, ...order.map((k) => ({ key: k, label: S[k].label, fmt: usd }))], rows: scen }}>
        <ResponsiveContainer width="100%" height="100%"><LineChart data={scen} margin={{ top: 8, right: 96, left: 0, bottom: 0 }}>
          {Grid()}{MonthAxis()}{NumAxis({ fmt: usdK, width: 48 })}<Tooltip content={<Tip fmt={usd} />} cursor={{ stroke: C.grayL }} />
          {order.filter((k) => k !== 'base').map((k) => <Line key={k} dataKey={k} name={S[k].label} stroke={C.gray} strokeWidth={1.5} dot={false} isAnimationActive={false} label={<EndLabel last={last} text={S[k].label} />} />)}
          <Line dataKey="base" name="Base" stroke={C.brand} strokeWidth={2.5} dot={false} isAnimationActive={false} label={<EndLabel last={last} text="Base" />} />
        </LineChart></ResponsiveContainer>
      </ChartCard>
      <div className="mt-3 grid sm:grid-cols-5 gap-3">
        {order.map((k) => (
          <Card key={k} className={`p-4 ${k === 'base' ? 'border-brand-300' : ''}`}>
            <div className="text-[11px] uppercase tracking-wide text-surface-500">{S[k].label}</div>
            <div className="mt-1 font-display text-xl text-surface-900">{usd(S[k].endARR)}</div>
            <div className="text-xs text-surface-500">Year-3 ARR · {num(S[k].endCustomers)} customers</div>
            <div className="mt-2 text-xs text-surface-600">Founder paid from <span className="font-mono">{S[k].drawStartsMonth ? mon(S[k].drawStartsMonth) : '—'}</span></div>
            <div className="text-xs text-surface-600">Cash at end <span className="font-mono">{usd(S[k].endCash)}</span></div>
          </Card>
        ))}
      </div>
    </Section>

    <Section id="sensitivity" icon={Gauge} title="What actually moves Year-3 ARR" hint="One assumption moved at a time, everything else held. The bar runs from the low case to the high case; the dashed line is the base.">
      <ChartCard title="Year-3 ARR, low to high" height={40 + sens.length * 38}
        table={{ cols: [{ key: 'name', label: 'Assumption', fmt: (s) => s, right: false }, { key: 'low', label: 'Low', fmt: usd }, { key: 'high', label: 'High', fmt: usd }, { key: 'swing', label: 'Swing', fmt: usd }], rows: sens }}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={sens} layout="vertical" margin={{ top: 4, right: 64, left: 8, bottom: 0 }} barCategoryGap={10}>
          {Grid()}{NumAxisX({ fmt: usdK })}{CatAxisY({ width: 210 })}
          <Tooltip content={<Tip title={(s) => s} fmt={usd} />} cursor={{ fill: C.grid, opacity: 0.5 }} />
          <ReferenceLine x={Y[2].endARR} stroke={C.gray} strokeDasharray="3 3" />
          <Bar dataKey="range" name="Low – high" fill={C.brand} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
            <LabelList dataKey="swing" position="right" formatter={usdK} style={{ fontSize: 10, fill: C.text }} />
          </Bar>
        </BarChart></ResponsiveContainer>
      </ChartCard>
    </Section>

    <Section id="price" icon={DollarSign} title="The price list, tested" hint={`A year of software as a share of GDP per capita — Nicaragua ${usd(R.market.gdpNi)}, United States ${usd(R.market.gdpUs)}.`}>
      <div className="grid lg:grid-cols-2 gap-3">
        {[['Herd software, $ a month', herd, maxHerd], ['Small-business software, $ a month', biz, maxBiz]].map(([title, rows, maxV]) => (
          <ChartCard key={title} title={title} height={28 * rows.length + 24} legend={[{ label: 'SelRic', color: C.brand }, { label: 'Others', color: C.gray }]}
            table={{ cols: [{ key: 'name', label: 'Product', fmt: (s) => s, right: false }, { key: 'price', label: '$ / month', fmt: usd2 }], rows }}>
            <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }} barCategoryGap={6}>
              {NumAxisX({ fmt: usd, domain: [0, maxV], hide: true })}{CatAxisY({ width: 170 })}
              <Tooltip content={<Tip title={(s) => s} fmt={usd2} />} cursor={{ fill: C.grid, opacity: 0.5 }} />
              <Bar dataKey="price" name="$ / month" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false}>
                {rows.map((r) => <Cell key={r.name} fill={r.name.startsWith('SelRic') ? C.brand : C.gray} />)}
                <LabelList dataKey="price" position="right" formatter={usd} style={{ fontSize: 10, fill: C.text }} />
              </Bar>
            </BarChart></ResponsiveContainer>
          </ChartCard>
        ))}
      </div>
      <div className="mt-3">
        <Table head={<><TH>Program</TH><TH right>$ / month</TH><TH right>Share of GDP pc, NI</TH><TH>Why this price</TH></>}>
          <tr className="border-t border-surface-100"><TD className="font-medium">Business — every market</TD><TD right mono>{usd(R.prices.business)}</TD><TD right mono className="text-red-600 font-semibold">{pct(R.affordability.bizNi)}</TD><TD className="text-surface-600">{R.meta['price.business']?.note} In the US, {pct(R.affordability.bizUs, 1)}. Carried as the "{S.niBalk?.label}" scenario.</TD></tr>
          {R.tiers.map((t) => (
            <tr key={t.key} className="border-t border-surface-100"><TD className="font-medium">Ganadería — {t.tier.toLowerCase()}</TD><TD right mono>{usd(t.price)}</TD><TD right mono>{pct(t.affordability)}</TD><TD className="text-surface-600">{R.meta[`price.ganaderia.${t.key}.price`]?.note}</TD></tr>
          ))}
        </Table>
      </div>
    </Section>

    <Section id="market" icon={Globe} title="Market" hint={`The Ganadería tiers were derived, not guessed: ${num(R.market.largeFarms)} farms over 60 head hold ${pct(R.market.shareHerdOnLarge)} of a ${num(R.market.producers)}-producer, ${num(R.market.herd / 1e6, 1)}M-head herd — an average of ${num(R.market.avgHeadLarge)} head, which anchors how they split across the three tiers. The size of the market is not what limits this business; the hours are.`}>
      <Table head={<><TH>Segment</TH><TH right>Businesses</TH><TH right>Value / yr</TH><TH>Basis</TH></>}>
        {R.tiers.map((t) => <tr key={t.key} className="border-t border-surface-100"><TD>Ganadería — {t.tier.toLowerCase()} at {usd(t.price)}/mo</TD><TD right mono>{num(t.farms)}</TD><TD right mono>{usd(t.valueYr)}</TD><TD className="text-surface-500">derived</TD></tr>)}
        <tr className="border-t border-surface-100 font-semibold"><TD>SAM — Ganadería, tiered</TD><TD right mono>{num(R.market.samGFarms)}</TD><TD right mono>{usd(R.market.samG)}</TD><TD /></tr>
        <tr className="border-t border-surface-100 text-red-600"><TD>SAM — if the price had stayed {usd(R.prices.oldFlat)} flat</TD><TD right mono>{num(R.market.largeFarms)}</TD><TD right mono>{usd(R.market.samGAtOldFlat)}</TD><TD>large farms only</TD></tr>
        <tr className="border-t border-surface-100"><TD>TAM — Business, US Latino-owned employer firms</TD><TD right mono>{num(R.market.usLatinoFirms)}</TD><TD right mono>{usd(R.market.tamB_us)}</TD><TD className="text-surface-500">Stanford SOLE 2023</TD></tr>
        <tr className="border-t border-surface-100"><TD>SAM — Business, reachable in 3 years</TD><TD right mono>{num(R.market.samB_farms)}</TD><TD right mono>{usd(R.market.samB)}</TD><TD className="text-surface-500">MO restaurants + NI MIPYMES (estimate)</TD></tr>
        <tr className="border-t border-surface-100 font-semibold"><TD>SOM — base case, end of Year 3</TD><TD right mono>{num(Y[2].endCustomers)}</TD><TD right mono>{usd(Y[2].endARR)} ARR</TD><TD className="text-surface-500 font-normal">{pct(R.market.somShare, 2)} of the reachable market</TD></tr>
      </Table>
    </Section>

    <Section id="unit" icon={Target} title="Unit economics" hint={`Per customer, under the churn curve — expected life ${num(R.unit.life)} months. True CAC counts the founder's ${A.capacity.hoursPerNewCustomer} hours at ${usd(A.capacity.founderHourValue)} each on top of the cash.`}>
      <Table head={<><TH>Measure</TH><TH right>Business</TH><TH right>Ganadería (blended)</TH></>}>
        <tr className="border-t border-surface-100"><TD>Monthly price</TD><TD right mono>{usd2(R.unit.bizArpu)}</TD><TD right mono>{usd2(R.unit.ganArpu)}</TD></tr>
        <tr className="border-t border-surface-100"><TD>Lifetime gross profit</TD><TD right mono>{usd(R.unit.ltvB)}</TD><TD right mono>{usd(R.unit.ltvG)}</TD></tr>
        <tr className="border-t border-surface-100"><TD>True CAC</TD><TD right mono>{usd(R.unit.trueCac)}</TD><TD right mono>{usd(R.unit.trueCac)}</TD></tr>
        <tr className="border-t border-surface-100 font-semibold"><TD>LTV / true CAC</TD><TD right mono>{R.unit.ltvCacB.toFixed(1)}x</TD><TD right mono>{R.unit.ltvCacG.toFixed(1)}x</TD></tr>
        <tr className="border-t border-surface-100"><TD>Months to repay</TD><TD right mono>{num(R.unit.paybackB, 1)}</TD><TD right mono>{num(R.unit.paybackG, 1)}</TD></tr>
      </Table>
    </Section>

    <Section id="assumptions" icon={Flag} title="Every assumption" hint="Nothing has been billed, so all of these are guesses with a reason. Change one on the Model tab and every chart on these pages moves." right={<Link to="/ceo/model" className="text-sm text-brand-700 hover:underline shrink-0">Edit →</Link>}>
      <Table head={<><TH>Assumption</TH><TH>Value</TH></>}>
        {assumptionsTable.rows.map(([k, v]) => <tr key={k} className="border-t border-surface-100"><TD className="font-medium text-surface-800 align-top">{k}</TD><TD className="text-surface-600">{v}</TD></tr>)}
      </Table>
      <Card className="mt-3 p-4"><div className="text-sm font-medium text-surface-900">Sources</div><ul className="mt-2 text-sm text-surface-600 space-y-1.5 list-disc pl-5">{R.sources.map((s) => <li key={s}>{s}</li>)}</ul></Card>
    </Section>
  </>);
}

function Plan({ animals, ws, R, M, plan }) {
  const today = new Date().toISOString().slice(0, 10);
  const metricValue = { animals, paying: M.payingNow, payingGan: M.payingGan, referrals: M.referrals };
  return (<>
    <Section icon={Flag} title="Milestones" hint="Commercial, not technical. A feature that ships to nobody is not progress. Status comes from the pilots and the funnel; the right-hand column is where the model's base case says we should be on that date." right={<Link to="/ceo/documents" className="text-sm text-brand-700 hover:underline shrink-0">Edit →</Link>}>
      <Card className="divide-y divide-surface-100">
        {plan.milestones.map((m) => {
          const target = m.targetPath && R ? get(R, m.targetPath) : m.target ? m.target * (m.per === 'pilot' ? ws.length : 1) : null;
          const n = m.metric ? metricValue[m.metric] ?? 0 : null;
          const done = m.metric ? (target ? n >= target : n > 0) : false, overdue = !done && m.due < today;
          const at = R ? M.atMonth(m.due.slice(0, 7)) : null;
          return (
            <div key={m.key} className="flex items-center gap-3 px-4 py-3">
              {done ? <CheckCircle2 size={17} className="text-brand-600 shrink-0" /> : <Circle size={17} className={`shrink-0 ${overdue ? 'text-red-500' : 'text-surface-300'}`} />}
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${done ? 'text-surface-500 line-through' : 'text-surface-800'}`}>{R ? resolve(m.what, R) : m.what}</div>
                {target > 1 && !done && <div className="mt-1.5 flex items-center gap-2"><div className="w-32"><Meter value={n} max={target} /></div><span className="font-mono text-[11px] text-surface-500">{n} / {num(target)}</span></div>}
              </div>
              {at && <span className="hidden sm:block text-[11px] text-surface-500 text-right w-36">model: {num(at.total)} paying · {usd(at.mrr)}/mo</span>}
              <span className={`font-mono text-xs w-24 text-right ${overdue ? 'text-red-600 font-semibold' : 'text-surface-500'}`}>{m.due}{overdue ? ' · late' : ''}</span>
            </div>
          );
        })}
        {plan.milestones.length === 0 && <div className="px-4 py-3 text-sm text-surface-500">No milestones published yet.</div>}
      </Card>
    </Section>
    <Section icon={Target} title="The next twelve months">
      <Card className="divide-y divide-surface-100">
        {plan.roadmap.map((r) => (
          <div key={r.quarter} className="grid sm:grid-cols-[90px_200px_1fr] gap-2 px-4 py-3 text-sm"><span className="font-mono text-surface-500">{r.quarter}</span><span className="font-medium text-surface-900">{r.focus}</span><span className="text-surface-600">{R ? resolve(r.actions, R) : r.actions}</span></div>
        ))}
        {plan.roadmap.length === 0 && <div className="px-4 py-3 text-sm text-surface-500">No roadmap published yet.</div>}
      </Card>
    </Section>
  </>);
}

// ── shell ───────────────────────────────────────────────────────────────────
const TABS = [['', 'Overview'], ['pilots', 'Pilots'], ['funnel', 'Funnel'], ['research', 'Research'], ['model', 'Model'], ['documents', 'Documents'], ['plan', 'Plan']];

export default function CeoPage() {
  const [data, setData] = useState(null);
  const [versions, setVersions] = useState([]);     // platform_assumptions, newest first
  const [docRows, setDocRows] = useState({});       // platform_documents by doc, newest first
  const [leads, setLeads] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { pathname, hash } = useLocation();
  const tab = (pathname.replace(/^\/ceo\/?/, '').split('/')[0] || '');

  // One load for the four sources. The model and the funnel may be absent
  // (not migrated, not seeded); neither takes the pilot view down.
  async function load() {
    data ? setRefreshing(true) : setLoading(true); setError('');
    const [o, a, d, l, e] = await Promise.all([
      supabase.rpc('ceo_overview'),
      supabase.from('platform_assumptions').select('id, version, data, note, created_at').order('version', { ascending: false }),
      supabase.from('platform_documents').select('id, doc, version, sections, note, created_at').order('version', { ascending: false }),
      supabase.from('platform_leads').select('*'),
      supabase.from('platform_lead_events').select('lead_id, at, to_stage').order('at', { ascending: true }),
    ]);
    if (o.error) { setError(o.error.message); setLoading(false); setRefreshing(false); return; }
    setData(o.data);
    setVersions(a.data || []);
    const rows = {}; for (const r of d.data || []) (rows[r.doc] ||= []).push(r); setDocRows(rows);
    setLeads(l.data || []); setEvents(e.data || []);
    setLoading(false); setRefreshing(false);
  }
  useEffect(() => { load(); }, []);
  // A finding links to its chart: /ceo/research#capacity. Scroll once the tab has rendered.
  useEffect(() => {
    if (!hash || loading) return;
    const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => clearTimeout(t);
  }, [hash, tab, loading]);

  const assump = versions[0] || null;
  const R = useMemo(() => { if (!assump) return null; try { return compute(assump.data); } catch (e) { console.error('model', e); return null; } }, [assump]);
  const docs = useMemo(() => ({ findings: docRows.findings?.[0]?.sections || [], plan: docRows.plan?.[0]?.sections || { milestones: [], roadmap: [] } }), [docRows]);
  const findings = useMemo(() => (R ? docs.findings.map((s) => ({ key: s.key, title: plain(s.title, R, docs), body: plain(s.body, R, docs) })) : []), [R, docs]);
  const ws = useMemo(() => (data?.workspaces || []).map((w) => ({ ...w, h: health(w) })), [data]);
  const M = useModel(R, leads, events);
  const animals = ws.reduce((s, w) => s + (w.counts?.animals || 0), 0);
  const neverUsed = ws.filter((w) => w.h.key === 'never');

  if (loading) return <div className="p-10 flex justify-center"><Spinner /></div>;
  if (error) {
    const denied = /NOT_PLATFORM_ADMIN/.test(error);
    return (
      <div className="max-w-xl mx-auto mt-16 rounded-xl border border-surface-200 bg-white p-7 text-center">
        <AlertTriangle className="mx-auto text-amber-500" size={28} />
        <h1 className="mt-3 font-display text-xl text-brand-950">{denied ? 'Not a platform admin' : 'Could not load'}</h1>
        <p className="mt-2 text-sm text-surface-600 leading-relaxed">{denied ? 'This page looks across every workspace, so it is limited to the people who run SelRic.' : error}</p>
        <button onClick={load} className="btn-secondary mt-5"><RefreshCw size={15} /> Try again</button>
      </div>
    );
  }

  return (
    <div className={`max-w-6xl mx-auto px-1 pb-16 transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4 pt-2">
        <div><h1 className="font-display text-3xl text-brand-950">Oversight</h1><p className="mt-1 text-surface-600">Every pilot, the funnel and the model on one calendar — what is alive, what is not, and how far off the plan we are.</p></div>
        <button onClick={load} className="btn-secondary shrink-0"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh</button>
      </div>
      <nav className="mt-5 flex gap-1 border-b border-surface-200 overflow-x-auto">
        {TABS.map(([k, label]) => <Link key={k} to={`/ceo${k ? '/' + k : ''}`} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${tab === k ? 'border-brand-600 text-brand-900' : 'border-transparent text-surface-500 hover:text-surface-800'}`}>{label}</Link>)}
      </nav>
      {tab === '' && <Overview data={data} ws={ws} animals={animals} neverUsed={neverUsed} R={R} M={M} findings={findings} />}
      {tab === 'pilots' && <Pilots data={data} ws={ws} R={R} M={M} />}
      {tab === 'funnel' && <FunnelPage R={R} M={M} onChange={load} />}
      {tab === 'research' && <Research R={R} M={M} findings={findings} assump={assump} />}
      {tab === 'model' && <ModelPage assump={assump} versions={versions} onSaved={load} />}
      {tab === 'documents' && <DocumentsPage R={R} docRows={docRows} assump={assump} onSaved={load} />}
      {tab === 'plan' && <Plan animals={animals} ws={ws} R={R} M={M} plan={docs.plan} />}
      <p className="mt-10 text-xs text-surface-400 leading-relaxed max-w-[75ch]">
        Pilot counts come from <code>ceo_overview()</code>, which returns aggregates only. The model is computed in this browser from <code>platform_assumptions</code> v{assump?.version ?? '—'}; the prose comes from <code>platform_documents</code>. Both are readable only by platform admins, and nothing confidential is in this site's code.
        Data as of {data.generated_at ? String(data.generated_at).slice(0, 19).replace('T', ' ') : '—'}.
      </p>
    </div>
  );
}
