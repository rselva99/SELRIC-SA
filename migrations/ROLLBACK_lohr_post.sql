-- ROLLBACK_lohr_post.sql
--
-- Reverses the batch of Lohr → Liquor journal entries posted on 2026-07-16
-- (batch tag: `LOHR-BATCH-2026-07-16`).
--
-- Guaranteed to touch ONLY the entries created by this batch. The batch
-- tag lives in `journal_entries.memo` AND `journal_entries.description`,
-- so this rollback finds them precisely.
--
-- What it does:
--   1. VOIDS every JE whose memo contains `LOHR-BATCH-2026-07-16`.
--   2. VOIDS every mirror `transactions` row linked to those JEs.
--   3. Resets each affected `checks` row back to `status='unclassified'`,
--      clears `account_id` and `classified_entry_id`, and restores the
--      `[LOHR]` prefix in `notes` so the row goes back into the LOHR
--      worklist. Prior-post notes ("Lohr Distributing") are cleared.
--
-- What it does NOT touch:
--   • Any JE that was not part of this batch.
--   • Any `checks` row that was not part of this batch.
--   • `book_bs_lines`, `book_bs_line_adjustments`, `cpa_sourced_locks`.
--
-- Idempotence: re-running is a no-op because voided JEs and voided
-- transactions match nothing on the second pass, and the affected
-- checks are already `unclassified`.
--
-- Safe to run at any time.

BEGIN;

-- 1. Void the 61 (or fewer) LOHR-BATCH journal entries.
UPDATE public.journal_entries
   SET status = 'voided'
 WHERE source_tag = 'checks'
   AND memo ILIKE '%LOHR-BATCH-2026-07-16%'
   AND status = 'posted';

-- 2. Void the mirror transactions.
UPDATE public.transactions
   SET voided = true
 WHERE voided = false
   AND journal_entry_id IN (
     SELECT id FROM public.journal_entries
      WHERE source_tag = 'checks'
        AND memo ILIKE '%LOHR-BATCH-2026-07-16%'
   );

-- 3. Reset the 61 (or fewer) LOHR checks back to unclassified.
--    Restore the [LOHR] prefix in notes so they show up in the tag chip again.
UPDATE public.checks
   SET status               = 'unclassified',
       account_id           = NULL,
       classified_entry_id  = NULL,
       notes                = CASE
                                WHEN notes IS NULL OR notes = ''
                                  THEN '[LOHR]'
                                WHEN notes ILIKE '[LOHR]%'
                                  THEN notes
                                ELSE '[LOHR] ' || notes
                              END
 WHERE classified_entry_id IN (
   SELECT id FROM public.journal_entries
    WHERE source_tag = 'checks'
      AND memo ILIKE '%LOHR-BATCH-2026-07-16%'
 );

DO $$
DECLARE
  v_jes INTEGER;
  v_txs INTEGER;
  v_chks INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_jes  FROM public.journal_entries WHERE source_tag='checks' AND memo ILIKE '%LOHR-BATCH-2026-07-16%';
  SELECT COUNT(*) INTO v_txs  FROM public.transactions    WHERE journal_entry_id IN (SELECT id FROM public.journal_entries WHERE source_tag='checks' AND memo ILIKE '%LOHR-BATCH-2026-07-16%');
  SELECT COUNT(*) INTO v_chks FROM public.checks          WHERE status='unclassified' AND notes ILIKE '[LOHR]%';
  RAISE NOTICE 'LOHR-BATCH rollback complete: JEs=% (all voided), transactions=% (all voided), unclassified LOHR checks=%',
    v_jes, v_txs, v_chks;
END $$;

COMMIT;
