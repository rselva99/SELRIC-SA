import { supabase } from './_dbClient.mjs';

for (const table of ['journal_entries', 'journal_entry_lines', 'period_close']) {
  const { data, error } = await supabase.from(table).select('*').limit(1);
  if (error) {
    console.log(`${table}: ${error.message}`);
  } else {
    console.log(`${table} columns: ${Object.keys(data?.[0] || {}).join(', ')}`);
  }
}
