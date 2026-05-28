# SelRic SA — Bar Finance & Inventory Management

A full-stack web app for managing the finances and inventory of a college bar. Built with React, Supabase, and Claude AI.

## Features

- **Dashboard** — Monthly revenue, expenses, net profit, low-stock alerts, and 6-month revenue/expense charts
- **Bookkeeping** — Upload bank statement PDFs and invoices; Claude AI extracts transactions automatically
- **Reconciliation** — Match bank statement entries to recorded transactions
- **Chart of Accounts** — Manage asset, liability, equity, revenue, and expense accounts
- **Inventory** — Track products (beer, wine, spirits, etc.), log received/sold/used/adjustment entries, reorder alerts
- **Reports** — Generate and download P&L reports as PDF
- **User Management** — Admin and limited-user roles; admins see financials, limited users see only inventory

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, React Router v6, Tailwind CSS, Recharts |
| Backend / DB | Supabase (PostgreSQL + Auth + Storage) |
| AI | Claude API (Anthropic) — document OCR & smart categorization |
| Build | Vite |
| Hosting | Vercel |

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/rselva99/SELRIC-SA.git
cd SELRIC-SA
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 3. Set up the database

Run `supabase-schema.sql` in your Supabase project's SQL Editor. This creates all tables, RLS policies, and seeds default categories.

### 4. Run locally

```bash
npm run dev
```

App runs at `http://localhost:5173`.

## Deployment

The app deploys to Vercel with zero configuration. See [SETUP-GUIDE.md](SETUP-GUIDE.md) for a step-by-step walkthrough covering Supabase, Vercel, and environment variable configuration.

## Project Structure

```
src/
├── components/
│   ├── layout/       # AppLayout (sidebar + nav)
│   └── ui/           # Reusable components (Modal, StatCard, Spinner, etc.)
├── contexts/
│   ├── AuthContext   # Auth state, user profile, isAdmin flag
│   └── DataContext   # Supabase data fetching for all entities
├── lib/
│   ├── claude.js     # Claude API calls (bank statement & invoice extraction)
│   ├── supabase.js   # Supabase client
│   ├── reports.js    # PDF report generation (jsPDF)
│   └── utils.js      # Formatting helpers
└── pages/
    ├── auth/         # Login, forgot password, reset password
    ├── dashboard/    # Overview with charts
    ├── bookkeeping/  # Transaction entry & bank reconciliation
    ├── accounts/     # Chart of accounts
    ├── inventory/    # Products & stock logs
    ├── reports/      # P&L report builder
    └── admin/        # User management (admin only)
```

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_ANTHROPIC_API_KEY` | Anthropic API key for document extraction |

## Roles

- **Admin** — full access: bookkeeping, accounts, reports, inventory, user management
- **Limited User** — inventory and dashboard only
