import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { fetchBusinessData } from '../src/lib/checks/fetch.js';
import { loadLatest, saveResults, MIGRATION_FILE } from '../src/lib/checks/store.js';
import { runChecks } from '../src/lib/checks/index.js';
import { mockSupabase } from './fixtures/mock-supabase.js';
import { makeBusiness } from './fixtures/synthetic-business.js';

// Saving and reading check runs, through a real supabase-js client whose
// requests are answered by the mock (tests/fixtures/mock-supabase.js) — the
// same mock the smoke uses for the Business pages. Nothing here reaches a
// network; every row is synthetic.

const TODAY = '2026-11-07';

function clientFor(options) {
  const handle = mockSupabase(options);
  const fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    const res = handle({ method: init.method || 'GET', url, headers, body: init.body ?? null });
    return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: res.headers });
  };
  const client = createClient('http://mock.supabase.test', 'anon-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch } });
  return { client, handle };
}

// A Business workspace's run, as the Checks page makes it.
const BIZ = { today: TODAY, program: 'business' };

describe('checks store — before the migration', () => {
  const b = makeBusiness({ today: TODAY });
  const { client, handle } = clientFor({ tables: b.tables, missing: ['integrity_results', 'integrity_checks'] });

  it('saving reports the missing table instead of throwing', async () => {
    const results = runChecks(b.data, BIZ);
    const out = await saveResults(client, { orgId: b.org.id, results, runAt: `${TODAY}T06:00:00.000Z` });
    expect(out).toEqual({ saved: 0, missing: true });
    // The database refused the insert, so nothing was written.
    expect(handle.writes).toHaveLength(0);
  });

  it('reading reports "no runs yet"', async () => {
    const out = await loadLatest(client, b.org.id);
    expect(out.missing).toBe(true);
    expect(out.runAt).toBeNull();
    expect(out.byCheck.size).toBe(0);
  });

  it('names the migration to paste', () => {
    expect(MIGRATION_FILE).toBe('migrations/2026-11-07-integrity-checks.sql');
  });
});

describe('checks store — with the tables', () => {
  const b = makeBusiness({ today: TODAY, issues: true });
  const older = runChecks(makeBusiness({ today: TODAY }).data, BIZ)
    .map((r) => ({ org_id: b.org.id, check_key: r.key, period: 'all', status: r.status, amount: r.amount, count: r.count, detail: r.detail, run_at: '2026-11-01T06:00:00.000Z' }));
  const newer = runChecks(b.data, BIZ)
    .map((r) => ({ org_id: b.org.id, check_key: r.key, period: 'all', status: r.status, amount: r.amount, count: r.count, detail: r.detail, run_at: `${TODAY}T06:00:00.000Z` }));
  const other = newer.map((r) => ({ ...r, org_id: 'fe11c0de-0000-4000-8000-0000000000ff', status: 'green', run_at: '2026-11-08T06:00:00.000Z' }));
  const { client, handle } = clientFor({ tables: { ...b.tables, integrity_results: [...older, ...newer, ...other], integrity_checks: [] } });

  it('reads the newest result of each check for this workspace only', async () => {
    const out = await loadLatest(client, b.org.id);
    expect(out.missing).toBe(false);
    expect(out.runAt).toBe(`${TODAY}T06:00:00.000Z`);
    expect(out.byCheck.size).toBe(15);
    expect(out.byCheck.get('tb_balanced').status).toBe('red');
  });

  it('saves one row per check, all with the same run time and org', async () => {
    const results = runChecks(b.data, BIZ);
    const out = await saveResults(client, { orgId: b.org.id, results, runAt: `${TODAY}T07:00:00.000Z` });
    expect(out).toMatchObject({ saved: 15, missing: false });
    expect(handle.writes.at(-1)).toMatchObject({ method: 'POST', table: 'integrity_results' });
  });

  it('fetches the same books the engine was given, filtered to the workspace', async () => {
    const data = await fetchBusinessData(client, b.org.id);
    expect(data.transactions).toHaveLength(b.data.transactions.length);
    expect(data.lines).toHaveLength(b.data.lines.length);
    const viaMock = runChecks(data, BIZ).map((r) => [r.key, r.status, r.count]);
    const direct = runChecks(b.data, BIZ).map((r) => [r.key, r.status, r.count]);
    expect(viaMock).toEqual(direct);
  });
});
