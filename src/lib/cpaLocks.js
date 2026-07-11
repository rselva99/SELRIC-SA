// CPA-sourced period locks. When a (year, kind) row exists in
// public.cpa_sourced_locks, the depreciation.js generator refuses to
// touch that (year, kind) — the straight-line generator would otherwise
// silently overwrite (or duplicate) figures that came from the CPA's
// tax schedule.
//
// Storage: public.cpa_sourced_locks (created by migration
// 2026-07-11-c-create-cpa-sourced-locks-and-lock-2024.sql). `kind` is:
//   • 'depreciation'  — locks against depreciation-side regeneration
//   • 'amortization'  — locks against amortization-side regeneration
//
// Unlocking is a manual admin operation — delete the row via a
// migration. Nothing in the code base auto-inserts or auto-deletes.

import { supabase } from './supabase';

export const CPA_LOCK_KINDS = ['depreciation', 'amortization'];

export class CpaLockedError extends Error {
  constructor(year, kind, note) {
    const which = Array.isArray(year)
      ? year.map(l => `${l.year} ${l.kind}`).join(', ')
      : `${kind[0].toUpperCase() + kind.slice(1)} for ${year}`;
    super(`${which} is CPA-locked. Delete the cpa_sourced_locks row(s) before regenerating.${note ? ` Lock note: ${note}` : ''}`);
    this.name = 'CpaLockedError';
    this.year = year;
    this.kind = kind;
    this.note = note || '';
  }
}

// Fetch every CPA lock. Reads only public.cpa_sourced_locks — the
// prior __CPA_LOCKS__ categories bridge is gone.
export async function listCpaLocks() {
  const { data, error } = await supabase
    .from('cpa_sourced_locks')
    .select('year, kind, note');
  if (error) throw error;
  return data || [];
}

// True when the (year, kind) pair is CPA-locked. `locks` is the array
// returned by listCpaLocks so callers can memoize the fetch across many
// checks (e.g. iterating 12 months of a year).
export function isCpaLocked(locks, year, kind) {
  return (locks || []).some(l => Number(l.year) === Number(year) && l.kind === kind);
}

// Look up the lock note (empty string when none). Useful for surfacing
// the reason in a UI tooltip.
export function cpaLockNote(locks, year, kind) {
  const l = (locks || []).find(l => Number(l.year) === Number(year) && l.kind === kind);
  return l?.note || '';
}

// Convenience: async single-check that queries the DB fresh. Prefer
// `listCpaLocks + isCpaLocked` in loops.
export async function isYearLocked(year, kind) {
  const locks = await listCpaLocks();
  return isCpaLocked(locks, year, kind);
}
