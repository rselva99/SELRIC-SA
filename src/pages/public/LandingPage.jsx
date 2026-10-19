import { Link } from 'react-router-dom';
import { ArrowRight, Check, Menu, X } from 'lucide-react';
import { useState } from 'react';

// Illustrative numbers only — a fictional bakery's week. Not any customer's data.
const WEEK = {
  business: 'Lopez Bakery',
  rows: [
    { label: 'Cash on hand',          value: '$23,604.17', note: 'operating checking' },
    { label: 'Sales this week',       value: '$12,418.60', note: 'up 8% on last week', good: true },
    { label: 'Bills due by Friday',   value: '$4,110.00',  note: '3 invoices' },
    { label: 'Payroll',               value: '$6,214.88',  note: 'runs Friday' },
    { label: 'Inventory',             value: '2 items',    note: 'below reorder point', warn: true },
    { label: 'Open tasks',            value: '4',          note: 'next: renew food permit, Thu' },
  ],
  footer: 'Books reconciled through February',
};

const GROUPS = [
  {
    title: 'Know where you stand',
    items: [
      ['Dashboard',       'Cash, sales and profit on one screen, the moment you open it.'],
      ['Cash management', 'Every dollar in and out, every check, matched to the bank.'],
      ['Reports',         'Profit & loss and balance sheet, as PDF, whenever someone asks for them.'],
    ],
  },
  {
    title: 'Run the day-to-day',
    items: [
      ['Daily sales',      'Import your point-of-sale recaps instead of retyping them.'],
      ['Inventory',        'Products, stock levels and reorder alerts before you run out.'],
      ['Payroll',          'Bring in the payroll register and post it in one step.'],
      ['Calendar & tasks', 'Permits, filings, deliveries and deadlines, next to the numbers they affect.'],
    ],
  },
  {
    title: 'Grow it and share the load',
    items: [
      ['Marketing',   'Campaigns and creative kept with the spend they generate.'],
      ['Team access', 'Give staff the parts they need — inventory, tasks — without opening the books.'],
      ['Assets',      'Equipment and vehicles, with their depreciation tracked for you.'],
    ],
  },
  {
    title: 'Books, done right',
    items: [
      ['Bookkeeping',           'Upload statements and invoices; SelRic drafts the entries, you confirm.'],
      ['Ledger & journal',      'Double-entry underneath, with months that lock once they close.'],
      ['Chart of accounts',     'A sensible starter set; rename, merge and archive as you grow.'],
    ],
  },
];

const MADE_FOR = [
  'Restaurants and bars',
  'Shops and online stores',
  'Contractors and trades',
  'Clinics, studios and practices',
  'Non-profits',
];

const STEPS = [
  ['Create your workspace',  'Business name, email, password. You get a private workspace with a starter chart of accounts — nobody else can see it.'],
  ['Bring in what you have', 'Drop in bank statements, invoices and payroll PDFs. SelRic pulls out the lines; you review and post.'],
  ['Run the week',           'Open the dashboard Monday and see cash, sales and what is due. When month-end comes, close it in minutes instead of a weekend.'],
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
            <a href="#what-you-get" className="hover:text-brand-700">What you get</a>
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
            <a href="#what-you-get" onClick={() => setMenuOpen(false)} className="block py-1">What you get</a>
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
            Everything it takes to run your business, in one place.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-surface-700 leading-relaxed max-w-[34rem]">
            Sales, cash, bills, payroll, inventory, your team — and the books underneath it all.
            SelRic is the one screen an owner opens in the morning to know exactly where the
            business stands.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary text-base px-6 py-3">
              Create your account <ArrowRight size={18} />
            </Link>
            <a href="#what-you-get" className="btn-secondary text-base px-6 py-3">
              See what's inside
            </a>
          </div>
          <p className="mt-5 text-sm text-surface-500">
            Takes two minutes. Your business gets its own private workspace.
          </p>
        </div>

        {/* The owner's week — lines post in once on load, then stay. */}
        <figure className="bg-brand-950 text-white rounded-2xl p-6 sm:p-7 shadow-modal" aria-label="Example owner dashboard for one week">
          <div className="flex items-baseline justify-between gap-4">
            <figcaption className="font-display text-xl">This week</figcaption>
            <span className="text-xs text-brand-300 truncate">{WEEK.business}</span>
          </div>

          <dl className="mt-4">
            {WEEK.rows.map((r, i) => (
              <div
                key={r.label}
                className="week-row flex items-baseline justify-between gap-4 py-3 border-t border-white/10"
                style={{ animationDelay: `${0.25 + i * 0.16}s` }}
              >
                <dt className="min-w-0">
                  <div className="text-[15px] text-white/90">{r.label}</div>
                  <div className={`text-xs mt-0.5 ${r.good ? 'text-brand-300' : r.warn ? 'text-amber-300' : 'text-brand-400'}`}>
                    {r.note}
                  </div>
                </dt>
                <dd className="font-mono text-[15px] sm:text-base text-white shrink-0">{r.value}</dd>
              </div>
            ))}
            <div className="week-row flex items-center justify-between gap-4 pt-4 mt-1 border-t border-white/20" style={{ animationDelay: '1.3s' }}>
              <dt className="text-sm text-brand-200">{WEEK.footer}</dt>
              <dd className="inline-flex items-center gap-1 rounded-full bg-brand-600 text-white text-xs px-2 py-0.5 shrink-0">
                <Check size={12} /> Reconciled
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
              Running a small business means being the owner, the manager, the bookkeeper, the
              buyer and the marketing department — usually before lunch. Every tool we tried was
              built for one of those hats. SelRic is built for the person wearing all of them.
            </p>
            <p>
              We are a small software company in St. Louis, Missouri. SelRic started inside one
              restaurant, where the sales lived in the point-of-sale, the bills in a drawer, payroll
              in a portal and the books nowhere in particular. We put it all in one place, got the
              business to a clean year-end, and realized a bakery, a contractor, a shop or a clinic
              needs exactly the same thing.
            </p>
            <p className="text-surface-600 text-base">
              Built by a finance analyst who runs small ventures of his own, for people who would
              rather build their business than chase it across five apps.
            </p>
          </div>
        </div>
      </section>

      {/* ── What you get ────────────────────────────────────────────────── */}
      <section id="what-you-get" className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
        <div className="max-w-[40rem]">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">What you get</h2>
          <p className="mt-4 text-lg text-surface-700">
            One workspace for everything you juggle. Each part reads from the same numbers, so
            a sale, a bill and a payroll run show up in your cash, your tasks and your reports
            without you copying anything.
          </p>
        </div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-10 sm:gap-8">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="font-display text-xl text-brand-800 pb-3 border-b-2 border-brand-900">{g.title}</h3>
              <dl className="divide-y divide-surface-200">
                {g.items.map(([name, desc]) => (
                  <div key={name} className="py-4">
                    <dt className="font-semibold text-surface-900">{name}</dt>
                    <dd className="mt-1 text-[15px] leading-relaxed text-surface-600">{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-surface-200 flex flex-col lg:flex-row lg:items-baseline gap-4 lg:gap-10">
          <h3 className="font-display text-xl text-brand-950 shrink-0">Made for owner-operators</h3>
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-surface-700">
            {MADE_FOR.map((m) => (
              <li key={m} className="flex items-center gap-2">
                <Check size={16} className="text-brand-600 shrink-0" />
                {m}
              </li>
            ))}
          </ul>
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
            <h2 className="font-display text-3xl sm:text-4xl leading-tight">Stop running the business out of five apps and a notebook.</h2>
            <p className="mt-4 text-lg text-brand-200 max-w-[36rem]">
              Your workspace is ready the moment you sign up. Bring last month's statement and
              see the whole picture by tonight.
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
