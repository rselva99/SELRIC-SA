import { lazy, Suspense, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, Tag, Flag, Milk, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n/I18nContext';
import { useHerd } from './HerdContext';
import { useRegistrar } from './RegistrarSheet';
import {
  ChapaTag, EventIcon, eventSummary, fmtDate, SectionTitle, Card, Loading, LoadFailed,
  NeedsYouList, MilkBars, LotBar, GroupLegend, tcount,
} from './components';
import {
  isActive, todayISO, BREEDING_FEMALE, needsYou, todayMilk, milkSeries, topMilkers, lotComposition, formatNum,
} from './lib';

// Inicio: the herd at a glance, what is yours to do today, this morning's
// milk, the lots, and two charts (calvings by month, milk per cow). On a
// desktop also the last two weeks of milk, the best milkers and the latest
// events. The charts load after the rest: recharts is only in HerdCharts.

const HomeCharts = lazy(() => import('./HerdCharts'));

const FLAG_ICON = { por_confirmar: Flag, vender: Tag };

function LeadIcon({ icon: Icon }) {
  return (
    <span className="w-[30px] h-[34px] shrink-0 rounded-lg bg-finca-claySoft text-finca-clayText flex items-center justify-center" aria-hidden="true">
      <Icon size={17} />
    </span>
  );
}

export default function HomePage() {
  const { t, tn, locale } = useT();
  const { organization } = useAuth();
  const { animals, events, byId, eventsByAnimal, loading, error } = useHerd();
  const registrar = useRegistrar();
  const today = todayISO();

  const view = useMemo(() => {
    const active = animals.filter(isActive);
    const pregnant = active.filter((a) => BREEDING_FEMALE.has(a.category) && a.pregnant === true);
    return {
      active,
      pregnant,
      need: needsYou(animals, today, eventsByAnimal),
      milk: todayMilk(events, today),
      week: milkSeries(events, 7, today),
      fortnight: milkSeries(events, 14, today),
      top: topMilkers(events, 7, today, 3),
      lots: lotComposition(animals),
      recent: events.slice(0, 4),
      hasCows: active.some((a) => a.category === 'vaca'),
    };
  }, [animals, events, eventsByAnimal, today]);

  if (loading) return <Loading />;
  if (error) return <LoadFailed />;

  // The "Hoy te toca" rows, in the words of the notebook.
  const items = view.need.map((r) => {
    if (r.kind === 'overdue') {
      return {
        key: `o-${r.animal.id}`, to: `/ganaderia/animales/${r.animal.slug}`, lead: <ChapaTag animal={r.animal} size="sm" />,
        title: t('lv.need.overdueTitle', { name: r.animal.name }),
        sub: [tn('lv.need.daysAgo', r.days), r.animal.lot].filter(Boolean).join(' · '),
      };
    }
    if (r.kind === 'due') {
      return {
        key: `d-${r.animal.id}`, to: `/ganaderia/animales/${r.animal.slug}`, lead: <ChapaTag animal={r.animal} size="sm" />,
        title: r.days === 0 ? t('lv.need.dueToday', { name: r.animal.name }) : tcount(t, 'lv.need.dueIn', r.days, { name: r.animal.name }),
        sub: [fmtDate(r.date, locale, { weekday: 'short', day: 'numeric', month: 'short' }), r.animal.lot].filter(Boolean).join(' · '),
      };
    }
    if (r.kind === 'unchecked') {
      return {
        key: 'unchecked', to: '/ganaderia/animales?f=sin_palpar', lead: <LeadIcon icon={Stethoscope} />,
        title: tn('lv.need.unchecked', r.n), sub: t('lv.need.uncheckedSub'),
      };
    }
    return {
      key: `f-${r.flag}`, to: `/ganaderia/animales?flag=${r.flag}`, lead: <LeadIcon icon={FLAG_ICON[r.flag] || Flag} />,
      title: tn(`lv.need.flag.${r.flag}`, r.n), sub: t(`lv.need.flagSub.${r.flag}`),
    };
  });

  const weekTotal = view.week.reduce((s, d) => s + d.liters, 0);
  const fortnightTotal = view.fortnight.reduce((s, d) => s + d.liters, 0);
  const dateLine = fmtDate(today, locale, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="animate-rise space-y-7">
      {/* The forest band: where we are, and three numbers. */}
      <section className="-mx-4 sm:-mx-6 md:mx-0 -mt-4 md:mt-0 bg-finca-forest text-white px-4 sm:px-6 pt-6 pb-5 md:rounded-[18px] md:px-7">
        <div className="text-[13px] font-semibold uppercase tracking-wider text-finca-mist">{dateLine}</div>
        <h1 className="font-display text-[32px] md:text-[40px] leading-tight mt-1 truncate">{organization?.name || t('nav.lvHome')}</h1>
        <div className="grid grid-cols-3 gap-2 mt-4">
          {[
            [view.active.length, tn('lv.home.headCount', view.active.length), '/ganaderia/animales'],
            [view.pregnant.length, tn('lv.home.pregnantCount', view.pregnant.length), '/ganaderia/animales?f=prenadas'],
            [`${formatNum(view.milk.liters)} L`, t('lv.home.milkToday'), '/ganaderia/eventos?type=leche'],
          ].map(([value, label, to]) => (
            <Link key={to} to={to} className="block min-h-[64px] rounded-xl bg-white/[0.07] hover:bg-white/[0.12] px-3 py-2.5 transition-colors">
              <div className="font-display text-[28px] leading-none tabular-nums">{value}</div>
              <div className="text-[12px] text-finca-mist mt-1.5 leading-tight">{label}</div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-7 lg:gap-6">
        <div className="lg:col-span-2">
          <NeedsYouList items={items} />
        </div>

        {/* This morning's milk: tap to write it down. */}
        {view.hasCows && (
          <section aria-labelledby="lv-milk-today">
            <SectionTitle><span id="lv-milk-today">{t('lv.home.milkTitle')}</span></SectionTitle>
            <button type="button" onClick={() => registrar.open({ type: 'leche' })} data-testid="lv-milk-card"
              className="w-full text-left rounded-2xl bg-finca-surface border border-finca-line shadow-finca px-4 py-4 flex items-end gap-4 hover:border-finca-field transition-colors">
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-finca-lecheInk"><Milk size={16} aria-hidden="true" /> {t('lv.types.leche')}</span>
                <span className="block font-display text-[36px] leading-none mt-2 tabular-nums">{formatNum(view.milk.liters)} L</span>
                <span className="block text-[13px] text-finca-ink2 mt-1.5">
                  {view.milk.milkings ? tn('lv.home.milkings', view.milk.milkings) : t('lv.home.milkNone')}
                </span>
              </span>
              <MilkBars series={view.week} height={56} className="w-[112px] shrink-0"
                summary={t('lv.home.milkWeekSummary', { l: formatNum(weekTotal, 0) })} />
            </button>
          </section>
        )}
      </div>

      {/* Desktop: two weeks of milk and the best milkers. */}
      {view.hasCows && (
        <div className="hidden md:grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-[20px]">{t('lv.home.milk14')}</h2>
              <span className="text-[13px] text-finca-ink2 tabular-nums">{t('lv.home.milkTotal', { l: formatNum(fortnightTotal, 0) })}</span>
            </div>
            <MilkBars series={view.fortnight} height={132} labels valueOnLast className="mt-4"
              summary={t('lv.home.milk14Summary', { l: formatNum(fortnightTotal, 0), today: formatNum(view.milk.liters) })} />
          </Card>
          <Card className="px-5 py-4">
            <h2 className="font-display text-[20px]">{t('lv.home.topCows')}</h2>
            <p className="text-[13px] text-finca-ink2">{t('lv.home.topCowsSub')}</p>
            {view.top.length === 0 ? (
              <p className="text-[14px] text-finca-ink2 mt-4">{t('lv.home.milkNoneWeek')}</p>
            ) : (
              <ol className="mt-3 space-y-1">
                {view.top.map((m, i) => {
                  const a = byId[m.animal_id];
                  if (!a) return null;
                  return (
                    <li key={m.animal_id}>
                      <Link to={`/ganaderia/animales/${a.slug}`} className="flex items-center gap-3 min-h-[52px] -mx-2 px-2 rounded-xl hover:bg-finca-lineSoft">
                        <span className="w-4 text-[13px] font-semibold text-finca-ink2 tabular-nums">{i + 1}</span>
                        <ChapaTag animal={a} size="sm" />
                        <span className="flex-1 min-w-0 text-[15px] font-semibold truncate">{a.name}</span>
                        <span className="text-[15px] font-semibold tabular-nums text-finca-lecheInk">{formatNum(m.liters, 0)} L</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      )}

      {/* Lots */}
      <section aria-labelledby="lv-lots">
        <SectionTitle action={<Link to="/ganaderia/lotes" className="min-h-[44px] inline-flex items-center gap-1 text-[14px] font-semibold text-finca-green">{t('common.viewAll')} <ChevronRight size={16} aria-hidden="true" /></Link>}>
          <span id="lv-lots">{t('lv.home.lots')}</span>
        </SectionTitle>
        {view.lots.length === 0 ? (
          <p className="text-[14px] text-finca-ink2">{t('lv.home.noAnimals')}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {view.lots.slice(0, 9).map((l) => (
              <Link key={l.lot || '_'} to={`/ganaderia/animales?lote=${encodeURIComponent(l.lot || '_')}`}
                className="block min-w-0 rounded-2xl bg-finca-surface border border-finca-line shadow-finca px-3 py-3 md:px-4 hover:border-finca-field transition-colors">
                <div className="text-[13px] md:text-[14px] font-semibold text-finca-ink truncate">{l.lot || t('lv.noLot')}</div>
                <div className="font-display text-[28px] leading-none mt-1.5 tabular-nums">{l.total}</div>
                <LotBar groups={l.groups} total={l.total} className="mt-2.5" />
                <div className="text-[12px] text-finca-ink2 mt-1.5 truncate">{l.pregnant ? tn('lv.lots.pregnant', l.pregnant) : ' '}</div>
                <GroupLegend groups={l.groups} className="hidden md:flex mt-1" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* The herd in charts, with the way to all of Informes. */}
      {view.active.length > 0 && (
        <section aria-labelledby="lv-charts">
          <SectionTitle action={<Link to="/ganaderia/informes" className="min-h-[44px] inline-flex items-center gap-1 text-[14px] font-semibold text-finca-green">{t('lv.reports.seeAll')} <ChevronRight size={16} aria-hidden="true" /></Link>}>
            <span id="lv-charts">{t('lv.reports.homeTitle')}</span>
          </SectionTitle>
          <Suspense fallback={<div className="h-[300px] rounded-2xl bg-finca-lineSoft/60" aria-hidden="true" />}>
            <HomeCharts animals={animals} events={events} today={today} hasCows={view.hasCows} />
          </Suspense>
        </section>
      )}

      {/* Desktop: the latest events. */}
      <section className="hidden md:block" aria-labelledby="lv-recent">
        <SectionTitle action={<Link to="/ganaderia/eventos" className="min-h-[44px] inline-flex items-center gap-1 text-[14px] font-semibold text-finca-green">{t('common.viewAll')} <ChevronRight size={16} aria-hidden="true" /></Link>}>
          <span id="lv-recent">{t('lv.home.recent')}</span>
        </SectionTitle>
        <Card className="overflow-hidden">
          {view.recent.length === 0 ? (
            <p className="px-5 py-8 text-[14px] text-finca-ink2 text-center">{t('lv.events.empty')}</p>
          ) : (
            <table className="w-full text-[14px]">
              <thead className="bg-finca-lineSoft/60 text-finca-ink2">
                <tr>
                  <th scope="col" className="text-left font-semibold px-5 py-2.5">{t('lv.fields.date')}</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5">{t('lv.event.animal')}</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5">{t('lv.event.type')}</th>
                  <th scope="col" className="text-left font-semibold px-5 py-2.5">{t('lv.home.detail')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-finca-line">
                {view.recent.map((ev) => {
                  const a = byId[ev.animal_id];
                  return (
                    <tr key={ev.id}>
                      <td className="px-5 py-3 text-finca-ink2 tabular-nums whitespace-nowrap">{fmtDate(ev.date, locale, { day: 'numeric', month: 'short' })}</td>
                      <td className="px-3 py-3">
                        {a ? <Link to={`/ganaderia/animales/${a.slug}`} className="inline-flex items-center gap-2 font-semibold hover:underline"><ChapaTag animal={a} size="sm" /> {a.name}</Link> : '—'}
                      </td>
                      <td className="px-3 py-3"><span className="inline-flex items-center gap-2"><EventIcon type={ev.type} size="sm" /> {t(`lv.types.${ev.type}`)}</span></td>
                      <td className="px-5 py-3 text-finca-ink2 truncate max-w-[18rem]">{eventSummary(ev, t, byId) || ev.note || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </div>
  );
}
