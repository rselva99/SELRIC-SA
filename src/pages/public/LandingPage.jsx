import { Link } from 'react-router-dom';
import { ArrowRight, Check, Menu, X } from 'lucide-react';
import { useState } from 'react';

// Illustrative numbers only — they add up (opening + rows = closing) so the
// reconciliation on the page is honest, but they are not any customer's data.
const LEDGER = {
  opening: '29,338.10',
  rows: [
    { date: 'Mar 02', label: 'Deposit — card settlement', amount: '+4,812.40' },
    { date: 'Mar 05', label: 'Check #1187 — rent',        amount: '−7,500.00' },
    { date: 'Mar 09', label: 'Payroll run',                amount: '−6,214.88' },
    { date: 'Mar 14', label: 'Deposit — card settlement', amount: '+5,106.75' },
    { date: 'Mar 21', label: 'Supplier invoice #4471',     amount: '−1,938.20' },
  ],
  closing: '23,604.17',
};

const MODULES = [
  {
    group: 'Money in and out',
    items: [
      ['Bookkeeping',             'Upload bank statements and invoices. SelRic reads them and drafts the transactions; you confirm.'],
      ['Cash management',         'Every check and statement tracked and reconciled to the penny.'],
      ['General ledger & journal','Double-entry posting, with periods that lock once a month is closed.'],
      ['Chart of accounts',       'Start from a sensible default, then rename, merge and archive as you grow.'],
    ],
  },
  {
    group: 'Operations',
    items: [
      ['Payroll',     'Bring in your payroll register and post it as one clean entry.'],
      ['Inventory',   'Products, stock levels and reorder alerts.'],
      ['Assets',      'Equipment, vehicles and their depreciation schedules.'],
      ['Daily sales', 'Import your point-of-sale recaps instead of retyping them.'],
    ],
  },
  {
    group: 'Close and report',
    items: [
      ['Reports',          'Profit & loss, balance sheet and a close package your accountant can open as PDF.'],
      ['Calendar & tasks', 'The recurring deadlines a business lives by, next to the numbers they affect.'],
      ['Marketing',        'Campaigns and assets kept with the spend they generate.'],
      ['Team access',      'Admins see the books; limited users see only what they need.'],
    ],
  },
];

const STEPS = [
  ['Create your workspace', 'Business name, email, password. You get a private workspace with a starter chart of accounts — nobody else can see it.'],
  ['Bring in what you have', 'Drop in statements, invoices and payroll PDFs. SelRic extracts the lines; you review and post.'],
  ['Close the month', 'Reconcile against the bank, lock the period and export the package. Then do it again next month, faster.'],
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-white text-surface-900 font-body">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-surface-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="SelRic home">
            <span className="w-8 h-8 rounded-lg bg-brand-600 text-white font-display text-base flex items-center justify-center">S</span>
            <span className="font-display text-xl text-brand-950">SelRic</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm text-surface-700">
            <a href="#who-we-are" className="hover:text-brand-700">Who we are</a>
            <a href="#what-it-does" className="hover:text-brand-700">What it does</a>
            <a href="#how-it-works" className="hover:text-brand-700">How it works</a>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/login" className="btn-ghost text-surface-700">Sign in</Link>
            <Link to="/signup" className="btn-primary">Create account</Link>
          </div>

          <button
            className="md:hidden p-2 text-surface-700"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-label="Menu"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-surface-200 bg-white px-5 py-4 space-y-3 text-sm">
            <a href="#who-we-are" onClick={() => setMenuOpen(false)} className="block py-1">Who we are</a>
            <a href="#what-it-does" onClick={() => setMenuOpen(false)} className="block py-1">What it does</a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)} className="block py-1">How it works</a>
            <div className="pt-3 flex gap-3">
              <Link to="/login" className="btn-secondary flex-1">Sign in</Link>
              <Link to="/signup" className="btn-primary flex-1">Create account</Link>
            </div>
          </div>
        )}
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center">
        <div>
          <h1 className="font-display text-[2.6rem] leading-[1.05] sm:text-5xl lg:text-[3.6rem] text-brand-950">
            Run the whole business from one set of books.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-surface-700 leading-relaxed max-w-[34rem]">
            SelRic is where your bank statements, invoices, payroll, inventory and reports
            live together — so the numbers tie out every month and your accountant gets a
            clean package instead of a shoebox.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary text-base px-6 py-3">
              Create your account <ArrowRight size={18} />
            </Link>
            <a href="#how-it-works" className="btn-secondary text-base px-6 py-3">
              See how it works
            </a>
          </div>
          <p className="mt-5 text-sm text-surface-500">
            Takes two minutes. Your business gets its own private workspace.
          </p>
        </div>

        {/* The reconciliation — rows post in once on load, then stay. */}
        <figure className="bg-brand-950 text-white rounded-2xl p-6 sm:p-7 shadow-modal" aria-label="Example month reconciliation">
          <div className="flex items-baseline justify-between">
            <figcaption className="font-display text-xl">March reconciliation</figcaption>
            <span className="text-xs text-brand-300">Operating checking</span>
          </div>

          <dl className="mt-5 font-mono text-[13px] sm:text-sm">
            <div className="flex justify-between py-2 text-brand-300">
              <dt>Opening balance</dt>
              <dd>{LEDGER.opening}</dd>
            </div>
            {LEDGER.rows.map((r, i) => (
              <div
                key={`${r.date}-${r.label}`}
                className="ledger-row flex items-baseline gap-3 py-2 border-t border-white/10"
                style={{ animationDelay: `${0.25 + i * 0.18}s` }}
              >
                <dt className="flex-1 flex gap-3 min-w-0">
                  <span className="text-brand-400 shrink-0">{r.date}</span>
                  <span className="truncate font-body text-white/90">{r.label}</span>
                </dt>
                <dd className={r.amount.startsWith('+') ? 'text-brand-300' : 'text-white'}>{r.amount}</dd>
              </div>
            ))}
            <div className="ledger-row flex justify-between pt-3 mt-1 border-t border-white/20" style={{ animationDelay: '1.3s' }}>
              <dt className="font-body text-brand-200">Statement balance</dt>
              <dd>{LEDGER.closing}</dd>
            </div>
            <div className="ledger-row flex justify-between py-1" style={{ animationDelay: '1.45s' }}>
              <dt className="font-body text-brand-200">Book balance</dt>
              <dd>{LEDGER.closing}</dd>
            </div>
            <div className="ledger-row flex justify-between items-center pt-3 mt-2 border-t border-white/20" style={{ animationDelay: '1.7s' }}>
              <dt className="font-body text-white">Difference</dt>
              <dd className="flex items-center gap-2 text-brand-300">
                0.00
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 text-white font-body text-xs px-2 py-0.5">
                  <Check size={12} /> Reconciled
                </span>
              </dd>
            </div>
          </dl>
        </figure>
      </section>

      {/* ── Who we are ──────────────────────────────────────────────────── */}
      <section id="who-we-are" className="bg-brand-50 border-y border-brand-100">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">
            Who we are
          </h2>
          <div className="border-l-2 border-brand-500 pl-6 sm:pl-8 max-w-[62ch] text-lg leading-relaxed text-surface-800 space-y-5">
            <p>
              SelRic is a small software company in St. Louis, Missouri. It started as the back
              office of one restaurant: bank statements that didn't match the books, checks nobody
              could name, tips and payroll tangled together, and an accountant waiting on a clean
              year-end.
            </p>
            <p>
              We built the tool we needed to close those books properly — statement by statement,
              check by check — and then saw that a bakery, a contractor, a shop or a clinic needs
              exactly the same thing. So SelRic became business management for any owner-operator:
              the books, the cash, the people and the reporting, in one place that balances.
            </p>
            <p className="text-surface-600 text-base">
              Built by a finance analyst, for people who would rather run their business than
              reconcile it.
            </p>
          </div>
        </div>
      </section>

      {/* ── What it does ────────────────────────────────────────────────── */}
      <section id="what-it-does" className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
        <div className="max-w-[40rem]">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">What it does</h2>
          <p className="mt-4 text-lg text-surface-700">
            Every module reads from the same ledger, so a payroll run, a supplier invoice and a
            card deposit end up in the same place your reports are built from.
          </p>
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-10 md:gap-8">
          {MODULES.map((m) => (
            <div key={m.group}>
              <h3 className="font-display text-xl text-brand-800 pb-3 border-b-2 border-brand-900">{m.group}</h3>
              <dl className="divide-y divide-surface-200">
                {m.items.map(([name, desc]) => (
                  <div key={name} className="py-4">
                    <dt className="font-semibold text-surface-900">{name}</dt>
                    <dd className="mt-1 text-[15px] leading-relaxed text-surface-600">{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="border-t border-surface-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">How it works</h2>
          <ol className="mt-12 grid md:grid-cols-3 gap-10 md:gap-8">
            {STEPS.map(([title, desc], i) => (
              <li key={title} className="relative pl-14">
                <span className="absolute left-0 top-0 w-10 h-10 rounded-full bg-brand-950 text-white font-display text-lg flex items-center justify-center">
                  {i + 1}
                </span>
                <h3 className="font-semibold text-lg text-surface-900 pt-1.5">{title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-surface-600">{desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="bg-brand-950 text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 lg:py-20 flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-16">
          <div className="flex-1">
            <h2 className="font-display text-3xl sm:text-4xl leading-tight">Start with the books you have.</h2>
            <p className="mt-4 text-lg text-brand-200 max-w-[36rem]">
              Your workspace is ready the moment you sign up. Bring last month's statement and
              see it reconcile.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary bg-brand-500 hover:bg-brand-400 text-base px-6 py-3">
              Create your account <ArrowRight size={18} />
            </Link>
            <Link to="/login" className="btn-secondary bg-transparent text-white border-white/30 hover:bg-white/10 text-base px-6 py-3">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-surface-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm text-surface-500">
          <div className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded bg-brand-600 text-white font-display text-xs flex items-center justify-center">S</span>
            <span>SelRic LLC, St. Louis, Missouri</span>
          </div>
          <div className="flex gap-6">
            <Link to="/login" className="hover:text-brand-700">Sign in</Link>
            <Link to="/signup" className="hover:text-brand-700">Create account</Link>
            <a href="#who-we-are" className="hover:text-brand-700">Who we are</a>
          </div>
          <div>&copy; {year} SelRic LLC</div>
        </div>
      </footer>
    </div>
  );
}
