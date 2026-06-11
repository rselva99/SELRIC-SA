// Server-side aggregates for the "Direct from PDF pull" view.
//
// The previous implementation fetched raw transaction rows for every
// statement id and summed them in JavaScript. PostgREST defaults to a
// 1000-row cap per request, so once the union of linked transactions
// across the requested statements exceeded that cap, every statement
// got a partial slice — different call sites (Bookkeeping vs. Reports)
// passed different statement-id pools and therefore got different
// partial totals for the same statement. That was the bug.
//
// Now we delegate to `statement_totals(uuid[])` (see migrations/
// 2026-06-11-statement-totals-and-period.sql). The RPC computes
// COUNT / SUM(ABS(amount)) keyed off the type column on the server —
// only one row per statement crosses the wire, so the row cap can't
// truncate the answer.

import { supabase } from './supabase';

const EMPTY = { count: 0, debits: 0, credits: 0, postedCount: 0, voidedCount: 0 };

function mapRow(r) {
  return {
    count:        Number(r.txn_count)    || 0,
    debits:       Number(r.debits)       || 0,
    credits:      Number(r.credits)      || 0,
    postedCount:  Number(r.posted_count) || 0,
    voidedCount:  Number(r.voided_count) || 0,
  };
}

// Returns a Map<statementId, totals>. Statements with no linked txns
// are filled with zeros so the caller can render them without an
// extra null check.
export async function fetchStatementTotals(stmtIds) {
  const totals = new Map();
  if (!stmtIds?.length) return totals;
  for (const id of stmtIds) totals.set(id, { ...EMPTY });

  const { data, error } = await supabase.rpc('statement_totals', { stmt_ids: stmtIds });
  if (error) throw error;
  for (const row of data || []) {
    totals.set(row.bank_statement_id, mapRow(row));
  }
  return totals;
}

// Reports "Source Documents" — every statement + its totals, newest first
// by upload_date.
export async function fetchAllStatementsWithTotals() {
  const { data: stmts, error } = await supabase
    .from('bank_statements')
    .select('id, file_name, upload_date, period_start, period_end, created_at')
    .order('upload_date', { ascending: false, nullsFirst: false })
    .order('created_at',  { ascending: false });
  if (error) throw error;
  const totals = await fetchStatementTotals((stmts || []).map(s => s.id));
  return (stmts || []).map(s => ({ ...s, totals: totals.get(s.id) || { ...EMPTY } }));
}
