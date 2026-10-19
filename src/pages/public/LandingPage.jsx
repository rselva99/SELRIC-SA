import { Link } from 'react-router-dom';
import { ArrowRight, Check, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useT, LangToggle } from '../../i18n/I18nContext';

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useT();
  const year = new Date().getFullYear();
  const week = t('landing.week');
  const groups = t('landing.groups');
  const madeFor = t('landing.madeFor');
  const steps = t('landing.steps');

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
            <a href="#who-we-are" className="hover:text-brand-700">{t('landing.navWho')}</a>
            <a href="#what-you-get" className="hover:text-brand-700">{t('landing.navWhat')}</a>
            <a href="#how-it-works" className="hover:text-brand-700">{t('landing.navHow')}</a>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <LangToggle />
            <Link to="/login" className="btn-ghost text-surface-700">{t('common.signIn')}</Link>
            <Link to="/signup" className="btn-primary">{t('common.createAccount')}</Link>
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
            <a href="#who-we-are" onClick={() => setMenuOpen(false)} className="block py-1">{t('landing.navWho')}</a>
            <a href="#what-you-get" onClick={() => setMenuOpen(false)} className="block py-1">{t('landing.navWhat')}</a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)} className="block py-1">{t('landing.navHow')}</a>
            <div className="pt-3 flex items-center gap-3">
              <LangToggle />
              <Link to="/login" className="btn-secondary flex-1">{t('common.signIn')}</Link>
              <Link to="/signup" className="btn-primary flex-1">{t('common.createAccount')}</Link>
            </div>
          </div>
        )}
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center">
        <div>
          <h1 className="font-display text-[2.6rem] leading-[1.05] sm:text-5xl lg:text-[3.6rem] text-brand-950">
            {t('landing.heroTitle')}
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-surface-700 leading-relaxed max-w-[34rem]">
            {t('landing.heroBody')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary text-base px-6 py-3">
              {t('landing.heroCta')} <ArrowRight size={18} />
            </Link>
            <a href="#what-you-get" className="btn-secondary text-base px-6 py-3">
              {t('landing.heroSecondary')}
            </a>
          </div>
          <p className="mt-5 text-sm text-surface-500">
            {t('landing.heroNote')}
          </p>
        </div>

        {/* The owner's week — lines post in once on load, then stay. */}
        <figure className="bg-brand-950 text-white rounded-2xl p-6 sm:p-7 shadow-modal" aria-label="Example owner dashboard for one week">
          <div className="flex items-baseline justify-between gap-4">
            <figcaption className="font-display text-xl">{week.title}</figcaption>
            <span className="text-xs text-brand-300 truncate">{week.business}</span>
          </div>

          <dl className="mt-4">
            {week.rows.map(([label, value, note], i) => (
              <div
                key={label}
                className="week-row flex items-baseline justify-between gap-4 py-3 border-t border-white/10"
                style={{ animationDelay: `${0.25 + i * 0.16}s` }}
              >
                <dt className="min-w-0">
                  <div className="text-[15px] text-white/90">{label}</div>
                  <div className={`text-xs mt-0.5 ${i === 1 ? 'text-brand-300' : i === 4 ? 'text-amber-300' : 'text-brand-400'}`}>
                    {note}
                  </div>
                </dt>
                <dd className="font-mono text-[15px] sm:text-base text-white shrink-0">{value}</dd>
              </div>
            ))}
            <div className="week-row flex items-center justify-between gap-4 pt-4 mt-1 border-t border-white/20" style={{ animationDelay: '1.3s' }}>
              <dt className="text-sm text-brand-200">{week.footer}</dt>
              <dd className="inline-flex items-center gap-1 rounded-full bg-brand-600 text-white text-xs px-2 py-0.5 shrink-0">
                <Check size={12} /> {week.badge}
              </dd>
            </div>
          </dl>
        </figure>
      </section>

      {/* ── Who we are ──────────────────────────────────────────────────── */}
      <section id="who-we-are" className="bg-brand-50 border-y border-brand-100">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">
            {t('landing.whoTitle')}
          </h2>
          <div className="border-l-2 border-brand-500 pl-6 sm:pl-8 max-w-[62ch] text-lg leading-relaxed text-surface-800 space-y-5">
            <p>{t('landing.who1')}</p>
            <p>{t('landing.who2')}</p>
            <p className="text-surface-600 text-base">{t('landing.who3')}</p>
          </div>
        </div>
      </section>

      {/* ── What you get ────────────────────────────────────────────────── */}
      <section id="what-you-get" className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
        <div className="max-w-[40rem]">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('landing.whatTitle')}</h2>
          <p className="mt-4 text-lg text-surface-700">{t('landing.whatBody')}</p>
        </div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-10 sm:gap-8">
          {groups.map((g) => (
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
          <h3 className="font-display text-xl text-brand-950 shrink-0">{t('landing.madeForTitle')}</h3>
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-surface-700">
            {madeFor.map((m) => (
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
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('landing.howTitle')}</h2>
          <ol className="mt-12 grid md:grid-cols-3 gap-10 md:gap-8">
            {steps.map(([title, desc], i) => (
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
            <h2 className="font-display text-3xl sm:text-4xl leading-tight">{t('landing.ctaTitle')}</h2>
            <p className="mt-4 text-lg text-brand-200 max-w-[36rem]">{t('landing.ctaBody')}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary bg-brand-500 hover:bg-brand-400 text-base px-6 py-3">
              {t('landing.heroCta')} <ArrowRight size={18} />
            </Link>
            <Link to="/login" className="btn-secondary bg-transparent text-white border-white/30 hover:bg-white/10 text-base px-6 py-3">
              {t('common.signIn')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-surface-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm text-surface-500">
          <div className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded bg-brand-600 text-white font-display text-xs flex items-center justify-center">S</span>
            <span>{t('landing.footerCompany')}</span>
          </div>
          <div className="flex gap-6">
            <Link to="/login" className="hover:text-brand-700">{t('common.signIn')}</Link>
            <Link to="/signup" className="hover:text-brand-700">{t('common.createAccount')}</Link>
            <a href="#who-we-are" className="hover:text-brand-700">{t('landing.navWho')}</a>
          </div>
          <div>&copy; {year} SelRic LLC</div>
        </div>
      </footer>
    </div>
  );
}
