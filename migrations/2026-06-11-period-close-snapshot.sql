-- 2026-06-11  Period close snapshot. When a period is closed we capture
-- the P&L and Balance Sheet aggregations as they were at that instant
-- into period_close.snapshot (JSONB). The UI then offers "View close
-- snapshot" on a closed period (read from this column) and "Reopen to
-- regenerate" as a separate action. Open periods always read live data.
--
-- snapshot_at records the moment the snapshot was captured, which is
-- shown as the "as of …" label. Reopening the period leaves the
-- snapshot in place (kept as historical record); the next close
-- overwrites it with a fresh capture.
--
-- Idempotent.

ALTER TABLE public.period_close
  ADD COLUMN IF NOT EXISTS snapshot    JSONB,
  ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ;

-- Optional: a small index for the rare case where we want to query
-- "which periods have a snapshot". Partial so it stays cheap.
CREATE INDEX IF NOT EXISTS idx_period_close_with_snapshot
  ON public.period_close (period)
  WHERE snapshot IS NOT NULL;
