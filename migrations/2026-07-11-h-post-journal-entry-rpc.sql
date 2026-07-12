-- 2026-07-11 · Phase A / Half-entry hole
--
-- Every JE-posting path in the app used to run three separate INSERTs
-- (journal_entries, journal_entry_lines, transactions) with no transactional
-- wrapper. If the second or third one failed after the first succeeded, an
-- orphan / half-posted entry stayed in the DB. That is one root cause of the
-- 59 already-unbalanced JEs the audit found.
--
-- This RPC does all three inserts inside one Postgres transaction and refuses
-- to run if the JE lines don't balance (SUM(debit) = SUM(credit)). Either the
-- whole entry lands, or nothing does. It also rejects <2-line entries and
-- non-positive totals — the two other shapes historical unbalanced entries
-- took.
--
-- Reference allocation stays in the client (nextJournalReference /
-- insertJournalEntryWithRetry) so we keep the existing unique_violation
-- retry loop. The RPC just uses whatever `reference` the caller passes.
--
-- Design notes:
--   • plpgsql function bodies already run in an implicit transaction, so a
--     RAISE EXCEPTION or any INSERT error rolls back every write above it.
--     No BEGIN/COMMIT block needed.
--   • ERRCODE 'check_violation' (23514) matches how a real CHECK constraint
--     would fail, so client-side error inspection stays uniform when Phase B
--     later adds a table-level CHECK.
--   • SECURITY INVOKER so RLS on the underlying tables still applies to
--     whoever is calling.
--   • No DB-level CHECK constraint on journal_entry_lines is added here —
--     Phase A guards NEW entries only. The 59 historical unbalanced JEs
--     would fail such a constraint immediately. That is Phase B.

CREATE OR REPLACE FUNCTION public.post_journal_entry(
  p_entry jsonb,
  p_lines jsonb,
  p_txns  jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_reference text;
  v_dr numeric;
  v_cr numeric;
  v_line_count int;
BEGIN
  IF p_entry IS NULL OR jsonb_typeof(p_entry) <> 'object' THEN
    RAISE EXCEPTION 'post_journal_entry: p_entry must be a JSON object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'post_journal_entry: p_lines must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_txns IS NOT NULL AND jsonb_typeof(p_txns) <> 'array' THEN
    RAISE EXCEPTION 'post_journal_entry: p_txns must be a JSON array or omitted' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count < 2 THEN
    RAISE EXCEPTION 'post_journal_entry: entry must have at least 2 lines (got %)', v_line_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT
    COALESCE(SUM(COALESCE((l->>'debit_amount')::numeric,  0)), 0),
    COALESCE(SUM(COALESCE((l->>'credit_amount')::numeric, 0)), 0)
  INTO v_dr, v_cr
  FROM jsonb_array_elements(p_lines) l;

  IF ABS(v_dr - v_cr) > 0.005 THEN
    RAISE EXCEPTION 'post_journal_entry: unbalanced entry: debits % != credits % (diff %)', v_dr, v_cr, (v_dr - v_cr)
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_dr <= 0 THEN
    RAISE EXCEPTION 'post_journal_entry: entry total must be positive (got %)', v_dr
      USING ERRCODE = 'check_violation';
  END IF;

  -- 1) Header. Caller supplies the reference (allocation + collision retry
  --    stay in journalReference.js).
  INSERT INTO journal_entries (
    reference, date, description, memo, total_amount,
    status, entry_type, rule_id, created_by, posted_at
  )
  VALUES (
    NULLIF(p_entry->>'reference', ''),
    (p_entry->>'date')::date,
    p_entry->>'description',
    p_entry->>'memo',
    COALESCE((p_entry->>'total_amount')::numeric, v_dr),
    COALESCE(NULLIF(p_entry->>'status', ''),      'posted'),
    COALESCE(NULLIF(p_entry->>'entry_type', ''),  'simple'),
    NULLIF(p_entry->>'rule_id', '')::uuid,
    NULLIF(p_entry->>'created_by', '')::uuid,
    COALESCE(NULLIF(p_entry->>'posted_at', '')::timestamptz, now())
  )
  RETURNING id, reference INTO v_entry_id, v_reference;

  -- 2) Lines.
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, description, debit_amount, credit_amount, category
  )
  SELECT
    v_entry_id,
    NULLIF(l->>'account_id', '')::uuid,
    l->>'description',
    COALESCE((l->>'debit_amount')::numeric,  0),
    COALESCE((l->>'credit_amount')::numeric, 0),
    NULLIF(l->>'category', '')
  FROM jsonb_array_elements(p_lines) l;

  -- 3) Mirrored transactions. Optional — some callers only need JE + lines.
  --    journal_entry_id + reference are wired in from the header so the two
  --    tables stay linked even if the caller forgets.
  IF p_txns IS NOT NULL AND jsonb_array_length(p_txns) > 0 THEN
    INSERT INTO transactions (
      date, description, supplier, amount, type, category, account_id,
      reference, bank_statement_id, journal_entry_id, posted, voided
    )
    SELECT
      (t->>'date')::date,
      t->>'description',
      NULLIF(t->>'supplier', ''),
      (t->>'amount')::numeric,
      t->>'type',
      NULLIF(t->>'category', ''),
      NULLIF(t->>'account_id', '')::uuid,
      COALESCE(NULLIF(t->>'reference', ''), v_reference),
      NULLIF(t->>'bank_statement_id', '')::uuid,
      v_entry_id,
      COALESCE((t->>'posted')::boolean, true),
      COALESCE((t->>'voided')::boolean, false)
    FROM jsonb_array_elements(p_txns) t;
  END IF;

  RETURN jsonb_build_object(
    'entry_id',   v_entry_id,
    'reference',  v_reference,
    'line_count', v_line_count,
    'debits',     v_dr,
    'credits',    v_cr
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_journal_entry(jsonb, jsonb, jsonb) TO authenticated;
