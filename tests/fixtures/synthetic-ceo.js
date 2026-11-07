// An invented SelRic office for the /ceo pages: the internal workspace a
// platform admin signs in to, and what ceo_overview() would return for four
// invented customer workspaces — one for each state the roll-up shows. The
// plan (platform_assumptions, platform_documents) is left empty, so the model
// pages show their "not published" states; the plan never goes in a fixture.
//
//   makeCeo({ today })
//     → { org, user, profile, programs, tables, rpc: { is_platform_admin, ceo_overview }, overview }
//
// The workspaces' `checks` are the synthetic restaurant's and finca's own
// check runs (with their planted problems, and a clean run for the quiet
// café), stored the way ceo_overview() returns them — the newest row per
// check, { key, status, skipped, run_at } — so a chip shows what the checks
// really score. Every name and count is invented.
import { makeBusiness } from './synthetic-business.js';
import { makeHerd } from './synthetic-herd.js';
import { runChecks } from '../../src/lib/checks/index.js';

const PREFIX = { org: 'ca771e10', user: 'ca771e11' };
const uid = (kind, n) => `${PREFIX[kind]}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const addDays = (date, n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);

export const CEO_ORG_ID = uid('org', 1);
export const CEO_USER_ID = uid('user', 1);

// A run as ceo_overview() hands it over.
const stored = (results, runAt) => results.map((r) => ({ key: r.key, status: r.status, skipped: !!r.detail?.skipped, run_at: runAt }));
const COUNTS0 = { transactions: 0, sales: 0, products: 0, customers: 0, inventory_logs: 0, animals: 0, herd_events: 0 };

export function makeCeo({ today = '2026-11-07' } = {}) {
  const at = (d) => `${d}T06:00:00.000Z`;
  const org = { id: CEO_ORG_ID, name: 'SelRic (synthetic)', slug: 'selric-synthetic', business_type: 'other', is_legacy: false, created_by: CEO_USER_ID, created_at: at(addDays(today, -400)), updated_at: at(addDays(today, -400)), plan: 'internal', accounting_mode: 'full', config: { configured: true }, is_internal: true, is_test: true };
  const user = { id: CEO_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'ceo@selric-synthetic.invalid', email_confirmed_at: org.created_at, app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Synthetic CEO' }, created_at: org.created_at };
  const profile = { id: CEO_USER_ID, org_id: CEO_ORG_ID, role: 'admin', full_name: 'Synthetic CEO', email: user.email, locale: 'en', created_at: user.created_at };
  const programs = [{ org_id: CEO_ORG_ID, program: 'business', plan: 'internal', enabled_at: org.created_at }];

  const bistro = makeBusiness({ today, issues: true });
  const cafe = makeBusiness({ today, name: 'Quiet Café (synthetic)' });
  const finca = makeHerd({ today, issues: true });
  const lastWeek = addDays(today, -1);
  const workspaces = [
    {
      id: uid('org', 2), name: bistro.org.name, created_at: bistro.org.created_at, accounting_mode: 'full', plan: 'pilot', configured: true, program: 'business', users: 2,
      counts: { ...COUNTS0, transactions: bistro.tables.transactions?.length || 0, sales: 140, products: 24, customers: 31, inventory_logs: 58 },
      last_activity: lastWeek, activity_30d: 64,
      activity_weeks: [9, 12, 10, 14, 11, 16, 13, 15, 18, 14, 17, 19],
      checks: stored(runChecks(bistro.data, { today, program: 'business' }), at(lastWeek)),
    },
    {
      id: uid('org', 3), name: finca.org.name, created_at: finca.org.created_at, accounting_mode: 'simple', plan: 'pilot', configured: true, program: 'ganaderia', users: 1,
      counts: { ...COUNTS0, animals: finca.data.animals.length, herd_events: finca.data.events.length },
      last_activity: addDays(today, -3), activity_30d: 38,
      activity_weeks: [0, 2, 5, 3, 8, 6, 9, 7, 11, 10, 8, 12],
      checks: stored(runChecks(finca.data, { today, program: 'ganaderia' }), at(addDays(today, -3))),
    },
    {
      id: uid('org', 4), name: cafe.org.name, created_at: cafe.org.created_at, accounting_mode: 'full', plan: 'pilot', configured: true, program: 'business', users: 1,
      counts: { ...COUNTS0, transactions: cafe.tables.transactions?.length || 0, sales: 22, products: 9, customers: 4 },
      last_activity: addDays(today, -45), activity_30d: 0,
      activity_weeks: [6, 8, 5, 3, 1, 0, 0, 0, 0, 0, 0, 0],
      checks: stored(runChecks(cafe.data, { today, program: 'business' }), at(addDays(today, -46))),
    },
    {
      id: uid('org', 5), name: 'Unopened Shop (synthetic)', created_at: at(addDays(today, -20)), accounting_mode: 'simple', plan: 'trial', configured: false, program: 'business', users: 1,
      counts: { ...COUNTS0 }, last_activity: '1900-01-01', activity_30d: 0,
      activity_weeks: Array(12).fill(0),
      checks: [],
    },
  ];
  const overview = {
    generated_at: at(today),
    workspaces,
    platform: { workspaces: workspaces.length, users: workspaces.reduce((s, w) => s + w.users, 0), paying: 0, waitlist: 0, invites_open: 0, invites_used: 0 },
    invites: [],
  };
  const tables = { organizations: [org], profiles: [profile], org_programs: programs };
  return { org, user, profile, programs, tables, rpc: { is_platform_admin: true, ceo_overview: overview }, overview };
}
