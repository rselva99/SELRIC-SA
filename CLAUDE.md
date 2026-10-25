# SelRic — working rules for Claude

SelRic is one account with a program for each thing a person runs: **SelRic Business**
(books, sales, inventory, payroll) and **Batavia Ganadería** (a herd). Multi-tenant: every
customer is a workspace (`organizations`). SelRic itself runs an internal workspace whose
shell is `/ceo` — the company's oversight, model and documents.

**Read `docs/ARCHITECTURE.md` first.** It is the map — tables, routes, engines, flows.
Read it instead of walking the tree; open a source file only when the task touches it.

## Stack

- React 18 + Vite 5 + React Router 6, Tailwind (tokens `brand`, `surface`, `ranch`, `clay`), lucide-react, recharts, react-hot-toast
- Supabase: Postgres with RLS, Auth, Storage (private buckets, signed URLs), RPCs
- Vercel: static build + serverless functions in `api/` (Anthropic calls stay server-side; the key is never `VITE_`)
- `docx` and `exceljs` are loaded lazily, only on `/ceo`
- Node scripts are `.mjs`; there is no test runner yet

## Directories

| Path | What |
|---|---|
| `src/main.jsx` | routes and gates (`RootGate`, `AppEntry`, `ProtectedRoute`, `GanaderiaRoot`) |
| `src/contexts/` | `AuthContext` (user, organization, programs, roles, `isPlatformAdmin`, `isInternal`), `DataContext` |
| `src/pages/` | Business pages by area; `public/` = landing; `ceo/` = the CEO shell's pages |
| `src/programs/` | program registry (`index.js`) and `ganaderia/` |
| `src/lib/` | engines and helpers — `ceoModel.js`, `ceoDocs.js`, `ceoCompetition.js`, `ceoFields.js`, finance/report helpers |
| `src/i18n/` | `translations.js` (EN + ES), `I18nContext.jsx` (`useT` → `t`, `tn`, `lang`) |
| `src/components/` | shared UI; `layout/AppLayout.jsx`, `layout/CeoLayout.jsx` |
| `api/` | Vercel functions (Claude proxy, extraction) |
| `migrations/` | every SQL change, one idempotent file each; `README.md` is the index |
| `scripts/` | gitignored except force-added files; `i18n_parity.mjs` is the committed check |
| `docs/` | gitignored except `ARCHITECTURE.md` |
| `.claude/rules/` | path-scoped rules (`ceo`, `ganaderia`, `migrations`, `i18n`) — load with the files |
| `.claude/skills/` | `batch`, `migration`, `seed`, `i18n-check` |

## Standing rules

**This repository is PUBLIC.** The bundle is public too. Nothing below is ever staged,
committed, pasted into code or comments, or uploaded:
- anything from `~/selric-business/` or `~/bataviallc/` (the plan, model, prose, datasets, seeds, docs)
- `reports/`, `.env*`, `.claude/settings.local.json`, `.claude/launch.json`
- the FY2025 migrations (`migrations/*fy2025*.sql`, `migrations/2026-09-*.sql`,
  `migrations/2026-07-22-book-bs-l20a-upstart-loan.sql`) and anything under `data/`, `.local/`
- customer or pilot data of any kind: names of people, amounts, bank details, screenshots of a workspace
- keys, tokens, project secrets (the Supabase project ref is public; keys are not)

Stage files **by name** from an allow-list (see the `batch` skill) — never `git add -A`, `.` or a directory.
`docs/ARCHITECTURE.md` and `scripts/i18n_parity.mjs` are tracked with `git add -f`; leave the ignore lines alone.

**Commit and push only on the word "sube".** Not on "go", not on "ok". Before that, show
`git diff --cached --stat`. End every commit message with the attribution lines the harness
provides at that moment (do not hard-code a model name).

**Migrations** are idempotent files in `migrations/` (`YYYY-MM-DD-what.sql`) with one index line in
`migrations/README.md`. Dry-run on production through the Supabase MCP (inside a transaction that
raises at the end), show the result, apply with `apply_migration` only on the word **"aplicada"**.
Branches only once `list_migrations` shows history and the owner has said branching is on.
Details: `migration` skill and `.claude/rules/migrations.md`.

**The engine holds no constants.** `src/lib/ceoModel.js` is pure functions over an assumptions
object; every number comes from `platform_assumptions` and every sentence from `platform_documents`.
A value or a sentence of the plan in `src/` is a bug. Field labels and units in `ceoFields.js` are fine.

**EN/ES key parity is mandatory.** Every key added in one language is added in the other in the same
edit. `node scripts/i18n_parity.mjs` must print `parity` before a batch is reported.

**recharts axes and grid are real elements.** The helpers in `src/pages/ceo/charts.jsx` are called
as functions — `{MonthAxis()}`, `{NumAxis({ fmt: usdK })}`, `{Grid()}` — never rendered as
`<MonthAxis />`; recharts finds axes by element type and silently ignores wrapper components.

**RLS.** Tenant tables carry a RESTRICTIVE `org_isolation` policy on `org_id = public.current_org_id()`.
Role checks go through SECURITY DEFINER functions (`is_admin()`, `is_platform_admin()`), never a subquery
on `profiles` inside a `profiles` policy (infinite recursion). `platform_*` tables are admin-only.

**Append-only versions.** `platform_assumptions` and `platform_documents` have no UPDATE or DELETE
grant; a save is an INSERT, a restore is an INSERT of an old row's data. The trigger assigns the version.

## Commands

```
npm run build                        # must pass before any report
node scripts/i18n_parity.mjs         # EN/ES parity
cd ~/selric-business && env $(grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' ~/SELRIC-SA/.env | xargs) node verify_model.mjs --version <n>
```
The dev server is started with the preview tool (`selric-dev` in `.claude/launch.json`), not Bash.
Never print the service-role key; pipe output through a redaction when a script echoes env.

## How a batch runs

Every batch follows the `batch` skill: **Phase 1** plan (read-only, files listed with purpose) → stop;
**Phase 2** on "go": build, migration dry-run → "aplicada" → apply, seed if needed, verify, walk the
pages in the Browser pane (desktop and 390 px, EN and ES), report; **Phase 3** on "sube": stage
exactly the listed files, show `--cached --stat`, commit, push, report the hash, then update
`docs/ARCHITECTURE.md` if the map changed (in the same commit when it is in the list).

Walks read numbers from the DOM (`javascript_tool`) and take one screenshot per view, not per scroll.
The owner signs in on the Browser pane; never ask for or type a password.

## Code style

- Match the surrounding file: comment density, naming, idioms. Comments say *why*, in full sentences.
- Plain language in the UI and in reports; no jargon the owner did not use.
- Prefer one shared helper over a second copy (`docParts.jsx`, `charts.jsx`, `ceoDocs.js`).
- Keep the public bundle lean: heavy libraries behind `import()` on the routes that need them.

## When compacting, keep

the current batch and phase, the file list for "sube", applied/pending migrations, the DB versions
that are current (assumptions vN, documents vN), and open questions to the owner. Drop exploration.
