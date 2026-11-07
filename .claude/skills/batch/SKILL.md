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
4. If the change adds a page, a chart or a route, add it to `VIEWS` in `scripts/smoke.mjs`; if it adds
   engine behaviour, add a test under `tests/` (synthetic inputs only — real numbers stay in `~/selric-business`).
5. Run **`npm run check`** (build → EN/ES parity → unit tests → smoke at 1366 and 390 px). It must exit 0.
   Read its 20-line report; screenshots are in `.smoke/`. `verify_model.mjs` too when assumptions changed.
   A manual walk in the Browser pane only when the owner asks for one, or to show a new visual.
6. Report: what changed, the `npm run check` result, the DB versions now current, and the exact
   file list for Phase 3. Hold.

## Phase 3 — commit (on "sube")
Two separate Bash calls — the commit guard (`.claude/hooks/guard-commit.mjs`) runs *before* a command,
so it can only check what is already staged, and it refuses a command that stages and commits at once.
1. **Call 1 — stage and show.** Exactly the files listed in Phase 2's report, by name:
   `git reset -q && git add <file> <file> … && git diff --cached --stat` — never `-A`, `.`, a directory
   or `commit -a`. `git add -f` only for `docs/ARCHITECTURE.md`, `scripts/i18n_parity.mjs`, `scripts/smoke.mjs`, `scripts/checks.mjs`.
   Check the staged count equals the listed count.
2. **Call 2 — commit and push.** `git commit -q -F - <<'EOF' … EOF` then `git push -q origin main` and
   `git log -1 --format='%H %s'`. The guard blocks it if a staged path is on the never-stage list, a staged line
   looks like a key, or `npm run check` fails — read its message, fix, and go back to call 1.
3. Report the hash. If routes, tables, engines or flows changed and `docs/ARCHITECTURE.md` was not in
   the list, say so and offer a one-file follow-up commit.

## Allow-list
Committable: `src/**`, `api/**`, `public/**`, `migrations/<date>-*.sql` (not FY2025) and `migrations/README.md`,
`index.html`, `package.json`, `package-lock.json` (only when a dependency changed and the owner allowed it),
config files at the root, `tests/**`, `CLAUDE.md`, `.claude/rules/**`, `.claude/skills/**`, `.claude/hooks/**`,
`.claude/settings.json`, `.mcp.json`, `docs/ARCHITECTURE.md`, `scripts/i18n_parity.mjs`, `scripts/smoke.mjs`, `scripts/checks.mjs`.
Anything else: ask first.

## Commit message
```
<Area>: <what changed, as the owner would say it>

<2–6 lines: why, and what a reader of the diff would not see — the migration, the data versions,
what was verified. Plain language.>

<the attribution lines the harness provides at commit time>
```
Pass it with `git commit -F -` and a heredoc so the lines survive intact.
