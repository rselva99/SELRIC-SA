// Reads one workspace's rows for the checks, through whichever Supabase
// client the caller has: the app's (RLS already limits it to the signed-in
// workspace) or the CLI's service-role client (which sees every workspace, so
// every query here filters on org_id explicitly — never drop that filter).
//
// A table that does not exist on this database reads as empty, so a check
// over it comes out "nothing to check" instead of failing the run.
import { fetchAll } from '../fetchAll.js';

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST204']);
export const isMissingTable = (error) => !!error && (MISSING.has(error.code) || /does not exist|schema cache/i.test(error.message || ''));

async function read(client, table, columns, orgId) {
  try {
    return await fetchAll(client.from(table).select(columns).eq('org_id', orgId));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

const TX = 'id, date, description, amount, type, category, supplier, reference, bank_statement_id, journal_entry_id, posted, voided, created_at';

export async function fetchBusinessData(client, orgId) {
  if (!orgId) throw new Error('fetchBusinessData: orgId required');
  const [categories, transactions, entries, lines, statements, checks, payrollLines, periodClose, bsLines, bsMappings] = await Promise.all([
    read(client, 'categories', 'id, name, type, archived', orgId),
    read(client, 'transactions', TX, orgId),
    read(client, 'journal_entries', 'id, reference, date, description, total_amount, status, entry_type, created_at', orgId),
    read(client, 'journal_entry_lines', 'id, journal_entry_id, debit_amount, credit_amount, category, description, created_at', orgId),
    read(client, 'bank_statements', 'id, file_name, period, period_start, period_end, statement_totals', orgId),
    read(client, 'checks', 'id, check_no, amount, clear_date, payee, status, returned_flag, returned_date, returned_amount, return_source', orgId),
    read(client, 'payroll_lines', 'id, pay_date, pay_month, net_pay, match_status, matched_check_id, matched_transaction_id', orgId),
    read(client, 'period_close', 'id, period, status, closed_at', orgId),
    read(client, 'book_bs_lines', 'id, year, section_code, title, ending_balance_confirmed', orgId),
    read(client, 'book_bs_line_mappings', 'id, line_id, category_name', orgId),
  ]);
  return { categories, transactions, entries, lines, statements, checks, payrollLines, periodClose, lenderStatements: lenderStatementsFrom(bsLines, bsMappings) };
}

// The herd: every card and every event, with the fields the herd checks read.
export async function fetchHerdData(client, orgId) {
  if (!orgId) throw new Error('fetchHerdData: orgId required');
  const [animals, events] = await Promise.all([
    read(client, 'lv_animals', 'id, slug, name, aliases, tag, species, category, sex, status, lot, pregnant, preg_date, preg_months, dam_id, dam_name, birth_date', orgId),
    read(client, 'lv_events', 'id, animal_id, type, date, data', orgId),
  ]);
  return { animals, events };
}

// A loan line of the book balance sheet with a confirmed ending balance is
// the lender's number for that year end; its mappings name the ledger
// accounts that make up the loan.
export function lenderStatementsFrom(lines, mappings, pattern = /loan|note\s+payable|line\s+of\s+credit/i) {
  const byLine = new Map();
  for (const m of mappings || []) if (m.category_name) (byLine.get(m.line_id) || byLine.set(m.line_id, []).get(m.line_id)).push(m.category_name);
  return (lines || [])
    .filter((l) => l.ending_balance_confirmed != null && pattern.test(l.title || '') && byLine.has(l.id))
    .map((l) => ({ id: l.id, label: l.title, as_of: `${l.year}-12-31`, balance: Number(l.ending_balance_confirmed), categories: byLine.get(l.id) }));
}
