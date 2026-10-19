import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Check, Plus } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { PROGRAMS, accentOf } from '../../programs';
import SiteHeader from '../../components/public/SiteHeader';
import SiteFooter from '../../components/public/SiteFooter';
import WeekCard from '../../components/public/WeekCard';
import WaitlistForm from '../../components/WaitlistForm';

// SelRic home: one account, a program for each thing you run.
// Each program also has its own page at /programs/<key> (ProgramPage).
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
  const businessWeek = t('landing.week');
  const ranchWeek = t('programs.ganaderia.page.week');
  const statusLabel = (p) => t(p.status === 'live' ? 'site.statusLive' : p.status === 'pilot' ? 'site.statusPilot' : 'site.statusSoon');

  return (
    <div className="min-h-screen bg-white text-surface-900 font-body">
      <SiteHeader />

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 pb-24 lg:pt-24 lg:pb-32 grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-16 items-center">
        <div>
          <p className="text-sm font-semibold text-brand-700 tracking-wide">{t('site.heroEyebrow')}</p>
          <h1 className="mt-4 font-display text-[2.6rem] leading-[1.05] sm:text-5xl lg:text-[3.6rem] text-brand-950">
            {t('site.heroTitle')}
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-surface-700 leading-relaxed max-w-[34rem]">
            {t('site.heroBody')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#waitlist" className="btn-primary text-base px-6 py-3">
              {t('landing.joinWaitlist')} <ArrowRight size={18} />
            </a>
            <a href="#programs" className="btn-secondary text-base px-6 py-3">
              {t('site.heroSecondary')}
            </a>
          </div>
          <p className="mt-5 text-sm text-surface-500">{t('site.heroNote')}</p>
        </div>

        {/* Two programs, one account: the finca's week sits behind the business's. */}
        <div className="relative mt-6 lg:mt-0 sm:pt-14">
          <WeekCard week={ranchWeek} tone="bg-ranch-900" animate={false} compact
            className="hidden sm:block absolute top-0 left-5 right-5 -rotate-[1.5deg] origin-bottom-left" />
          <WeekCard week={businessWeek} tone="bg-brand-950" className="relative" />
        </div>
      </section>

      {/* ── Programs ────────────────────────────────────────────────────── */}
      <section id="programs" className="scroll-mt-20 bg-surface-50 border-y border-surface-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
          <div className="max-w-[40rem]">
            <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.programsTitle')}</h2>
            <p className="mt-4 text-lg text-surface-700">{t('site.programsBody')}</p>
          </div>

          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PROGRAMS.map((p) => {
              const a = accentOf(p);
              const bullets = t(`programs.${p.key}.bullets`);
              return (
                <article key={p.key} className={`rounded-2xl bg-white border ${a.border} p-6 sm:p-7 flex flex-col shadow-card`}>
                  <div className="flex items-start justify-between gap-3">
                    <span className={`w-12 h-12 rounded-xl flex items-center justify-center ${a.tile}`}><p.icon size={24} /></span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${p.status === 'live' ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-800'}`}>
                      {statusLabel(p)}
                    </span>
                  </div>
                  <h3 className="font-display text-2xl text-brand-950 mt-5">{t(`programs.${p.key}.name`)}</h3>
                  <p className="text-surface-700 mt-2 leading-relaxed">{t(`programs.${p.key}.tagline`)}</p>
                  <ul className="mt-5 space-y-2 flex-1">
                    {bullets.map((b) => (
                      <li key={b} className="flex gap-2.5 text-[15px] text-surface-700">
                        <Check size={17} className={`${a.text} shrink-0 mt-0.5`} /> <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 pt-5 border-t border-surface-100 flex items-center justify-between gap-3">
                    <span className="text-sm text-surface-600">{t(`programs.${p.key}.price`)}</span>
                    <Link to={`/programs/${p.key}`} className={`inline-flex items-center gap-1 text-sm font-medium ${a.text} hover:underline`}>
                      {t('site.seeProgram', { name: t(`programs.${p.key}.short`) })} <ArrowRight size={15} />
                    </Link>
                  </div>
                </article>
              );
            })}

            <article className="rounded-2xl border-2 border-dashed border-surface-300 p-6 sm:p-7 flex flex-col">
              <span className="w-12 h-12 rounded-xl flex items-center justify-center bg-surface-100 text-surface-600"><Plus size={24} /></span>
              <h3 className="font-display text-2xl text-brand-950 mt-5">{t('site.nextTitle')}</h3>
              <p className="text-surface-700 mt-2 leading-relaxed flex-1">{t('site.nextBody')}</p>
              <a href="#waitlist" className="btn-secondary mt-6 self-start">{t('site.nextCta')} <ArrowRight size={16} /></a>
            </article>
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-20 max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
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
      </section>

      {/* ── Who we are ──────────────────────────────────────────────────── */}
      <section id="who-we-are" className="scroll-mt-20 bg-brand-50 border-y border-brand-100">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24 grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16">
          <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.whoTitle')}</h2>
          <div className="border-l-2 border-brand-500 pl-6 sm:pl-8 max-w-[62ch] text-lg leading-relaxed text-surface-800 space-y-5">
            <p>{t('site.who1')}</p>
            <p className="text-surface-600 text-base">{t('site.who2')}</p>
          </div>
        </div>
      </section>

      {/* ── Pricing + waitlist ──────────────────────────────────────────── */}
      <section id="pricing" className="scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-start">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.pricingTitle')}</h2>
            <p className="mt-4 text-lg text-surface-700 max-w-[34rem]">{t('site.pricingBody')}</p>

            <div className="mt-8 rounded-2xl bg-brand-950 text-white shadow-modal overflow-hidden">
              <div className="hidden sm:grid grid-cols-[1.1fr_0.8fr_1.6fr] gap-4 px-6 py-3 text-[11px] font-semibold uppercase tracking-wider text-brand-300 border-b border-white/10">
                <span>{t('site.pricingProgram')}</span><span>{t('site.pricingPrice')}</span><span>{t('site.pricingIncludes')}</span>
              </div>
              {PROGRAMS.map((p) => (
                <div key={p.key} className="grid sm:grid-cols-[1.1fr_0.8fr_1.6fr] gap-1 sm:gap-4 px-6 py-5 border-b border-white/10">
                  <div className="font-display text-xl">{t(`programs.${p.key}.name`)}</div>
                  <div>
                    <div className="font-mono text-[15px]">{t(`programs.${p.key}.price`)}</div>
                    <div className="text-xs text-brand-300 mt-0.5">{t(`programs.${p.key}.priceNote`)}</div>
                  </div>
                  <div className="text-[15px] text-white/85 leading-relaxed">{t(`programs.${p.key}.includes`)}</div>
                </div>
              ))}
              <div className="grid sm:grid-cols-[1.1fr_0.8fr_1.6fr] gap-1 sm:gap-4 px-6 py-5 border-b border-white/10">
                <div className="font-display text-xl">{t('site.bundleName')}</div>
                <div className="font-mono text-[15px] text-brand-200">{t('site.bundlePrice')}</div>
                <div className="text-[15px] text-white/85 leading-relaxed">{t('site.bundleIncludes')}</div>
              </div>
              <p className="px-6 py-5 text-sm text-brand-200">{t('site.pricingNote')}</p>
            </div>
          </div>

          <div id="waitlist" className="scroll-mt-24">
            <WaitlistForm />
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="bg-brand-950 text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 lg:py-20 flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-16">
          <div className="flex-1">
            <h2 className="font-display text-3xl sm:text-4xl leading-tight">{t('site.ctaTitle')}</h2>
            <p className="mt-4 text-lg text-brand-200 max-w-[36rem]">{t('site.ctaBody')}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="#waitlist" className="btn-primary bg-brand-500 hover:bg-brand-400 text-base px-6 py-3">
              {t('landing.joinWaitlist')} <ArrowRight size={18} />
            </a>
            <Link to="/login" className="btn-secondary bg-transparent text-white border-white/30 hover:bg-white/10 text-base px-6 py-3">
              {t('common.signIn')}
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
