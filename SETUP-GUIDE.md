# SelRic SA — Complete Setup Guide
## From Zero to Running App

This guide walks you through every single step to get SelRic SA running. No prior technical knowledge needed.

---

## TABLE OF CONTENTS

1. [Prerequisites — What You Need First](#1-prerequisites)
2. [Create a Supabase Project (Database & Auth)](#2-supabase)
3. [Set Up the Database Tables](#3-database)
4. [Create Storage Buckets](#4-storage)
5. [Get a Claude API Key (Document OCR)](#5-claude-api)
6. [Push Code to GitHub](#6-github)
7. [Deploy to Vercel (Free Hosting)](#7-vercel)
8. [Configure Environment Variables on Vercel](#8-env-vars)
9. [Configure Supabase Auth Redirect URLs](#9-auth-urls)
10. [Test Your App](#10-test)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. PREREQUISITES — What You Need First {#1-prerequisites}

You need accounts on these free services (create them now if you don't have them):

**a) GitHub account** (free)
- Go to: https://github.com
- Click "Sign up" in the top right
- Follow the prompts (email, password, username)
- Verify your email

**b) Node.js installed on your computer**
- Go to: https://nodejs.org
- Click the big green button labeled "LTS" (Long Term Support)
- Download and install it (just click Next through the installer)
- To verify: open Terminal (Mac) or Command Prompt (Windows), type: `node --version`
- You should see something like `v20.x.x`

**c) Git installed on your computer**
- Mac: It's pre-installed. Type `git --version` in Terminal to confirm.
- Windows: Go to https://git-scm.com/download/win → download and install (keep all defaults)

---

## 2. CREATE A SUPABASE PROJECT {#2-supabase}

Supabase is your free database, authentication, and file storage backend.

### Step 2.1 — Create Account
1. Go to: **https://supabase.com**
2. Click **"Start your project"** (green button, top right)
3. Click **"Sign up with GitHub"** (easiest option)
4. Authorize Supabase to access your GitHub account
5. You'll land on the Supabase Dashboard

### Step 2.2 — Create a New Project
1. Click **"New Project"** (green button)
2. Select your **Organization** (it auto-creates one with your name)
3. Fill in:
   - **Name**: `selric-sa`
   - **Database Password**: Create a strong password → **SAVE THIS PASSWORD** (you'll need it later)
   - **Region**: Choose the closest to your location (e.g., **"US East (N. Virginia)"** or **"US West (Oregon)"**)
4. Click **"Create new project"**
5. Wait 1-2 minutes while it sets up. You'll see a loading screen.

### Step 2.3 — Get Your API Keys
1. Once the project is ready, click **"Settings"** in the left sidebar (gear icon at the bottom)
2. Click **"API"** in the Settings submenu
3. You'll see two important values:
   - **Project URL**: Looks like `https://abcdefghijk.supabase.co` → **COPY THIS**
   - **anon public key**: A long string starting with `eyJ...` → **COPY THIS**
4. Save both values somewhere safe (a text file, notes app, etc.)

---

## 3. SET UP THE DATABASE TABLES {#3-database}

### Step 3.1 — Open SQL Editor
1. In your Supabase dashboard, click **"SQL Editor"** in the left sidebar (looks like a terminal icon)
2. Click **"New query"** (top left, or the + button)

### Step 3.2 — Run the Schema
1. Open the file `supabase-schema.sql` from your project folder
2. Select ALL the text (Ctrl+A / Cmd+A) and COPY it (Ctrl+C / Cmd+C)
3. PASTE it into the Supabase SQL Editor (Ctrl+V / Cmd+V)
4. Click the **"Run"** button (green play button, or Ctrl+Enter)
5. You should see **"Success. No rows returned"** — this is correct!
6. If you see any errors, check the Troubleshooting section below

### Step 3.3 — Verify Tables Were Created
1. Click **"Table Editor"** in the left sidebar (grid icon)
2. You should see these tables listed:
   - profiles
   - categories
   - accounts
   - transactions
   - invoices
   - bank_statements
   - products
   - inventory_logs
   - supplier_categories
3. Click on **"categories"** — you should see ~29 pre-seeded rows

---

## 4. CREATE STORAGE BUCKETS {#4-storage}

The SQL script already created the storage buckets. Let's verify:

1. Click **"Storage"** in the left sidebar (folder icon)
2. You should see two buckets:
   - **documents** — for bank statement PDFs
   - **invoices** — for invoice files
3. If they're NOT there, create them manually:
   - Click **"New bucket"**
   - Name: `documents`, toggle **"Public bucket"** ON → click **"Create bucket"**
   - Click **"New bucket"** again
   - Name: `invoices`, toggle **"Public bucket"** ON → click **"Create bucket"**

---

## 5. GET A CLAUDE API KEY {#5-claude-api}

Claude API is used to extract data from bank statements and invoices. You pay only per document processed (typically a few cents each).

### Step 5.1 — Create Anthropic Account
1. Go to: **https://console.anthropic.com/**
2. Click **"Sign up"**
3. Create an account with your email
4. Verify your email

### Step 5.2 — Add Billing (Required for API access)
1. Click **"Plans & Billing"** in the left sidebar
2. Click **"Add payment method"**
3. Enter a credit/debit card
4. Set a **spending limit** of $5/month (this is more than enough — each document costs ~$0.01-0.05)

### Step 5.3 — Create API Key
1. Click **"API Keys"** in the left sidebar
2. Click **"Create Key"**
3. Give it a name: `selric-sa`
4. Click **"Create Key"**
5. **IMMEDIATELY COPY** the key that appears — it starts with `sk-ant-api03-...`
6. **SAVE THIS** — you cannot see it again after closing this dialog!

---

## 6. PUSH CODE TO GITHUB {#6-github}

### Step 6.1 — Create a GitHub Repository
1. Go to: **https://github.com/new**
2. Fill in:
   - **Repository name**: `selric-sa`
   - **Description**: `College bar finance & inventory management`
   - Select **"Private"** (so no one else can see your code & API keys)
3. Do NOT check "Add a README file"
4. Click **"Create repository"**
5. You'll see a page with setup instructions — keep this page open

### Step 6.2 — Push Your Code
1. Open **Terminal** (Mac) or **Command Prompt** (Windows)
2. Navigate to your project folder:
   ```
   cd path/to/selric-sa
   ```
3. Run these commands one by one:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - SelRic SA"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/selric-sa.git
   git push -u origin main
   ```
   Replace `YOUR-USERNAME` with your actual GitHub username.
4. If prompted for credentials, enter your GitHub username and a Personal Access Token (not your password):
   - Go to: https://github.com/settings/tokens
   - Click **"Generate new token (classic)"**
   - Give it a note: `selric-sa`
   - Check the **"repo"** scope
   - Click **"Generate token"** → copy the token and use it as your password

---

## 7. DEPLOY TO VERCEL {#7-vercel}

### Step 7.1 — Create Vercel Account
1. Go to: **https://vercel.com**
2. Click **"Sign Up"**
3. Click **"Continue with GitHub"**
4. Authorize Vercel to access your GitHub

### Step 7.2 — Import Your Project
1. On the Vercel dashboard, click **"Add New..."** → **"Project"**
2. You'll see a list of your GitHub repos
3. Find **selric-sa** and click **"Import"**
4. Settings will auto-detect (Framework: Vite, Root Directory: ./)
5. **DO NOT click Deploy yet!** — you need to add environment variables first (next section)

---

## 8. CONFIGURE ENVIRONMENT VARIABLES ON VERCEL {#8-env-vars}

### Step 8.1 — Add All Variables
Still on the Vercel project import page, scroll down to **"Environment Variables"**

Add each of these (click "Add" after each one):

| Key (NAME) | Value (paste your saved value) |
|---|---|
| `VITE_SUPABASE_URL` | `https://your-project-id.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi...` (your anon key) |
| `VITE_ANTHROPIC_API_KEY` | `sk-ant-api03-...` |

### Step 8.2 — Deploy
1. After adding all 3 environment variables, click **"Deploy"**
2. Wait 1-3 minutes for the build to complete
3. You'll see a green "Congratulations!" screen with a preview of your site
4. Your app is now live at: `https://selric-sa.vercel.app` (or similar URL shown on screen)

---

## 9. CONFIGURE SUPABASE AUTH REDIRECT URLs {#9-auth-urls}

This is CRITICAL — without this, login and password reset won't work properly.

### Step 9.1 — Set Redirect URLs
1. Go back to your **Supabase Dashboard**: https://supabase.com/dashboard
2. Click your **selric-sa** project
3. Click **"Authentication"** in the left sidebar
4. Click **"URL Configuration"** (under the Configuration section)
5. Set **Site URL** to your Vercel URL:
   ```
   https://selric-sa.vercel.app
   ```
   (Use the EXACT URL Vercel gave you — no trailing slash)
6. Under **"Redirect URLs"**, click **"Add URL"** and add:
   ```
   https://selric-sa.vercel.app/**
   ```
   (This wildcard allows all paths on your domain)
7. Click **"Save"**

### Step 9.2 — Configure Email Templates (Optional but Recommended)
1. Still in Authentication settings, click **"Email Templates"**
2. For the **"Confirm signup"** template, you can customize the email body
3. For the **"Reset password"** template, make sure the `{{ .ConfirmationURL }}` placeholder is present
4. The defaults work fine — only customize if you want branded emails

---

## 10. TEST YOUR APP {#10-test}

### Step 10.1 — Create Your First Admin Account
1. Open your app URL (e.g., `https://selric-sa.vercel.app`)
2. Click **"Create an account"** on the login page
3. Fill in:
   - **Full Name**: Your name
   - **Email**: Your real email (you'll receive a verification email)
   - **Role**: Select **"Admin"**
   - **Password**: At least 6 characters
4. Click **"Create Account"**
5. Check your email for a verification link from Supabase → click it
6. Go back to the app and log in

### Step 10.2 — Test Core Features
1. **Dashboard**: Should load with empty stats (no data yet)
2. **Inventory**: Click "Add Product" → add a test product (e.g., "Bud Light 12-pack", Beer, cost $10, sell $18, stock 48)
3. **Inventory → Log Entry**: Log a "Received" entry for 24 units
4. **Bookkeeping**: Upload a test invoice image → Claude should extract the data
5. **Accounts**: Create a test account (e.g., "Cash" under "Asset")
6. **Reports**: Select the current month → Download a P&L report

### Step 10.3 — Create a Limited User
1. Log out
2. Register a new account with Role: **"Limited User"**
3. Log in — you should only see Dashboard and Inventory (no Bookkeeping, Accounts, or Reports)

---

## 11. TROUBLESHOOTING {#11-troubleshooting}

### "SQL Error: permission denied"
- Make sure you're running the SQL in your project's SQL Editor, not a different project
- Try running the script in smaller chunks (copy sections one at a time)

### "Invalid API Key" errors in browser console
- Double-check that your .env variables on Vercel match exactly (no extra spaces)
- Redeploy after changing env vars: Vercel Dashboard → Deployments → Redeploy

### Login doesn't work / redirects to blank page
- Check Supabase Auth → URL Configuration → make sure Site URL matches your Vercel URL exactly
- Make sure the redirect URL wildcard `https://your-app.vercel.app/**` is added

### Claude API / Document extraction not working
- Check browser console (F12 → Console tab) for error messages
- Verify your Anthropic API key is correct and has billing set up
- The API key must start with `sk-ant-api03-`

### "Module not found" errors during build
- Make sure all imports match the file paths exactly (case-sensitive!)
- Run `npm install` again to make sure all dependencies are installed

### Bank statement extraction returns empty results
- Claude works best with clearly formatted PDF bank statements
- If extraction quality is low, try a cleaner PDF scan
- The app sends the PDF as base64 to Claude's vision API — very large files may timeout

### Vercel build fails
- Check the build logs on Vercel Dashboard → Deployments → click the failed deployment
- Common fix: make sure `package.json` lists all dependencies
- Try: delete `node_modules` folder and `package-lock.json`, then `npm install` again, commit, and push

### Custom domain (optional)
1. In Vercel: Settings → Domains → Add your domain
2. Update DNS records as Vercel instructs (usually a CNAME record)
3. Update Supabase Auth → URL Configuration → Site URL to your custom domain
4. Add the custom domain to Redirect URLs too

---

## QUICK REFERENCE — All Your Saved Values

Copy this template and fill in your values:

```
SUPABASE_URL:               ___________________________________
SUPABASE_ANON_KEY:          ___________________________________
ANTHROPIC_API_KEY:          ___________________________________
VERCEL_APP_URL:             ___________________________________
```

---

## COST SUMMARY

| Service | Cost |
|---------|------|
| Supabase (Free tier) | $0/month — 500MB DB, 1GB storage, 50K auth users |
| Vercel (Free tier) | $0/month — 100GB bandwidth, automatic HTTPS |
| Claude API | ~$0.01-0.05 per document processed |
| **TOTAL** | **~$0/month** + cents per document |
