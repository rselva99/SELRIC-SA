// Runs a SQL file against Postgres via Supabase's management SQL endpoint.
// Uses service_role so we can create functions in the public schema. Not for
// user-space queries.
import { readFileSync } from 'node:fs';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './_dbClient.mjs';

const [, , sqlPath] = process.argv;
if (!sqlPath) {
  console.error('usage: node scripts/apply_migration.mjs <sql-file>');
  process.exit(1);
}
const sql = readFileSync(sqlPath, 'utf8');
console.log(`Applying migration: ${sqlPath}`);
console.log(`Length: ${sql.length} bytes`);

// Supabase's official REST endpoint doesn't accept arbitrary SQL. The
// project has an `exec_sql` / `raw_sql` RPC in some setups; here we go via
// PGRest's ordinary rpc mechanism using a helper we create-if-missing.

const url = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text}`);
  process.exit(2);
}
console.log('OK:', text.slice(0, 500));
