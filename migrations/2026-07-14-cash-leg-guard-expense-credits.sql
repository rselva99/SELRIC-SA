-- 2026-07-14 · Cash-leg trigger — extend to EXPENSE CREDITS (vendor refunds)
--
-- ═══════════════════════════════════════════════════════════════════════
-- BACKGROUND. The V3.1 trigger (migrations/2026-07-13-cash-leg-guard.sql,
-- currently APPLIED and covering 2,162 CASH-LEG-2024 rows) is EXPENSE-ONLY
-- BY TYPE-DEBIT-ONLY. Its `v_should_have` gate insists on `NEW.type =
-- 'debit'`. That means bank-imported EXPENSE CREDITS (vendor refunds,
-- processing-discount rebates, chargebacks) never receive a mirror.
-- Phase 2C Task 1 identified 36 such rows in FY2024 whose missing DR
-- Cash & Bank offsets contribute −$1,994.71 to the trial-balance
-- imbalance. Those 36 have been backfilled via CASH-LEG-REFUND-2024,
-- but the trigger STILL won't catch the next refund import.
--
-- FIX. Relax `NEW.type = 'debit'` to `NEW.type IN ('debit','credit')`,
-- keeping every other gate (posted, non-void, bank_statement_id set,
-- category ≠ Cash & Bank, category type = 'expense'). Flip the mirror's
-- type using CASE WHEN NEW.type = 'debit' THEN 'credit' ELSE 'debit' END.
-- Revenue rows still fall out via the category-type='expense' check —
-- Phase 2B Task 2 moved revenue's cash offset to Merchant Clearing, so
-- allowing revenue here would recreate the $1,733,190.26 double-count
-- the app just eliminated.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WHY A NEW FILE INSTEAD OF EDITING V3.1. The 2026-07-13 file is applied
-- and the migration convention here is one file per apply. Editing an
-- applied file would break the applied-set invariant. This file supersedes
-- V3.1's function bodies via CREATE OR REPLACE (same names, same triggers,
-- same signatures); no DROP is needed. V3.1 stays on disk as the historical
-- record.
--
-- SIDE-EFFECTS OF INCLUDING TYPE='CREDIT' IN v_should_have.
--   • The Case B UPDATE trigger is bound to
--       AFTER INSERT OR UPDATE OF (posted, category, amount, voided, type)
--     so it will now fire on flipping a bank credit's `posted` flag, on a
--     re-categorization, on a void, etc. — exactly like it does for debits.
--     Case A/B logic is symmetric: the SAME `active_src` vs `active_leg`
--     counting drives the one-mirror-per-source invariant.
--   • Case A's per-row mirror still writes `reference = 'CASH-LEG-<NEW.id>'`.
--     No naming conflict with the historical `CASH-LEG-REFUND-2024` batch
--     tag: the Case A INSERT path only fires when a source has neither a
--     per-row mirror nor a batch mirror at the (bs_id, date, amount) triple.
--     The CASH-LEG-REFUND-2024 batch already covers all 36 pre-existing
--     refunds; Case A will skip them.
--   • CASE B's active-count check now must recognize `CASH-LEG-REFUND-2024`
--     mirrors as valid sibling mirrors when voiding a refund source. Same
--     for the DELETE trigger's step V (prefer-voided) and step S (surplus
--     prune). We rewrite ALL three functions to treat both batch tags
--     ('CASH-LEG-2024' AND 'CASH-LEG-REFUND-2024') as legacy mirrors.
--
-- MIRROR SIGN & AMOUNT.
--   • Bank debit source (amt = −108, type='debit') → mirror amt = −108,
--     type='credit'. |amt|=108 → CR. Cash decreases. (unchanged)
--   • Bank credit source (amt = +30, type='credit') → mirror amt = +30,
--     type='debit'. |amt|=30 → DR. Cash increases. (new)
--   Both preserve source.amount verbatim; only the mirror's type flips.
--
-- MIRROR / UNIQUE-INDEX COLLISION. The `[Cash leg] ` prefix on the mirror's
-- description keeps it distinct from the source description in
-- `transactions_bank_dedupe_ux (bank_statement_id, date, amount,
-- description) WHERE bank_statement_id IS NOT NULL`. No new collision
-- surface — see V3.1 header for the full analysis.
--
-- MASTER INVARIANT (still holds after this change):
--   active_sources_at_triple == active_mirrors_at_triple
-- where active_sources now includes BOTH bank debits AND bank credits at
-- expense categories, and active_mirrors is the union of per-row
-- CASH-LEG-<id>, CASH-LEG-2024, and CASH-LEG-REFUND-2024 at the triple.

-- ─── WRITE / UPDATE TRIGGER ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transactions_ensure_cash_leg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat_type          TEXT;
  v_cash_ref          TEXT;
  v_should_have       BOOLEAN;
  v_existing_id       UUID;
  v_source_count      INT;
  v_legacy_count      INT;
  v_active_src_count  INT;
  v_active_leg_count  INT;
  v_leg_id            UUID;
BEGIN
  -- Guard 1: mirror rows short-circuit. Covers CASH-LEG-<id>,
  -- CASH-LEG-2024, CASH-LEG-REFUND-2024 — anything CASH-LEG-*.
  IF NEW.reference IS NOT NULL AND NEW.reference LIKE 'CASH-LEG-%' THEN
    RETURN NEW;
  END IF;

  -- Six conditions. CHANGE FROM V3.1: type is now ('debit','credit'),
  -- everything else identical. The direction of the mirror is derived
  -- below via CASE WHEN.
  v_should_have := (
    NEW.posted                = TRUE
    AND NEW.voided IS DISTINCT FROM TRUE
    AND NEW.bank_statement_id IS NOT NULL
    AND NEW.type              IN ('debit','credit')
    AND NEW.category IS NOT NULL
    AND NEW.category         <> 'Cash & Bank'
    AND NEW.amount IS NOT NULL
  );

  IF v_should_have THEN
    SELECT type INTO v_cat_type FROM public.categories WHERE name = NEW.category;
    IF v_cat_type IS DISTINCT FROM 'expense' THEN
      v_should_have := FALSE;   -- revenue STAYS excluded (Merchant Clearing owns it)
    END IF;
  END IF;

  v_cash_ref := 'CASH-LEG-' || NEW.id::text;

  ------------------------------------------------------------------------
  -- Case A: row should have a mirror.
  ------------------------------------------------------------------------
  IF v_should_have THEN
    -- Per-row mirror already exists → sync drift-prone fields, and keep
    -- its type in sync with the (possibly-changed) source type.
    SELECT id INTO v_existing_id
      FROM public.transactions
     WHERE reference = v_cash_ref
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE public.transactions
         SET amount            = NEW.amount,
             date              = NEW.date,
             description       = '[Cash leg] ' || COALESCE(NEW.description, ''),
             supplier          = COALESCE(NEW.supplier, NEW.description, ''),
             bank_statement_id = NEW.bank_statement_id,
             voided            = COALESCE(NEW.voided, FALSE),
             type              = CASE WHEN NEW.type = 'debit' THEN 'credit' ELSE 'debit' END
       WHERE id = v_existing_id;
      RETURN NEW;
    END IF;

    -- No per-row mirror. Multiplicity-safe check for the two Task 5 /
    -- Phase 2C batch tags together.
    SELECT COUNT(*) INTO v_source_count
      FROM public.transactions
     WHERE bank_statement_id = NEW.bank_statement_id
       AND date              = NEW.date
       AND amount            = NEW.amount
       AND type              = NEW.type          -- match the direction we're looking at
       AND posted            = TRUE
       AND (voided IS NULL OR voided = FALSE)
       AND (reference IS NULL OR reference NOT LIKE 'CASH-LEG-%');

    SELECT COUNT(*) INTO v_legacy_count
      FROM public.transactions
     WHERE reference IN ('CASH-LEG-2024','CASH-LEG-REFUND-2024')
       AND bank_statement_id = NEW.bank_statement_id
       AND date              = NEW.date
       AND amount            = NEW.amount
       -- mirror type is the FLIP of source type
       AND type              = CASE WHEN NEW.type = 'debit' THEN 'credit' ELSE 'debit' END
       AND category          = 'Cash & Bank'
       AND (voided IS NULL OR voided = FALSE);

    IF v_legacy_count >= v_source_count THEN
      RETURN NEW;   -- historical batch already covered this key/direction
    END IF;

    -- Write a per-row mirror. Mirror type is the flip of source type.
    INSERT INTO public.transactions (
      date, description, supplier, amount, type, category, account_id,
      reference, bank_statement_id, posted, voided
    )
    VALUES (
      NEW.date,
      '[Cash leg] ' || COALESCE(NEW.description, ''),
      COALESCE(NEW.supplier, NEW.description, ''),
      NEW.amount,           -- preserves source sign
      CASE WHEN NEW.type = 'debit' THEN 'credit' ELSE 'debit' END,
      'Cash & Bank',
      NULL,
      v_cash_ref,
      NEW.bank_statement_id,
      TRUE,
      FALSE
    );

    RETURN NEW;
  END IF;

  ------------------------------------------------------------------------
  -- Case B: row is NOT in a state that requires a mirror.
  --   Step 1: void per-row mirror if it exists.
  --   Step 2: else, if an active batch mirror at OLD's triple exceeds
  --           active source count, void ONE (multiplicity-safe).
  --
  -- The direction test is intentionally OMITTED from the count queries:
  -- for a given triple, there is exactly one source-direction and one
  -- mirror-direction that "belong" together. The V3.1 approach — counting
  -- all active debit sources vs all active CASH-LEG-* credit mirrors at
  -- the triple — extends cleanly: we now count active sources in BOTH
  -- directions vs active mirrors in BOTH directions. This preserves the
  -- one-leg-per-source invariant across both refund-DR-mirror and
  -- expense-CR-mirror shapes at the same triple (unlikely but possible).
  ------------------------------------------------------------------------

  UPDATE public.transactions
     SET voided = TRUE
   WHERE reference = v_cash_ref
     AND (voided IS NULL OR voided = FALSE);

  IF FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.bank_statement_id IS NULL
     OR NEW.date            IS NULL
     OR NEW.amount          IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_active_src_count
    FROM public.transactions
   WHERE bank_statement_id = NEW.bank_statement_id
     AND date              = NEW.date
     AND amount            = NEW.amount
     AND type              IN ('debit','credit')
     AND posted            = TRUE
     AND (voided IS NULL OR voided = FALSE)
     AND (reference IS NULL OR reference NOT LIKE 'CASH-LEG-%');

  SELECT COUNT(*) INTO v_active_leg_count
    FROM public.transactions
   WHERE reference IN ('CASH-LEG-2024','CASH-LEG-REFUND-2024')
     AND bank_statement_id = NEW.bank_statement_id
     AND date              = NEW.date
     AND amount            = NEW.amount
     AND category          = 'Cash & Bank'
     AND (voided IS NULL OR voided = FALSE);

  IF v_active_leg_count > v_active_src_count THEN
    SELECT id INTO v_leg_id
      FROM public.transactions
     WHERE reference IN ('CASH-LEG-2024','CASH-LEG-REFUND-2024')
       AND bank_statement_id = NEW.bank_statement_id
       AND date              = NEW.date
       AND amount            = NEW.amount
       AND category          = 'Cash & Bank'
       AND (voided IS NULL OR voided = FALSE)
     ORDER BY id
     LIMIT 1;

    IF v_leg_id IS NOT NULL THEN
      UPDATE public.transactions
         SET voided = TRUE
       WHERE id = v_leg_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Rebind the trigger (same binding as V3.1). CREATE OR REPLACE on the
-- function is enough to update behaviour, but rebinding keeps the file
-- self-contained and idempotent.
DROP TRIGGER IF EXISTS trg_cash_leg_write ON public.transactions;
CREATE TRIGGER trg_cash_leg_write
  AFTER INSERT OR UPDATE OF posted, category, amount, voided, type
    ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_ensure_cash_leg();


-- ─── DELETE TRIGGER ──────────────────────────────────────────────────────
-- V3.1's DELETE handler had P → V → S steps against CASH-LEG-2024 only.
-- Extend both V (prefer voided) and S (surplus prune) to recognize
-- CASH-LEG-REFUND-2024 too. Same three-step structure and same invariant.

CREATE OR REPLACE FUNCTION public.transactions_handle_source_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leg_id           UUID;
  v_active_src_count INT;
  v_active_leg_count INT;
BEGIN
  IF OLD.reference IS NOT NULL AND OLD.reference LIKE 'CASH-LEG-%' THEN
    RETURN OLD;
  END IF;

  ---- Step P: per-row form (unambiguous 1:1) ---------------------------
  DELETE FROM public.transactions
   WHERE reference = 'CASH-LEG-' || OLD.id::text;
  IF FOUND THEN
    RETURN OLD;
  END IF;

  IF OLD.bank_statement_id IS NULL
     OR OLD.date            IS NULL
     OR OLD.amount          IS NULL THEN
    RETURN OLD;
  END IF;

  ---- Step V: prefer a voided batch mirror at OLD's triple -------------
  SELECT id INTO v_leg_id
    FROM public.transactions
   WHERE reference IN ('CASH-LEG-2024','CASH-LEG-REFUND-2024')
     AND bank_statement_id = OLD.bank_statement_id
     AND date              = OLD.date
     AND amount            = OLD.amount
     AND category          = 'Cash & Bank'
     AND voided            = TRUE
   ORDER BY id
   LIMIT 1;

  IF v_leg_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = v_leg_id;
    v_leg_id := NULL;
  END IF;

  ---- Step S: invariant re-check + active-mirror prune -----------------
  SELECT COUNT(*) INTO v_active_src_count
    FROM public.transactions
   WHERE bank_statement_id = OLD.bank_statement_id
     AND date              = OLD.date
     AND amount            = OLD.amount
     AND type              IN ('debit','credit')
     AND posted            = TRUE
     AND (voided IS NULL OR voided = FALSE)
     AND (reference IS NULL OR reference NOT LIKE 'CASH-LEG-%');

  SELECT COUNT(*) INTO v_active_leg_count
    FROM public.transactions
   WHERE reference IN ('CASH-LEG-2024','CASH-LEG-REFUND-2024')
     AND bank_statement_id = OLD.bank_statement_id
     AND date              = OLD.date
     AND amount            = OLD.amount
     AND category          = 'Cash & Bank'
     AND (voided IS NULL OR voided = FALSE);

  IF v_active_leg_count > v_active_src_count THEN
    SELECT id INTO v_leg_id
      FROM public.transactions
     WHERE reference IN ('CASH-LEG-2024','CASH-LEG-REFUND-2024')
       AND bank_statement_id = OLD.bank_statement_id
       AND date              = OLD.date
       AND amount            = OLD.amount
       AND category          = 'Cash & Bank'
       AND (voided IS NULL OR voided = FALSE)
     ORDER BY id
     LIMIT 1;

    IF v_leg_id IS NOT NULL THEN
      DELETE FROM public.transactions WHERE id = v_leg_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_leg_delete ON public.transactions;
CREATE TRIGGER trg_cash_leg_delete
  AFTER DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_handle_source_delete();
