-- 2026-06-17  Fix the enforce_period_lock trigger function so it stops
-- erroring on UPDATEs to journal_entries.
--
-- Bug: the prior versions
--   (2026-06-11-period-lock-trigger.sql + 2026-06-11-extend-period-lock-delete.sql)
-- have an ELSIF in the UPDATE branch that reads NEW.posted as part of a
-- compound boolean expression:
--
--     ELSIF TG_TABLE_NAME = 'transactions'
--           AND NEW.posted IS DISTINCT FROM OLD.posted
--           AND NEW.posted = true THEN
--       should_check := true;
--     END IF;
--
-- PL/pgSQL does not short-circuit boolean expressions when evaluating
-- record field access, so NEW.posted is referenced even when the leading
-- TG_TABLE_NAME = 'transactions' check would have ruled it out. On a
-- journal_entries UPDATE this fails with:
--     record "new" has no field "posted"
-- because the journal_entries table has no `posted` column.
--
-- Practical impact: every UPDATE on journal_entries fails, including the
-- app's own void flow (voidEntry() in src/pages/journal/JournalPage.jsx
-- line 502 — `update({ status: 'voided' })`). Nobody has been able to
-- void a JE since 2026-06-11 when the original trigger shipped.
--
-- Fix: defer the NEW.posted access into a nested IF that runs only when
-- TG_TABLE_NAME = 'transactions'. The outer IF guarantees we never
-- touch NEW.posted on journal_entries.
--
-- Idempotent: CREATE OR REPLACE on the function. Trigger definitions are
-- unchanged from the 2026-06-11-extend-period-lock-delete.sql version
-- (BEFORE INSERT OR UPDATE OR DELETE on each table), so no DROP+CREATE
-- on the trigger objects is needed.

CREATE OR REPLACE FUNCTION public.enforce_period_lock()
RETURNS TRIGGER AS $$
DECLARE
  txn_period   TEXT;
  close_status TEXT;
  target_date  DATE;
  should_check BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_date  := OLD.date;
    should_check := true;
  ELSIF TG_OP = 'INSERT' THEN
    target_date  := NEW.date;
    should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    target_date  := NEW.date;
    -- Date moves into a new period: always check, regardless of table.
    IF NEW.date IS DISTINCT FROM OLD.date THEN
      should_check := true;
    ELSIF TG_TABLE_NAME = 'transactions' THEN
      -- NEW.posted only exists on transactions. Nesting this IF inside
      -- the table-name guard keeps PL/pgSQL from trying to resolve the
      -- field on journal_entries (which has no `posted` column).
      IF NEW.posted IS DISTINCT FROM OLD.posted AND NEW.posted = true THEN
        should_check := true;
      END IF;
    END IF;
  END IF;

  IF NOT should_check THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  txn_period := to_char(target_date, 'YYYY-MM');
  SELECT status INTO close_status
    FROM public.period_close
   WHERE period = txn_period;

  IF close_status = 'closed' THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: % is closed. Reopen the period from the Accountant page before writing to it.', txn_period
      USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
