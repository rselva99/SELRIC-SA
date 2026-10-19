import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { PROGRAMS, accentOf } from '../../programs';
import SiteHeader from '../../components/public/SiteHeader';
import SiteFooter from '../../components/public/SiteFooter';
import WeekCard from '../../components/public/WeekCard';
import WaitlistForm from '../../components/WaitlistForm';

// SelRic home. Two programs, each a separate product: its own panel here,
// its own page at /programs/<key>, its own workspace and its own price.
// Nothing from one program appears in the other.
export default function LandingPage() {
  const { t } = useT();
  const { hash } = useLocation();

  // Links like /#waitlist from other pages: the router does not scroll to the
  // hash on its own, so do it once the page has rendered.
  useEffect(() => {
    if (!hash) return;
    const el = document.querySelector(hash);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  const steps = t('site.steps');
  const weekOf = (key) => (key === 'business' ? t('landing.week') : t(`programs.${key}.page.week`));
  const statusLabel = (p) => t(p.status === 'live' ? 'site.statusLive' : p.status === 'pilot' ? 'site.statusPilot' : 'site.statusSoon');
  const panelTone = { brand: 'bg-brand-50 border-brand-100', ranch: 'bg-ranch-50 border-ranch-100' };

  return (
    <div className="min-h-screen bg-white text-surface-900 font-body">
      <SiteHeader />

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 pb-12 lg:pt-24 lg:pb-16 text-center">
        <p className="text-sm font-semibold text-brand-700 tracking-wide">{t('site.heroEyebrow')}</p>
        <h1 className="mt-4 font-display text-[2.6rem] leading-[1.05] sm:text-5xl lg:text-[3.8rem] text-brand-950 max-w-[16ch] mx-auto">
          {t('site.heroTitle')}
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-surface-700 leading-relaxed max-w-[42rem] mx-auto">
          {t('site.heroBody')}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {PROGRAMS.map((p) => {
            const a = accentOf(p);
            return (
              <Link key={p.key} to={`/programs/${p.key}`} className={`inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-medium text-white ${a.tile} hover:opacity-90 transition-opacity`}>
                <p.icon size={18} /> {t(`programs.${p.key}.name`)} <ArrowRight size={18} />
              </Link>
            );
          })}
        </div>
        <p className="mt-5 text-sm text-surface-500">{t('site.heroNote')}</p>
      </section>

      {/* ── Two programs, side by side ──────────────────────────────────── */}
      <section id="programs" className="scroll-mt-20 max-w-6xl mx-auto px-5 sm:px-8 pb-20 lg:pb-24">
        <div className="max-w-[40rem]">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.programsTitle')}</h2>
          <p className="mt-4 text-lg text-surface-700">{t('site.programsBody')}</p>
        </div>

        <div className="mt-10 grid lg:grid-cols-2 gap-6 lg:gap-8">
          {PROGRAMS.map((p, i) => {
            const a = accentOf(p);
            const bullets = t(`programs.${p.key}.bullets`);
            return (
              <article key={p.key} className={`rounded-3xl border p-6 sm:p-8 flex flex-col ${panelTone[p.accent] || panelTone.brand}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-12 h-12 rounded-xl flex items-center justify-center ${a.tile}`}><p.icon size={24} /></span>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">{t('site.programEyebrow')}</div>
                      <h3 className="font-display text-2xl text-brand-950 leading-tight">{t(`programs.${p.key}.name`)}</h3>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${p.status === 'live' ? 'bg-white text-brand-800 border border-brand-200' : 'bg-amber-100 text-amber-800'}`}>
                    {statusLabel(p)}
                  </span>
                </div>

                <p className="text-surface-800 mt-5 text-lg leading-relaxed">{t(`programs.${p.key}.tagline`)}</p>
                <ul className="mt-5 space-y-2">
                  {bullets.map((b) => (
                    <li key={b} className="flex gap-2.5 text-[15px] text-surface-700">
                      <Check size={17} className={`${a.text} shrink-0 mt-0.5`} /> <span>{b}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link to={`/programs/${p.key}`} className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-medium text-white ${a.tile} hover:opacity-90 transition-opacity`}>
                    {t('site.seeProgram', { name: t(`programs.${p.key}.short`) })} <ArrowRight size={16} />
                  </Link>
                  <Link to={`/programs/${p.key}#waitlist`} className="btn-secondary bg-white">{t('landing.joinWaitlist')}</Link>
                  <span className="text-sm text-surface-600 ml-auto">
                    <span className="font-mono text-surface-900">{t(`programs.${p.key}.price`)}</span> {t('site.perMonth')} · {t(`programs.${p.key}.priceNote`)}
                  </span>
                </div>

                <div className="mt-7">
                  <WeekCard week={weekOf(p.key)} tone={a.dark} animate={i === 0} />
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl border border-dashed border-surface-300 px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <div className="font-display text-xl text-brand-950">{t('site.somethingElse')}</div>
            <p className="text-surface-600 mt-1">{t('site.somethingElseBody')}</p>
          </div>
          <a href="#waitlist" className="btn-secondary shrink-0">{t('site.nextCta')} <ArrowRight size={16} /></a>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-20 bg-surface-50 border-y border-surface-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.howTitle')}</h2>
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

      {/* ── Who we are ──────────────────────────────────────────────────── */}
      <section id="who-we-are" className="scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.whoTitle')}</h2>
          <div className="border-l-2 border-brand-500 pl-6 sm:pl-8 max-w-[62ch] text-lg leading-relaxed text-surface-800 space-y-5">
            <p>{t('site.who1')}</p>
            <p className="text-surface-600 text-base">{t('site.who2')}</p>
          </div>
        </div>
      </section>

      {/* ── Pricing: one card per program ───────────────────────────────── */}
      <section id="pricing" className="scroll-mt-20 bg-brand-50 border-y border-brand-100">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
          <div className="max-w-[40rem]">
            <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.pricingTitle')}</h2>
            <p className="mt-4 text-lg text-surface-700">{t('site.pricingBody')}</p>
          </div>

          <div className="mt-10 grid md:grid-cols-2 gap-6">
            {PROGRAMS.map((p) => {
              const a = accentOf(p);
              return (
                <div key={p.key} className={`rounded-2xl ${a.dark} text-white p-6 sm:p-7 shadow-modal flex flex-col`}>
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center"><p.icon size={18} /></span>
                    <span className="font-display text-xl">{t(`programs.${p.key}.name`)}</span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-5">
                    <span className="font-display text-5xl">{t(`programs.${p.key}.price`)}</span>
                    <span className="text-white/70">{t('site.perMonth')}</span>
                  </div>
                  <div className="text-sm text-white/60 mt-1">{t(`programs.${p.key}.priceNote`)}</div>
                  <ul className="mt-6 space-y-2.5 flex-1">
                    {t(`programs.${p.key}.includes`).map((line) => (
                      <li key={line} className="flex gap-3 text-[15px] leading-relaxed text-white/90">
                        <Check size={18} className="text-white/60 shrink-0 mt-0.5" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to={`/programs/${p.key}#waitlist`} className="mt-7 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-brand-950 font-medium px-5 py-2.5 hover:bg-white/90">
                    {t('landing.joinWaitlist')} <ArrowRight size={16} />
                  </Link>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-sm text-surface-600 max-w-[48rem]">{t('site.pricingNote')}</p>
        </div>
      </section>

      {/* ── Waitlist ────────────────────────────────────────────────────── */}
      <section id="waitlist" className="scroll-mt-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16 items-start">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.ctaTitle')}</h2>
            <p className="mt-4 text-lg text-surface-700 max-w-[34rem]">{t('site.ctaBody')}</p>
          </div>
          <WaitlistForm />
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
