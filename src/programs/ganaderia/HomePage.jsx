import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ClipboardList, ChevronRight, AlertTriangle, CalendarClock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useT } from '../../i18n/I18nContext';
import Spinner from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { Kpi, AnimalAvatar, EventIcon, eventSummary, fmtDate, SectionTitle } from './components';
import { isActive, expectedCalving, daysBetween, todayISO, BREEDING_FEMALE, addDays } from './lib';
import EventForm from './EventForm';
import AnimalForm from './AnimalForm';

// Inicio: the head count, who is due, what needs a hand, what happened last.

export default function HomePage() {
  const { t, locale } = useT();
  const { organization } = useAuth();
  const { animals, events, byId, loading, error } = useHerd();
  const [eventOpen, setEventOpen] = useState(false);
  const [animalOpen, setAnimalOpen] = useState(false);
  const today = todayISO();

  const view = useMemo(() => {
    const active = animals.filter(isActive);
    const count = (cat) => active.filter((a) => a.category === cat).length;
    const females = active.filter((a) => BREEDING_FEMALE.has(a.category));
    const pregnant = females.filter((a) => a.pregnant === true);
    const unchecked = females.filter((a) => a.pregnant == null);
    const yearAgo = addDays(today, -365);
    const monthStart = today.slice(0, 7) + '-01';
    const calvings = events.filter((e) => e.type === 'parto' && e.date >= yearAgo);
    const calvingsThisMonth = calvings.filter((e) => e.date >= monthStart).length;

    const due = pregnant
      .map((a) => ({ a, due: expectedCalving(a) }))
      .filter((x) => x.due)
      .map((x) => ({ ...x, days: daysBetween(today, x.due) }))
      .sort((x, y) => x.days - y.days);

    // One line per animal: an overdue calving outranks a flag.
    const reasons = new Map();
    for (const d of due) if (d.days < -14) reasons.set(d.a.id, { a: d.a, key: 'overdue', days: -d.days });
    for (const a of active) {
      if (reasons.has(a.id)) continue;
      if (a.flags?.includes('vender')) reasons.set(a.id, { a, key: 'sell' });
      else if (a.flags?.includes('mala_madre')) reasons.set(a.id, { a, key: 'badMother' });
    }
    const attention = [...reasons.values()];
    const toConfirm = active.filter((a) => a.flags?.includes('por_confirmar'));

    const lotMap = {};
    for (const a of active) {
      const k = a.lot || '';
      (lotMap[k] ||= { lot: k, total: 0, cats: {} });
      lotMap[k].total += 1;
      lotMap[k].cats[a.category] = (lotMap[k].cats[a.category] || 0) + 1;
    }
    const lots = Object.values(lotMap).sort((x, y) => y.total - x.total);

    return {
      active, count, females, pregnant, unchecked, calvings, calvingsThisMonth, due,
      attention: attention.slice(0, 8), toConfirm, lots, recent: events.slice(0, 8),
      bulls: active.filter((a) => a.sex === 'M' && !['ternero', 'lechon', 'engorde'].includes(a.category)).length,
    };
  }, [animals, events, today]);

  if (loading) {
    return <div className="flex items-center gap-3 text-surface-500 text-sm"><Spinner size="sm" /> {t('common.loading')}</div>;
  }
  if (error) {
    return <div className="card p-6 text-sm text-red-700">{t('lv.loadFailed')}</div>;
  }

  const herdLine = [
    [view.count('vaca'), 'vaca'],
    [view.count('ternera'), 'ternera'],
    [view.count('ternero'), 'ternero'],
    [view.bulls, 'toro'],
  ].filter(([n]) => n > 0).map(([n, c]) => `${n} ${t(`lv.categoryPlural.${c}`).toLowerCase()}`).join(' · ');

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ranch-700">{t('programs.ganaderia.name')}</div>
          <h1 className="page-title mt-1">{organization?.name || t('nav.lvHome')}</h1>
          <p className="text-surface-500 text-sm mt-1">{t('lv.home.sub', { date: fmtDate(today, locale, { weekday: 'long', day: 'numeric', month: 'long' }) })}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAnimalOpen(true)} className="btn-secondary"><Plus size={16} /> {t('lv.newAnimal')}</button>
          <button type="button" onClick={() => setEventOpen(true)} className="btn-primary"><ClipboardList size={16} /> {t('lv.recordEvent')}</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <Kpi label={t('lv.home.head')} value={view.active.length} sub={herdLine} to="/ganaderia/animales" />
        <Kpi label={t('lv.home.pregnantKpi')} value={view.pregnant.length} sub={view.unchecked.length ? t('lv.home.unchecked', { n: view.unchecked.length }) : t('lv.home.ofFemales', { n: view.females.length })} tone="blue" to="/ganaderia/animales?preg=1" />
        <Kpi label={t('lv.home.calvings12')} value={view.calvings.length} sub={t('lv.home.thisMonth', { n: view.calvingsThisMonth })} tone="ranch" to="/ganaderia/eventos?type=parto" />
        <Kpi label={t('lv.home.attention')} value={view.attention.length + view.toConfirm.length} sub={view.toConfirm.length ? t('lv.home.toConfirm', { n: view.toConfirm.length }) : t('lv.home.allGood')} tone={view.attention.length ? 'amber' : 'muted'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        {/* Due */}
        <section className="card lg:col-span-2">
          <div className="px-5 pt-4 pb-3 border-b border-surface-200 flex items-center justify-between gap-3">
            <h2 className="section-title flex items-center gap-2"><CalendarClock size={18} className="text-ranch-700" /> {t('lv.home.dueTitle')}</h2>
            <span className="text-xs text-surface-500">{t('lv.home.dueNote')}</span>
          </div>
          {view.due.length === 0 ? (
            <p className="px-5 py-8 text-sm text-surface-500 text-center">{t('lv.home.dueEmpty')}</p>
          ) : (
            <ul className="divide-y divide-surface-100">
              {view.due.slice(0, 8).map(({ a, due, days }) => (
                <li key={a.id}>
                  <Link to={`/ganaderia/animales/${a.slug}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-50">
                    <AnimalAvatar animal={a} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-surface-500">{a.lot || '—'} · {t('lv.monthsPregnant', { n: a.preg_months ?? '?' })}{a.preg_date ? ` · ${t('lv.checkedOn', { date: fmtDate(a.preg_date, locale) })}` : ''}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn('text-sm font-medium tabular-nums', days < 0 ? 'text-amber-700' : days <= 14 ? 'text-ranch-700' : 'text-surface-700')}>
                        {days < 0 ? t('lv.home.overdueBy', { n: -days }) : days === 0 ? t('lv.home.dueToday') : t('lv.home.inDays', { n: days })}
                      </div>
                      <div className="text-xs text-surface-500">{fmtDate(due, locale)}</div>
                    </div>
                    <ChevronRight size={16} className="text-surface-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Attention */}
        <section className="card">
          <div className="px-5 pt-4 pb-3 border-b border-surface-200">
            <h2 className="section-title flex items-center gap-2"><AlertTriangle size={18} className="text-amber-600" /> {t('lv.home.attention')}</h2>
          </div>
          {view.attention.length === 0 && view.toConfirm.length === 0 ? (
            <p className="px-5 py-8 text-sm text-surface-500 text-center">{t('lv.home.allGood')}</p>
          ) : (
            <ul className="divide-y divide-surface-100">
              {view.attention.map(({ a, key, days }) => (
                <li key={a.id + key}>
                  <Link to={`/ganaderia/animales/${a.slug}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-50">
                    <AnimalAvatar animal={a} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-surface-500 truncate">{t(`lv.home.reasons.${key}`, { n: days })}</div>
                    </div>
                  </Link>
                </li>
              ))}
              {view.toConfirm.length > 0 && (
                <li>
                  <Link to="/ganaderia/animales?flag=por_confirmar" className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-50 text-sm text-surface-700">
                    <span className="w-8 h-8 shrink-0 rounded-lg bg-surface-100 text-surface-600 flex items-center justify-center text-xs font-bold">{view.toConfirm.length}</span>
                    <span className="flex-1">{t('lv.home.toConfirmLine', { n: view.toConfirm.length })}</span>
                    <ChevronRight size={16} className="text-surface-300" />
                  </Link>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        {/* Lots */}
        <section>
          <SectionTitle>{t('lv.home.lots')}</SectionTitle>
          <div className="space-y-2">
            {view.lots.map((l) => (
              <Link key={l.lot || '_'} to={`/ganaderia/animales?lot=${encodeURIComponent(l.lot)}`} className="card-hover flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{l.lot || t('lv.noLot')}</div>
                  <div className="text-xs text-surface-500 truncate">
                    {Object.entries(l.cats).sort((x, y) => y[1] - x[1]).map(([c, n]) => `${n} ${t(`lv.categoryPlural.${c}`).toLowerCase()}`).join(' · ')}
                  </div>
                </div>
                <div className="font-display text-xl tabular-nums">{l.total}</div>
              </Link>
            ))}
            {view.lots.length === 0 && <p className="text-sm text-surface-500">{t('lv.home.noAnimals')}</p>}
          </div>
        </section>

        {/* Recent */}
        <section className="lg:col-span-2">
          <SectionTitle action={<Link to="/ganaderia/eventos" className="text-sm text-brand-700 font-medium hover:underline">{t('common.viewAll')}</Link>}>{t('lv.home.recent')}</SectionTitle>
          <div className="card divide-y divide-surface-100">
            {view.recent.length === 0 && <p className="px-5 py-8 text-sm text-surface-500 text-center">{t('lv.events.empty')}</p>}
            {view.recent.map((ev) => {
              const a = byId[ev.animal_id];
              return (
                <Link key={ev.id} to={a ? `/ganaderia/animales/${a.slug}` : '/ganaderia/eventos'} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-50">
                  <EventIcon type={ev.type} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate"><span className="font-medium">{a?.name || '—'}</span> <span className="text-surface-500">· {t(`lv.types.${ev.type}`)}</span></div>
                    <div className="text-xs text-surface-500 truncate">{eventSummary(ev, t, byId) || ev.note || ev.source}</div>
                  </div>
                  <div className="text-xs text-surface-500 tabular-nums shrink-0">{fmtDate(ev.date, locale)}</div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <EventForm open={eventOpen} onClose={() => setEventOpen(false)} />
      <AnimalForm open={animalOpen} onClose={() => setAnimalOpen(false)} />
    </div>
  );
}
