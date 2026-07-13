-- 2026-07-13 · Cash-leg auto-writer + guard on bank-imported EXPENSE rows
--
-- SUPERSEDES an earlier draft rejected because it (a) fired for both
-- 'expense' AND 'revenue', which would recreate the exact double-count
-- Phase 2B Task 2 just eliminated (revenue was re-routed through Merchant
-- Clearing and MUST NOT get a Cash & Bank leg); (b) checked for existing
-- legs with a 'CASH-LEG-<id>' pattern only, missing every one of the
-- 2,162 Task 5 backfill rows (which used the uniform tag 'CASH-LEG-2024'),
-- so duplicates would proliferate on any future edit; (c) documented a
-- 'trg_cash_leg_check' trigger that didn't exist; (d) never fired on
-- amount edits, voided flips, or type changes; (e) hard-coded account_id
-- to NULL without verifying nullability; (f) used SECURITY DEFINER without
-- explaining why; (g) had no recursion-guard commentary.
--
-- WHERE TASK 5 WROTE THE LEGS (verified this run):
--   Location: public.transactions (NOT journal_entry_lines).
--   Reference: uniform 'CASH-LEG-2024' on every one of the 2,162 mirror rows.
--   Sign convention: amount = source.amount (negative), type = 'credit',
--   category = 'Cash & Bank', bank_statement_id = source.bank_statement_id,
--   posted = true, voided = false, journal_entry_id = null.
--   The trigger below MUST detect this pattern via multiplicity-safe
--   count comparison (matching (bank_statement_id, date, amount)), not
--   by looking for 'CASH-LEG-<id>'.
--
-- EXPENSE-ONLY BY DESIGN. The trigger fires only when the row's category
-- resolves to type='expense' in the categories table. Revenue rows,
-- Merchant Clearing settlements, and asset/liability/equity rows all fall
-- through without a mirror. This is deliberate — Phase 2B Task 2 moved
-- revenue's cash offset to Merchant Clearing, and re-adding a Cash & Bank
-- CR here would double-count the same $1,733,190.26 the app just rerouted.
--
-- SECURITY DEFINER. The trigger function runs as its owner (typically
-- postgres) so it can INSERT into transactions regardless of the calling
-- role's RLS grants. This lets the auto-writer succeed when a lower-
-- privileged auth role (e.g. 'authenticated') fires the trigger via a
-- user-facing UPDATE — otherwise the mirror INSERT would silently fail
-- with a RLS-policy error. The SET search_path = public clause prevents
-- search-path hijacking under SECURITY DEFINER.
--
-- RECURSION GUARD. The trigger writes NEW rows into public.transactions,
-- which re-fires the same trigger. Termination:
--   • The new mirror row has type='credit' + category='Cash & Bank'.
--   • The v_should_have check requires type='debit' AND
--     category <> 'Cash & Bank', so the recursive fire evaluates to
--     v_should_have = FALSE, Case B runs, and Case B looks for a row
--     with reference='CASH-LEG-<mirror.id>' — which doesn't exist
--     because we key our mirrors off the source id, not the mirror's
--     own id. No further action, recursion terminates in 1 hop.
--
-- FIRES ON: INSERT (all cols) OR UPDATE OF (posted, category, amount,
-- voided, type). Each of these state changes can invalidate a mirror,
-- so each needs a re-eval.
--
-- Idempotent throughout: CREATE OR REPLACE on the function, DROP TRIGGER
-- IF EXISTS + CREATE TRIGGER on the trigger.

CREATE OR REPLACE FUNCTION public.transactions_ensure_cash_leg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat_type      TEXT;
  v_cash_ref      TEXT;
  v_should_have   BOOLEAN;
  v_existing_id   UUID;
  v_source_count  INT;
  v_legacy_count  INT;
BEGIN
  -- Guard 1: if the row itself IS a Cash & Bank mirror (either the
  -- per-row 'CASH-LEG-<id>' or the Task 5 batch 'CASH-LEG-2024' pattern),
  -- skip. This is the primary recursion terminator.
  IF NEW.reference IS NOT NULL AND NEW.reference LIKE 'CASH-LEG-%' THEN
    RETURN NEW;
  END IF;

  -- Compute whether this row is currently in a state that REQUIRES a mirror.
  -- Six conditions must all hold:
  v_should_have := (
    NEW.posted             = TRUE
    AND NEW.voided IS DISTINCT FROM TRUE
    AND NEW.bank_statement_id IS NOT NULL
    AND NEW.type           = 'debit'
    AND NEW.category IS NOT NULL
    AND NEW.category      <> 'Cash & Bank'
    AND NEW.amount IS NOT NULL
  );

  -- EXPENSE-ONLY. Revenue rows re-routed to Merchant Clearing must NOT
  -- get a Cash & Bank offset — see header note.
  IF v_should_have THEN
    SELECT type INTO v_cat_type FROM public.categories WHERE name = NEW.category;
    IF v_cat_type IS DISTINCT FROM 'expense' THEN
      v_should_have := FALSE;
    END IF;
  END IF;

  v_cash_ref := 'CASH-LEG-' || NEW.id::text;

  ------------------------------------------------------------------------
  -- Case A: this row should have a mirror.
  ------------------------------------------------------------------------
  IF v_should_have THEN
    -- Look for a per-row mirror (this trigger's pattern).
    SELECT id INTO v_existing_id
      FROM public.transactions
     WHERE reference = v_cash_ref
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      -- Per-row mirror exists. Fix any drift in amount/date/description/
      -- bank_statement_id/voided; those are the fields an app-side UPDATE
      -- can move on a row that also has a mirror.
      UPDATE public.transactions
         SET amount            = NEW.amount,
             date              = NEW.date,
             description       = '[Cash leg] ' || COALESCE(NEW.description, ''),
             supplier          = COALESCE(NEW.supplier, NEW.description, ''),
             bank_statement_id = NEW.bank_statement_id,
             voided            = COALESCE(NEW.voided, FALSE)
       WHERE id = v_existing_id;
      RETURN NEW;
    END IF;

    -- No per-row mirror. Now check for a Task 5 batch mirror
    -- ('CASH-LEG-2024'). Multiplicity-safe: two source rows sharing
    -- the exact (bank_statement_id, date, amount) key need two Task 5
    -- mirrors; if only one exists, we still need to write one.
    SELECT COUNT(*) INTO v_source_count
      FROM public.transactions
     WHERE bank_statement_id = NEW.bank_statement_id
       AND date              = NEW.date
       AND amount             = NEW.amount
       AND type              = 'debit'
       AND posted            = TRUE
       AND (voided IS NULL OR voided = FALSE)
       AND (reference IS NULL OR reference NOT LIKE 'CASH-LEG-%');

    SELECT COUNT(*) INTO v_legacy_count
      FROM public.transactions
     WHERE reference          = 'CASH-LEG-2024'
       AND bank_statement_id = NEW.bank_statement_id
       AND date              = NEW.date
       AND amount             = NEW.amount
       AND type              = 'credit'
       AND category          = 'Cash & Bank'
       AND (voided IS NULL OR voided = FALSE);

    IF v_legacy_count >= v_source_count THEN
      -- Enough Task 5 mirrors already exist for this (bank_statement_id,
      -- date, amount) group. Don't add a duplicate.
      RETURN NEW;
    END IF;

    -- No matching mirror anywhere. Write a per-row mirror.
    INSERT INTO public.transactions (
      date, description, supplier, amount, type, category, account_id,
      reference, bank_statement_id, posted, voided
    )
    VALUES (
      NEW.date,
      '[Cash leg] ' || COALESCE(NEW.description, ''),
      COALESCE(NEW.supplier, NEW.description, ''),
      NEW.amount,           -- preserves source sign; the aggregators
                            -- key off `type`, not sign
      'credit',
      'Cash & Bank',
      NULL,                 -- account_id is NULLABLE on public.transactions
                            -- (verified: every existing Cash & Bank row
                            -- and every bank-imported row has NULL here).
      v_cash_ref,
      NEW.bank_statement_id,
      TRUE,
      FALSE
    );

    RETURN NEW;
  END IF;

  ------------------------------------------------------------------------
  -- Case B: this row is NOT in a state that requires a mirror.
  --
  -- If we had previously written a per-row mirror for it (via a prior
  -- fire of this same trigger), void that mirror so it stops contributing
  -- to the ledger. This handles:
  --   • voided=true    → mirror should also be voided
  --   • category changed to Cash & Bank / revenue → mirror should stop
  --     mattering to the double-entry
  --   • posted flipped to false → mirror should be inactive
  --
  -- We ONLY void the per-row mirror (reference = 'CASH-LEG-<NEW.id>').
  -- Task 5 batch mirrors ('CASH-LEG-2024') are NEVER voided by the
  -- trigger — those are the manually-curated historical backfill and
  -- belong to the human who ran Task 5, not to this automated path.
  ------------------------------------------------------------------------
  UPDATE public.transactions
     SET voided = TRUE
   WHERE reference = v_cash_ref
     AND (voided IS NULL OR voided = FALSE);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_leg_write ON public.transactions;
CREATE TRIGGER trg_cash_leg_write
  AFTER INSERT OR UPDATE OF posted, category, amount, voided, type
    ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_ensure_cash_leg();

-- Note on the second trigger the earlier draft claimed to install:
-- `trg_cash_leg_check` was documented in that draft but never actually
-- created. The combined write-and-void logic in this single trigger
-- covers both roles (the guard becomes an implicit invariant enforced
-- by the auto-writer + auto-voider). No separate check trigger needed.
