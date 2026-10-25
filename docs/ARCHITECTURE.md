# SelRic — architecture map

The file every session reads first. It names where things are and how they connect; it holds
no business numbers, no plan prose and no customer data. Keep it under 300 lines. Update it in
the batch that changes a route, a table, an engine or a flow.

## 1. Shape of the system

```
 Browser (React 18 + Vite, public bundle)            Vercel                    Supabase
 ┌───────────────────────────────────────┐   ┌──────────────────────┐   ┌───────────────────────────┐
 │ /            LandingPage (public)      │   │ static build (dist)  │   │ Auth (email + password)   │
 │ /login …     auth pages                │   │ api/*.js functions → │──►│ Postgres + RLS + RPCs     │
 │ /app         AppEntry → program home   │──►│  Anthropic (server-  │   │ Storage (private buckets, │
 │ /dashboard … Business (AppLayout)      │   │  side key)           │   │  signed URLs)             │
 │ /ganaderia/* Ganadería (AppLayout)     │   └──────────────────────┘   └───────────────────────────┘
 │ /ceo/*       CEO shell (CeoLayout)     │──── supabase-js with the anon key; RLS decides everything ──►
 └───────────────────────────────────────┘
 ~/selric-business/ (outside the repo) ── publish.mjs with the service-role key ──► platform_* tables, platform-docs bucket
```

## 2. Tenancy and access

- A **workspace** is a row in `organizations`; a person is a row in `profiles` (`id` = `auth.users.id`,
  `org_id`, `role` ∈ `admin|limited`, `locale`). `org_programs` says which programs a workspace runs.
- `public.current_org_id()` (SECURITY DEFINER) returns the caller's org; every tenant table has a
  RESTRICTIVE `org_isolation` policy on it. `set_org_id` triggers fill `org_id` on insert.
- `public.is_admin()` gates admin-only tables; `public.is_platform_admin()` (email in `platform_admins`)
  gates every `platform_*` table, the `ceo_overview()` RPC and the `platform-docs` bucket.
- `organizations.is_internal = true` marks SelRic's own workspace; an internal account only ever sees `/ceo`.
- `organizations.accounting_mode` ∈ `full|simple`; `organizations.config` holds the Simple-mode portal
  (template, modules on/off, custom names, dashboard sections, custom fields).

## 3. Tables

**Tenancy, sign-up, settings** — `organizations`, `profiles`, `org_programs`, `org_invitations`
(admin invites a person into a workspace), `invite_codes` (sign-up codes), `waitlist`, `app_settings`
(`signup_mode`), `platform_admins`.

**Business — Simple package** — `transactions` (the cash ledger every mode shares), `sales` + `sale_items`
(RPCs `record_sale`, `update_sale`, `void_sale`: stock comes off inventory, money lands in transactions),
`customers`, `customer_prices` (agreed prices), `products` (+ photos in `product-images`), `product_components`
(recipes: packaging consumed on sale), `inventory_logs`, `categories`, `supplier_categories`, `invoices`.

**Business — Full package (books)** — `accounts` (chart of accounts), `journal_entries` + `journal_entry_lines`
(RPC `post_journal_entry`), `journal_rules`, `bank_statements` (+ files in `bank-statements`; RPC
`statement_totals`), `checks`, `payroll_months` + `payroll_lines`, `period_close` + `close_checklist`
(trigger `enforce_period_lock`), `close_scenarios` + `close_scenario_lines`, `cpa_sourced_locks`,
`report_deliverables`, `accountant_audit_log`, `accountant_chat`, and the book balance sheet:
`book_bs_statements`, `book_bs_lines`, `book_bs_line_mappings`, `book_bs_line_txns`,
`book_bs_line_adjustments`, `book_bs_line_asset_mappings`. Triggers on `transactions` keep the cash leg
(`transactions_ensure_cash_leg`) and handle source deletes.

**Ganadería** — `lv_animals` (one card per animal), `lv_events` (the timeline). RPCs `lv_record_event`
(the event plus its effect on the card: calving → calvings+1 and not pregnant, optional calf card;
palpation → pregnancy; weight → last weight; sale/death → status; move → lot) and `lv_delete_event`.

**Platform (the CEO shell; admin-only, see §2)**
| Table | What | Writes |
|---|---|---|
| `platform_assumptions` | one row per version of the model's assumptions (`data` jsonb, `note`) | INSERT only; version by trigger |
| `platform_documents` | one row per version of a document (`doc` ∈ business_plan, market_gtm, findings, plan, competition; `sections` jsonb) | INSERT only; version by trigger, per doc |
| `platform_leads` | the sales funnel (region us/ni, program, stage, source, owner, head_count, next action) | INSERT/UPDATE/DELETE by admins |
| `platform_lead_events` | stage history | by trigger `platform_leads_track` |
| `platform_research` | legacy v2 research row | not read by the app |

**Storage** — `product-images`, `bank-statements` (private, signed URLs), `platform-docs` (private; the
frozen editions of the plan, market analysis, competition and model, admin-only).

## 4. Routes and shells (`src/main.jsx`)

| Path | Gate | Page |
|---|---|---|
| `/` | `RootGate` — always the public landing for `/` itself | `pages/public/LandingPage` |
| `/programs/:key` | public | `ProgramPage` |
| `/login` `/signup` `/forgot-password` `/reset-password` | `PublicRoute` | `pages/auth/*` (sign-up reads `?invite=`) |
| `/app` | `AppEntry` → the program's home, `/setup`, or `/ceo` | — |
| `/setup` | Simple-mode admin with an unconfigured portal | `SetupPage` |
| `/dashboard` | any member | `DashboardPage` |
| `/transactions` `/sales` `/customers` `/tasks` `/reports` `/inventory` | `ProtectedRoute` (+ `module=` for Simple portals) | Business, both modes |
| `/accountant/*` `/bookkeeping/*` `/ledger` `/journal` `/accounts` `/cash-management` `/assets` `/payroll` | `adminOnly fullOnly` (+ `PinGate` on accountant) | Full package |
| `/users` `/settings` | `adminOnly program={null}` | shared by every program |
| `/ganaderia` `/ganaderia/animales[/:slug]` `/ganaderia/eventos` | `GanaderiaRoot` (program `ganaderia`) + `HerdProvider` | `src/programs/ganaderia/*` |
| `/ceo/*` | internal account → `CeoLayout` | `pages/ceo/CeoPage` (tabs below) |

`ProtectedRoute` order: not signed in → `/login`; internal → `/ceo`; wrong program → that program's home;
`adminOnly`; `fullOnly` in Simple → `/transactions`; module off → `/dashboard`.

**CEO tabs** (`/ceo`, `/ceo/<tab>`; rail in `CeoLayout`, drawer below `lg`): Overview · Pilots · Funnel
(`FunnelPage`) · Research · Competition (`CompetitionPage`) · Model (`ModelPage`) · Documents
(`DocumentsPage`: Business Plan, Market Analysis & GTM, Competition, Financial Model, Findings & milestones) · Plan.

## 5. Engines (pure, constant-free, run in the browser and under node)

| File | Does | Read by |
|---|---|---|
| `src/lib/ceoModel.js` | `compute(assumptions)` → `R`: 36-month cohort engine (capacity-capped acquisition, front-loaded churn, pilots, cash, founder draw), `derive` (market, tiers, affordability), `scenarios`, `sensitivity`, unit economics, break-even | every CEO tab, the documents, the exports, `~/selric-business` scripts |
| `src/lib/ceoDocs.js` | markdown subset → blocks; `{{path\|fmt}}` tokens (`resolve`, `FMT`); `{{table:name}}` computed tables (`TABLES`, `tableFor`); `parseSections` (`##`/`###` with `{#key}`) | Documents, Research findings, Plan, exports |
| `src/lib/ceoCompetition.js` | ladders, medians, cheaper / free-tier counts, the grouped feature matrix; resolves SelRic's price from `R` via `priceToken` | Competition page and tables |
| `src/lib/ceoFields.js` | the assumptions schema for the editor and the Excel (labels, types, units; no values) | Model tab, Financial Model, `exportXlsx` |
| `src/pages/ceo/exportDocx.js` | document sections + `R` → Word (`docx`), lazy-loaded | Documents, Competition, `build_docx.mjs` |
| `src/pages/ceo/exportXlsx.js` | `R` → the workbook (`exceljs`), lazy-loaded | Financial Model, `build_xlsx.mjs` |
| `src/pages/ceo/charts.jsx` | palette `C`, `ChartCard` (chart + table twin), axis/grid helpers (called, not rendered), `Tip`, `useNarrow` | every CEO chart |
| `src/pages/ceo/docParts.jsx` | `Blocks`, `Section` (edit in place), `Versions`, `DocTable`, `saveBlob` | Documents, Competition |

Business helpers in `src/lib/`: `finance.js`, `reports.js`, `postJournalEntry.js`, `periodClose.js`,
`periodLock.js`, `bookBalanceSheet.js`, `depreciation.js`, `statement*.js`, `workspaceConfig.js`,
`productImages.js` (downscale, HEIC reject, signed URLs), `fetchAll.js` (paged reads), `claude.js` (→ `api/claude`).

## 6. Flows

**Sign-up → workspace.** `/signup?invite=CODE` → `get_signup_mode` / `check_invite` gate the form →
Supabase Auth creates the user → trigger `handle_new_user`:
(1) invited into an existing workspace (`org_invitations`) → that org, that role;
(2a) email in `platform_admins` → the internal SelRic workspace, admin, no program;
(2) self-serve → invite code consumed when `signup_mode = 'invite'` → new `organizations` row +
`org_programs` row + `seed_organization_defaults` → admin. Then `profiles` row. `/app` routes to the home.

**Seed → tables (outside the repo).** `~/selric-business/publish.mjs` (service-role key from `.env`) inserts
v1 of `platform_assumptions` and of each `platform_documents` doc **only if absent**, and uploads the frozen
files to `platform-docs`. `verify_model.mjs --version N` runs a stored version through `ceoModel.js` and
compares it to the 24 Oct 2026 reference run (0 differences expected).

**Assumptions → every tab.** `CeoPage.load()` reads `ceo_overview()`, all assumption versions, all document
versions, leads and lead events → `R = compute(newest assumptions)` and `docs = { findings, plan, competition }`
(newest per doc) → every tab renders from `R` and `docs`; Overview and Funnel join the model's monthly path with
the funnel's paying leads. Saving on the Model or Documents tab INSERTs a new version → `load()` → everything
recomputes. Restore = INSERT of an old version's payload. Downloads build .docx/.xlsx in the browser from the
same `R` and sections.

**Migration.** File in `migrations/` → dry run through the Supabase MCP in a transaction that raises →
owner says "aplicada" → `apply_migration` (recorded in history) → README index line. See the `migration` skill.

**Deploy.** Push to `main` → Vercel builds and serves. There is no staging deployment.

## 7. Never in this repository

This repo and the bundle are public. Never staged, committed or pasted into code:
- `~/selric-business/` and `~/bataviallc/` — the model's assumptions, all plan prose, datasets, seeds, outputs, frozen files
- `reports/`, `.env*`, `.claude/settings.local.json`, `.claude/launch.json`, `data/`, `.local/`
- FY2025 and pilot bookkeeping migrations: `migrations/*fy2025*.sql`, `migrations/2026-09-*.sql`,
  `migrations/2026-07-22-book-bs-l20a-upstart-loan.sql`
- anything from a customer's or pilot's workspace: names, amounts, statements, screenshots
- keys and tokens (service role, Anthropic, EmailJS private values)

`docs/` and `scripts/` are gitignored; only `docs/ARCHITECTURE.md` and `scripts/i18n_parity.mjs` (plus the
scripts already tracked) are in git, added with `git add -f`.

## 8. Checks

`npm run build` · `node scripts/i18n_parity.mjs` · `verify_model.mjs` (outside the repo) · the Browser-pane
walk at desktop and 390 px in EN and ES. Tests, Playwright and hooks are not set up yet.
