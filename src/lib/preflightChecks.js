// Period close pre-flight integrity checks. Run before the wizard's
// final Close step so the operator sees anything suspicious before
// freezing the books. Every check is a WARN — the wizard surfaces them
// as a checklist with an explicit "Close anyway" acknowledgment. No
// check is currently a hard BLOCK; the operator stays in control.
//
// Checks:
//   1. Unposted transactions dated in the period (count + sample).
//      Suggests bookkeeping work still pending.
//   2. Uncategorized transactions in the period (count + sample).
//      Affects P&L and Account Balance Review accuracy.
//   3. Suspicious duplicates: ≥2 posted, non-voided txns sharing the
//      same |amount| (rounded to cents) and category, where the
//      magnitude exceeds $1,000. This is exactly how the duplicate-
//      payroll mess looked, so it's specifically flagged.
//   4. Orphaned void state: txns whose linked journal_entries.status
//      is 'voided' but the txn itself has voided=false. Indicates
//      the propagation step from a void didn't run (or ran before
//      the voided column existed).
//
// All Supabase calls use the existing reader filters (voided=false
// where relevant) so a freshly-voided JE's mirrored rows don't leak
// back into the warning counts.

import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { magnitudeOf } from './finance';

const DUPLICATE_MAGNITUDE_THRESHOLD = 1000;

function sampleOf(arr, n = 3) {
  return (arr || []).slice(0, n);
}

export async function runPeriodPreflight({ periodStart, periodEnd }) {
  // Every fetch here is paginated: PostgREST silently caps un-ranged responses
  // at 1,000 rows, so a busy monthly period would under-report unposted /
  // uncategorized / duplicate counts and mask real close-blocking issues.

  // 1) Unposted in period.
  const unposted = await fetchAll(
    supabase
      .from('transactions')
      .select('id, date, description, supplier, amount, type, category')
      .gte('date', periodStart).lte('date', periodEnd)
      .eq('voided', false)
      .eq('posted', false)
      .order('date', { ascending: true })
  );

  // 2) Uncategorized in period (either posted or unposted — both matter).
  const uncategorized = await fetchAll(
    supabase
      .from('transactions')
      .select('id, date, description, supplier, amount, type')
      .gte('date', periodStart).lte('date', periodEnd)
      .eq('voided', false)
      .or('category.is.null,category.eq.')
      .order('date', { ascending: true })
  );

  // 3) Suspicious duplicates among posted, non-voided txns.
  const posted = await fetchAll(
    supabase
      .from('transactions')
      .select('id, date, description, supplier, amount, type, category, journal_entry_id')
      .gte('date', periodStart).lte('date', periodEnd)
      .eq('voided', false)
      .eq('posted', true)
      .order('date', { ascending: true })
  );

  const buckets = new Map();
  for (const t of posted || []) {
    if (!t.category) continue;
    const mag = magnitudeOf(t);
    if (mag <= DUPLICATE_MAGNITUDE_THRESHOLD) continue;
    const key = `${mag.toFixed(2)}|${t.category}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  const duplicates = [];
  for (const [key, group] of buckets) {
    if (group.length < 2) continue;
    const [magStr, category] = key.split('|');
    duplicates.push({
      amount:   parseFloat(magStr),
      category,
      count:    group.length,
      txnIds:   group.map(t => t.id),
      sample:   sampleOf(group),
    });
  }
  duplicates.sort((a, b) => b.amount - a.amount);

  // 4) Orphaned void state.
  const linkedTxns = await fetchAll(
    supabase
      .from('transactions')
      .select('id, journal_entry_id, date, description, supplier, amount, type, category')
      .gte('date', periodStart).lte('date', periodEnd)
      .eq('voided', false)
      .not('journal_entry_id', 'is', null)
      .order('date', { ascending: true })
  );

  let orphanedVoids = [];
  if (linkedTxns?.length) {
    const jeIds = [...new Set(linkedTxns.map(t => t.journal_entry_id))];
    const { data: jes, error: e5 } = await supabase
      .from('journal_entries')
      .select('id, reference, status')
      .in('id', jeIds)
      .eq('status', 'voided');
    if (e5) throw e5;
    const voidedSet = new Set((jes || []).map(j => j.id));
    const refByJE = new Map((jes || []).map(j => [j.id, j.reference]));
    orphanedVoids = linkedTxns
      .filter(t => voidedSet.has(t.journal_entry_id))
      .map(t => ({ ...t, voided_je_reference: refByJE.get(t.journal_entry_id) || '' }));
  }

  const unpostedCount     = (unposted || []).length;
  const uncategorizedCount = (uncategorized || []).length;
  const orphanCount       = orphanedVoids.length;

  return {
    unposted:      { count: unpostedCount,     sample: sampleOf(unposted) },
    uncategorized: { count: uncategorizedCount, sample: sampleOf(uncategorized) },
    duplicates,                                                // [] when clean
    orphanedVoids: { count: orphanCount,       sample: sampleOf(orphanedVoids) },
    hasWarnings:   unpostedCount + uncategorizedCount + duplicates.length + orphanCount > 0,
    ranAt:         new Date().toISOString(),
  };
}
