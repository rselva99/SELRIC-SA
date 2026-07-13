-- 2026-07-13 · Cash-leg auto-writer + guard on bank-imported EXPENSE rows
--
-- ═══════════════════════════════════════════════════════════════════════
-- HISTORY. Rewritten twice before landing here:
--   V1: fired on both expense AND revenue → would recreate the Phase 2B
--       double-count. Rejected.
--   V2: (a) fixed to expense-only; (b) added multiplicity-safe detection
--       of Task 5's uniform 'CASH-LEG-2024' tag in Case A; (c) added
--       SECURITY DEFINER and a recursion guard. Rejected because:
--         • Case B refused to void CASH-LEG-2024 mirrors, so voiding
--           one of the 2,162 Task 5 backfill rows silently orphaned
--           its cash leg and broke the trial balance by that amount.
--         • The mirror INSERT set bank_statement_id, but the header
--           claimed mirrors were excluded from
--           `transactions_bank_dedupe_ux` — they ARE inside it.
--         • No DELETE handling — deleting a source orphaned its mirror.
--   V3 (this file): all three fixed.
--
-- ═══════════════════════════════════════════════════════════════════════
-- WHERE TASK 5 WROTE THE LEGS (re-verified this run):
--   Location   : public.transactions (NOT journal_entry_lines).
--   Reference  : uniform 'CASH-LEG-2024' on every one of the 2,162 rows.
--   b_s_id     : ALL 2,162 mirrors have bank_statement_id SET (non-null,
--                confirmed by direct query — 2162/2162).
--   Sign/type  : amount = source.amount (negative), type = 'credit',
--                category = 'Cash & Bank', posted = TRUE, voided = FALSE.
--
--   Because every mirror carries a non-null bank_statement_id, ALL 2,162
--   mirrors LIVE INSIDE the partial index
--     transactions_bank_dedupe_ux (bank_statement_id, date, amount, description)
--     WHERE bank_statement_id IS NOT NULL
--   The trigger below preserves this — it sets NEW.bank_statement_id on
--   the mirror to remain consistent with Task 5's on-disk state. Any
--   change here would create a two-shape universe of mirrors and break
--   downstream queries that assume the invariant.
--
-- ═══════════════════════════════════════════════════════════════════════
-- MIRROR / UNIQUE-INDEX COLLISION ANALYSIS.
--
--   Mirror key   = (source.bs_id, source.date, source.amount,
--                   '[Cash leg] ' || source.description)
--   Source key   = (source.bs_id, source.date, source.amount,
--                   source.description)
--
--   For a MIRROR to collide with a SOURCE at the same (bs_id, date,
--   amount) triple, that source's description must exactly equal
--   '[Cash leg] ' || some_other_source.description. Bank-imported
--   descriptions never carry the '[Cash leg] ' prefix — that prefix is
--   reserved for the trigger. So under the normal bank-import flow
--   collision is impossible.
--
--   For a MIRROR to collide with ANOTHER MIRROR at the same triple, two
--   sources would need identical (bs_id, date, amount, description) — but
--   that quadruple is exactly the source's own unique-index key, so those
--   two sources cannot both exist. No mirror-mirror collision possible.
--
--   The single remaining pathological case: a hand-authored source row
--   whose description starts with '[Cash leg] ' and would happen to
--   coincide with an existing mirror description at the same triple. If
--   that ever occurs the INSERT WILL fail loudly. That's the intended
--   behaviour — silently dropping a leg would break double-entry, so
--   this INSERT deliberately has no ON CONFLICT.
--
-- ═══════════════════════════════════════════════════════════════════════
-- EXPENSE-ONLY BY DESIGN. Revenue rows re-routed to Merchant Clearing
-- (Phase 2B Task 2) MUST NOT get a Cash & Bank offset — the auto-writer
-- would double-count the same $1,733,190.26 the app just rerouted.
--
-- SECURITY DEFINER. The function runs as its owner so it can INSERT and
-- UPDATE public.transactions regardless of the calling role's RLS
-- grants — otherwise the mirror write would silently fail with an RLS
-- error when a lower-privileged auth role fires the trigger. The
-- SET search_path = public clause prevents search-path hijacking.
--
-- RECURSION GUARDS.
--   • trg_cash_leg_write: writes NEW mirror rows into transactions, which
--     re-fires this trigger. Guard 1 (reference LIKE 'CASH-LEG-%' →
--     early return) terminates recursion in one hop.
--   • trg_cash_leg_delete: DELETEs the mirror, which re-fires the DELETE
--     trigger. Guard in delete fn (OLD.reference LIKE 'CASH-LEG-%' →
--     early return) terminates recursion in one hop.
--
-- FIRES ON:
--   trg_cash_leg_write : AFTER INSERT OR UPDATE OF
--                        (posted, category, amount, voided, type)
--   trg_cash_leg_delete: AFTER DELETE

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
  -- Guard 1: the row IS itself a mirror. Short-circuit — this is the
  -- primary recursion terminator for both CASH-LEG-<id> and CASH-LEG-2024.
  IF NEW.reference IS NOT NULL AND NEW.reference LIKE 'CASH-LEG-%' THEN
    RETURN NEW;
  END IF;

  -- Six conditions must hold for the row to require a mirror.
  v_should_have := (
    NEW.posted                = TRUE
    AND NEW.voided IS DISTINCT FROM TRUE
    AND NEW.bank_statement_id IS NOT NULL
    AND NEW.type              = 'debit'
    AND NEW.category IS NOT NULL
    AND NEW.category         <> 'Cash & Bank'
    AND NEW.amount IS NOT NULL
  );

  IF v_should_have THEN
    SELECT type INTO v_cat_type FROM public.categories WHERE name = NEW.category;
    IF v_cat_type IS DISTINCT FROM 'expense' THEN
      v_should_have := FALSE;   -- Merchant Clearing route handles revenue
    END IF;
  END IF;

  v_cash_ref := 'CASH-LEG-' || NEW.id::text;

  ------------------------------------------------------------------------
  -- Case A: row should have a mirror.
  ------------------------------------------------------------------------
  IF v_should_have THEN
    -- Per-row mirror already exists → sync the drift-prone fields.
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
             voided            = COALESCE(NEW.voided, FALSE)
       WHERE id = v_existing_id;
      RETURN NEW;
    END IF;

    -- No per-row mirror. Multiplicity-safe check for Task 5 backfill:
    -- two sources sharing (bs_id, date, amount) need two mirrors.
    SELECT COUNT(*) INTO v_source_count
      FROM public.transactions
     WHERE bank_statement_id = NEW.bank_statement_id
       AND date              = NEW.date
       AND amount            = NEW.amount
       AND type              = 'debit'
       AND posted            = TRUE
       AND (voided IS NULL OR voided = FALSE)
       AND (reference IS NULL OR reference NOT LIKE 'CASH-LEG-%');

    SELECT COUNT(*) INTO v_legacy_count
      FROM public.transactions
     WHERE reference          = 'CASH-LEG-2024'
       AND bank_statement_id = NEW.bank_statement_id
       AND date              = NEW.date
       AND amount            = NEW.amount
       AND type              = 'credit'
       AND category          = 'Cash & Bank'
       AND (voided IS NULL OR voided = FALSE);

    IF v_legacy_count >= v_source_count THEN
      RETURN NEW;   -- Task 5 already covered this key
    END IF;

    -- Write a per-row mirror. See "MIRROR / UNIQUE-INDEX COLLISION"
    -- above for why this INSERT has no ON CONFLICT clause.
    INSERT INTO public.transactions (
      date, description, supplier, amount, type, category, account_id,
      reference, bank_statement_id, posted, voided
    )
    VALUES (
      NEW.date,
      '[Cash leg] ' || COALESCE(NEW.description, ''),
      COALESCE(NEW.supplier, NEW.description, ''),
      NEW.amount,
      'credit',
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
  --
  -- Step 1: void a per-row mirror if it exists (this trigger's own
  --         auto-writer output). We only ever wrote one, so voiding all
  --         matching by reference is equivalent to voiding one.
  --
  -- Step 2: if step 1 found nothing, check for a matching Task 5
  --         CASH-LEG-2024 mirror. Void EXACTLY ONE — the one-leg-per-source
  --         invariant. Determined by counting active sources vs active
  --         mirrors at the (bs_id, date, amount) triple: if
  --         active_mirrors > active_sources, we have surplus, so void
  --         one mirror to bring the count back in sync. This is
  --         multiplicity-safe: two sources sharing the same triple keep
  --         one mirror active until both sources are inactive.
  ------------------------------------------------------------------------

  UPDATE public.transactions
     SET voided = TRUE
   WHERE reference = v_cash_ref
     AND (voided IS NULL OR voided = FALSE);

  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- No per-row mirror. Check the Task 5 backfill form.
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
     AND type              = 'debit'
     AND posted            = TRUE
     AND (voided IS NULL OR voided = FALSE)
     AND (reference IS NULL OR reference NOT LIKE 'CASH-LEG-%');

  SELECT COUNT(*) INTO v_active_leg_count
    FROM public.transactions
   WHERE reference          = 'CASH-LEG-2024'
     AND bank_statement_id = NEW.bank_statement_id
     AND date              = NEW.date
     AND amount            = NEW.amount
     AND type              = 'credit'
     AND category          = 'Cash & Bank'
     AND (voided IS NULL OR voided = FALSE);

  IF v_active_leg_count > v_active_src_count THEN
    -- Surplus mirror. Void EXACTLY ONE (LIMIT 1 semantics via subquery).
    SELECT id INTO v_leg_id
      FROM public.transactions
     WHERE reference          = 'CASH-LEG-2024'
       AND bank_statement_id = NEW.bank_statement_id
       AND date              = NEW.date
       AND amount            = NEW.amount
       AND type              = 'credit'
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

DROP TRIGGER IF EXISTS trg_cash_leg_write ON public.transactions;
CREATE TRIGGER trg_cash_leg_write
  AFTER INSERT OR UPDATE OF posted, category, amount, voided, type
    ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_ensure_cash_leg();


-- ─── DELETE TRIGGER ──────────────────────────────────────────────────────
--
-- On DELETE of a source row, delete the corresponding mirror leg so it
-- doesn't remain as an orphan credit. Handles both:
--   • per-row form  (reference = 'CASH-LEG-<OLD.id>')
--   • Task 5 form   (reference = 'CASH-LEG-2024', match by
--                    bs_id/date/amount, LIMIT 1 for multiplicity safety)
--
-- We DELETE rather than void. If the source is being physically removed,
-- its mirror should be too — otherwise the mirror sits with a dangling
-- 'CASH-LEG-<gone-id>' reference forever. Voiding would work for balance
-- purposes but leaves permanent no-op audit rows.
--
-- Interaction with period-lock: `trg_period_lock_transactions` blocks
-- DELETEs on rows dated in closed periods. If the source is in a closed
-- period, the DELETE fails at the row level before this trigger fires,
-- and the whole transaction rolls back. When the period is open, the
-- source DELETE succeeds, this trigger fires, and the cascade DELETE
-- on the mirror row (same period) also succeeds. The two DELETEs are
-- atomic under the source's transaction.

CREATE OR REPLACE FUNCTION public.transactions_handle_source_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leg_id UUID;
BEGIN
  -- Guard: OLD row is itself a mirror. No cascade in either direction —
  -- terminates the recursive DELETE the cascade below would otherwise
  -- trigger on the mirror.
  IF OLD.reference IS NOT NULL AND OLD.reference LIKE 'CASH-LEG-%' THEN
    RETURN OLD;
  END IF;

  -- Try per-row form first.
  DELETE FROM public.transactions
   WHERE reference = 'CASH-LEG-' || OLD.id::text;
  IF FOUND THEN
    RETURN OLD;
  END IF;

  -- Fall back to Task 5 CASH-LEG-2024 form. Delete EXACTLY ONE.
  IF OLD.bank_statement_id IS NULL
     OR OLD.date            IS NULL
     OR OLD.amount          IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT id INTO v_leg_id
    FROM public.transactions
   WHERE reference          = 'CASH-LEG-2024'
     AND bank_statement_id = OLD.bank_statement_id
     AND date              = OLD.date
     AND amount            = OLD.amount
     AND type              = 'credit'
     AND category          = 'Cash & Bank'
   ORDER BY id
   LIMIT 1;

  IF v_leg_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = v_leg_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_leg_delete ON public.transactions;
CREATE TRIGGER trg_cash_leg_delete
  AFTER DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_handle_source_delete();
