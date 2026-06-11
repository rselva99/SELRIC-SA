-- 2026-06-11  Enforce period locking at the database. Rejects inserts and
-- the writes that "post" a row when its date falls inside a period whose
-- period_close.status is 'closed'.
--
-- The trigger DOES block:
--   • Any INSERT of a journal_entries row dated in a closed period.
--   • Any INSERT of a transactions row dated in a closed period.
--   • Any UPDATE that moves an existing row's date INTO a closed period.
--   • A transactions UPDATE that flips posted from false → true while the
--     row is dated in a closed period.
-- The trigger DOES NOT block:
--   • Voiding a JE in a closed period (status='posted' → 'voided').
--   • Setting transactions.voided=true to propagate a void.
--   • Recategorizing or reconciling a closed-period row.
--   • Unposting (posted=true → false), which a closing accountant may need
--     to do as a cleanup step before reopening.
--
-- On block the trigger raises SQLSTATE 'P0001' with a message that begins
-- with 'PERIOD_LOCKED:' so src/lib/periodLock.js can detect it and surface
-- the reopen prompt.
--
-- Idempotent: CREATE OR REPLACE on the function, DROP IF EXISTS + CREATE
-- on each trigger.

-- ── Function ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_period_lock()
RETURNS TRIGGER AS $$
DECLARE
  txn_period   TEXT;
  close_status TEXT;
  should_check BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only enforce when date moves, or when a transactions row is being
    -- posted (flipped to posted=true). Other updates pass through so
    -- voiding, recategorizing, and reconciling closed-period rows work.
    IF NEW.date IS DISTINCT FROM OLD.date THEN
      should_check := true;
    ELSIF TG_TABLE_NAME = 'transactions'
          AND NEW.posted IS DISTINCT FROM OLD.posted
          AND NEW.posted = true THEN
      should_check := true;
    END IF;
  END IF;

  IF NOT should_check THEN
    RETURN NEW;
  END IF;

  txn_period := to_char(NEW.date, 'YYYY-MM');
  SELECT status INTO close_status
    FROM public.period_close
   WHERE period = txn_period;

  IF close_status = 'closed' THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: % is closed. Reopen the period from the Accountant page before writing to it.', txn_period
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Trigger: journal_entries ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_period_lock_journal_entries ON public.journal_entries;
CREATE TRIGGER trg_period_lock_journal_entries
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_period_lock();

-- ── Trigger: transactions ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_period_lock_transactions ON public.transactions;
CREATE TRIGGER trg_period_lock_transactions
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_period_lock();
