import { supabase } from './_dbClient.mjs';

const candidates = ['exec_sql', 'run_sql', 'exec', 'sql', 'query', 'pg_exec', 'statement_totals'];
for (const name of candidates) {
  const { error } = await supabase.rpc(name, {});
  console.log(`${name}: ${error?.code || 'ok'} — ${error?.message || ''}`);
}
