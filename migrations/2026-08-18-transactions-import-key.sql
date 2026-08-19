-- 2026-08-18 · transactions.import_key — dedupe key for bulk bank-transaction imports
--
-- ═══════════════════════════════════════════════════════════════════════
-- WHY
--
-- The FY2025 Apr–Dec bookkeeping import (Regions Advantage Business Checking
-- #0319502494, 9 statements, 2,796 rows) is delivered as a CSV with a stable
-- SHA-256-prefix `import_key` per row. Making the loader idempotent requires
-- a DB-side UNIQUE index on that key so a re-run cannot double-insert. This
-- migration:
--   1. adds transactions.import_key (nullable text) if absent
--   2. adds a partial UNIQUE index on (import_key) WHERE import_key IS NOT NULL
--      — partial so historical rows (which have no key) don't collide with each
--      other on NULL, and future non-imported rows stay unconstrained.
--
-- Nothing else on the transactions table is touched. No data is written by
-- this migration.
--
-- IDEMPOTENCE. Both DDLs use IF NOT EXISTS. Re-running never double-creates.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS import_key text;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_import_key_uniq
  ON public.transactions (import_key)
  WHERE import_key IS NOT NULL;

-- ── END ────────────────────────────────────────────────────────────────
-- No INSERTs. No data mutations. Schema only.
