import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Pencil, Trash2, ClipboardList, ChevronRight } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import Spinner from '../../components/ui/Spinner';
import Modal from '../../components/ui/Modal';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { AnimalAvatar, BrandChip, StatusBadge, FlagChip, EventIcon, eventSummary, fmtDate } from './components';
import { ageParts, expectedCalving, daysBetween, todayISO, formatNum } from './lib';
import AnimalForm from './AnimalForm';
import EventForm from './EventForm';

// La ficha: one animal, everything about it — marks, state, family, timeline.

function Fact({ label, children, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">{label}</div>
      <div className="text-sm text-surface-900 mt-0.5 truncate">{children ?? '—'}</div>
    </div>
  );
}

export default function AnimalPage() {
  const { slug } = useParams();
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { bySlug, byId, animals, eventsByAnimal, loading, error, deleteAnimal, deleteEvent } = useHerd();
  const [editOpen, setEditOpen] = useState(false);
  const [eventType, setEventType] = useState(undefined);   // undefined = closed, null = open with no type
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEvent, setConfirmEvent] = useState(null);
  const [busy, setBusy] = useState(false);
  const today = todayISO();

  const animal = bySlug[slug];
  const events = animal ? eventsByAnimal[animal.id] || [] : [];
  const dam = animal?.dam_id ? byId[animal.dam_id] : null;
  const sire = animal?.sire_id ? byId[animal.sire_id] : null;
  const offspring = useMemo(() => animal ? animals.filter((a) => a.dam_id === animal.id || a.sire_id === animal.id).sort((x, y) => (y.birth_date || '').localeCompare(x.birth_date || '')) : [], [animals, animal]);
  const age = animal ? ageParts(animal.birth_date, today) : null;
  const due = animal ? expectedCalving(animal) : null;
  const dueDays = due ? daysBetween(today, due) : null;
  const weights = useMemo(() => events.filter((e) => e.type === 'peso' && e.data?.kg != null).slice(0, 6).reverse(), [events]);

  async function handleDeleteAnimal() {
    setBusy(true);
    try {
      await deleteAnimal(animal.id);
      toast.success(t('lv.ficha.deleted', { name: animal.name }));
      navigate('/ganaderia/animales');
    } catch (err) {
      toast.error(err.message || t('lv.form.saveFailed'));
      setBusy(false);
    }
  }

  async function handleDeleteEvent() {
    const ev = confirmEvent;
    setBusy(true);
    try {
      await deleteEvent(ev.id);
      toast.success(t('lv.ficha.eventDeleted'));
      setConfirmEvent(null);
    } catch (err) {
      toast.error(err.message || t('lv.form.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex items-center gap-3 text-surface-500 text-sm"><Spinner size="sm" /> {t('common.loading')}</div>;
  if (error) return <div className="card p-6 text-sm text-red-700">{t('lv.loadFailed')}</div>;
  if (!animal) {
    return (
      <div className="animate-fade-in">
        <Link to="/ganaderia/animales" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-800"><ArrowLeft size={15} /> {t('nav.lvAnimals')}</Link>
        <div className="card mt-4 p-8 text-center text-surface-500">{t('lv.ficha.notFound')}</div>
      </div>
    );
  }

  const ageText = age ? (age.years ? t('lv.ageYM', { y: age.years, m: age.months }) : age.months ? t('lv.ageM', { m: age.months }) : t('lv.ageD', { d: age.days })) : null;

  return (
    <div className="animate-fade-in">
      <Link to="/ganaderia/animales" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-800"><ArrowLeft size={15} /> {t('nav.lvAnimals')}</Link>

      {/* Header */}
      <div className="mt-3 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <AnimalAvatar animal={animal} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title truncate">{animal.name}</h1>
              <BrandChip brand={animal.brand} />
              <StatusBadge status={animal.status} />
            </div>
            <div className="text-sm text-surface-500 mt-1">
              {t(`lv.category.${animal.category}`)} · {t(`lv.sex.${animal.sex}`)}{animal.lot ? ` · ${animal.lot}` : ''}{animal.tag ? ` · ${t('lv.fields.tag')} ${animal.tag}` : ''}
              {animal.aliases?.length ? <span> · {t('lv.ficha.aka', { names: animal.aliases.join(', ') })}</span> : null}
            </div>
            {animal.flags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">{animal.flags.map((f) => <FlagChip key={f} flag={f} />)}</div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button type="button" onClick={() => setEditOpen(true)} className="btn-secondary"><Pencil size={15} /> {t('lv.ficha.edit')}</button>
          <button type="button" onClick={() => setEventType(null)} className="btn-primary"><ClipboardList size={16} /> {t('lv.recordEvent')}</button>
        </div>
      </div>

      {/* Facts */}
      <div className="card mt-5 px-5 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {animal.sex === 'H' && <Fact label={t('lv.fields.calvings')}>{animal.calvings || 0}</Fact>}
        {animal.sex === 'H' && (
          <Fact label={t('lv.fields.pregnancy')}>
            {animal.pregnant === true
              ? <span className="text-blue-700 font-medium">{animal.preg_months != null ? t('lv.monthsPregnant', { n: formatNum(animal.preg_months) }) : t('lv.pregnant')}</span>
              : animal.pregnant === false ? t('lv.notPregnant') : t('lv.ficha.notChecked')}
          </Fact>
        )}
        {animal.sex === 'H' && animal.pregnant === true && (
          <Fact label={t('lv.ficha.dueDate')}>
            {due ? <span className={cn('font-medium', dueDays < 0 ? 'text-amber-700' : 'text-surface-900')}>{fmtDate(due, locale)}{dueDays != null && <span className="text-xs text-surface-500 font-normal"> · {dueDays < 0 ? t('lv.home.overdueBy', { n: -dueDays }) : t('lv.home.inDays', { n: dueDays })}</span>}</span> : '—'}
          </Fact>
        )}
        <Fact label={t('lv.ficha.lastWeight')}>
          {animal.last_weight_kg != null ? <>{formatNum(animal.last_weight_kg)} kg{animal.last_weight_date && <span className="text-xs text-surface-500"> · {fmtDate(animal.last_weight_date, locale)}</span>}</> : null}
        </Fact>
        <Fact label={t('lv.fields.birthDate')}>
          {animal.birth_date ? <>{fmtDate(animal.birth_date, locale)}{ageText && <span className="text-xs text-surface-500"> · {ageText}</span>}</> : null}
        </Fact>
        <Fact label={t('lv.fields.breed')}>{animal.breed || null}</Fact>
        {animal.sex === 'M' && <Fact label={t('lv.ficha.offspring')}>{offspring.length}</Fact>}
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mt-6">
        {/* Timeline */}
        <section className="lg:col-span-2 card">
          <div className="px-5 pt-4 pb-3 border-b border-surface-200 flex items-center justify-between">
            <h2 className="section-title">{t('lv.ficha.timeline')}</h2>
            <span className="text-xs text-surface-500">{t('lv.ficha.eventsCount', { n: events.length })}</span>
          </div>
          {events.length === 0 ? (
            <p className="px-5 py-10 text-sm text-surface-500 text-center">{t('lv.ficha.noEvents')}</p>
          ) : (
            <ul className="divide-y divide-surface-100">
              {events.map((ev) => {
                const summary = eventSummary(ev, t, byId);
                const calf = ev.type === 'parto' && ev.data?.calf_id ? byId[ev.data.calf_id] : null;
                return (
                  <li key={ev.id} className="group flex items-start gap-3 px-5 py-3">
                    <EventIcon type={ev.type} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-medium">{t(`lv.types.${ev.type}`)}</span>
                        <span className="text-xs text-surface-500 tabular-nums">{fmtDate(ev.date, locale)}</span>
                        {ev.data?.date_estimated && <span className="text-[11px] text-surface-400">({t('lv.ficha.estimated')})</span>}
                      </div>
                      {summary && (
                        <div className="text-sm text-surface-700 mt-0.5">
                          {calf ? <Link to={`/ganaderia/animales/${calf.slug}`} className="hover:underline">{summary}</Link> : summary}
                        </div>
                      )}
                      {ev.note && <div className="text-sm text-surface-600 mt-0.5 whitespace-pre-line">{ev.note}</div>}
                      {ev.source && ev.origin !== 'app' && <div className="text-[11px] text-surface-400 mt-0.5 font-mono truncate" title={ev.source}>{t('lv.ficha.source')}: {ev.source}</div>}
                    </div>
                    {confirmEvent?.id === ev.id ? (
                      <span className="inline-flex items-center gap-1.5 text-xs shrink-0">
                        <span className="text-surface-600">{t('lv.ficha.deleteEventConfirm')}</span>
                        <button type="button" disabled={busy} onClick={handleDeleteEvent} className="rounded px-2 py-1 bg-red-600 text-white hover:bg-red-700">{t('tx.yes')}</button>
                        <button type="button" onClick={() => setConfirmEvent(null)} className="rounded px-2 py-1 bg-surface-100 text-surface-700 hover:bg-surface-200">{t('tx.no')}</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmEvent(ev)} className="p-1.5 rounded text-surface-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0" aria-label={t('tx.delete')}><Trash2 size={15} /></button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* Family */}
          <section className="card px-5 py-4">
            <h2 className="section-title">{t('lv.ficha.family')}</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-surface-500">{t('lv.fields.dam')}</dt>
                <dd className="font-medium text-right truncate">
                  {dam ? <Link to={`/ganaderia/animales/${dam.slug}`} className="text-brand-700 hover:underline">{dam.name}</Link> : animal.dam_name || <span className="text-surface-400">{t('lv.form.unknown')}</span>}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-surface-500">{t('lv.fields.sire')}</dt>
                <dd className="font-medium text-right truncate">
                  {sire ? <Link to={`/ganaderia/animales/${sire.slug}`} className="text-brand-700 hover:underline">{sire.name}</Link> : animal.sire_name || <span className="text-surface-400">{t('lv.form.unknown')}</span>}
                </dd>
              </div>
            </dl>
            {offspring.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 mt-4 mb-1.5">{t('lv.ficha.offspring')} · {offspring.length}</div>
                <ul className="divide-y divide-surface-100 -mx-2">
                  {offspring.map((c) => (
                    <li key={c.id}>
                      <Link to={`/ganaderia/animales/${c.slug}`} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-50">
                        <AnimalAvatar animal={c} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm truncate">{c.name}</span>
                          <span className="block text-xs text-surface-500">{t(`lv.category.${c.category}`)}{c.birth_date ? ` · ${fmtDate(c.birth_date, locale)}` : ''}{c.status !== 'activo' ? ` · ${t(`lv.status.${c.status}`)}` : ''}</span>
                        </span>
                        <ChevronRight size={14} className="text-surface-300" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Weights */}
          {weights.length > 1 && (
            <section className="card px-5 py-4">
              <h2 className="section-title">{t('lv.ficha.weights')}</h2>
              <div className="mt-3 flex items-end gap-1.5 h-20">
                {weights.map((w) => {
                  const max = Math.max(...weights.map((x) => Number(x.data.kg)));
                  return (
                    <div key={w.id} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${fmtDate(w.date, locale)} · ${formatNum(w.data.kg)} kg`}>
                      <div className="w-full rounded-t bg-ranch-500/80" style={{ height: `${Math.max(8, (Number(w.data.kg) / max) * 56)}px` }} />
                      <div className="text-[10px] text-surface-500 tabular-nums">{formatNum(w.data.kg, 0)}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Notes */}
          <section className="card px-5 py-4">
            <h2 className="section-title">{t('lv.fields.notes')}</h2>
            {animal.notes?.length ? (
              <ul className="mt-3 space-y-2">
                {animal.notes.map((n, i) => <li key={i} className="text-sm text-surface-700 pl-3 border-l-2 border-surface-200">{n}</li>)}
              </ul>
            ) : <p className="text-sm text-surface-400 mt-2">{t('lv.ficha.noNotes')}</p>}
            {animal.brand_note && <p className="text-xs text-surface-500 mt-3">{t('lv.fields.brand')}: {animal.brand_note}</p>}
            {animal.origin !== 'app' && <p className="text-[11px] text-surface-400 mt-3">{t('lv.ficha.origin', { origin: animal.origin })}</p>}
          </section>

          <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost text-red-600 hover:bg-red-50 w-full justify-center"><Trash2 size={15} /> {t('lv.ficha.deleteAnimal')}</button>
        </div>
      </div>

      <AnimalForm open={editOpen} onClose={() => setEditOpen(false)} animal={animal} onSaved={(saved) => { if (saved?.slug && saved.slug !== slug) navigate(`/ganaderia/animales/${saved.slug}`, { replace: true }); }} />
      <EventForm open={eventType !== undefined} onClose={() => setEventType(undefined)} animal={animal} type={eventType || null} />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('lv.ficha.deleteAnimal')} size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)} className="btn-secondary">{t('common.cancel')}</button>
            <button type="button" onClick={handleDeleteAnimal} disabled={busy} className="btn-danger">{busy ? <Spinner size="sm" className="text-white" /> : t('tx.delete')}</button>
          </div>
        )}>
        <p className="text-sm text-surface-700">{t('lv.ficha.deleteBody', { name: animal.name, n: events.length })}</p>
        {animal.status === 'activo' && <p className="text-xs text-surface-500 mt-3">{t('lv.ficha.deleteHint')}</p>}
      </Modal>
    </div>
  );
}
