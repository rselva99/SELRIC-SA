// CPA-sourced period locks. When a (year, kind) row exists in the
// database, the app's depreciation.js generator refuses to post — the
// straight-line generator would otherwise silently overwrite figures
// that came from the CPA's tax schedule.
//
// STORAGE (TWO LAYERS — read from BOTH, prefer the first that returns data)
//
//   1. public.cpa_sourced_locks table
//        Canonical, per-(year, kind). Created by migration
//        `2026-07-11-c-create-cpa-sourced-locks-and-lock-2024.sql`.
//        MUST be applied via the Supabase SQL editor — DDL cannot go
//        through PostgREST.
//
//   2. public.categories row named `__CPA_LOCKS__` (fallback / bridge)
//        A single archived, reserved-name category whose `description`
//        column holds the same lock state as JSON:
//          {"YYYY":{"depreciation":true,"amortization":true}}
//        Written by the executor script that ships the amortization
//        remediation, so the guard is enforceable BEFORE the DDL runs.
//        Once the table exists and holds the same rows, this row can be
//        archived / deleted — the reader prefers the table.
//
// See migration file for schema shape. `kind` is:
//   • 'depreciation'  — locks against depreciation-side regeneration
//   • 'amortization'  — locks against amortization-side regeneration
//
// Unlocking is a manual admin operation — either delete the table row
// via a migration or edit `__CPA_LOCKS__`.description JSON. Nothing in
// the code base auto-inserts or auto-deletes lock rows.

import { supabase } from './supabase';

export const CPA_LOCK_KINDS = ['depreciation', 'amortization'];
export const CPA_LOCK_FALLBACK_CATEGORY_NAME = '__CPA_LOCKS__';

// PostgREST codes we treat as "table not present yet — try fallback":
//   PGRST205 — "Could not find the table 'public.cpa_sourced_locks'"
//   42P01    — Postgres "relation does not exist"
const TABLE_MISSING_CODES = new Set(['PGRST205', '42P01']);

export class CpaLockedError extends Error {
  constructor(year, kind, note) {
    super(`${kind[0].toUpperCase() + kind.slice(1)} for ${year} is CPA-locked. Delete the cpa_sourced_locks row (or ${CPA_LOCK_FALLBACK_CATEGORY_NAME} JSON entry) for {year:${year}, kind:${kind}} before regenerating.${note ? ` Lock note: ${note}` : ''}`);
    this.name = 'CpaLockedError';
    this.year = year;
    this.kind = kind;
    this.note = note || '';
  }
}

// Read the fallback row and return a flat [{year, kind, note}] array.
async function readFallbackLocks() {
  const { data, error } = await supabase
    .from('categories')
    .select('description')
    .eq('name', CPA_LOCK_FALLBACK_CATEGORY_NAME)
    .maybeSingle();
  if (error || !data?.description) return [];
  try {
    const j = JSON.parse(data.description);
    const out = [];
    for (const [year, kinds] of Object.entries(j || {})) {
      for (const kind of CPA_LOCK_KINDS) {
        const entry = kinds?.[kind];
        if (!entry) continue;
        const note = typeof entry === 'string' ? entry : (entry?.note || '');
        out.push({ year: Number(year), kind, note });
      }
    }
    return out;
  } catch { return []; }
}

// Fetch every CPA lock. Prefers the cpa_sourced_locks table; if that
// table isn't in the schema yet, reads the fallback JSON row.
export async function listCpaLocks() {
  const { data, error } = await supabase
    .from('cpa_sourced_locks')
    .select('year, kind, note');
  if (!error) return data || [];
  if (TABLE_MISSING_CODES.has(error.code)) return await readFallbackLocks();
  throw error;
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
