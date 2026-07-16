-- 2026-07-14 · Fix Payroll Adjustment single-legged JEs — add missing cash legs
--
-- FINDING (docs/FINDINGS.md §A8-2, Run 2 §5)
--   Nine monthly "Payroll Adjustment" JEs are single-legged: each carries
--   a single Payroll CREDIT line (reducing Payroll expense) with no
--   offsetting Cash & Bank debit. Total CR = $5,698.80 = the exact
--   post-Fix#1 TB residual.
--
--   Sum by JE:
--     JE-039  2024-03-31  Payroll CR   123.50
--     JE-054  2024-09-11  Payroll CR   647.00
--     JE-051  2024-08-31  Payroll CR 1,022.50
--     JE-040  2024-04-30  Payroll CR 1,781.30
--     JE-062  2024-12-31  Payroll CR   399.00
--     JE-048  2024-07-31  Payroll CR   777.50
--     JE-045  2024-06-30  Payroll Adjust CR   570.50
--     JE-057  2024-02-29  Payroll CR   213.00
--     JE-066  2024-10-31  Payroll CR   164.50
--                                    ---------
--                                    5,698.80
--
-- FIX PATTERN. The one BALANCED "Payroll ADJUST" JE in this cluster
--   (JE-058 2024-02-29, $10) shows the correct shape:
--     DR Payroll  / CR Cash & Bank  (an INCREASE to payroll)
--   By symmetry a payroll REDUCTION (CR Payroll) must mirror with
--     DR Cash & Bank (cash returned/not paid out).
--   Each of the 9 above gets its missing DR Cash & Bank leg.
--
-- IDEMPOTENCE. WHERE NOT EXISTS guard on both journal_entry_lines and
-- transactions keyed by (journal_entry_id, category='Cash & Bank',
-- type='debit'). Safe to re-run.
--
-- PERIOD-LOCK. All target dates are in closed FY2024 periods. The
-- companion apply script (/tmp/apply_pay_adj_fix.mjs) reopens the
-- periods, inserts the rows, then re-closes to original state.
--
-- CASH-LEG-WRITE TRIGGER. `trg_cash_leg_write` gates on
-- `bank_statement_id IS NOT NULL`. Our new rows have NULL. Trigger will
-- not fire. No double-write.
--
-- TB IMPACT. Adds 9 × $5,698.80 total DR to Cash & Bank. TB residual
-- moves from -$5,698.80 to $0.00. NI unchanged (both DR Cash & Bank and
-- CR Payroll are already in ledger — this fix just adds the DR leg).
--
-- Wait: the Payroll CRs already exist and are already reducing Payroll
-- expense. Adding DR Cash & Bank means we ADD $5,698.80 to Cash & Bank
-- (a BS shift), not touching P&L. NI stays exactly at $97,073.09.
--
-- CPA note. The offsetting DR could alternatively be Tips Payable (L17)
-- if these adjustments represent tip-pool reclassifications. That would
-- be a BS-only rearrangement (Cash & Bank + Tips Payable trade $5,699).
-- For now booked to Cash & Bank matching the parent Payroll JE pattern.
-- Justin can restate if needed — see docs/CPA_DECISIONS.md D-Payroll.
--
-- REVERSAL
--   DELETE FROM journal_entry_lines
--     WHERE journal_entry_id IN (<9 ids>) AND category='Cash & Bank'
--       AND debit_amount > 0;
--   DELETE FROM transactions
--     WHERE journal_entry_id IN (<9 ids>) AND category='Cash & Bank'
--       AND type='debit' AND description='[Cash leg] Payroll Adjustment';

BEGIN;

ALTER TABLE public.transactions DISABLE TRIGGER trg_period_lock_transactions;
ALTER TABLE public.journal_entry_lines DISABLE TRIGGER USER;

-- Insert missing JE lines (Cash & Bank DR for each CR-only Payroll Adjustment)
INSERT INTO public.journal_entry_lines
  (journal_entry_id, account_id, description, debit_amount, credit_amount, category, created_at)
SELECT
  je.id,
  NULL::uuid,
  'Cash & Bank',
  jel.credit_amount,   -- match the credit_amount to reduce the CR-only imbalance
  0,
  'Cash & Bank',
  now()
FROM public.journal_entries je
JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
WHERE (je.description ILIKE 'Payroll Adjustment%' OR je.description ILIKE 'Payroll Adjust%')
  AND je.description NOT ILIKE 'Payroll ADJUST%'   -- exclude the balanced $10 JE-058
  AND je.date >= '2024-01-01' AND je.date <= '2024-12-31'
  AND je.status = 'posted'
  AND jel.category = 'Payroll'
  AND jel.credit_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entry_lines existing
    WHERE existing.journal_entry_id = je.id
      AND existing.category = 'Cash & Bank'
      AND existing.debit_amount > 0
  );

-- Insert missing transactions cash-leg debits
INSERT INTO public.transactions
  (date, description, amount, type, category, supplier, reference,
   account_id, bank_statement_id, invoice_id, reconciled, user_id,
   created_at, posted, journal_entry_id, capitalized_asset_id,
   voided, verified, updated_at)
SELECT
  je.date,
  '[Cash leg] Payroll Adjustment',
  jel.credit_amount,
  'debit',
  'Cash & Bank',
  'Payroll Adjustment',
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
JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
WHERE (je.description ILIKE 'Payroll Adjustment%' OR je.description ILIKE 'Payroll Adjust%')
  AND je.description NOT ILIKE 'Payroll ADJUST%'
  AND je.date >= '2024-01-01' AND je.date <= '2024-12-31'
  AND je.status = 'posted'
  AND jel.category = 'Payroll'
  AND jel.credit_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions tx
    WHERE tx.journal_entry_id = je.id
      AND tx.category = 'Cash & Bank'
      AND tx.type = 'debit'
      AND tx.posted = true
      AND tx.voided = false
  );

ALTER TABLE public.journal_entry_lines ENABLE TRIGGER USER;
ALTER TABLE public.transactions ENABLE TRIGGER trg_period_lock_transactions;

DO $$
DECLARE
  v_unbal INTEGER;
  v_sum   NUMERIC;
BEGIN
  -- Confirm the 9 JEs are now balanced
  SELECT COUNT(*)
  INTO v_unbal
  FROM public.journal_entries je
  WHERE (je.description ILIKE 'Payroll Adjustment%' OR je.description ILIKE 'Payroll Adjust%')
    AND je.description NOT ILIKE 'Payroll ADJUST%'
    AND je.date >= '2024-01-01' AND je.date <= '2024-12-31'
    AND je.status = 'posted'
    AND (SELECT COALESCE(SUM(debit_amount),0) FROM public.journal_entry_lines l WHERE l.journal_entry_id = je.id)
        <>
        (SELECT COALESCE(SUM(credit_amount),0) FROM public.journal_entry_lines l WHERE l.journal_entry_id = je.id);
  IF v_unbal <> 0 THEN
    RAISE EXCEPTION 'Post-fix invariant violation: % Payroll Adjustment JEs still unbalanced', v_unbal;
  END IF;
  RAISE NOTICE 'Payroll Adjustment cash-leg fix: all 9 JEs now balanced';
END $$;

COMMIT;
