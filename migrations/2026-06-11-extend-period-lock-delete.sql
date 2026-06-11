-- 2026-06-11  Extend the period-lock trigger from 2026-06-11-period-lock-
-- trigger.sql to also guard DELETE on transactions and journal_entries.
-- Without this, deleting a transaction (or its parent JE) dated inside a
-- closed period would silently break the audit trail since the original
-- trigger only fired on INSERT / UPDATE.
--
-- This is the safety net for the "delete bank statement" recovery flow:
-- the app already pre-checks closed periods, but if anyone (script,
-- direct SQL edit, future code path) tries to DELETE a closed-period
-- row, the DB rejects it.
--
-- CREATE OR REPLACE on the function (with the extra DELETE branch),
-- DROP + recreate the triggers to add DELETE to the event list.
-- Idempotent.

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
    -- Same rules as before: date move OR posted-going-true on transactions.
    IF NEW.date IS DISTINCT FROM OLD.date THEN
      should_check := true;
    ELSIF TG_TABLE_NAME = 'transactions'
          AND NEW.posted IS DISTINCT FROM OLD.posted
          AND NEW.posted = true THEN
      should_check := true;
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

DROP TRIGGER IF EXISTS trg_period_lock_journal_entries ON public.journal_entries;
CREATE TRIGGER trg_period_lock_journal_entries
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_period_lock();

DROP TRIGGER IF EXISTS trg_period_lock_transactions ON public.transactions;
CREATE TRIGGER trg_period_lock_transactions
  BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_period_lock();
