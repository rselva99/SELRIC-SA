// Compute per-statement totals for the "Direct from PDF pull" view.
// Returns a map { statementId -> { count, debits, credits, postedCount } }
// using the finance.js helpers, so the mixed-sign convention on
// transactions.amount is handled in one place.

import { supabase } from './supabase';
import { debitOf, creditOf } from './finance';

// Fetch totals for a list of bank statement ids. Empty input → empty map.
// Single batched query — no per-statement round-trip.
export async function fetchStatementTotals(stmtIds) {
  const totals = new Map();
  if (!stmtIds?.length) return totals;
  const { data, error } = await supabase
    .from('transactions')
    .select('bank_statement_id, amount, type, posted, voided')
    .in('bank_statement_id', stmtIds);
  if (error) throw error;
  for (const id of stmtIds) totals.set(id, { count: 0, debits: 0, credits: 0, postedCount: 0, voidedCount: 0 });
  for (const t of data || []) {
    const entry = totals.get(t.bank_statement_id);
    if (!entry) continue;
    entry.count++;
    entry.debits  += debitOf(t);
    entry.credits += creditOf(t);
    if (t.posted) entry.postedCount++;
    if (t.voided) entry.voidedCount++;
  }
  return totals;
}

// Fetch every bank statement plus its totals for the Reports "Source
// Documents" section. Sorted newest-first by upload_date.
export async function fetchAllStatementsWithTotals() {
  const { data: stmts, error } = await supabase
    .from('bank_statements')
    .select('id, file_name, upload_date, period_start, period_end, created_at')
    .order('upload_date', { ascending: false, nullsFirst: false })
    .order('created_at',  { ascending: false });
  if (error) throw error;
  const ids = (stmts || []).map(s => s.id);
  const totals = await fetchStatementTotals(ids);
  return (stmts || []).map(s => ({ ...s, totals: totals.get(s.id) || { count: 0, debits: 0, credits: 0, postedCount: 0, voidedCount: 0 } }));
}
