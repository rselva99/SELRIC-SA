-- 2026-07-11  2024 DEPRECIATION CORRECTION — CPA-sourced.
--
-- Aligns the general ledger and Book Balance Sheet to the CPA's
-- 2024 Federal tax depreciation schedule for 3700 Laclede Ave LLC:
--
--   Cost / Other Basis (L09A scope) ...... $823,420.89   (unchanged)
--   Beg. Accum. Dep. 1/1/2024 ............ $597,709.11   (unchanged — from 2023 close)
--   2024 depreciation .................... $  7,082.90   (this migration posts it)
--   End. Accum. Dep. 12/31/2024 .......... $604,792.01   (this migration corrects L09B)
--
-- Per-asset 2024 depreciation (all other assets fully bonused in 2022):
--   #9  Doors            225.69   #10 Drywall          263.21
--   #11 Electrical     1,447.49   #12 Floors           770.15
--   #13 Framing           87.94   #14 HVAC             891.88
--   #15 Plumbing       2,015.24   #16 Flooring-Tile    209.51
--   #17 Patio Heaters    180.73   #18 Fencing          582.81
--   #19 Patio Lighting   138.51   #20 Pergolas         170.94
--   #21 Catering Equip    98.80
--   ─────────────────────────────
--   SUM             = 7,082.90
--
-- Requires migration `2026-07-11-add-depreciation-coa-accounts.sql`
-- to have run first (adds distinct "Depreciation Expense" and
-- "Accumulated Depreciation" categories used by the new JEs).
--
-- SCOPE LIMITS (ENFORCED)
--   • L12A / L12B (Start-Up Costs / amortization) — untouched. The CPA
--     schedule is fixed assets only; Section 195 amortization is out of
--     scope. The app's existing depreciation.js flow bundles amortization
--     into its "Depreciation & Amortization" combined account — that is
--     reported to the operator, not fixed here.
--   • 2023, 2022 — untouched. The $597,709.11 beginning accum-dep is a
--     given.
--   • Structural Balance Sheet gap — NOT plugged. Fixing L09B moves the
--     visible gap by +29,149.28. That is the correct, intended surface.
--   • Revenue and non-D&A P&L categories — untouched.
--
-- WHAT THIS MIGRATION DOES
--   Step 3.  Reopens all 12 months of 2024 in period_close (Phase 1
--            state fully preserved in per-period constants below).
--   Step 2.  Deletes 7 incorrect 2024 JEs (transactions → lines → JE):
--              JE-DA-2024-02, -03, -04, -05  (app straight-line, wrong basis)
--              JE-067  (malformed single-line DR Accum Dep $38,886)
--              JE-068  (single-line CR Accum Dep $38,886, "Reversal of JE-067")
--              JE-069  (single-line CR Accum Dep $38,886, "True Up Dep")
--            JE-OPENING and JE-CLOSE-2024 are LEFT ALONE — they carry
--            2022 opening balances and a voided closing entry, respectively.
--   Step 4.  Inserts 12 clean monthly JEs:
--              JE-DA-2024-01 .. JE-DA-2024-11 : $590.24 each
--              JE-DA-2024-12                  : $590.26  (rounding absorber)
--            Each: DR Depreciation Expense $x / CR Accumulated Depreciation $x.
--            Dated the LAST day of the month. Also mirrors two transactions
--            per JE so the P&L / Trial Balance / General Ledger show the
--            correct figures.
--   Step 5.  Sets book_bs_lines L09B (2024) ending_balance_confirmed
--            from -633,941.29 to -604,792.01 (delta +29,149.28).
--   Step 6.  Restores every reopened 2024 period_close row to its EXACT
--            Phase 1 state (status='closed', original closed_at and
--            closed_by, snapshot untouched throughout).
--
-- IDEMPOTENCY
--   Every step is guarded so re-running is safe:
--     - Reopen uses WHERE status='closed' guard.
--     - Delete uses WHERE reference IN (…) — 0 rows on re-run.
--     - Insert new JEs uses WHERE NOT EXISTS on reference.
--     - L09B update uses WHERE ending_balance_confirmed = -633941.29 guard —
--       won't re-apply if already at -604,792.01 or otherwise changed.
--     - Re-close uses WHERE status='open' guard.
--
-- The whole file runs in an implicit transaction (single-file paste in
-- Supabase SQL Editor); any RAISE EXCEPTION rolls the entire batch back.

BEGIN;

-- ============================================================
-- PRE-CHECK — depreciation-only categories must exist and be active.
-- ============================================================
DO $$
DECLARE
  n_exp INT;
  n_ac  INT;
BEGIN
  SELECT COUNT(*) INTO n_exp FROM public.categories
    WHERE name = 'Depreciation Expense' AND type = 'expense' AND archived = false;
  SELECT COUNT(*) INTO n_ac  FROM public.categories
    WHERE name = 'Accumulated Depreciation' AND type = 'asset' AND archived = false;
  IF n_exp <> 1 OR n_ac <> 1 THEN
    RAISE EXCEPTION 'Missing distinct depreciation CoA accounts — run 2026-07-11-add-depreciation-coa-accounts.sql first (expense=%, asset=%)', n_exp, n_ac;
  END IF;
END $$;

-- ============================================================
-- STEP 3 — Reopen 12 closed 2024 periods.
--
-- Phase 1 state (snapshot of period_close at discovery — restored in Step 6):
--   2024-01  closed 2026-06-15T20:16:32.539+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-02  closed 2026-06-15T20:16:44.721+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-03  closed 2026-06-15T20:16:59.384+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-04  closed 2026-06-15T20:17:08.35+00:00   by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-05  closed 2026-06-15T20:17:14.831+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-06  closed 2026-06-15T20:17:31.037+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-07  closed 2026-06-15T20:17:39.652+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-08  closed 2026-06-15T20:17:50.555+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-09  closed 2026-06-15T20:17:56.965+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-10  closed 2026-06-15T20:18:02.627+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-11  closed 2026-06-15T20:18:13.829+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
--   2024-12  closed 2026-06-17T13:42:53.786+00:00  by 7fd50334-c616-4861-b73e-e3e16e1bbc17
-- snapshot + snapshot_at + notes intentionally NOT touched here, so the
-- byte-for-byte restore in Step 6 need only re-flip status/closed_at/closed_by.
-- ============================================================
UPDATE public.period_close
   SET status = 'open',
       closed_at = NULL,
       closed_by = NULL
 WHERE period IN ('2024-01','2024-02','2024-03','2024-04','2024-05','2024-06',
                  '2024-07','2024-08','2024-09','2024-10','2024-11','2024-12')
   AND status = 'closed';

-- ============================================================
-- STEP 2 — Delete the 7 incorrect 2024 D&A JEs (transactions → JE lines → JE).
--
-- We DELETE (rather than void) so we can re-use the JE-DA-2024-02..-05
-- references cleanly. The migration file itself is the audit trail.
-- ============================================================
DELETE FROM public.transactions
 WHERE journal_entry_id IN (
   SELECT id FROM public.journal_entries
    WHERE reference IN ('JE-DA-2024-02','JE-DA-2024-03','JE-DA-2024-04','JE-DA-2024-05',
                        'JE-067','JE-068','JE-069')
 );

DELETE FROM public.journal_entry_lines
 WHERE journal_entry_id IN (
   SELECT id FROM public.journal_entries
    WHERE reference IN ('JE-DA-2024-02','JE-DA-2024-03','JE-DA-2024-04','JE-DA-2024-05',
                        'JE-067','JE-068','JE-069')
 );

DELETE FROM public.journal_entries
 WHERE reference IN ('JE-DA-2024-02','JE-DA-2024-03','JE-DA-2024-04','JE-DA-2024-05',
                     'JE-067','JE-068','JE-069');

-- ============================================================
-- STEP 4 — Insert 12 monthly D&A journals per CPA schedule.
-- Reference sequence follows depreciation.js convention (JE-DA-YYYY-MM).
-- Jan–Nov: $590.24 each. Dec: $590.26 (rounding absorber). Total: $7,082.90.
-- ============================================================
WITH months(m, mnum, amount, mname) AS (
  VALUES
    ('2024-01-31'::date, 1,  590.24::numeric(12,2), 'January'),
    ('2024-02-29'::date, 2,  590.24::numeric(12,2), 'February'),
    ('2024-03-31'::date, 3,  590.24::numeric(12,2), 'March'),
    ('2024-04-30'::date, 4,  590.24::numeric(12,2), 'April'),
    ('2024-05-31'::date, 5,  590.24::numeric(12,2), 'May'),
    ('2024-06-30'::date, 6,  590.24::numeric(12,2), 'June'),
    ('2024-07-31'::date, 7,  590.24::numeric(12,2), 'July'),
    ('2024-08-31'::date, 8,  590.24::numeric(12,2), 'August'),
    ('2024-09-30'::date, 9,  590.24::numeric(12,2), 'September'),
    ('2024-10-31'::date, 10, 590.24::numeric(12,2), 'October'),
    ('2024-11-30'::date, 11, 590.24::numeric(12,2), 'November'),
    ('2024-12-31'::date, 12, 590.26::numeric(12,2), 'December')
),
inserted_jes AS (
  INSERT INTO public.journal_entries
    (reference, date, description, memo, total_amount, status, entry_type, created_by, posted_at)
  SELECT
    'JE-DA-2024-' || lpad(mnum::text, 2, '0'),
    m,
    'Monthly depreciation - ' || mname || ' 2024 (per CPA schedule)',
    'CPA-sourced 2024 depreciation — migration 2026-07-11',
    amount,
    'posted',
    'simple',
    NULL,
    now()
  FROM months
  WHERE NOT EXISTS (
    SELECT 1 FROM public.journal_entries je
     WHERE je.reference = 'JE-DA-2024-' || lpad(months.mnum::text, 2, '0')
  )
  RETURNING id, reference, date, total_amount
),
inserted_lines AS (
  INSERT INTO public.journal_entry_lines
    (journal_entry_id, account_id, description, debit_amount, credit_amount, category)
  SELECT ie.id, NULL, 'Depreciation Expense',        ie.total_amount, 0,               'Depreciation Expense'
    FROM inserted_jes ie
  UNION ALL
  SELECT ie.id, NULL, 'Accumulated Depreciation',    0,               ie.total_amount, 'Accumulated Depreciation'
    FROM inserted_jes ie
  RETURNING journal_entry_id
),
inserted_txns AS (
  INSERT INTO public.transactions
    (date, description, supplier, amount, type, category, account_id, reference, bank_statement_id, journal_entry_id, posted, voided)
  SELECT ie.date,
         'Depreciation — ' || to_char(ie.date, 'FMMonth YYYY'),
         'Depreciation JE',
         ie.total_amount, 'debit',  'Depreciation Expense',    NULL, ie.reference, NULL, ie.id, true, false
    FROM inserted_jes ie
  UNION ALL
  SELECT ie.date,
         'Depreciation — ' || to_char(ie.date, 'FMMonth YYYY'),
         'Depreciation JE',
         ie.total_amount, 'credit', 'Accumulated Depreciation', NULL, ie.reference, NULL, ie.id, true, false
    FROM inserted_jes ie
  RETURNING id
)
SELECT 1;  -- CTE result is discarded; RETURNINGs cascade the writes.

-- Assert DR = CR per JE and total = 7,082.90.
DO $$
DECLARE
  total_amt numeric(12,2);
  je_count  int;
  dr_sum    numeric(12,2);
  cr_sum    numeric(12,2);
BEGIN
  SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
    INTO je_count, total_amt
    FROM public.journal_entries
   WHERE reference LIKE 'JE-DA-2024-%';
  IF je_count <> 12 THEN
    RAISE EXCEPTION 'Expected 12 JE-DA-2024-* rows, found %', je_count;
  END IF;
  IF total_amt <> 7082.90 THEN
    RAISE EXCEPTION 'Sum of 2024 D&A JEs = % (expected 7082.90)', total_amt;
  END IF;
  SELECT COALESCE(SUM(l.debit_amount), 0), COALESCE(SUM(l.credit_amount), 0)
    INTO dr_sum, cr_sum
    FROM public.journal_entry_lines l
    JOIN public.journal_entries je ON je.id = l.journal_entry_id
   WHERE je.reference LIKE 'JE-DA-2024-%';
  IF dr_sum <> cr_sum THEN
    RAISE EXCEPTION 'JE lines imbalance: DR=% CR=%', dr_sum, cr_sum;
  END IF;
  IF dr_sum <> 7082.90 THEN
    RAISE EXCEPTION 'JE lines DR total = % (expected 7082.90)', dr_sum;
  END IF;
END $$;

-- ============================================================
-- STEP 5 — Correct book_bs_lines L09B (2024) ending_balance_confirmed.
--   Before:  -633,941.29
--   After:   -604,792.01
--   Delta:   +29,149.28
-- Value is CPA-sourced, not derived from the JEs above.
-- confirmed_at bumped to now() so the Book BS Compare panel shows the
-- fresh confirmation; confirmed_by set NULL to signal migration source.
-- Pre-existing book_bs_line_adjustments on this line are left intact —
-- ending_balance_confirmed overrides them in the builder.
-- ============================================================
UPDATE public.book_bs_lines
   SET ending_balance_confirmed = -604792.01,
       confirmed_by             = NULL,
       confirmed_at             = now(),
       updated_at               = now()
 WHERE year = 2024
   AND section_code = 'L09B'
   AND title = 'Accumulated Depreciation'
   AND ending_balance_confirmed = -633941.29;

DO $$
DECLARE
  v numeric(14,2);
BEGIN
  SELECT ending_balance_confirmed INTO v
    FROM public.book_bs_lines
   WHERE year = 2024 AND section_code = 'L09B' AND title = 'Accumulated Depreciation';
  IF v <> -604792.01 THEN
    RAISE EXCEPTION 'L09B (2024) ending_balance_confirmed = % (expected -604792.01)', v;
  END IF;
END $$;

-- ============================================================
-- STEP 6 — Restore period_close for 2024-01..12 byte-for-byte.
-- ============================================================
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:16:32.539+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-01' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:16:44.721+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-02' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:16:59.384+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-03' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:17:08.35+00:00'::timestamptz,  closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-04' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:17:14.831+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-05' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:17:31.037+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-06' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:17:39.652+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-07' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:17:50.555+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-08' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:17:56.965+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-09' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:18:02.627+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-10' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-15T20:18:13.829+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-11' AND status='open';
UPDATE public.period_close SET status='closed', closed_at='2026-06-17T13:42:53.786+00:00'::timestamptz, closed_by='7fd50334-c616-4861-b73e-e3e16e1bbc17'::uuid WHERE period='2024-12' AND status='open';

DO $$
DECLARE
  open_count int;
BEGIN
  SELECT COUNT(*) INTO open_count FROM public.period_close
   WHERE period BETWEEN '2024-01' AND '2024-12' AND status <> 'closed';
  IF open_count <> 0 THEN
    RAISE EXCEPTION 'Expected all 12 of 2024 period_close closed, found % non-closed', open_count;
  END IF;
END $$;

COMMIT;
