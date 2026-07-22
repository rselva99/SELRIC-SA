-- Create payroll_lines table for the Payroll tab.
-- Individual paycheck rows from the 2024 register (983 rows), bridged to checks/transactions.
-- RLS via public.is_admin(). Read-mostly; writes only from admin UI or service-role scripts.

create extension if not exists "pgcrypto";

create table if not exists public.payroll_lines (
  id                       uuid primary key default gen_random_uuid(),
  pay_date                 date not null,
  period_start             date,
  period_end               date,
  employee_name            text not null,
  is_starred               boolean not null default false,
  pay_month                text not null,                 -- 'YYYY-MM'
  gross_pay                numeric(14,2) not null default 0,
  employee_taxes           numeric(14,2) not null default 0,
  net_pay                  numeric(14,2) not null default 0,
  employer_taxes           numeric(14,2),                 -- allocated pro-rata from annual total; NULL = not yet allocated
  er_tax_is_estimate       boolean not null default true,

  match_status             text not null default 'unmatched',
    -- allowed values: 'unmatched' | 'matched_check' | 'matched_txn' | 'no_disbursement'
  matched_check_id         uuid references public.checks(id) on delete set null,
  matched_transaction_id   uuid references public.transactions(id) on delete set null,
  match_confidence         text,                          -- 'exact' | 'near' | 'name' | 'manual'
  match_day_delta          int,
  notes                    text,

  source_tag               text not null default 'payroll-register-2024',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint payroll_lines_match_status_ck
    check (match_status in ('unmatched','matched_check','matched_txn','no_disbursement')),
  constraint payroll_lines_match_confidence_ck
    check (match_confidence is null or match_confidence in ('exact','near','name','manual')),
  constraint payroll_lines_single_match_ck
    check (not (matched_check_id is not null and matched_transaction_id is not null))
);

-- Idempotency key for re-runs: pay_date + employee_name + net_pay + period.
--
-- Choice: COALESCE expression index (Option A), not NOT-NULL sentinel defaults.
-- Why: period_start / period_end are genuinely nullable in the abstract data model
-- (not every payment ties to a pay period — bonuses, corrections, etc.). A COALESCE
-- expression index handles both cases without lying in the schema. Postgres treats
-- COALESCE(period_start, pay_date) as a non-null expression, so NULLs no longer
-- compare "not equal" the way they do in a plain multi-column unique index.
--
-- Load-time verified with the current CSV: 983 rows, 983 distinct keys, 0 collisions
-- (including the six 2024-06-26 Harris back-pay checks where only period distinguishes
--  three $2,478.42s and three $2,478.43s spanning six pay periods).
create unique index if not exists payroll_lines_dedup_ux
  on public.payroll_lines (
    pay_date,
    employee_name,
    net_pay,
    (coalesce(period_start, pay_date)),
    (coalesce(period_end,   pay_date))
  );

create index if not exists payroll_lines_pay_month_idx  on public.payroll_lines (pay_month);
create index if not exists payroll_lines_net_pay_idx    on public.payroll_lines (net_pay);
create index if not exists payroll_lines_match_status_idx on public.payroll_lines (match_status);
create index if not exists payroll_lines_matched_check_idx on public.payroll_lines (matched_check_id) where matched_check_id is not null;
create index if not exists payroll_lines_matched_txn_idx   on public.payroll_lines (matched_transaction_id) where matched_transaction_id is not null;

-- updated_at trigger
create or replace function public.payroll_lines_touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists payroll_lines_touch_updated_at_tr on public.payroll_lines;
create trigger payroll_lines_touch_updated_at_tr
  before update on public.payroll_lines
  for each row execute function public.payroll_lines_touch_updated_at();

-- RLS
alter table public.payroll_lines enable row level security;

drop policy if exists payroll_lines_admin_all on public.payroll_lines;
create policy payroll_lines_admin_all on public.payroll_lines
  for all
  using ( public.is_admin() )
  with check ( public.is_admin() );

comment on table public.payroll_lines is 'Individual paycheck rows from the 2024 payroll register, bridged to checks/transactions.';
comment on column public.payroll_lines.employer_taxes is 'Allocated pro-rata on gross_pay from the $73,924.64 annual total (estimate).';
comment on column public.payroll_lines.match_status is 'unmatched | matched_check | matched_txn | no_disbursement';
