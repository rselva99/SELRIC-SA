-- 2026-07-13 · transactions.updated_at — audit-trail hardening
--
-- Phase 1 recon (~/Documents/SELRIC-PHASE1-RECON.md) showed the app has no
-- way to answer "when did this row's category change?". `transactions` has
-- created_at but no updated_at, so in-place edits (category flips, posted
-- flag toggles, verified toggles) leave no time-stamp trail.
--
-- The whole $146.02 residual in Task 1's net-income delta was
-- unattributable for this exact reason: rows updated between two snapshots
-- cannot be dated. This migration fixes forward — every UPDATE from now on
-- gets an updated_at stamp.
--
-- Backfill note. Existing rows are seeded with created_at, not now(). The
-- alternative — seeding every row with now() — would say "these were all
-- edited today" when in fact they were created weeks or months ago and
-- have never been touched since. Matching created_at means "no known
-- update since insert" which is the correct semantic for historical rows.
-- Any future UPDATE will overwrite the seed via the trigger.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE on the function,
-- DROP IF EXISTS + CREATE on the trigger.

-- 1. Add the column, seeded from created_at.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.transactions
   SET updated_at = created_at
 WHERE updated_at = created_at  -- only rows still at the default; a no-op re-run
    OR updated_at IS DISTINCT FROM created_at
    AND xmax::text = '0';       -- only rows that haven't been touched by a real
                                -- UPDATE in this transaction (belt and braces)

-- Second pass: any row where the default now() got stamped but created_at
-- exists is a candidate for the semantic backfill. Do it unconditionally on
-- the historical set — future UPDATEs move updated_at forward from here.
UPDATE public.transactions
   SET updated_at = created_at
 WHERE created_at IS NOT NULL;

-- 2. The trigger.
CREATE OR REPLACE FUNCTION public.transactions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transactions_set_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_set_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_set_updated_at();

-- 3. Small helper index for the common "what changed since X" query.
--    NOT UNIQUE (many rows can share a timestamp). Partial index skips the
--    historical set that all sit at their created_at seed.
CREATE INDEX IF NOT EXISTS transactions_updated_at_idx
  ON public.transactions (updated_at)
  WHERE updated_at > '2026-07-13'::timestamptz;
