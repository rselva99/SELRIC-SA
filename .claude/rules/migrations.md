---
paths:
  - "migrations/**"
---

# Migrations

Every SQL change against the live database is a file here, written **before** the code that
depends on it. Use the `migration` skill to write, dry-run and apply one.

## The file
- Name: `YYYY-MM-DD-short-description.sql` (UTC date of writing). One concern per file.
- Header comment: what changes, why, what it requires (earlier migrations), and that it is idempotent.
- Wrapped in `BEGIN; … COMMIT;`. Ends with a sanity `DO $$ … $$` block that `RAISE EXCEPTION`s
  if the result is not what the file promises (object missing, a grant that slipped through).
- Idempotent: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
  `DROP POLICY IF EXISTS` then `CREATE POLICY`, `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`,
  `ON CONFLICT DO NOTHING` for seed rows, `IS DISTINCT FROM` guards on updates.
- No DELETE or rewrite of existing user data unless the header says why, in a sentence the owner signed off.
- Statements that cannot run inside a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`) go in their own file
  without `BEGIN/COMMIT`, and the header says so.

## RLS patterns
- Tenant table: `org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, then
  ```sql
  ALTER TABLE public.t ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS org_isolation ON public.t;
  CREATE POLICY org_isolation ON public.t AS RESTRICTIVE FOR ALL TO authenticated
    USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.t TO authenticated; REVOKE ALL ON public.t FROM anon;
  ```
- Platform table (`platform_*`): policies `USING (public.is_platform_admin())` / `WITH CHECK (…)`;
  `REVOKE ALL … FROM anon, authenticated`, then grant only what the table needs (versioned tables: SELECT, INSERT).
- Role checks through SECURITY DEFINER functions with `SET search_path = public`; never a subquery on `profiles`
  inside a policy on `profiles`.
- Functions callable by the client: `GRANT EXECUTE … TO authenticated; REVOKE EXECUTE … FROM anon`.

## The index
One entry per file in `migrations/README.md`, appended in date order:
`` - `file.sql` — what it does in one or two lines. Idempotent. **Applied YYYY-MM-DD.** ``
(St. Louis date). Write "**Not yet applied.**" until it is.

## Never staged
`migrations/*fy2025*.sql`, `migrations/2026-09-*.sql`, `migrations/2026-07-22-book-bs-l20a-upstart-loan.sql`
— real bookkeeping corrections for a pilot. They are gitignored; never `git add -f` them.
