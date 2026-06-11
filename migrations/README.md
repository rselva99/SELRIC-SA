# Migrations

Every SQL change against the live Supabase database is checked in here as
a numbered, dated file. Filename convention: `YYYY-MM-DD-short-description.sql`.

## Rules

- New migrations are written here BEFORE the dependent code lands.
- Every file is idempotent (`IF NOT EXISTS`, `OR REPLACE`, `IS DISTINCT FROM`)
  so re-running is safe.
- No migration ever deletes or rewrites existing user data without an
  explicit reason called out in a header comment.
- The PR / commit that introduces a migration also flags it loudly in the
  final report so the human knows to run it.

## How to apply

Open the Supabase SQL Editor for the project the deployed app points at and
paste the entire contents of the file. Each migration here is self-contained
and safe to re-run.

## Index

- `2026-06-11-add-voided-column.sql` — transactions.voided BOOLEAN, partial
  index, backfill from already-voided JEs. **Applied tonight.**
- `2026-06-11-period-lock-trigger.sql` — BEFORE INSERT/UPDATE trigger on
  journal_entries and transactions that rejects writes dated inside a
  closed period (status='closed' in period_close).
- `2026-06-11-period-close-snapshot.sql` — period_close.snapshot JSONB +
  period_close.snapshot_at, plus an UPDATE-on-reopen helper.
- `2026-06-11-extend-period-lock-delete.sql` — extends the period-lock
  trigger to also fire on DELETE so the bank-statement delete recovery
  path can't silently drop closed-period rows.
