---
name: migration
description: Write, dry-run and apply a Supabase SQL migration for SelRic — the idempotent file in migrations/, a rolled-back dry run on production through the Supabase MCP, apply_migration only after the owner says "aplicada", and the README index line. Use whenever a change needs a new table, column, policy, function, constraint, bucket or seed row.
---

# Migration

Rules for the file itself are in `.claude/rules/migrations.md`; the template is `template.sql` next to this file.

## 1. Write
- `migrations/YYYY-MM-DD-short-description.sql` from `template.sql`: header, `BEGIN;`, idempotent body,
  sanity `DO` block, `COMMIT;`.
- Print the whole file in the chat in a ```sql block, so the owner can read it before anything runs.

## 2. Dry run on production (Supabase MCP `execute_sql`)
Run the file's body inside a transaction that always raises at the end, so nothing is kept:
```sql
BEGIN;
-- … the migration body, without its own BEGIN; / COMMIT; …
DO $$ BEGIN RAISE EXCEPTION 'DRY RUN reached the end — rolling back'; END $$;
ROLLBACK;
```
- **Success** = the call errors with exactly `DRY RUN reached the end — rolling back`, and any
  `RAISE NOTICE` from the sanity block appears before it.
- **Failure** = any other error: that statement is the problem. Fix the file and dry-run again.
- Then prove nothing persisted with one read query (the new table/column/policy is absent, a count unchanged).
- Show the owner both results verbatim. Stop and wait for **"aplicada"**.
- A file that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`) cannot be dry-run this way:
  say so and ask before applying.

## 3. Apply (only on "aplicada")
- MCP `apply_migration` with `name` = the file stem with `-` → `_` (e.g. `2026_10_25_platform_competition`)
  and `query` = the file exactly as committed. This also records it in the migration history.
- Verify with one read query that the result is there (the sanity block already raised if not).
- Run MCP `get_advisors` (security) once and report anything new it flags about the objects just created.

## 4. Index
Append to `migrations/README.md`, in date order:
`` - `<file>.sql` — <what, in one or two lines>. Idempotent. **Applied <St. Louis date>.** ``

## Branches
Do not create a branch unless `list_migrations` shows history **and** the owner has said branching is on.
(Earlier migrations went in through the SQL Editor and are not in the history, so a branch would start
empty; branching is also a paid feature that asks for a cost confirmation.)

## Never
- `execute_sql` that writes outside a rolled-back dry run.
- Apply before "aplicada", or apply a different text than the file.
- Stage the FY2025 files.
