import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity, AlertTriangle, Beef, Briefcase, CheckCircle2, ChevronDown, ChevronRight, Circle,
  DollarSign, Download, FileSpreadsheet, FileText, Flag, Globe, RefreshCw, Target, TrendingUp, Users,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import Spinner from '../../components/ui/Spinner';

// CEO oversight — the only view that looks across every workspace at once.
// Four pages under /ceo: Overview, Pilots, Research, Plan.
//
// Nothing confidential is in this file or in the bundle. The pilot counts come
// from ceo_overview(); the research — plan, model, market — comes from one
// jsonb row in platform_research and three files in the private bucket
// platform-docs, both readable only when is_platform_admin(). They are put
// there by ~/selric-business/publish.mjs, from outside the repository.

const usd = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const usd2 = (n) => '$' + Number(n).toFixed(2);
const num = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const daysSince = (d) => (!d || d < '2000-01-01') ? null : Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);
const DOC_NAMES = ['SelRic_Business_Plan.docx', 'SelRic_Market_Analysis_and_GTM.docx', 'SelRic_Financial_Model.xlsx'];

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
function Section({ icon: Icon, title, hint, children, right }) {
  return (
    <section className="mt-8">
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
const Bar = ({ value, max, tone = 'bg-brand-600' }) => <div className="h-2 rounded-full bg-surface-100 overflow-hidden"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }} /></div>;

// Shown wherever research would be, until publish.mjs has run.
function NotPublished() {
  return (
    <Card className="p-5 flex gap-3 items-start">
      <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
      <div className="text-sm text-surface-700 leading-relaxed">
        <span className="font-medium text-surface-900">Research not published yet.</span> The plan, model and market analysis are kept out of the repository and the site. Publish them from outside the repo with <code className="font-mono text-xs">node ~/selric-business/publish.mjs</code> and refresh.
      </div>
    </Card>
  );
}

// ── pages ───────────────────────────────────────────────────────────────────
function Overview({ data, ws, paying, animals, neverUsed, R }) {
  return (<>
    <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat icon={DollarSign} label="Paying customers" value={paying} tone={paying === 0 ? 'text-red-600' : 'text-brand-900'} sub={paying === 0 ? 'Nobody has ever been billed.' : null} to="/ceo/pilots" />
      <Stat icon={TrendingUp} label="MRR" value={usd(0)} sub="All workspaces are free pilots." to="/ceo/plan" />
      <Stat icon={Users} label="Pilot workspaces" value={data.platform.workspaces} sub={`${data.platform.users} user${data.platform.users === 1 ? '' : 's'} across them`} to="/ceo/pilots" />
      <Stat icon={Beef} label="Animals in Ganadería" value={animals} tone={animals === 0 ? 'text-red-600' : 'text-brand-900'} sub={animals === 0 ? 'The program shipped and has no user.' : null} to="/ceo/pilots" />
    </div>

    {(neverUsed.length > 0 || animals === 0) && (
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 leading-relaxed">
            <span className="font-semibold">Needs attention. </span>
            {neverUsed.length > 0 && <>{neverUsed.map((w) => w.name).join(', ')} {neverUsed.length === 1 ? 'has' : 'have'} never been used. </>}
            {animals === 0 && <>Ganadería is in production with zero animals; the Batavia invitation is unused. </>}
            <Link to="/ceo/pilots" className="underline underline-offset-2 font-medium">See pilots →</Link>
          </div>
        </div>
      </div>
    )}

    <Section icon={Target} title="Distance to break-even" hint="From the financial model at the current price list." right={<Link to="/ceo/research" className="text-sm text-brand-700 hover:underline shrink-0">The model →</Link>}>
      {!R ? <NotPublished /> : (
        <div className="grid sm:grid-cols-3 gap-3">
          {[{ n: R.breakeven.fixed, label: 'Cover platform + accountant' }, { n: R.breakeven.fixedPlusHelp, label: 'Cover fixed + contract help' }, { n: R.breakeven.founder4k, label: 'Pay the founder $4,000/mo' }].map((b) => (
            <Card key={b.label} className="p-4">
              <div className="flex items-baseline justify-between gap-2"><span className="text-sm font-medium text-surface-800">{b.label}</span><span className="font-mono text-sm">{paying} / {num(b.n, 1)}</span></div>
              <div className="mt-2.5"><Bar value={paying} max={b.n} /></div>
            </Card>
          ))}
        </div>
      )}
    </Section>

    {R && (
      <Section icon={Flag} title="What decides this" hint="The three findings from the analysis, carried here so they are seen every time this page is." right={<Link to="/ceo/research" className="text-sm text-brand-700 hover:underline shrink-0">Full research →</Link>}>
        <div className="grid md:grid-cols-3 gap-3">
          {R.findings.map((f, i) => (
            <Card key={f.title} className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Finding {i + 1}</div>
              <div className="mt-1 font-medium text-surface-900 leading-snug">{f.title}</div>
              <p className="mt-2 text-sm text-surface-600 leading-relaxed">{f.body}</p>
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

function Pilots({ data, ws }) {
  const [open, setOpen] = useState(null);
  const COUNTS = [['transactions', 'Transactions'], ['sales', 'Sales'], ['products', 'Products'], ['customers', 'Customers'], ['inventory_logs', 'Stock moves'], ['animals', 'Animals'], ['herd_events', 'Herd events']];
  return (<>
    <Section icon={Activity} title="Pilot health" hint="Click a row for what is actually inside. Last activity counts anything a person put in — a sale, a customer, a stock move, an animal. Bookkeeping you back-filled yourself still counts, so a workspace that looks quiet here is definitely quiet.">
      <Table head={<><TH>Workspace</TH><TH>Program</TH><TH>Mode</TH><TH right>Users</TH><TH right>30-day activity</TH><TH>Last activity</TH><TH>Portal</TH><TH /></>}>
        {ws.map((w) => {
          const isOpen = open === w.id;
          const touched = COUNTS.filter(([k]) => k !== 'transactions').reduce((s, [k]) => s + (w.counts[k] || 0), 0);
          return (<>
            <tr key={w.id} onClick={() => setOpen(isOpen ? null : w.id)} className={`border-t border-surface-100 cursor-pointer hover:bg-surface-50 ${isOpen ? 'bg-surface-50' : ''}`}>
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
          </>);
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

function Research({ R, docs, updatedAt }) {
  if (!R) return <div className="mt-6"><NotPublished /></div>;
  const maxSwing = Math.max(...R.sensitivity.map((s) => s.high - s.low));
  const herdMax = Math.max(...R.competitors.herd.map(([, p]) => p), 100);
  return (<>
    <Section icon={FileText} title="The documents" hint="Generated from the same model that produced every number on this page, and served from a private bucket only to platform admins. The Excel is live: change a shaded cell on its Assumptions tab and everything moves.">
      <div className="grid sm:grid-cols-3 gap-3">
        {DOC_NAMES.map((name) => {
          const d = docs[name];
          const inner = (<>
            <div className="flex items-center gap-2 text-brand-700">{name.endsWith('.xlsx') ? <FileSpreadsheet size={18} /> : <FileText size={18} />}{d?.url && <Download size={14} className="ml-auto text-surface-400" />}</div>
            <div className="mt-2 text-sm font-medium text-surface-900 leading-snug">{name.replace(/_/g, ' ').replace(/\.(docx|xlsx)$/, '')}</div>
            <div className="mt-1 text-xs text-surface-500">{d?.url ? `${name.split('.').pop().toUpperCase()} · link valid one hour` : d?.error ? <span className="text-amber-700">{d.error}</span> : 'not uploaded yet'}</div>
          </>);
          return d?.url
            ? <a key={name} href={d.url} download={name} className="rounded-xl border border-surface-200 bg-white p-4 hover:border-brand-300 hover:bg-brand-50/30 transition-colors">{inner}</a>
            : <Card key={name} className="p-4 opacity-70">{inner}</Card>;
        })}
      </div>
    </Section>

    <Section icon={Flag} title="The three findings">
      <div className="space-y-3">
        {R.findings.map((f, i) => (
          <Card key={f.title} className="p-4 flex gap-4"><div className="font-display text-2xl text-brand-300 leading-none">{i + 1}</div><div><div className="font-medium text-surface-900">{f.title}</div><p className="mt-1 text-sm text-surface-600 leading-relaxed">{f.body}</p></div></Card>
        ))}
      </div>
    </Section>

    <Section icon={TrendingUp} title="Sensitivity — what actually moves Year-3 ARR" hint="One assumption moved at a time, everything else held. The bar is the swing.">
      <Card className="p-4 space-y-3">
        {R.sensitivity.map((s) => (
          <div key={s.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="text-surface-800">{s.name}</span><span className="font-mono text-surface-600">{usd(s.low)} … {usd(s.high)} <span className="text-surface-900 font-semibold ml-2">{usd(s.high - s.low)}</span></span></div>
            <div className="mt-1.5"><Bar value={s.high - s.low} max={maxSwing} /></div>
          </div>
        ))}
      </Card>
    </Section>

    <Section icon={DollarSign} title="The price list, tested" hint={`A year of software as a share of GDP per capita — Nicaragua ${usd(R.market.gdpNi)}, United States ${usd(R.market.gdpUs)}.`}>
      <Table head={<><TH>Program</TH><TH right>$ / month</TH><TH right>Share of GDP pc, NI</TH><TH>Reading</TH></>}>
        <tr className="border-t border-surface-100"><TD className="font-medium">Business — every market</TD><TD right mono>{usd(R.prices.business)}</TD><TD right mono className="text-red-600 font-semibold">{pct(R.affordability.biz100_ni)}</TD><TD className="text-surface-600">The exposed price: half a year of average income for a bakery. In the US, {pct(R.affordability.biz100_us, 1)}.</TD></tr>
        {R.prices.ganaderia.map((t) => (
          <tr key={t.tier} className="border-t border-surface-100"><TD className="font-medium">Ganadería — {t.tier.toLowerCase()}</TD><TD right mono>{usd(t.price)}</TD><TD right mono>{pct((t.price * 12) / R.market.gdpNi)}</TD><TD className="text-surface-600">{t.price === 50 ? 'Payable out of one steer.' : t.price === 75 ? 'A 150-head farm turns over several times the average.' : 'The AgriWebb tier; the ranch that pays it does not notice it.'}</TD></tr>
        ))}
      </Table>
      <div className="mt-4 grid md:grid-cols-2 gap-3">
        <Card className="p-4"><div className="text-sm font-medium text-surface-900">Herd software, $/month</div><div className="mt-3 space-y-2">
          {[...R.competitors.herd, ['SelRic entry tier', 50], ['SelRic top tier', 100]].map(([n, p]) => (<div key={n} className="text-xs"><div className="flex justify-between"><span className={n.startsWith('SelRic') ? 'font-semibold text-brand-800' : 'text-surface-700'}>{n}</span><span className="font-mono">{usd2(p)}</span></div><div className="mt-1"><Bar value={p} max={herdMax} tone={n.startsWith('SelRic') ? 'bg-brand-600' : 'bg-surface-300'} /></div></div>))}
        </div></Card>
        <Card className="p-4"><div className="text-sm font-medium text-surface-900">Small-business software, $/month</div><div className="mt-3 space-y-2">
          {[...R.competitors.business, ['SelRic Business', 100]].sort((a, b) => a[1] - b[1]).map(([n, p]) => (<div key={n} className="text-xs"><div className="flex justify-between"><span className={n.startsWith('SelRic') ? 'font-semibold text-brand-800' : 'text-surface-700'}>{n}</span><span className="font-mono">{usd2(p)}</span></div><div className="mt-1"><Bar value={p} max={170} tone={n.startsWith('SelRic') ? 'bg-brand-600' : 'bg-surface-300'} /></div></div>))}
        </div></Card>
      </div>
    </Section>

    <Section icon={Globe} title="Market" hint={`The Ganadería tiers were derived, not guessed: ${num(R.market.largeFarms)} farms over 60 head hold 35% of a ${num(R.market.producers)}-producer, 5.3M-head herd — an average of ${num(R.market.avgHeadLarge)} head, which anchors how they split across the three tiers.`}>
      <Table head={<><TH>Segment</TH><TH right>Businesses</TH><TH right>Value / yr</TH><TH>Basis</TH></>}>
        {R.tiers.map((t) => <tr key={t.key} className="border-t border-surface-100"><TD>Ganadería — {t.key === 't50' ? 'up to 100' : t.key === 't75' ? '101–200' : 'over 200'} head at {usd(t.price)}/mo</TD><TD right mono>{num(t.farms)}</TD><TD right mono>{usd(t.valueYr)}</TD><TD className="text-surface-500">derived</TD></tr>)}
        <tr className="border-t border-surface-100 font-semibold"><TD>SAM — Ganadería, tiered</TD><TD right mono>{num(R.market.samGFarms)}</TD><TD right mono>{usd(R.market.samG)}</TD><TD /></tr>
        <tr className="border-t border-surface-100 text-red-600"><TD>SAM — if the price had stayed $150 flat</TD><TD right mono>{num(R.market.largeFarms)}</TD><TD right mono>{usd(R.market.samG_at150)}</TD><TD>large farms only</TD></tr>
        <tr className="border-t border-surface-100"><TD>TAM — Business, US Latino-owned employer firms</TD><TD right mono>{num(R.market.usLatinoFirms)}</TD><TD right mono>{usd(R.market.tamB_us)}</TD><TD className="text-surface-500">Stanford SOLE 2023</TD></tr>
        <tr className="border-t border-surface-100"><TD>SAM — Business, reachable in 3 years</TD><TD right mono>{num(R.market.samB_farms)}</TD><TD right mono>{usd(R.market.samB)}</TD><TD className="text-surface-500">MO restaurants + NI MIPYMES (estimate)</TD></tr>
        <tr className="border-t border-surface-100 font-semibold"><TD>SOM — plan case, end of Year 3</TD><TD right mono>{num(R.years[2].endCustomers)}</TD><TD right mono>{usd(R.years[2].endARR)} ARR</TD><TD className="text-surface-500 font-normal">financial model</TD></tr>
      </Table>
    </Section>

    <Section icon={Target} title="Unit economics and the plan" hint="Per customer, and the three years. Operating profit is before the founder is paid anything.">
      <div className="grid md:grid-cols-2 gap-3">
        <Table head={<><TH>Measure</TH><TH right>Business</TH><TH right>Ganadería</TH></>}>
          <tr className="border-t border-surface-100"><TD>Monthly price (Ganadería blended)</TD><TD right mono>{usd2(R.unit.bizArpu)}</TD><TD right mono>{usd2(R.unit.ganArpu)}</TD></tr>
          <tr className="border-t border-surface-100"><TD>Lifetime gross profit</TD><TD right mono>{usd(R.unit.ltvB)}</TD><TD right mono>{usd(R.unit.ltvG)}</TD></tr>
          <tr className="border-t border-surface-100"><TD>True CAC (cash + 12 founder hours)</TD><TD right mono>{usd(R.unit.trueCac)}</TD><TD right mono>{usd(R.unit.trueCac)}</TD></tr>
          <tr className="border-t border-surface-100 font-semibold"><TD>LTV / true CAC</TD><TD right mono>{R.unit.ltvCacB.toFixed(1)}x</TD><TD right mono>{R.unit.ltvCacG.toFixed(1)}x</TD></tr>
          <tr className="border-t border-surface-100"><TD>Months to repay</TD><TD right mono>{num(R.unit.paybackB, 1)}</TD><TD right mono>{num(R.unit.paybackG, 1)}</TD></tr>
        </Table>
        <Table head={<><TH /><TH right>Year 1</TH><TH right>Year 2</TH><TH right>Year 3</TH></>}>
          <tr className="border-t border-surface-100"><TD>Customers</TD>{R.years.map((y) => <TD key={y.year} right mono>{num(y.endCustomers)}</TD>)}</tr>
          <tr className="border-t border-surface-100"><TD>ARR</TD>{R.years.map((y) => <TD key={y.year} right mono>{usd(y.endARR)}</TD>)}</tr>
          <tr className="border-t border-surface-100 font-semibold"><TD>Operating profit</TD>{R.years.map((y) => <TD key={y.year} right mono className={y.profit < 0 ? 'text-red-600' : ''}>{usd(y.profit)}</TD>)}</tr>
          <tr className="border-t border-surface-100 text-red-600"><TD>Founder hours / month</TD>{R.years.map((y) => <TD key={y.year} right mono>{num(y.hoursOnFounder)}</TD>)}</tr>
        </Table>
      </div>
      <div className="mt-3 grid sm:grid-cols-4 gap-3">
        {[['downside', 'Downside'], ['base', 'Base'], ['upside', 'Upside'], ['niBalk', 'NI pilots balk']].map(([k, label]) => (
          <Card key={k} className="p-4"><div className="text-[11px] uppercase tracking-wide text-surface-500">{label}</div><div className="mt-1 font-display text-xl">{usd(R.scenarios[k].endARR)}</div><div className="text-xs text-surface-500">Year-3 ARR · {num(R.scenarios[k].endCustomers)} customers</div></Card>
        ))}
      </div>
    </Section>

    <Section icon={FileText} title="Sources">
      <Card className="p-4"><ul className="text-sm text-surface-600 space-y-1.5 list-disc pl-5">{R.sources.map((s) => <li key={s}>{s}</li>)}</ul></Card>
      <p className="mt-3 text-xs text-surface-400">Model run {R.generatedAt?.slice(0, 10)} · published {updatedAt ? String(updatedAt).slice(0, 10) : '—'}.</p>
    </Section>
  </>);
}

function Plan({ paying, animals, R }) {
  const fixedN = R ? Math.ceil(R.breakeven.fixedPlusHelp) : null, founderN = R ? Math.ceil(R.breakeven.founder4k) : null;
  const MILESTONES = [
    { due: '2026-11-30', what: 'Finca Batavia live with its herd loaded', key: 'batavia' },
    { due: '2026-12-31', what: 'First invoice issued and paid', key: 'firstPaid' },
    { due: '2026-12-31', what: 'Price list live in the product; paid infrastructure tiers', key: 'pricing' },
    { due: '2027-03-31', what: 'Each pilot has made two introductions', key: 'referrals' },
    { due: '2027-06-30', what: '10 paying customers; churn measured for two quarters', key: 'ten' },
    { due: '2027-12-31', what: `${fixedN ?? '—'} paying — fixed costs and contract help covered`, key: 'fixed' },
    { due: '2027-12-31', what: 'Ganadería: three paying ranches, or archive it', key: 'ganDecision' },
    { due: '2028-12-31', what: `${founderN ?? '—'} paying — the founder can be paid $4,000 a month`, key: 'founder' },
  ];
  const state = (k) => (k === 'batavia' ? (animals > 0 ? 'done' : 'open') : k === 'firstPaid' && paying > 0 ? 'done' : 'open');
  const today = new Date().toISOString().slice(0, 10);
  return (<>
    <Section icon={Flag} title="Milestones" hint="Commercial, not technical. A feature that ships to nobody is not progress. Status is computed from the data where it can be.">
      <Card className="divide-y divide-surface-100">
        {MILESTONES.map((m) => { const st = state(m.key), overdue = st !== 'done' && m.due < today; return (
          <div key={m.key} className="flex items-center gap-3 px-4 py-3">
            {st === 'done' ? <CheckCircle2 size={17} className="text-brand-600 shrink-0" /> : <Circle size={17} className={`shrink-0 ${overdue ? 'text-red-500' : 'text-surface-300'}`} />}
            <span className={`flex-1 text-sm ${st === 'done' ? 'text-surface-500 line-through' : 'text-surface-800'}`}>{m.what}</span>
            <span className={`font-mono text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-surface-500'}`}>{m.due}{overdue ? ' · overdue' : ''}</span>
          </div>); })}
      </Card>
    </Section>
    <Section icon={Target} title="The next twelve months">
      <Card className="divide-y divide-surface-100">
        {[['Q4 2026', 'Make it a business', 'Land Batavia and load its herd. Put the price list in the product. Move to paid tiers. Referral first, price second, with all four pilots. Issue the first invoice.'], ['Q1 2027', 'Prove the reference loop', 'Two introductions per pilot. First three Spanish case studies. Two accountants in St. Louis.'], ['Q2 2027', 'First channel beyond the founder', 'One Missouri restaurant association, one Nicaraguan cattle association. Ten paying. Churn measured.'], ['Q3 2027', 'Relieve the constraint', 'Contract support for onboarding and first-line.'], ['Q4 2027', 'Decide on Ganadería', 'Three paying ranches, or archive it. On the date.']].map(([q, f, a]) => (
          <div key={q} className="grid sm:grid-cols-[90px_200px_1fr] gap-2 px-4 py-3 text-sm"><span className="font-mono text-surface-500">{q}</span><span className="font-medium text-surface-900">{f}</span><span className="text-surface-600">{a}</span></div>
        ))}
      </Card>
    </Section>
  </>);
}

// ── shell ───────────────────────────────────────────────────────────────────
const TABS = [['', 'Overview'], ['pilots', 'Pilots'], ['research', 'Research'], ['plan', 'Plan']];

export default function CeoPage() {
  const [data, setData] = useState(null);
  const [R, setR] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [docs, setDocs] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const { pathname } = useLocation();
  const tab = (pathname.replace(/^\/ceo\/?/, '').split('/')[0] || '');

  async function load() {
    setLoading(true); setError('');
    const { data: d, error: e } = await supabase.rpc('ceo_overview');
    if (e) { setError(e.message); setLoading(false); return; }
    setData(d);
    // Research row and document links. Absent or unreadable simply means
    // "not published yet"; it must never take the pilot view down with it.
    const { data: row } = await supabase.from('platform_research').select('doc, updated_at').eq('key', 'research').maybeSingle();
    setR(row?.doc || null); setUpdatedAt(row?.updated_at || null);
    const out = {};
    await Promise.all(DOC_NAMES.map(async (name) => {
      const { data: s, error: se } = await supabase.storage.from('platform-docs').createSignedUrl(name, 3600);
      out[name] = s?.signedUrl ? { url: s.signedUrl } : { error: se?.message?.includes('not found') ? 'not uploaded yet' : (se?.message || 'unavailable') };
    }));
    setDocs(out);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const ws = useMemo(() => (data?.workspaces || []).map((w) => ({ ...w, h: health(w) })), [data]);
  const paying = data?.platform?.paying ?? 0;
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
    <div className="max-w-6xl mx-auto px-1 pb-16">
      <div className="flex items-start justify-between gap-4 pt-2">
        <div><h1 className="font-display text-3xl text-brand-950">Oversight</h1><p className="mt-1 text-surface-600">Every pilot at once — what is alive, what is not, and what the research says to do about it.</p></div>
        <button onClick={load} className="btn-secondary shrink-0"><RefreshCw size={15} /> Refresh</button>
      </div>
      <nav className="mt-5 flex gap-1 border-b border-surface-200">
        {TABS.map(([k, label]) => <Link key={k} to={`/ceo${k ? '/' + k : ''}`} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === k ? 'border-brand-600 text-brand-900' : 'border-transparent text-surface-500 hover:text-surface-800'}`}>{label}</Link>)}
      </nav>
      {tab === '' && <Overview data={data} ws={ws} paying={paying} animals={animals} neverUsed={neverUsed} R={R} />}
      {tab === 'pilots' && <Pilots data={data} ws={ws} />}
      {tab === 'research' && <Research R={R} docs={docs} updatedAt={updatedAt} />}
      {tab === 'plan' && <Plan paying={paying} animals={animals} R={R} />}
      <p className="mt-10 text-xs text-surface-400 leading-relaxed max-w-[75ch]">
        Pilot counts come from <code>ceo_overview()</code>, which returns aggregates only. Research comes from <code>platform_research</code> and the private bucket <code>platform-docs</code>, readable only by platform admins. Nothing confidential is in this site's code.
        Data as of {data.generated_at ? String(data.generated_at).slice(0, 19).replace('T', ' ') : '—'}.
      </p>
    </div>
  );
}
