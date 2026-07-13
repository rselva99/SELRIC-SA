// PostgREST silently caps un-paginated .select() responses at 1,000 rows. Every
// financial-data fetch on `transactions` (>2,368 rows and growing) therefore
// under-reports totals if it doesn't page. `fetchAll` runs a Supabase query
// builder repeatedly with `.range()` until fewer than PAGE_SIZE rows come back.
//
// STABLE-PAGINATION GUARANTEE. `.order()` with a NON-UNIQUE key (date,
// created_at, category, amount, etc.) is silently non-deterministic across
// successive `.range()` calls — Postgres may reorder ties differently between
// requests, so rows near a page boundary can slip INTO a page they were not
// previously in (duplicated) or OUT of a page they were previously in
// (dropped). Total count often matches ground truth (dups ~ misses) so the bug
// is silent and can silently corrupt financial statements — see
// ~/Documents/SELRIC-ALARM-NI-DRIFT.md (Jul 12 2026) for the incident that
// motivated this hardening.
//
// This helper enforces a stable pagination by appending `.order('id',
// { ascending: true })` to every builder before ranging. The caller's own
// `.order()` clauses (if any) act as PRIMARY sort; `id` is the tiebreaker.
// Repeated `.order('id')` chains are a no-op semantically (Postgres ignores
// the duplicate), so callers who already ordered by id are unaffected.
//
// Usage:
//   const rows = await fetchAll(supabase.from('transactions')
//     .select('*').gte('date', start).lte('date', end).eq('voided', false));
//
// Options (second arg, optional):
//   - `tiebreaker`: column name for the tiebreaker. Default 'id'. Set to
//     `false` ONLY if the target table has no id column AND the caller has
//     already appended a unique-key .order() to the builder.
//   - `pageSize`: rows per page. Default 1,000 (Postgres's cap).
//
// Notes
// - Do NOT call `.range()` yourself on the passed builder — fetchAll owns it.
// - Passing `tiebreaker: false` without an already-stable order is a bug and
//   will re-open the silent-corruption class this helper was written to close.
//   Prefer supplying an explicit tiebreaker column instead.

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_TIEBREAKER = 'id';

export async function fetchAll(builder, opts = {}) {
  const { tiebreaker = DEFAULT_TIEBREAKER, pageSize = DEFAULT_PAGE_SIZE } = opts;
  const stable = tiebreaker === false ? builder : builder.order(tiebreaker, { ascending: true });
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await stable.range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}
