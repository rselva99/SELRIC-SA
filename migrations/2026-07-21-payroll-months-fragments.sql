-- Extend payroll_months to distinguish plug from fragments.
-- "Booked today" for a month is plug + fragments, NOT just plug.
-- January example: plug $37,957.97 + fragments $6,907.03 = $44,865.00 booked (matches the ledger).
--
-- Apply AFTER 2026-07-21-create-payroll-months.sql.

alter table public.payroll_months
  add column if not exists existing_fragment_amount numeric(14,2) not null default 0,
  add column if not exists existing_booked_total    numeric(14,2) not null default 0;

comment on column public.payroll_months.existing_fragment_amount is
  'Sum of Payroll-categorized ledger rows for the month that are NOT the plug JE (Venmo, CashApp, ATM, etc.). Signed as DR-CR net.';
comment on column public.payroll_months.existing_booked_total is
  'Plug + fragments — the true "booked today" figure. Variance against this, not against plug alone.';
