-- Add returned-item columns to public.checks.
-- Loader script scripts/returned_items_load.mjs populates these from parsed bank statements.
-- No changes to status. Retroactive tagging only.

alter table public.checks
  add column if not exists returned_flag  boolean not null default false,
  add column if not exists returned_date  date null,
  add column if not exists returned_amount numeric(14,2) null,
  add column if not exists return_source  text null;

create index if not exists checks_returned_flag_idx on public.checks (returned_flag) where returned_flag = true;

comment on column public.checks.returned_flag  is 'TRUE if this check was returned per bank statement.';
comment on column public.checks.returned_date  is 'Date the bank posted the return credit.';
comment on column public.checks.returned_amount is 'Return credit amount (usually equals check amount).';
comment on column public.checks.return_source  is 'Source statement / batch reference for the return.';
