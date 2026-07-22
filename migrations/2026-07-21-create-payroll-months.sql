-- Create payroll_months table for the Payroll tab.
-- One row per 2024 pay month (12 rows), rolled up from payroll_lines.
-- Tracks the existing Payroll plug JE so the UI can flag double-count risk.
-- Draft status only in this build — no posting logic yet.

create extension if not exists "pgcrypto";

create table if not exists public.payroll_months (
  id                      uuid primary key default gen_random_uuid(),
  pay_month               text unique not null,           -- 'YYYY-MM'
  line_count              int not null default 0,

  total_gross             numeric(14,2) not null default 0,
  total_ee_tax            numeric(14,2) not null default 0,
  total_net               numeric(14,2) not null default 0,
  total_er_tax            numeric(14,2) not null default 0,
  total_loaded            numeric(14,2) not null default 0, -- gross + er_tax

  matched_to_check_net    numeric(14,2) not null default 0,
  matched_to_txn_net      numeric(14,2) not null default 0,
  unmatched_net           numeric(14,2) not null default 0,

  existing_plug_je_id     uuid references public.journal_entries(id) on delete set null,
  existing_plug_amount    numeric(14,2) not null default 0,

  journal_entry_id        uuid references public.journal_entries(id) on delete set null, -- future replacement JE; null in this build
  status                  text not null default 'draft',   -- 'draft' | 'posted' | 'superseded'

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint payroll_months_status_ck check (status in ('draft','posted','superseded'))
);

create or replace function public.payroll_months_touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists payroll_months_touch_updated_at_tr on public.payroll_months;
create trigger payroll_months_touch_updated_at_tr
  before update on public.payroll_months
  for each row execute function public.payroll_months_touch_updated_at();

alter table public.payroll_months enable row level security;
drop policy if exists payroll_months_admin_all on public.payroll_months;
create policy payroll_months_admin_all on public.payroll_months
  for all
  using ( public.is_admin() )
  with check ( public.is_admin() );

comment on table public.payroll_months is 'Monthly rollup for the Payroll tab: 12 rows per year, bridged to existing plug JEs. This build does NOT create replacement JEs.';
comment on column public.payroll_months.existing_plug_je_id is 'The existing plug JE for the month (JE-033 etc). Any future posting must reverse this first to prevent double-count.';
