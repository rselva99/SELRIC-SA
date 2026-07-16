-- 2026-07-14 · Revert the un-sourced Meridian $157,459.91 BS-line adjustment
--
-- FINDING (Run 2 §1.1, docs/FINDINGS.md §A9 replaces earlier Meridian
-- write-off assumption)
--
-- L17 line "Meridian Payments" for FY2024 has:
--   beginning_balance          =  157,459.91  (CPA opening balance)
--   ending_balance_confirmed   =        0.00
--   adjustments (1)            = -157,459.91
--     date=NULL  reason=NULL  memo=NULL  ref_type=NULL  ref_id=NULL
--
-- The single adjustment carries NO source metadata — no linked JE, no
-- linked transaction, no reason, no memo, no date. It is a single-legged
-- balance-sheet write-down. NO corresponding DR entry exists anywhere in
-- the ledger (verified: `SELECT * FROM journal_entries WHERE description
-- ILIKE '%Meridian%'` returns 0 rows).
--
-- The result: a $157,459.91 liability write-off that touches only one
-- side of the accounting equation. It is precisely why the FY2024
-- balance sheet has been "out of balance": BS-implied NI = 262,235.51
-- vs. P&L NI = 97,073.09, a gap of $165,162.42, of which $157,459.91
-- (~95%) is explained by this one un-sourced adjustment.
--
-- Run 1 leapt to booking this to the P&L, producing a fabricated
-- -$60,387 net loss "to align with owner reality." Run 2 rejects that
-- fitting. Meridian is a payable. Payments against a payable are BS
-- events (DR liability, CR cash) — they do NOT reduce net income.
-- Without bank evidence of a $157,459.91 cash outflow in FY2024, we
-- cannot prove the payment happened at all.
--
-- REMEDY (per Run 2 §1.1 doctrine "assume the ledger is guilty until
-- proven innocent")
--   Delete the un-sourced adjustment. The Meridian $157,459.91 liability
--   returns to its FY2024 ending balance = beginning balance = 157,459.91.
--   The BS re-balances (or comes much closer) and the P&L stays at
--   +$97,073.09. Meridian's ACTUAL payoff status becomes a CPA question
--   for Justin: either produce bank evidence of the payoff (then we book
--   the correct DR-cash + CR-Meridian pair) or Meridian genuinely
--   remains outstanding at 12/31/2024.
--
-- IDEMPOTENCE
--   The DELETE targets rows on Meridian's L17 line where the adjustment
--   amount is exactly -157459.91 AND every source metadata field is
--   NULL. If run twice, second run affects 0 rows.
--
-- REVERSAL
--   Should Justin later produce evidence of the payoff:
--     INSERT INTO book_bs_line_adjustments (line_id, amount, date, reason, memo, ref_type, ref_id)
--     SELECT id, -157459.91, '<date>', '<reason>', '<memo>', '<type>', '<id>'
--     FROM book_bs_lines WHERE year=2024 AND section_code='L17' AND title='Meridian Payments';
--   plus the corresponding CR Cash & Bank / DR Meridian JE.

BEGIN;

DELETE FROM public.book_bs_line_adjustments
 WHERE line_id IN (
    SELECT id FROM public.book_bs_lines
     WHERE year = 2024 AND section_code = 'L17' AND title = 'Meridian Payments'
 )
   AND amount = -157459.91
   AND date IS NULL
   AND (reason IS NULL OR reason = '')
   AND (memo IS NULL OR memo = '')
   AND ref_type IS NULL
   AND ref_id IS NULL;

-- Also clear the ending_balance_confirmed override so it derives from
-- beg + adjustments (which is now $157,459.91)
UPDATE public.book_bs_lines
   SET ending_balance_confirmed = NULL
 WHERE year = 2024
   AND section_code = 'L17'
   AND title = 'Meridian Payments'
   AND ending_balance_confirmed = 0;

DO $$
DECLARE
  v_end NUMERIC;
BEGIN
  SELECT
    COALESCE(l.ending_balance_confirmed,
             COALESCE(l.beginning_balance,0) + COALESCE((SELECT SUM(amount) FROM public.book_bs_line_adjustments a WHERE a.line_id = l.id),0))
    INTO v_end
    FROM public.book_bs_lines l
   WHERE l.year=2024 AND l.section_code='L17' AND l.title='Meridian Payments';
  RAISE NOTICE 'Meridian ending after revert: %', v_end;
END $$;

COMMIT;
