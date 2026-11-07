-- ════════════════════════════════════════════════════════════════════════════
-- INTEGRITY CHECKS — the catalog of checks and the results of each run
--
-- The checks engine (src/lib/checks/) runs pure functions over one workspace's
-- rows and returns, per check, a status (green, amber, red), an amount, a
-- count and the offending rows. This file adds the two tables it needs:
--
--   integrity_checks   the catalog: one row per check, its program, its name
--                      and its "what to do" line in English and Spanish, and
--                      the status a failing run gets (amber or red). Readable
--                      by every signed-in user; written only by migrations.
--   integrity_results  one row per check per run, per workspace. Tenant RLS
--                      like every other workspace table: a member reads and
--                      inserts only their own workspace's rows. The CLI
--                      (npm run checks) writes with the service role and sets
--                      org_id itself. Rows are never updated: a new run is a
--                      new row, and the page reads the newest per check.
--
-- The catalog is seeded with the fifteen Business checks and the four
-- Ganadería checks. Names and actions match src/i18n/translations.js
-- (checks.items.<key>); tests/checks.test.js compares the two.
--
-- Requires 2026-10-18-organizations-multi-business.sql (current_org_id,
-- set_org_id). Idempotent: CREATE TABLE IF NOT EXISTS, DROP/CREATE POLICY,
-- ON CONFLICT DO UPDATE for the catalog rows.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The catalog ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integrity_checks (
  key        text PRIMARY KEY,
  program    text NOT NULL CHECK (program IN ('business', 'ganaderia')),
  name_en    text NOT NULL,
  name_es    text NOT NULL,
  severity   text NOT NULL CHECK (severity IN ('amber', 'red')),
  action_en  text NOT NULL,
  action_es  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integrity_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integrity_checks_read ON public.integrity_checks;
CREATE POLICY integrity_checks_read ON public.integrity_checks
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.integrity_checks FROM anon, authenticated;
GRANT SELECT ON public.integrity_checks TO authenticated;

INSERT INTO public.integrity_checks (key, program, severity, name_en, name_es, action_en, action_es) VALUES
  ('tb_balanced', 'business', 'red',
   'Debits equal credits in every month',
   'Débitos y créditos cuadran cada mes',
   'Open the months listed and fix or reverse the entries whose lines do not balance.',
   'Abre los meses de la lista y corrige o revierte los asientos cuyas líneas no cuadran.'),
  ('cash_leg_single', 'business', 'red',
   'Every bank expense has exactly one cash leg',
   'Cada gasto del banco tiene una sola contrapartida de caja',
   'Re-save the rows listed in Bookkeeping so the cash leg is rebuilt; delete any extra copy.',
   'Vuelve a guardar las filas de la lista en Contabilidad para rehacer la contrapartida; borra cualquier copia de más.'),
  ('orphan_lines', 'business', 'red',
   'No journal lines without an entry, no entries without lines',
   'Ninguna línea sin asiento ni asiento sin líneas',
   'Delete the empty entries and the stray lines, or re-post the entry they belonged to.',
   'Borra los asientos vacíos y las líneas sueltas, o vuelve a registrar el asiento al que pertenecían.'),
  ('statement_ties', 'business', 'red',
   'Each imported statement ties to its printed ending balance',
   'Cada estado de cuenta importado cuadra con su saldo final impreso',
   'Compare the statement listed with the PDF: a row is missing, doubled or has the wrong amount.',
   'Compara el estado de cuenta de la lista con el PDF: falta una fila, está doble o tiene otro monto.'),
  ('check_no_payee', 'business', 'amber',
   'Every cleared check has a payee',
   'Cada cheque cobrado tiene beneficiario',
   'Write the payee on each check listed, from the check image or the checkbook.',
   'Escribe el beneficiario en cada cheque de la lista, con la imagen del cheque o la chequera.'),
  ('returned_unpaired', 'business', 'amber',
   'Every returned item is paired with the deposit it reverses',
   'Cada partida devuelta está emparejada con el depósito que revierte',
   'Find the original deposit for each returned item and record how it was settled.',
   'Busca el depósito original de cada partida devuelta y registra cómo se resolvió.'),
  ('merchant_clearing', 'business', 'red',
   'Merchant clearing is within 2% of card sales',
   'La cuenta puente de tarjetas está dentro del 2% de las ventas con tarjeta',
   'Book the processor fees and match the card deposits for the months listed.',
   'Registra las comisiones del procesador y empareja los depósitos de tarjeta de los meses de la lista.'),
  ('sales_tax', 'business', 'amber',
   'Sales tax collected is being remitted',
   'El impuesto sobre ventas cobrado se está pagando',
   'Check the sales tax filings for the months listed; book any payment that is missing.',
   'Revisa las declaraciones de impuesto de los meses de la lista; registra cualquier pago que falte.'),
  ('tips', 'business', 'amber',
   'Card tips collected are paid out',
   'Las propinas cobradas con tarjeta se pagan',
   'Match the tips listed to payroll; book the payout or correct the tips recorded.',
   'Empareja las propinas de la lista con la planilla; registra el pago o corrige las propinas anotadas.'),
  ('payroll_cleared', 'business', 'amber',
   'Every paycheck on the payroll register has cleared',
   'Cada cheque de la planilla se cobró',
   'Match each paycheck listed to its cleared check or transfer, or note why it is still out.',
   'Empareja cada pago de la lista con su cheque o transferencia, o anota por qué sigue pendiente.'),
  ('accrued_no_cash', 'business', 'amber',
   'No bill accrued more than 90 days ago is still unpaid',
   'Ninguna cuenta registrada hace más de 90 días sigue sin pagar',
   'Pay or reverse each bill listed; if it was paid, link the payment to it.',
   'Paga o revierte cada cuenta de la lista; si ya se pagó, vincula el pago.'),
  ('duplicate_candidates', 'business', 'amber',
   'No likely duplicates from two different sources',
   'Sin posibles duplicados de dos fuentes distintas',
   'Look at each pair listed; void the copy if both rows are the same payment.',
   'Mira cada par de la lista; anula la copia si las dos filas son el mismo pago.'),
  ('closed_period_entries', 'business', 'red',
   'Nothing was entered inside a closed month',
   'No se registró nada dentro de un mes cerrado',
   'Move each entry listed to an open month, or reopen the month on purpose and close it again.',
   'Pasa cada asiento de la lista a un mes abierto, o reabre el mes a propósito y vuelve a cerrarlo.'),
  ('unknown_deposits', 'business', 'amber',
   'Every deposit has a source',
   'Cada depósito tiene origen',
   'Categorize each deposit listed: sales, a loan, the owner, a refund.',
   'Clasifica cada depósito de la lista: ventas, préstamo, dueño, reembolso.'),
  ('loan_vs_lender', 'business', 'red',
   'Loan balances match the lender statements on file',
   'Los saldos de préstamos coinciden con los estados del prestamista',
   'Book the interest, fees or payments that explain the difference for each loan listed.',
   'Registra los intereses, cargos o pagos que explican la diferencia de cada préstamo de la lista.'),
  ('herd_no_category', 'ganaderia', 'amber',
   'Every animal has a category',
   'Cada animal tiene categoría',
   'Open each animal listed and choose its category.',
   'Abre cada animal de la lista y elige su categoría.'),
  ('herd_orphan_events', 'ganaderia', 'red',
   'Every event belongs to an animal',
   'Cada evento pertenece a un animal',
   'Delete the events listed or attach them to the right animal.',
   'Borra los eventos de la lista o asígnalos al animal correcto.'),
  ('herd_pregnant_no_palpacion', 'ganaderia', 'amber',
   'Every cow marked pregnant has a palpation',
   'Cada vaca marcada preñada tiene palpación',
   'Record the palpation for each cow listed, or clear the pregnant mark.',
   'Registra la palpación de cada vaca de la lista, o quita la marca de preñada.'),
  ('herd_dam_unresolved', 'ganaderia', 'amber',
   'Every mother named on a card is in the herd',
   'Cada madre anotada en una ficha está en el hato',
   'Link each animal listed to its mother''s card, or add the mother.',
   'Vincula cada animal de la lista con la ficha de su madre, o agrega la madre.')
ON CONFLICT (key) DO UPDATE SET
  program = EXCLUDED.program, severity = EXCLUDED.severity,
  name_en = EXCLUDED.name_en, name_es = EXCLUDED.name_es,
  action_en = EXCLUDED.action_en, action_es = EXCLUDED.action_es;

-- ─── 2. The results ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integrity_results (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  check_key  text NOT NULL REFERENCES public.integrity_checks(key) ON DELETE CASCADE,
  period     text NOT NULL DEFAULT 'all' CHECK (period = 'all' OR period ~ '^\d{4}-\d{2}$'),
  status     text NOT NULL CHECK (status IN ('green', 'amber', 'red')),
  amount     numeric NOT NULL DEFAULT 0,
  count      integer NOT NULL DEFAULT 0,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integrity_results_org_run_idx ON public.integrity_results (org_id, run_at DESC);
CREATE INDEX IF NOT EXISTS integrity_results_org_check_idx ON public.integrity_results (org_id, check_key, run_at DESC);

DROP TRIGGER IF EXISTS aa_set_org_id ON public.integrity_results;
CREATE TRIGGER aa_set_org_id BEFORE INSERT ON public.integrity_results
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

ALTER TABLE public.integrity_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read and add integrity_results" ON public.integrity_results;
CREATE POLICY "Members can read and add integrity_results" ON public.integrity_results
  AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS org_isolation ON public.integrity_results;
CREATE POLICY org_isolation ON public.integrity_results AS RESTRICTIVE FOR ALL TO authenticated
  USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
REVOKE ALL ON public.integrity_results FROM anon, authenticated;
GRANT SELECT, INSERT ON public.integrity_results TO authenticated;

-- ─── Sanity ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_business int;
  n_herd     int;
BEGIN
  SELECT count(*) FILTER (WHERE program = 'business'), count(*) FILTER (WHERE program = 'ganaderia')
    INTO n_business, n_herd FROM public.integrity_checks;
  IF n_business <> 15 OR n_herd <> 4 THEN
    RAISE EXCEPTION 'integrity_checks: expected 15 business and 4 ganaderia checks, got % and %', n_business, n_herd;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'integrity_results'
                  AND policyname = 'org_isolation' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'integrity_results: org_isolation is missing or not restrictive';
  END IF;
  IF has_table_privilege('anon', 'public.integrity_results', 'SELECT')
     OR has_table_privilege('anon', 'public.integrity_checks', 'SELECT') THEN
    RAISE EXCEPTION 'anon can read the integrity tables';
  END IF;
  IF has_table_privilege('authenticated', 'public.integrity_results', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.integrity_checks', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated can update results or write the catalog';
  END IF;
  RAISE NOTICE 'integrity checks: % business + % ganaderia in the catalog; results table with tenant RLS', n_business, n_herd;
END $$;

COMMIT;
