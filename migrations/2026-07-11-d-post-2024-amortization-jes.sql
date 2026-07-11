-- 2026-07-11 (d)  Post 2024 monthly amortization JEs — companion to the
-- Fix-1 side-effect remediation (missing amortization expense).
--
-- Motivation. The prior 2024 depreciation correction deleted 7 legacy JEs
-- (JE-DA-2024-02..-05 plus JE-067/068/069). Those legacy JEs used a
-- combined "Depreciation & Amortization" expense account, so removing
-- them stripped ~$11,704.33 of 2024 Section 195 amortization off the P&L.
-- The balance sheet's L12B still shows the accumulated amortization moved
-- by -$11,704.33 (2023 -$23,408.62 → 2024 -$35,112.95), so BS and P&L
-- were out of sync. This migration re-posts the missing amortization as
-- 12 clean monthly JEs on the NEW distinct "Amortization Expense" and
-- "Accumulated Amortization" accounts (the 2026-07-11-b migration adds
-- those accounts if not already present).
--
-- Amounts. annual_amort = |L12B(2024)| − |L12B(2023)| = 11,704.33.
-- Split as 11 × $975.36 (Jan–Nov) + $975.37 (Dec, rounding stub) = 11,704.33.
--
-- References. JE-NNN sequence (max numeric suffix + 1). Since prior session
-- ended at JE-082, this migration allocates JE-083..JE-094 in date order.
-- The allocation is computed at run time so re-runs against a modified DB
-- pick up new numbers correctly.
--
-- Idempotency. Uses a per-month "already posted?" check via a
-- fingerprint (date + category + memo pattern). Re-running is safe.
--
-- Depends on migration `2026-07-11-b-add-amortization-coa-accounts.sql`.
-- Skips itself if the 2024 amortization JEs are already present.

BEGIN;

-- Ensure the amortization CoA accounts exist and are active.
DO $$
DECLARE
  n_exp INT;
  n_ac  INT;
BEGIN
  SELECT COUNT(*) INTO n_exp FROM public.categories
   WHERE name = 'Amortization Expense' AND type = 'expense' AND archived = false;
  SELECT COUNT(*) INTO n_ac  FROM public.categories
   WHERE name = 'Accumulated Amortization' AND type = 'asset' AND archived = false;
  IF n_exp <> 1 OR n_ac <> 1 THEN
    RAISE EXCEPTION 'Amortization CoA accounts missing (expense=%, asset=%). Run 2026-07-11-b first.', n_exp, n_ac;
  END IF;
END $$;

-- Idempotent guard — if this migration has already run to completion,
-- exit gracefully.
DO $$
DECLARE
  n_existing INT;
BEGIN
  SELECT COUNT(*) INTO n_existing FROM public.journal_entries je
    JOIN public.journal_entry_lines l ON l.journal_entry_id = je.id
   WHERE je.date BETWEEN '2024-01-01' AND '2024-12-31'
     AND l.category = 'Amortization Expense';
  IF n_existing >= 12 THEN
    RAISE NOTICE '2024 amortization JEs already present (% expense-side lines) — skipping.', n_existing;
    RETURN;
  END IF;
END $$;

-- Reopen the 12 closed 2024 periods so we can post into them.
-- Phase 1 state (restored at end of this migration):
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
UPDATE public.period_close
   SET status = 'open', closed_at = NULL, closed_by = NULL
 WHERE period BETWEEN '2024-01' AND '2024-12'
   AND status = 'closed';

-- Compute the JE-NNN base once for this batch; each of the 12 months uses
-- base + m to zero-pad to 3 digits. If there's a race with another writer
-- allocating JE-NNN concurrently, the UNIQUE(reference) constraint on
-- journal_entries will surface it.
WITH months(m, mnum, amount, mname) AS (
  VALUES
    ('2024-01-31'::date, 1,  975.36::numeric(12,2), 'January'),
    ('2024-02-29'::date, 2,  975.36::numeric(12,2), 'February'),
    ('2024-03-31'::date, 3,  975.36::numeric(12,2), 'March'),
    ('2024-04-30'::date, 4,  975.36::numeric(12,2), 'April'),
    ('2024-05-31'::date, 5,  975.36::numeric(12,2), 'May'),
    ('2024-06-30'::date, 6,  975.36::numeric(12,2), 'June'),
    ('2024-07-31'::date, 7,  975.36::numeric(12,2), 'July'),
    ('2024-08-31'::date, 8,  975.36::numeric(12,2), 'August'),
    ('2024-09-30'::date, 9,  975.36::numeric(12,2), 'September'),
    ('2024-10-31'::date, 10, 975.36::numeric(12,2), 'October'),
    ('2024-11-30'::date, 11, 975.36::numeric(12,2), 'November'),
    ('2024-12-31'::date, 12, 975.37::numeric(12,2), 'December')
),
base AS (
  SELECT COALESCE(
           MAX((regexp_replace(reference, '^JE-', ''))::int),
           0
         ) AS n
    FROM public.journal_entries
   WHERE reference ~ '^JE-\d+$'
),
inserted_jes AS (
  INSERT INTO public.journal_entries
    (reference, date, description, memo, total_amount, status, entry_type, created_by, posted_at)
  SELECT
    'JE-' || lpad((base.n + m.mnum)::text, 3, '0'),
    m.m,
    'Monthly amortization - ' || m.mname || ' 2024 (Start-Up Costs, Sec 195)',
    'CPA-sourced 2024 amortization — migration 2026-07-11-d',
    m.amount,
    'posted',
    'simple',
    NULL,
    now()
  FROM months m, base
  RETURNING id, reference, date, total_amount
),
inserted_lines AS (
  INSERT INTO public.journal_entry_lines
    (journal_entry_id, account_id, description, debit_amount, credit_amount, category)
  SELECT ie.id, NULL, 'Amortization Expense',       ie.total_amount, 0,               'Amortization Expense'
    FROM inserted_jes ie
  UNION ALL
  SELECT ie.id, NULL, 'Accumulated Amortization',   0,               ie.total_amount, 'Accumulated Amortization'
    FROM inserted_jes ie
  RETURNING journal_entry_id
),
inserted_txns AS (
  INSERT INTO public.transactions
    (date, description, supplier, amount, type, category, account_id, reference, bank_statement_id, journal_entry_id, posted, voided)
  SELECT ie.date,
         'Amortization — ' || to_char(ie.date, 'FMMonth YYYY'),
         'Amortization JE',
         ie.total_amount, 'debit',  'Amortization Expense',     NULL, ie.reference, NULL, ie.id, true, false
    FROM inserted_jes ie
  UNION ALL
  SELECT ie.date,
         'Amortization — ' || to_char(ie.date, 'FMMonth YYYY'),
         'Amortization JE',
         ie.total_amount, 'credit', 'Accumulated Amortization', NULL, ie.reference, NULL, ie.id, true, false
    FROM inserted_jes ie
  RETURNING id
)
SELECT 1;

-- Assert DR = CR and total = 11,704.33 across the 12 new JEs (identify by
-- the memo pattern so we don't accidentally sweep in unrelated JE-NNN entries).
DO $$
DECLARE
  je_count int;
  total_amt numeric(12,2);
  dr_sum   numeric(12,2);
  cr_sum   numeric(12,2);
BEGIN
  SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
    INTO je_count, total_amt
    FROM public.journal_entries
   WHERE memo = 'CPA-sourced 2024 amortization — migration 2026-07-11-d';
  IF je_count <> 12 THEN
    RAISE EXCEPTION 'Expected 12 amortization JEs, found %', je_count;
  END IF;
  IF total_amt <> 11704.33 THEN
    RAISE EXCEPTION 'Sum of 2024 amortization JEs = % (expected 11,704.33)', total_amt;
  END IF;

  SELECT COALESCE(SUM(l.debit_amount), 0), COALESCE(SUM(l.credit_amount), 0)
    INTO dr_sum, cr_sum
    FROM public.journal_entry_lines l
    JOIN public.journal_entries je ON je.id = l.journal_entry_id
   WHERE je.memo = 'CPA-sourced 2024 amortization — migration 2026-07-11-d';
  IF dr_sum <> cr_sum OR dr_sum <> 11704.33 THEN
    RAISE EXCEPTION 'Amortization JE lines imbalance: DR=%  CR=%  (expected 11,704.33 each)', dr_sum, cr_sum;
  END IF;
END $$;

-- Restore period_close for 2024-01..12 byte-for-byte.
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

COMMIT;
