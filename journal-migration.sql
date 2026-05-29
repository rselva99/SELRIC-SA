-- ============================================================================
-- Journal feature migration
-- Run this in the Supabase SQL editor.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. journal_entries ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference    TEXT NOT NULL UNIQUE,                -- e.g. 'JE-001'
  date         DATE NOT NULL,
  description  TEXT,
  memo         TEXT,
  total_amount NUMERIC(12,2) DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','posted','voided')),
  entry_type   TEXT NOT NULL DEFAULT 'simple'
                 CHECK (entry_type IN ('simple','double','auto')),
  rule_id      UUID,                                -- FK added after rules table
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  posted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date   ON public.journal_entries (date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON public.journal_entries (status);

-- ── 2. journal_entry_lines ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id   UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id         UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  description        TEXT,
  debit_amount       NUMERIC(12,2) DEFAULT 0,
  credit_amount      NUMERIC(12,2) DEFAULT 0,
  category           TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON public.journal_entry_lines (journal_entry_id);

-- ── 3. journal_rules ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  rule_type      TEXT NOT NULL CHECK (rule_type IN ('net_to_zero','fixed_amount')),
  match_keyword  TEXT,
  match_category TEXT,
  fixed_amount   NUMERIC(12,2) DEFAULT 0,
  fixed_type     TEXT DEFAULT 'debit' CHECK (fixed_type IN ('debit','credit')),
  account_id     UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  category       TEXT,
  frequency      TEXT DEFAULT 'monthly',
  active         BOOLEAN DEFAULT true,
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Now wire the FK from entries → rules (deferred until rules table exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_rule_id_fkey'
  ) THEN
    ALTER TABLE public.journal_entries
      ADD CONSTRAINT journal_entries_rule_id_fkey
      FOREIGN KEY (rule_id) REFERENCES public.journal_rules(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 4. Link transactions to journal entries ─────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID
    REFERENCES public.journal_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_journal_entry
  ON public.transactions (journal_entry_id);

-- ── 5. RLS — using public.is_admin() pattern already in use ──────────────────
ALTER TABLE public.journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_rules        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage journal_entries"     ON public.journal_entries;
DROP POLICY IF EXISTS "Admins manage journal_entry_lines" ON public.journal_entry_lines;
DROP POLICY IF EXISTS "Admins manage journal_rules"       ON public.journal_rules;

CREATE POLICY "Admins manage journal_entries"
  ON public.journal_entries FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins manage journal_entry_lines"
  ON public.journal_entry_lines FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins manage journal_rules"
  ON public.journal_rules FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── 6. Sanity check (optional) ───────────────────────────────────────────────
-- SELECT COUNT(*) FROM public.journal_entries;
-- SELECT COUNT(*) FROM public.journal_rules;
