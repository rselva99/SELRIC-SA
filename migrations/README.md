# Migrations

Every SQL change against the live Supabase database is checked in here as
a numbered, dated file. Filename convention: `YYYY-MM-DD-short-description.sql`.
The date in a file name is the UTC day it was written; the **Applied** date in
the index below is St. Louis time — so a `2026-10-20-…` file applied late on
the evening of the 19th is correct, not a typo.

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
- `2026-06-11-statement-totals-and-period.sql` — fixes the "Direct from
  PDF pull" truncation bug by introducing a `statement_totals(uuid[])`
  RPC that aggregates server-side; adds idempotent backfill of
  bank_statements.period_start / period_end from the linked txns'
  min/max date (additive columns only — never touches transactions).
- `2026-06-11-repair-misdated-statement-uploads.sql` — one-time manual
  data repair for `Dec-24.pdf` + `Reprint Oct-24.pdf` whose extractions
  came back with the wrong year on some/all rows. Paste-and-run in
  three stages (PREVIEW → FIX → RECOMPUTE), scoped to those two
  statements' UNPOSTED, NON-VOIDED rows. Read this script's header for
  the safety contract before running.
- `2026-06-11-statement-match.sql` — adds period / file_path /
  statement_totals / match_status columns to bank_statements,
  bank_statement_id + verified on transactions, ensures the private
  `bank-statements` storage bucket exists, and gates every read/write
  through `public.is_admin()`. Required for the Accountant Import &
  Match flow.
- `2026-09-11-fy2025-batch2-fees-rent.sql` — FY2025 Batch 2: 78 Regions FEES-section rows into
  transactions (Bank Fees, reference FEE, cash legs by trigger), new "Rent Payable" liability
  category, 12 month-end rent accruals + 11 rent-check payment JEs (JE-RENT25-*) via
  post_journal_entry. **Applied 2026-09-11** by scripts/fy2025_batch2/phase2_write.mjs; the SQL
  file is the idempotent record. Rollback: scripts/fy2025_batch2/rollback_batch2.mjs.
- `2026-09-11-fy2025-batch3-payroll-ccfees.sql` — FY2025 Batch 3: "Payroll Taxes Payable" (liability) +
  "Payroll Clearing" (expense, see note in file) categories; 206 Venmo/Cash App bank rows reclassed
  Payroll → Payroll Clearing; 12 month-end payroll JVs from the 2025 Paycor register (JE-PR25-MM) and
  12 CC-processing entries (JE-CCP25-MM) via post_journal_entry. **Applied 2026-09-11** by
  scripts/fy2025_payroll/phase2_write.mjs. Rollback: scripts/fy2025_payroll/rollback_batch3.mjs.
- `2026-09-11-fy2025-batch4-tips-lohr.sql` — FY2025 Batch 4: Lohr Distributing checks that cleared
  Regions in Jan–Feb 2025 (document-supported, $19,794.36) posted DR Liquor / CR Cash & Bank as
  JE-LOHR25-01/02. Tips part NOT executed (no L17 tips ledger account exists; 12 planned entries
  listed in the file). **Applied 2026-09-11** by scripts/fy2025_batch4/phase2_write.mjs.
  Rollback: scripts/fy2025_batch4/rollback_batch4.mjs.
- `2026-09-11-fy2025-batch4b-tips-account.sql` — FY2025 Batch 4B: "Tips Payable" (liability) category +
  book_bs_line_mappings row → 2024 L17 "Tips Payable" line (rolls into 2025 via Add Year); 12 tips
  entries JE-TIPS25-MM (DR Tips Payable / CR Cash & Bank, $320,109.65). **Applied 2026-09-11** by
  scripts/fy2025_batch4b/phase2_write.mjs. Rollback: scripts/fy2025_batch4b/rollback_batch4b.mjs.
- `2026-09-14-fy2025-sanity-batch1.sql` — FY2025 Sanity Batch 1: 323 FY2025 bank rows reclassed per
  reports/FY2025_sanity_flags.csv (Sales Tax Payable, Upstart Loan, both Due to Partners, Taxes, POS System,
  Donations, Miscellaneous, Music & Entertainment, Licenses & Permits, Utilities, Amazon), tagged
  [reclass:fy2025-sanity-batch1]; 202 trigger-voided cash legs restored (voided=false). Record only;
  **Applied 2026-09-14** row by row by scripts/fy2025_sanity/batch1_apply.mjs. Rollback: batch1_rollback.mjs.
- `2026-09-14-fy2025-batch5-da-loans.sql` — FY2025 Batch 5: 24 D&A entries (JE-DEP25-MM $6,823.93, JE-AMORT25-MM $11,704.29),
  12 Southern Bank interest entries JE-GSBINT25-MM (DR Interest Expense / CR Loans $34,966.50), September return JE-GSBRET25-09
  (DR Cash & Bank / CR Loans $5,588.19), 13 CASH-LEG mirrors for the Southern Bank Loans rows ($72,647.82, tagged [fy2025-batch5-cash-leg]
  in the description). **Applied 2026-09-14** by scripts/fy2025_batch5/phase2_write.mjs. Rollback: scripts/fy2025_batch5/rollback_batch5.mjs.
- `2026-09-14-fy2025-batch6-owner-answers.sql` — FY2025 Batch 6 (owner answers, John Harris Sep 9): Shamrock Sewer $6,240.00 and Polywood
  $1,819.57 capitalized to Property & Equipment (mirrors restored live); FSP The Bounce $1,324.32 → Miscellaneous; Commercial Kitchen
  $311.79 (unposted) → Repairs & Maintenance; all tagged [reclass:fy2025-batch6]. JE-CORONADO25-04 DR Rent Payable / CR Miscellaneous $7,500.00;
  2 CASH-LEG mirrors for the $85.00 / $168.00 partner-account rows ([fy2025-batch6-cash-leg]). **Applied 2026-09-14** by
  scripts/fy2025_batch6/phase2_write.mjs. Rollback: scripts/fy2025_batch6/rollback_batch6.mjs.
- `2026-09-15-fy2025-batch7-revenue.sql` — FY2025 Batch 7: revenue from the SpotOn Daily Sales Recaps. Posted 2026-09-15 for
  August, September, October and December; extended 2026-09-16 to all 12 months once the owner supplied the rest. 12 entries
  JE-REV25-MM, month-end, DR Merchant Clearing / CR Bar Sales, Food Sales, Other, Sales Tax Payable, Tips Payable; net sales
  $1,835,802.20, sales tax $177,034.08, non-cash tips $327,125.09. **Applied** by scripts/fy2025_revenue/phase2_write.mjs.
  Rollback: scripts/fy2025_revenue/rollback_batch7.mjs.
- `2026-10-18-organizations-multi-business.sql` — SelRic becomes multi-business: `organizations` + `org_invitations`
  tables, `org_id` on profiles and every business-data table (metadata-only add, no row rewrite, `updated_at` untouched),
  `aa_set_org_id` BEFORE-INSERT auto-fill, RESTRICTIVE `org_isolation` RLS on every table (existing policies unchanged),
  global unique keys re-scoped to `(org_id, …)` (period_close.period, journal_entries.reference, close_checklist, checks,
  payroll_months, close_scenarios, cpa_sourced_locks, book_bs_lines, transactions.import_key; book_bs_statements re-keyed to
  (org_id, year)), `enforce_period_lock()` made org-aware, `handle_new_user()` now creates a workspace per self-serve sign-up
  (or joins the inviting org when an invitation exists; client `role` still ignored), `seed_organization_defaults(org)`.
  Humphrey's is the legacy org `00000000-0000-4000-8000-000000000001`; every existing row stays exactly where it is.
  Idempotent, tested against a PostgreSQL 16 replica of the schema. **Not yet applied.**
  Rollback: `ROLLBACK_organizations_multi_business.sql` (Stage A reversible; Stage B destructive, commented out).
- `2026-10-19-profiles-locale.sql` — `profiles.locale` (`en`/`es`, default `en`) for the UI language toggle, and
  `handle_new_user()` copies `locale` from the sign-up metadata so a Spanish sign-up lands in Spanish. Additive,
  idempotent, tested on the PostgreSQL 16 replica. The app tolerates the column being absent (toggle still works
  per device; the profile save is skipped). **Applied 2026-10-19.**
- `2026-10-19-waitlist-and-invites.sql` — paid product with free pilots: `waitlist` (public INSERT only), `invite_codes`,
  `app_settings.signup_mode` (`invite` now; set to `open` when payments go live), `organizations.plan` (`pilot`/`paid`,
  existing = pilot), RPCs `check_invite(code)` and `get_signup_mode()`, and `handle_new_user()` refuses self-serve
  sign-ups without a valid invite while in invite mode (team invitations from Manage Users unaffected). Additive,
  idempotent, tested on the replica. Usage notes at the bottom of the file. **Applied 2026-10-19.**
- `2026-10-19-accounting-mode.sql` — `organizations.accounting_mode` (`full`/`simple`, column default `full` so every
  existing workspace keeps the full package) and `handle_new_user()` creates new self-serve workspaces as `simple`.
  Settings → Accounting switches it (existing admin UPDATE policy). Both modes write the same tables — the mode only
  decides which pages the sidebar shows. Additive, idempotent, tested on the replica. **Applied 2026-10-19.**
- `2026-10-19-programs.sql` — SelRic as a platform: `org_programs` (one row per program a workspace runs; every
  existing workspace backfilled with `business`), `waitlist.program`, `invite_codes.program`, and
  `handle_new_user()` gives a new workspace its first program row (the invite's program, else `business`).
  Admin-only writes through RLS. Additive, idempotent, tested on the replica. The app assumes `business` when the
  table is absent. **Applied 2026-10-19.**
- `2026-10-19-sales-and-customers.sql` — Simple mode's Sales tab and Customers tab: `customers`, `sales`
  (per-workspace running number), `sale_items` (product, name snapshot, quantity, price as sold), `inventory_logs`
  gains `sale_id` and the `waste`/`returned` types. `record_sale(jsonb)` does the whole sale in one transaction —
  stock off `products`, a `sold` inventory log, the money-in row in `transactions` (credit, Sales Revenue, posted,
  reference `SALE-<id>`), the customer filed/reused by name. `update_sale` edits the header and mirrors it onto the
  money-in row; `void_sale` deletes the sale, the money-in row, and returns the stock. All three SECURITY INVOKER
  (RLS + period lock apply). `customer_stats` view (security_invoker). Full mode's Daily Sales is untouched.
  Additive, idempotent, tested on the replica. **Applied 2026-10-19.**
- `2026-10-19-sale-item-cost.sql` — `sale_items.unit_cost` (the product's cost at the moment of the sale, for the
  Simple-mode margin reports), backfill of earlier lines from the product's current cost, and `record_sale()`
  storing it. Additive, idempotent, tested on the replica. **Applied 2026-10-19.**
- `2026-10-19-product-kind-and-customer-prices.sql` — from the Chile Nicaragua pilot: `products.kind`
  (`sale` / `supply` — raw materials and packaging are stock-only and never offered in Sales),
  `products.target_stock` created IF NOT EXISTS (it had no migration), `customer_prices` (the agreed unit price
  per customer and product; `record_sale()` learns it from every sale, the Customers page edits it).
  Additive, idempotent, tested on the replica. **Applied 2026-10-19.**
- `2026-10-19-workspace-config.sql` — `organizations.config` (jsonb, `{}` = not set up): the portal each Simple-mode
  workspace shapes for itself — template, modules on/off, custom names, dashboard sections. Resolved in
  `src/lib/workspaceConfig.js`; admins write it through the existing organization UPDATE policy. Additive, idempotent,
  tested on the replica. **Applied 2026-10-19.**
- `2026-10-20-product-components.sql` — from the Lopez Bakery pilot: `product_components`, what a product is made of.
  Selling one unit of a parent now draws its packaging and materials off stock (`used` inventory log, tied to the
  sale) and folds their cost into `sale_items.unit_cost`, so the Simple-mode margin counts the bag the product went
  out in. `void_sale` returns the materials, reading the logs rather than the recipe so an edited recipe cannot
  distort a reversal; `update_sale` keeps the component logs on the sale's date. **No COGS transaction is written:**
  supplies are expensed when bought (receiving stock creates no transaction), so booking cost again at sale time
  would double-count — the cost reaches the margin, not the P&L. Quantities are whole units, because
  `products.current_stock` is integer and the UI parseInt()s it. Additive, idempotent. **Applied 2026-10-19.**
- `2026-10-20-decimal-quantities.sql` — quantities become `numeric(12,3)` everywhere they were integers
  (`products.current_stock/reorder_level/target_stock`, `product_components.quantity`, `inventory_logs.quantity`,
  `sale_items.quantity` + its generated `line_total`, `sales.items_count`) so a recipe can say "0.5 kg of flour" and a
  sale "2.25 lb". `record_sale` / `void_sale` re-created with numeric arithmetic; values are kept exactly. The front
  parses with parseFloat and shows up to 3 decimals (`formatQty`). Idempotent, tested on the replica. **Applied 2026-10-19.**
- `2026-10-20-custom-fields.sql` — the workspace's own fields (Settings → Your portal → "Your own fields"): adds
  `extra jsonb NOT NULL DEFAULT '{}'` (CHECK: an object) to `products`, `customers` and `sales`; `record_sale` stores
  `p->'extra'` on the new sale and `update_sale` replaces `sales.extra` when the call carries an object. The field
  definitions live in `organizations.config.fields` (no schema change); `cleanExtra` in the front keeps the values
  typed. A guard refuses to run before decimal-quantities, so that numeric `record_sale` body is never undone.
  Additive, idempotent, tested on the replica (CHECK rejects arrays/scalars; another workspace cannot read or change
  `extra`; period lock still applies). **Not yet applied.**
