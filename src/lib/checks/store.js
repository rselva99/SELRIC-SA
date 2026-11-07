// Saving and reading check runs (integrity_results). Until the migration
// 2026-11-07-integrity-checks.sql is applied the table does not exist; both
// functions then report { missing: true } instead of throwing, and the pages
// show "no runs yet". Rows are only ever inserted: a run is a set of rows
// with one run_at.
import { isMissingTable } from './fetch.js';
import { latestByCheck } from './score.js';

export const MIGRATION_FILE = 'migrations/2026-11-07-integrity-checks.sql';

export async function saveResults(client, { orgId, period = 'all', results, runAt = new Date().toISOString() }) {
  const rows = results.map((r) => ({
    org_id: orgId, check_key: r.key, period, status: r.status,
    amount: r.amount || 0, count: r.count || 0, detail: r.detail || {}, run_at: runAt,
  }));
  const { error } = await client.from('integrity_results').insert(rows);
  if (error) {
    if (isMissingTable(error)) return { saved: 0, missing: true };
    throw error;
  }
  return { saved: rows.length, missing: false, runAt };
}

// The newest result per check for one workspace, plus when the newest run
// happened. Reads the last 400 rows: enough for many runs of every check.
export async function loadLatest(client, orgId) {
  const { data, error } = await client.from('integrity_results')
    .select('check_key, period, status, amount, count, detail, run_at')
    .eq('org_id', orgId).order('run_at', { ascending: false }).limit(400);
  if (error) {
    if (isMissingTable(error)) return { missing: true, byCheck: new Map(), runAt: null };
    throw error;
  }
  const byCheck = latestByCheck(data || []);
  return { missing: false, byCheck, runAt: data?.[0]?.run_at || null };
}
