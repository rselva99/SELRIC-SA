---
name: seed
description: Seed or republish SelRic's confidential model data — platform_assumptions, platform_documents and the frozen files in the platform-docs bucket — through ~/selric-business/publish.mjs, and verify it with verify_model.mjs. Use when a batch adds a document, a dataset or new assumption fields, when the owner asks to republish or rebuild the frozen .docx/.xlsx, or to check that a stored version reproduces the model.
---

# Seed (outside the repository)

The plan's numbers, prose and datasets live in `~/selric-business/` (not a git repo) and in the database.
**Nothing from that folder is ever copied into `src/`, a commit, a comment or the chat beyond what the owner asks to see.**

## Layout of `~/selric-business/`
- `model.mjs` — the assumptions object `A` only; re-exports the engine from the repo's `src/lib/ceoModel.js`
- `docs/*.md` (business_plan, market_gtm, findings, competition) — prose with `{{tokens}}`; `docs/plan.json`; `docs/competitors.json`
- `publish.mjs` — seeds v1 of each table/doc **only when absent**, then uploads the frozen files
- `verify_model.mjs` — runs a stored assumptions version through the engine and compares it to `outputs.json`
- `build_docx.mjs`, `build_xlsx.mjs` — rebuild the frozen files with the same exporters the app uses
- `outputs.json`, `research.json` — the 24 Oct 2026 reference run; do not regenerate them casually

## Run (credentials from the repo's `.env`, never printed)
```bash
cd ~/selric-business && env $(grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' ~/SELRIC-SA/.env | xargs) node publish.mjs 2>&1 | sed -E 's/(eyJ|sb_)[A-Za-z0-9._-]+/<redacted>/g'
```
Same prefix for `node verify_model.mjs --version <n>` (or `--local` for the seed in `model.mjs`).
Rebuild the frozen files with `node build_docx.mjs && node build_xlsx.mjs` before `publish.mjs` uploads them.

## Adding a new document or dataset
1. The doc name is in the `platform_documents.doc` CHECK — if not, a migration first (`migration` skill).
2. Write `docs/<name>.md` (sections `## Title {#key}`, sub-sections `### Title {#key}`) and, if any, the json.
3. Add it to `sources` in `publish.mjs` (a json dataset rides as `{ key: 'dataset', kind: 'json', data }`).
4. Check every token resolves before seeding: parse the sections and `resolve()` each against `compute(A)`;
   `⟨path⟩` in the output means a missing path.
5. Run `publish.mjs`; it prints `✓ platform_documents/<name> v1`. Existing docs are left alone.

## After a seed
- `verify_model.mjs --version <current>` must report **0 differences** after any engine or assumption change.
- Seeds never overwrite: a correction to a seeded document is a new version saved in the app
  (or an INSERT with a note), not an UPDATE.
- Report which versions are now current (assumptions vN, each document vN).
