-- 2026-07-14 · L2 finance charge Feb–Jul 2024 [ESTIMATE]
--
-- CONTEXT (per Run 2 §5 item 1, existing disclosures in reports.js §"E.
-- Year-by-year finance charge" and §"F. Open questions")
--
-- The L2 Jaris/SpotOn Capital loan statements for Feb–Jul 2024 are
-- missing from the source packet. L2 was refinanced into L3 on
-- 06/27/2024, so the missing statements cover approximately the entire
-- pre-refi period of 2024. Prior forensic work (SELRIC-JARIS.md,
-- reports §D-F) quantified the missing finance charge at $13,252.79
-- using the same proportional effective-interest method already
-- validated on the January-2024 L2 documented statement ($241.61) and
-- on the full L1/L3 series.
--
-- ACCOUNTING TREATMENT
--   DR  Interest Expense                        13,252.79   ← P&L
--   CR  Loan — Spoton                           13,252.79   ← BS
--
-- The credit adds L2 finance charge accrual to the Spoton loan balance
-- that ultimately rolled into L3 during the 06/27/2024 refi.
--
-- IDEMPOTENCE
--   Detection: JE reference = 'JE-L2-FIN-EST'. If already present, this
--   file's companion apply script (/tmp/apply_l2_finance.mjs) exits
--   without re-posting.
--
-- WHY [ESTIMATE]
--   The Feb–Jul source statements are missing. The amount is derived
--   proportionally from documented L2 January and L3 post-refi
--   statements. Once Justin (or SpotOn) produces the missing statements,
--   the estimate should be replaced with the documented number.
--
-- REVERSAL
--   Set JE b5f6220a-962d-4698-858a-889e20fac172 status='voided' plus
--   propagate voided=true to the 2 mirror transactions.
--
-- IMPACT ON TB / NI (verified post-apply)
--   TB imbalance:   0.00 →  0.00  (stays balanced — this is a balanced JE)
--   Net income:  97,073.09 → 83,820.30  (drops $13,252.79 as designed)
--   BS is CPA-anchored via ending_balance_confirmed on L20A Loan - Spoton
--   so the CR to the loan does NOT flow through to the balance sheet
--   ending value. That is intentional. The transaction is captured in the
--   ledger; the CPA-locked BS remains at its Justin-sourced value.

-- Documentation-only migration; the actual post is executed via the
-- companion apply script that uses the post_journal_entry RPC. This
-- file records the fix for auditability. Idempotent by design (no DDL).

DO $$
BEGIN
  RAISE NOTICE 'L2 finance charge estimate posted via JE-L2-FIN-EST. See docs/FIX_LOG.md Fix #3.';
END $$;
