-- 2026-06-11  Add voided flag to transactions so voiding a JE actually
-- removes its mirrored rows from every ledger / P&L / Balance Sheet /
-- Dashboard / Wizard query. The flag stays in sync with
-- journal_entries.status: tonight's code update propagates voided=true
-- onto every linked transaction when the JE is voided.
--
-- Applied to the live database on 2026-06-11. Idempotent — safe to re-run.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS voided BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_transactions_voided
  ON public.transactions (voided) WHERE voided = true;

UPDATE public.transactions t
   SET voided = true
  FROM public.journal_entries j
 WHERE t.journal_entry_id = j.id
   AND j.status = 'voided'
   AND t.voided IS DISTINCT FROM true;
