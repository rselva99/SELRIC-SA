---
name: batch
description: The three-phase protocol for any SelRic change — Phase 1 plan (read-only, stop), Phase 2 build and verify on "go", Phase 3 stage the listed files, commit and push on "sube". Use at the start of every new batch, when the owner says "go", "aplicada" or "sube", or when deciding what may be staged in this public repo.
---

# Batch protocol

Three phases, each ended by the owner's word. Never skip ahead; never treat "ok" or "looks good" as "go" or "sube".

## Phase 1 — plan (read-only)
1. Read `docs/ARCHITECTURE.md`, then only the source files the task touches.
2. Write nothing. No migration files, no seeds, no edits.
3. Report:
   - the **file list** — every file to create or modify, one-line purpose each; outside-repo files marked as such
   - the migration (if any) as a summary; it is printed in full in Phase 2
   - decisions the owner must make, each with a recommended default
   - anything in the request that conflicts with the standing rules in `CLAUDE.md`, said plainly
4. Stop.

## Phase 2 — build and verify (on "go")
1. Migration first, if any: the `migration` skill (write → dry-run → show → wait for **"aplicada"** → apply → README line).
2. Code. Match the surrounding files. Keep engines constant-free.
3. Seed or publish data, if any: the `seed` skill (runs outside the repo).
4. Checks — all must pass before the report:
   - `npm run build`
   - `node scripts/i18n_parity.mjs` → `parity`
   - `verify_model.mjs` → 0 differences, when the engine or assumptions changed
5. Walk the affected pages in the Browser pane: desktop and 390 px, EN and ES. Read numbers from the
   DOM; one screenshot per view. If an edit is part of the test (a version saved), restore it after and say so.
6. Report: what changed, what was verified and how, the DB versions now current, and the exact
   file list for Phase 3. Hold.

## Phase 3 — commit (on "sube")
1. Stage exactly the files listed in Phase 2's report, by name:
   `git reset -q && git add <file> <file> …` — never `-A`, `.`, or a directory.
   `git add -f` only for `docs/ARCHITECTURE.md` and `scripts/i18n_parity.mjs`.
2. Guard before committing — abort if any fails:
   - the staged count equals the listed count
   - nothing staged matches the never-stage list (`.env*`, `reports/`, `.claude/settings.local.json`,
     `.claude/launch.json`, `migrations/*fy2025*`, `migrations/2026-09-*`, `data/`, `.local/`, `~/selric-business` content)
3. Show `git diff --cached --stat`.
4. Commit with the format below, push `origin main`, report the hash (`git log -1 --format='%H %s'`).
5. If routes, tables, engines or flows changed and `docs/ARCHITECTURE.md` was not in the list,
   say so and offer a one-file follow-up commit.

## Allow-list
Committable: `src/**`, `api/**`, `public/**`, `migrations/<date>-*.sql` (not FY2025) and `migrations/README.md`,
`index.html`, `package.json`, `package-lock.json` (only when a dependency changed and the owner allowed it),
config files at the root, `CLAUDE.md`, `.claude/rules/**`, `.claude/skills/**`, `.mcp.json`,
`docs/ARCHITECTURE.md`, `scripts/i18n_parity.mjs`. Anything else: ask first.

## Commit message
```
<Area>: <what changed, as the owner would say it>

<2–6 lines: why, and what a reader of the diff would not see — the migration, the data versions,
what was verified. Plain language.>

<the attribution lines the harness provides at commit time>
```
Pass it with `git commit -F -` and a heredoc so the lines survive intact.
