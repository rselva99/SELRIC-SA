import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { getProgram, accentOf } from '../../programs';
import SiteHeader from '../../components/public/SiteHeader';
import SiteFooter from '../../components/public/SiteFooter';
import WeekCard from '../../components/public/WeekCard';
import WaitlistForm from '../../components/WaitlistForm';

// /programs/:key — one public page per program, same template for all.
// Business reuses the copy that used to be the whole landing page
// (translations.landing.*); other programs carry theirs under
// programs.<key>.page.
function useProgramCopy(key) {
  const { t } = useT();
  if (key === 'business') {
    return {
      heroTitle: t('landing.heroTitle'),
      heroBody: t('landing.heroBody'),
      week: t('landing.week'),
      whatTitle: t('landing.whatTitle'),
      whatBody: t('landing.whatBody'),
      groups: t('landing.groups'),
      madeForTitle: t('landing.madeForTitle'),
      madeFor: t('landing.madeFor'),
    };
  }
  const page = t(`programs.${key}.page`);
  return typeof page === 'object' ? page : null;
}

export default function ProgramPage() {
  const { key } = useParams();
  const { t } = useT();
  const program = getProgram(key);
  const copy = useProgramCopy(key);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [key]);

  if (!program || !copy) return <Navigate to="/" replace />;
  const a = accentOf(program);
  const name = t(`programs.${key}.name`);
  const statusLabel = t(program.status === 'live' ? 'site.statusLive' : program.status === 'pilot' ? 'site.statusPilot' : 'site.statusSoon');

  return (
    <div className="min-h-screen bg-white text-surface-900 font-body">
      <SiteHeader />

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-12 pb-20 lg:pt-20 lg:pb-28 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center">
        <div>
          <Link to="/#programs" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-brand-700">
            <ArrowLeft size={15} /> {t('site.backHome')}
          </Link>
          <div className="mt-6 flex items-center gap-3">
            <span className={`w-11 h-11 rounded-xl flex items-center justify-center ${a.tile}`}><program.icon size={22} /></span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-surface-500">{t('site.programEyebrow')}</div>
              <div className="flex items-center gap-2">
                <span className="font-display text-xl text-brand-950">{name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${program.status === 'live' ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-800'}`}>{statusLabel}</span>
              </div>
            </div>
          </div>
          <h1 className="mt-6 font-display text-[2.4rem] leading-[1.05] sm:text-5xl lg:text-[3.4rem] text-brand-950">{copy.heroTitle}</h1>
          <p className="mt-6 text-lg sm:text-xl text-surface-700 leading-relaxed max-w-[34rem]">{copy.heroBody}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#waitlist" className="btn-primary text-base px-6 py-3">
              {t('landing.joinWaitlist')} <ArrowRight size={18} />
            </a>
            <a href="#what-you-get" className="btn-secondary text-base px-6 py-3">{t('landing.heroSecondary')}</a>
          </div>
          <p className="mt-5 text-sm text-surface-500">
            <span className="font-mono text-surface-800">{t(`programs.${key}.price`)}</span> {t('site.perMonth')} · {t(`programs.${key}.priceNote`)}
          </p>
        </div>

        <WeekCard week={copy.week} tone={a.dark} />
      </section>

      {/* ── What you get ────────────────────────────────────────────────── */}
      <section id="what-you-get" className="scroll-mt-20 bg-surface-50 border-y border-surface-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24">
          <div className="max-w-[40rem]">
            <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{copy.whatTitle}</h2>
            <p className="mt-4 text-lg text-surface-700">{copy.whatBody}</p>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-10 sm:gap-8">
            {copy.groups.map((g) => (
              <div key={g.title}>
                <h3 className={`font-display text-xl text-brand-950 pb-3 border-b-2 ${a.rule}`}>{g.title}</h3>
                <dl className="divide-y divide-surface-200">
                  {g.items.map(([label, desc]) => (
                    <div key={label} className="py-4">
                      <dt className="font-semibold text-surface-900">{label}</dt>
                      <dd className="mt-1 text-[15px] leading-relaxed text-surface-600">{desc}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          <div className="mt-16 pt-8 border-t border-surface-200 flex flex-col lg:flex-row lg:items-baseline gap-4 lg:gap-10">
            <h3 className="font-display text-xl text-brand-950 shrink-0">{copy.madeForTitle}</h3>
            <ul className="flex flex-wrap gap-x-8 gap-y-2 text-surface-700">
              {copy.madeFor.map((m) => (
                <li key={m} className="flex items-center gap-2">
                  <Check size={16} className={`${a.text} shrink-0`} /> {m}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Price + waitlist ────────────────────────────────────────────── */}
      <section id="pricing" className="scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 lg:py-24 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16 items-start">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl text-brand-950 leading-tight">{t('site.pricingTitle')}</h2>
            <p className="mt-4 text-lg text-surface-700 max-w-[34rem]">{t('site.pricingBody')}</p>
            <div className={`mt-8 rounded-2xl ${a.dark} text-white p-6 sm:p-7 shadow-modal`}>
              <div className="text-white/60 text-sm">{name}</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-display text-5xl">{t(`programs.${key}.price`)}</span>
                <span className="text-white/70">{t('site.perMonth')}</span>
              </div>
              <div className="text-white/60 text-sm mt-1">{t(`programs.${key}.priceNote`)}</div>
              <ul className="mt-6 space-y-2.5">
                {t(`programs.${key}.includes`).map((line) => (
                  <li key={line} className="flex gap-3 text-[15px] leading-relaxed text-white/90">
                    <Check size={18} className="text-white/60 shrink-0 mt-0.5" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 pt-5 border-t border-white/15 text-sm text-white/60">{t('site.pricingNote')}</p>
            </div>
          </div>

          <div id="waitlist" className="scroll-mt-24">
            <WaitlistForm program={key} />
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
