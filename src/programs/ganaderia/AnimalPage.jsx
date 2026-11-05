import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronDown, MoreHorizontal, Pencil, Trash2, ClipboardList, Milk, Stethoscope } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { useRegistrar } from './RegistrarSheet';
import { ActionSheet } from './Sheet';
import {
  ChapaTag, BrandChip, StatusBadge, FlagChip, EventIcon, eventSummary, fmtDate, Kpi, Card, Loading, LoadFailed,
  PregnancyBar, tcount, btnClay, btnPaper,
} from './components';
import { ageParts, expectedCalving, daysBetween, todayISO, addDays, formatNum, isActive, BREEDING_FEMALE } from './lib';
import AnimalForm from './AnimalForm';

// La ficha: one animal — its mark, its pregnancy, three numbers, everything
// that happened to it, its family and notes. Registrar is one tap away: a
// sticky bar on the phone, two buttons at the top on a desktop.

function Fold({ title, hint, open, children }) {
  return (
    <details open={open} className="group rounded-2xl bg-finca-surface border border-finca-line shadow-finca">
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-3 min-h-[56px] px-4">
        <span className="flex-1 font-display text-[20px] text-finca-ink">{title}</span>
        {hint && <span className="text-[13px] text-finca-ink2">{hint}</span>}
        <ChevronDown size={18} className="text-finca-ink2 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export default function AnimalPage() {
  const { slug } = useParams();
  const { t, tn, locale } = useT();
  const navigate = useNavigate();
  const registrar = useRegistrar();
  const { bySlug, byId, animals, eventsByAnimal, loading, error, deleteAnimal, deleteEvent } = useHerd();
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [eventMenu, setEventMenu] = useState(null);
  const [confirmEvent, setConfirmEvent] = useState(null);
  const today = todayISO();

  const animal = bySlug[slug];
  const events = animal ? eventsByAnimal[animal.id] || [] : [];
  const dam = animal?.dam_id ? byId[animal.dam_id] : null;
  const sire = animal?.sire_id ? byId[animal.sire_id] : null;
  const offspring = useMemo(() => (animal ? animals.filter((a) => a.dam_id === animal.id || a.sire_id === animal.id).sort((x, y) => (y.birth_date || '').localeCompare(x.birth_date || '')) : []), [animals, animal]);
  const weights = useMemo(() => events.filter((e) => e.type === 'peso' && e.data?.kg != null).slice(0, 6).reverse(), [events]);
  const milk7 = useMemo(() => {
    const from = addDays(today, -6);
    const list = events.filter((e) => e.type === 'leche' && e.date >= from);
    return { liters: list.reduce((s, e) => s + (Number(e.data?.liters) || 0), 0), n: list.length };
  }, [events, today]);

  async function handleDeleteAnimal() {
    try {
      await deleteAnimal(animal.id);
      toast.success(t('lv.ficha.deleted', { name: animal.name }));
      navigate('/ganaderia/animales');
    } catch (err) {
      toast.error(err.message || t('lv.form.saveFailed'));
    }
  }

  async function handleDeleteEvent(ev) {
    try {
      await deleteEvent(ev.id);
      toast.success(t('lv.ficha.eventDeleted'));
    } catch (err) {
      toast.error(err.message || t('lv.form.saveFailed'));
    }
  }

  if (loading) return <Loading />;
  if (error) return <LoadFailed />;
  if (!animal) {
    return (
      <div className="animate-rise">
        <Link to="/ganaderia/animales" className="inline-flex items-center gap-1 min-h-[44px] text-[15px] font-semibold text-finca-green"><ChevronLeft size={18} /> {t('nav.lvAnimals')}</Link>
        <Card className="mt-3 p-8 text-center text-finca-ink2">{t('lv.ficha.notFound')}</Card>
      </div>
    );
  }

  const age = ageParts(animal.birth_date, today);
  const ageText = age ? (age.years ? t('lv.ageYM', { y: age.years, m: age.months }) : age.months ? t('lv.ageM', { m: age.months }) : t('lv.ageD', { d: age.days })) : null;
  const due = expectedCalving(animal);
  const dueDays = due ? daysBetween(today, due) : null;
  const breeding = animal.sex === 'H' && (BREEDING_FEMALE.has(animal.category) || animal.pregnant != null);
  const canMilk = isActive(animal) && animal.category === 'vaca';
  const lastCheck = [animal.preg_date, events.find((e) => e.type === 'palpacion')?.date].filter(Boolean).sort().pop() || null;
  const backTo = animal.lot ? `/ganaderia/animales?lote=${encodeURIComponent(animal.lot)}` : '/ganaderia/animales';
  const hasFamily = !!(dam || sire || animal.dam_name || animal.sire_name || offspring.length);
  const hasNotes = !!(animal.notes?.length || animal.brand_note);

  const recordAny = () => registrar.open({ animalIds: [animal.id] });
  const recordMilk = () => registrar.open({ type: 'leche', animalIds: [animal.id] });

  return (
    <div className="animate-rise">
      {/* Hero */}
      <section className="-mx-4 sm:-mx-6 md:mx-0 -mt-4 md:mt-0 bg-finca-forest text-white px-4 sm:px-6 md:px-7 pt-2 md:pt-4 pb-5 md:rounded-[18px]">
        <div className="flex items-center justify-between gap-2">
          <Link to={backTo} className="inline-flex items-center gap-1 min-h-[44px] -ml-1.5 pr-2 text-[15px] font-semibold text-finca-mist hover:text-white min-w-0">
            <ChevronLeft size={20} className="shrink-0" aria-hidden="true" /> <span className="truncate">{animal.lot || t('nav.lvAnimals')}</span>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            {isActive(animal) && <button type="button" onClick={recordAny} className={cn(btnClay, 'hidden md:inline-flex min-h-[44px]')}><ClipboardList size={18} /> {t('lv.ficha.recordAny')}</button>}
            {canMilk && <button type="button" onClick={recordMilk} className="hidden md:inline-flex items-center gap-2 min-h-[44px] px-4 rounded-[14px] bg-white/10 hover:bg-white/15 text-[15px] font-semibold"><Milk size={18} /> {t('lv.ficha.milkToday')}</button>}
            <button type="button" onClick={() => setMenuOpen(true)} className="w-11 h-11 rounded-xl bg-white/10 hover:bg-white/15 flex items-center justify-center" aria-label={t('lv.ficha.moreActions')} data-testid="lv-ficha-menu">
              <MoreHorizontal size={22} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 mt-2">
          <ChapaTag animal={animal} size="lg" />
          <div className="min-w-0">
            <h1 className="font-display text-[32px] md:text-[40px] leading-tight truncate">{animal.name}</h1>
            <div className="text-[14px] text-finca-mist">
              {[t(`lv.category.${animal.category}`), ageText, animal.breed].filter(Boolean).join(' · ')}
            </div>
            {animal.aliases?.length > 0 && <div className="text-[13px] text-finca-mist truncate">{t('lv.ficha.aka', { names: animal.aliases.join(', ') })}</div>}
          </div>
        </div>
        {(animal.flags?.length > 0 || !isActive(animal) || animal.brand) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {!isActive(animal) && <StatusBadge status={animal.status} />}
            <BrandChip brand={animal.brand} />
            {animal.flags?.map((f) => <FlagChip key={f} flag={f} />)}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Pregnancy */}
          {breeding && (
            <Card className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-[20px]">{t('lv.fields.pregnancy')}</h2>
                {lastCheck && <span className="text-[13px] text-finca-ink2">{t('lv.ficha.checkedOn', { date: fmtDate(lastCheck, locale) })}</span>}
              </div>
              {animal.pregnant === true ? (
                <>
                  <PregnancyBar animal={animal} today={today} size="md" className="mt-3" />
                  {due && (
                    <p className={cn('text-[15px] mt-2', dueDays < 0 ? 'text-finca-clayText font-semibold' : 'text-finca-ink')}>
                      {dueDays < 0 ? tcount(t, 'lv.ficha.overdue', -dueDays, { date: fmtDate(due, locale, { day: 'numeric', month: 'long' }) })
                        : dueDays === 0 ? t('lv.ficha.dueToday')
                        : tcount(t, 'lv.ficha.dueIn', dueDays, { date: fmtDate(due, locale, { day: 'numeric', month: 'long' }) })}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
                  <div>
                    <div className="font-display text-[26px] leading-tight">{animal.pregnant === false ? t('lv.notPregnant') : t('lv.ficha.notChecked')}</div>
                    <div className="text-[13px] text-finca-ink2">{lastCheck ? tn('lv.ficha.daysSinceCheck', daysBetween(lastCheck, today)) : t('lv.ficha.neverChecked')}</div>
                  </div>
                  {isActive(animal) && (
                    <button type="button" onClick={() => registrar.open({ type: 'palpacion', animalIds: [animal.id] })} className={btnPaper}>
                      <Stethoscope size={18} /> {t('lv.ficha.recordCheck')}
                    </button>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Three numbers */}
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {animal.sex === 'H'
              ? <Kpi label={t('lv.fields.calvings')} value={animal.calvings || 0} />
              : <Kpi label={t('lv.ficha.offspring')} value={offspring.length} />}
            <Kpi label={t('lv.ficha.lastWeight')} value={animal.last_weight_kg != null ? `${formatNum(animal.last_weight_kg, 0)} kg` : '—'}
              sub={animal.last_weight_date ? fmtDate(animal.last_weight_date, locale, { day: 'numeric', month: 'short' }) : null} />
            {canMilk
              ? <Kpi label={t('lv.ficha.milk7')} value={`${formatNum(milk7.liters, 0)} L`} sub={milk7.n ? tn('lv.events.milkings', milk7.n) : null} />
              : <Kpi label={t('lv.ficha.age')} value={ageText || '—'} sub={animal.birth_date ? fmtDate(animal.birth_date, locale) : null} />}
          </div>

          {/* Timeline */}
          <Card className="overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2">
              <h2 className="font-display text-[20px]">{t('lv.ficha.timeline')}</h2>
              <span className="text-[13px] text-finca-ink2">{tn('lv.ficha.eventsCount', events.length)}</span>
            </div>
            {events.length === 0 ? (
              <p className="px-4 pb-8 pt-4 text-[14px] text-finca-ink2 text-center">{t('lv.ficha.noEvents')}</p>
            ) : (
              <ol className="relative pb-2">
                <span className="absolute left-[33px] top-2 bottom-4 w-[2px] bg-finca-line" aria-hidden="true" />
                {events.map((ev) => {
                  const summary = eventSummary(ev, t, byId);
                  const calf = ev.type === 'parto' && ev.data?.calf_id ? byId[ev.data.calf_id] : null;
                  return (
                    <li key={ev.id} className="relative flex items-start gap-3 pl-4 pr-1 py-2.5" data-testid="lv-timeline-row">
                      <EventIcon type={ev.type} className="relative ring-4 ring-finca-surface" />
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-[15px] font-semibold">{t(`lv.types.${ev.type}`)}</span>
                          <span className="text-[13px] text-finca-ink2 tabular-nums">{fmtDate(ev.date, locale)}</span>
                          {ev.data?.date_estimated && <span className="text-[12px] text-finca-ink2">({t('lv.ficha.estimated')})</span>}
                        </div>
                        {summary && (
                          <div className="text-[14px] text-finca-ink mt-0.5">
                            {calf ? <Link to={`/ganaderia/animales/${calf.slug}`} className="underline underline-offset-2">{summary}</Link> : summary}
                          </div>
                        )}
                        {ev.note && <div className="text-[14px] text-finca-ink2 mt-0.5 whitespace-pre-line">{ev.note}</div>}
                        {ev.source && ev.origin !== 'app' && <div className="text-[12px] text-finca-ink2 mt-0.5 font-mono truncate" title={ev.source}>{t('lv.ficha.source')}: {ev.source}</div>}
                      </div>
                      <button type="button" onClick={() => setEventMenu(ev)} className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-finca-ink2 hover:bg-finca-lineSoft hover:text-finca-ink"
                        aria-label={t('lv.ficha.eventActions', { type: t(`lv.types.${ev.type}`), date: fmtDate(ev.date, locale) })} data-testid="lv-event-menu">
                        <MoreHorizontal size={20} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Fold title={t('lv.ficha.family')} hint={hasFamily ? (offspring.length ? tn('lv.ficha.offspringCount', offspring.length) : null) : t('lv.ficha.noData')} open={hasFamily}>
            <dl className="space-y-2.5 text-[15px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-finca-ink2">{t('lv.fields.dam')}</dt>
                <dd className="font-semibold text-right truncate">
                  {dam ? <Link to={`/ganaderia/animales/${dam.slug}`} className="text-finca-green underline underline-offset-2">{dam.name}</Link> : animal.dam_name || <span className="text-finca-ink2 font-normal">{t('lv.form.unknown')}</span>}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-finca-ink2">{t('lv.fields.sire')}</dt>
                <dd className="font-semibold text-right truncate">
                  {sire ? <Link to={`/ganaderia/animales/${sire.slug}`} className="text-finca-green underline underline-offset-2">{sire.name}</Link> : animal.sire_name || <span className="text-finca-ink2 font-normal">{t('lv.form.unknown')}</span>}
                </dd>
              </div>
            </dl>
            {offspring.length > 0 && (
              <ul className="mt-3 space-y-1">
                {offspring.map((c) => (
                  <li key={c.id}>
                    <Link to={`/ganaderia/animales/${c.slug}`} className="flex items-center gap-3 min-h-[52px] -mx-2 px-2 rounded-xl hover:bg-finca-lineSoft">
                      <ChapaTag animal={c} size="sm" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold truncate">{c.name}</span>
                        <span className="block text-[13px] text-finca-ink2 truncate">{[t(`lv.category.${c.category}`), c.birth_date ? fmtDate(c.birth_date, locale) : null, !isActive(c) ? t(`lv.status.${c.status}`) : null].filter(Boolean).join(' · ')}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Fold>

          <Fold title={t('lv.fields.notes')} hint={hasNotes ? null : t('lv.ficha.noNotes')} open={hasNotes}>
            {animal.notes?.length ? (
              <ul className="space-y-2">
                {animal.notes.map((n, i) => <li key={i} className="text-[15px] text-finca-ink pl-3 border-l-2 border-finca-line">{n}</li>)}
              </ul>
            ) : (
              <button type="button" onClick={() => setEditOpen(true)} className="min-h-[44px] text-[14px] font-semibold text-finca-green underline underline-offset-2">{t('lv.ficha.addNotes')}</button>
            )}
            {animal.brand_note && <p className="text-[13px] text-finca-ink2 mt-3">{t('lv.fields.brand')}: {animal.brand_note}</p>}
          </Fold>

          {weights.length > 1 && (
            <Card className="px-4 py-4">
              <h2 className="font-display text-[20px]">{t('lv.ficha.weights')}</h2>
              <div className="mt-3 flex items-end gap-1.5 h-24">
                {weights.map((w) => {
                  const max = Math.max(...weights.map((x) => Number(x.data.kg)));
                  return (
                    <div key={w.id} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${fmtDate(w.date, locale)} · ${formatNum(w.data.kg)} kg`}>
                      <div className="text-[11px] text-finca-ink2 tabular-nums">{formatNum(w.data.kg, 0)}</div>
                      <div className="w-full rounded-t-[4px] bg-finca-straw" style={{ height: `${Math.max(8, (Number(w.data.kg) / max) * 64)}px` }} />
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {animal.origin && animal.origin !== 'app' && <p className="text-[12px] text-finca-ink2 px-1">{t('lv.ficha.origin', { origin: animal.origin })}</p>}
        </div>
      </div>

      {/* Phone: Registrar stays under the thumb. */}
      {isActive(animal) && (
        <div className="md:hidden sticky bottom-above-nav z-10 mt-5 flex gap-2 p-2 rounded-2xl bg-finca-surface border border-finca-line shadow-modal">
          <button type="button" onClick={recordAny} className={cn(btnClay, 'flex-1 min-w-0 px-4 whitespace-nowrap')} data-testid="lv-ficha-record"><ClipboardList size={18} className="shrink-0" /> {t('lv.ficha.recordAny')}</button>
          {canMilk && <button type="button" onClick={recordMilk} className={cn(btnPaper, 'shrink-0 px-4 whitespace-nowrap')}><Milk size={18} className="shrink-0" /> {t('lv.ficha.milkToday')}</button>}
        </div>
      )}

      <AnimalForm open={editOpen} onClose={() => setEditOpen(false)} animal={animal}
        onSaved={(saved) => { if (saved?.slug && saved.slug !== slug) navigate(`/ganaderia/animales/${saved.slug}`, { replace: true }); }} />

      <ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} title={animal.name}
        actions={[
          { key: 'edit', label: t('lv.ficha.edit'), icon: Pencil, onClick: () => setEditOpen(true), autoFocus: true },
          { key: 'delete', label: t('lv.ficha.deleteAnimal'), icon: Trash2, danger: true, onClick: () => setConfirmDelete(true) },
        ]} />

      <ActionSheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('lv.ficha.deleteAnimal')}
        subtitle={t('lv.ficha.deleteBody', { name: animal.name, n: events.length })}
        actions={[{ key: 'yes', label: t('tx.delete'), icon: Trash2, danger: true, onClick: handleDeleteAnimal }]}>
        {isActive(animal) && <p className="text-[13px] text-finca-ink2">{t('lv.ficha.deleteHint')}</p>}
      </ActionSheet>

      <ActionSheet open={!!eventMenu} onClose={() => setEventMenu(null)}
        title={eventMenu ? t(`lv.types.${eventMenu.type}`) : ''} subtitle={eventMenu ? fmtDate(eventMenu.date, locale) : ''}
        actions={[{ key: 'delete', label: t('lv.ficha.deleteEvent'), icon: Trash2, danger: true, onClick: () => setConfirmEvent(eventMenu) }]} />

      <ActionSheet open={!!confirmEvent} onClose={() => setConfirmEvent(null)} title={t('lv.ficha.deleteEventTitle')}
        subtitle={t('lv.ficha.deleteEventBody')}
        actions={[{ key: 'yes', label: t('tx.delete'), icon: Trash2, danger: true, onClick: () => handleDeleteEvent(confirmEvent) }]} />
    </div>
  );
}
