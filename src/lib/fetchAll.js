// PostgREST silently caps un-paginated .select() responses at 1,000 rows. Every
// financial-data fetch on `transactions` (>2,368 rows and growing) therefore
// under-reports totals if it doesn't page. `fetchAll` runs a Supabase query
// builder repeatedly with `.range()` until fewer than PAGE_SIZE rows come back.
//
// Usage:
//   const rows = await fetchAll(supabase.from('transactions')
//     .select('*').gte('date', start).lte('date', end).eq('voided', false));
//
// Notes
// - Do NOT call `.range()` yourself on the passed builder — fetchAll owns it.
// - `.order(...)` is required for stable pagination when the DB doesn't already
//   guarantee an order. If the caller doesn't set one we add id ASC as a
//   fallback (safe for any table with an `id` primary key; the caller is free
//   to specify their own order first).

const PAGE_SIZE = 1000;

export async function fetchAll(builder) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await builder.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return all;
}
