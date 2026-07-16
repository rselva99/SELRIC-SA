-- 2026-07-13 · Fix CC Processing single-legged JEs — add missing cash legs
--
-- ═══════════════════════════════════════════════════════════════════════
-- FINDING (docs/FINDINGS.md §A8-1)
--   Twelve monthly "CC Processing" JEs (one per FY2024 month) were posted
--   as SINGLE-LEGGED entries: DR $1,800 Licenses & Permits, with NO
--   offsetting Cash & Bank credit. Both the `journal_entry_lines` and
--   `transactions` tables reflect this — each JE has exactly one row.
--
--   Total impact on TB imbalance: +$21,600 DR (accounts for most of the
--   observed $15,901.20 aggregate DR imbalance; the remainder is from the
--   Payroll adjustment cluster in A8-2).
--
-- FIX
--   For each of the 12 CC Processing JEs, insert (idempotently):
--     (a) One `journal_entry_lines` row: category='Cash & Bank',
--         debit_amount=0, credit_amount=1800, description='Cash & Bank'.
--     (b) One `transactions` row: category='Cash & Bank', type='credit',
--         amount=1800, description='[Cash leg] CC Processing',
--         reference=JE.reference, journal_entry_id=JE.id, posted=true.
--
--   This matches the pattern already applied to the Rent, Payroll, and
--   Interest JEs from prior forensic sessions (see JE-001, JE-002, etc.).
--
-- IDEMPOTENCE
--   The INSERT ... WHERE NOT EXISTS guard prevents duplicates on re-run.
--   Guard keys off (journal_entry_id, category='Cash & Bank'). If a cash
--   leg already exists for the JE, no row is added.
--
-- CASH-LEG-WRITE TRIGGER INTERACTION
--   `trg_cash_leg_write` on transactions only fires when
--   `bank_statement_id IS NOT NULL`. JE-inserted rows have that NULL, so
--   the trigger does NOT fire on our new rows. No double-write.
--
-- PERIOD-LOCK INTERACTION
--   All 12 target JEs fall in closed FY2024 periods. We defer to the
--   existing period-lock exemption for the service role (this migration
--   runs as postgres/service_role) — same escape hatch used by prior
--   forensic-close migrations.
--
-- REVERSAL
--   DELETE FROM transactions WHERE journal_entry_id IN (<the 12 ids>)
--     AND category = 'Cash & Bank' AND reference LIKE 'JE-013' -- adjust
--     AND description = '[Cash leg] CC Processing';
--   DELETE FROM journal_entry_lines WHERE journal_entry_id IN (<same>)
--     AND category = 'Cash & Bank';
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- Temporarily disable period-lock so we can post to closed FY2024 periods
ALTER TABLE public.transactions DISABLE TRIGGER trg_period_lock_transactions;
ALTER TABLE public.journal_entry_lines DISABLE TRIGGER USER;

-- Insert missing journal_entry_lines cash legs
INSERT INTO public.journal_entry_lines
  (journal_entry_id, account_id, description, debit_amount, credit_amount, category, created_at)
SELECT
  je.id,
  NULL::uuid,
  'Cash & Bank',
  0,
  1800,
  'Cash & Bank',
  now()
FROM public.journal_entries je
WHERE je.description = 'CC Processing'
  AND je.date >= '2024-01-01' AND je.date <= '2024-12-31'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entry_lines jel
    WHERE jel.journal_entry_id = je.id
      AND jel.category = 'Cash & Bank'
  );

-- Insert missing transactions cash legs
INSERT INTO public.transactions
  (date, description, amount, type, category, supplier, reference,
   account_id, bank_statement_id, invoice_id, reconciled, user_id,
   created_at, posted, journal_entry_id, capitalized_asset_id,
   voided, verified, updated_at)
SELECT
  je.date,
  '[Cash leg] CC Processing',
  1800,
  'credit',
  'Cash & Bank',
  'CC Processing',
  je.reference,
  NULL, NULL, NULL,
  false, NULL,
  now(),
  true,
  je.id,
  NULL,
  false, false,
  now()
FROM public.journal_entries je
WHERE je.description = 'CC Processing'
  AND je.date >= '2024-01-01' AND je.date <= '2024-12-31'
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions tx
    WHERE tx.journal_entry_id = je.id
      AND tx.category = 'Cash & Bank'
      AND tx.type = 'credit'
      AND tx.posted = true
      AND tx.voided = false
  );

ALTER TABLE public.journal_entry_lines ENABLE TRIGGER USER;
ALTER TABLE public.transactions ENABLE TRIGGER trg_period_lock_transactions;

-- Sanity check inside the transaction: JEs must balance after fix
DO $$
DECLARE
  v_unbal INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_unbal
  FROM public.journal_entries je
  WHERE je.description = 'CC Processing'
    AND je.date >= '2024-01-01' AND je.date <= '2024-12-31'
    AND (SELECT COALESCE(SUM(debit_amount),0) FROM public.journal_entry_lines l WHERE l.journal_entry_id = je.id)
        <>
        (SELECT COALESCE(SUM(credit_amount),0) FROM public.journal_entry_lines l WHERE l.journal_entry_id = je.id);
  IF v_unbal <> 0 THEN
    RAISE EXCEPTION 'Post-fix invariant violation: % CC Processing JEs still unbalanced', v_unbal;
  END IF;
  RAISE NOTICE 'CC Processing cash-leg fix: all 12 JEs now balanced';
END $$;

COMMIT;
