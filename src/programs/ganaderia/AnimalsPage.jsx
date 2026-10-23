import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, ClipboardList, ChevronRight, X } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { AnimalAvatar, BrandChip, StatusBadge, fmtDate, eventSummary } from './components';
import { CATEGORIES, STATUSES, FLAGS, isActive, formatNum } from './lib';
import AnimalForm from './AnimalForm';
import EventForm from './EventForm';

// Animales: the whole herd, searchable, filtered by lot / category / status.
// Filters live in the URL so the home page can link straight into a lot.

const ALL_CATEGORIES = [...CATEGORIES.bovino, ...CATEGORIES.porcino];

export default function AnimalsPage() {
  const { t, locale } = useT();
  const { animals, byId, eventsByAnimal, lots, loading, error } = useHerd();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [eventFor, setEventFor] = useState(null);

  const f = {
    lot: params.get('lot') ?? '',
    cat: params.get('cat') ?? '',
    status: params.get('status') ?? 'activo',
    preg: params.get('preg') === '1',
    flag: params.get('flag') ?? '',
  };
  const setF = (k, v) => {
    const next = new URLSearchParams(params);
    if (v === '' || v == null || v === false) next.delete(k); else next.set(k, v === true ? '1' : v);
    setParams(next, { replace: true });
  };
  const activeFilters = [f.lot && ['lot', f.lot], f.cat && ['cat', t(`lv.category.${f.cat}`)], f.preg && ['preg', t('lv.pregnant')], f.flag && ['flag', t(`lv.flags.${f.flag}`)]].filter(Boolean);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return animals
      .filter((a) => (f.status === 'all' ? true : f.status === 'closed' ? !isActive(a) : a.status === f.status))
      .filter((a) => !f.lot || (a.lot || '') === f.lot)
      .filter((a) => !f.cat || a.category === f.cat)
      .filter((a) => !f.preg || a.pregnant === true)
      .filter((a) => !f.flag || a.flags?.includes(f.flag))
      .filter((a) => !s || a.name.toLowerCase().includes(s) || (a.tag && a.tag.toLowerCase().includes(s)) || (a.brand && a.brand.toLowerCase().includes(s)) || (a.aliases || []).some((x) => x.toLowerCase().includes(s)) || (a.dam_name && a.dam_name.toLowerCase().includes(s)))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [animals, q, f.status, f.lot, f.cat, f.preg, f.flag, locale]);

  const lastEvent = (a) => eventsByAnimal[a.id]?.[0];
  // A new animal added while a lot filter is on starts in that lot.
  const newDefaults = useMemo(() => (f.lot ? { lot: f.lot } : null), [f.lot]);

  if (loading) return <div className="flex items-center gap-3 text-surface-500 text-sm"><Spinner size="sm" /> {t('common.loading')}</div>;
  if (error) return <div className="card p-6 text-sm text-red-700">{t('lv.loadFailed')}</div>;

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="page-title">{t('nav.lvAnimals')}</h1>
          <p className="text-surface-500 text-sm mt-1">{t('lv.animals.sub', { n: animals.filter(isActive).length, total: animals.length })}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEventFor({})} className="btn-secondary"><ClipboardList size={16} /> {t('lv.recordEvent')}</button>
          <button type="button" onClick={() => setFormOpen(true)} className="btn-primary"><Plus size={16} /> {t('lv.newAnimal')}</button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="mt-5 flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="input-field pl-9" placeholder={t('lv.animals.searchPh')} aria-label={t('lv.animals.searchPh')} />
        </div>
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
          <select value={f.status} onChange={(e) => setF('status', e.target.value === 'activo' ? '' : e.target.value)} className="input-field w-auto shrink-0" aria-label={t('lv.fields.status')}>
            <option value="activo">{t('lv.status.activo')}</option>
            <option value="all">{t('lv.animals.allStatuses')}</option>
            <option value="closed">{t('lv.animals.closed')}</option>
            {STATUSES.filter((s) => s !== 'activo').map((s) => <option key={s} value={s}>{t(`lv.status.${s}`)}</option>)}
          </select>
          <select value={f.lot} onChange={(e) => setF('lot', e.target.value)} className="input-field w-auto shrink-0" aria-label={t('lv.fields.lot')}>
            <option value="">{t('lv.animals.allLots')}</option>
            {lots.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={f.cat} onChange={(e) => setF('cat', e.target.value)} className="input-field w-auto shrink-0" aria-label={t('lv.fields.category')}>
            <option value="">{t('lv.animals.allCategories')}</option>
            {ALL_CATEGORIES.filter((c) => animals.some((a) => a.category === c)).map((c) => <option key={c} value={c}>{t(`lv.category.${c}`)}</option>)}
          </select>
          <select value={f.flag} onChange={(e) => setF('flag', e.target.value)} className="input-field w-auto shrink-0" aria-label={t('lv.fields.flags')}>
            <option value="">{t('lv.animals.anyFlag')}</option>
            {FLAGS.map((x) => <option key={x} value={x}>{t(`lv.flags.${x}`)}</option>)}
          </select>
          <button type="button" onClick={() => setF('preg', !f.preg)} aria-pressed={f.preg}
            className={cn('shrink-0 px-3 rounded-lg border text-sm font-medium transition-colors', f.preg ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-white border-surface-300 text-surface-600 hover:border-surface-400')}>
            {t('lv.animals.pregnantOnly')}
          </button>
        </div>
      </div>
      {activeFilters.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-surface-500">{t('lv.animals.showing', { n: rows.length })}</span>
          {activeFilters.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setF(k, '')} className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-800 border border-brand-100 pl-2.5 pr-1.5 py-0.5 font-medium">
              {label} <X size={12} />
            </button>
          ))}
        </div>
      )}

      {/* List */}
      {rows.length === 0 ? (
        <div className="card mt-5">
          <EmptyState title={animals.length ? t('lv.animals.noMatch') : t('lv.animals.emptyTitle')} description={animals.length ? null : t('lv.animals.emptyBody')}
            action={animals.length ? null : { label: t('lv.newAnimal'), onClick: () => setFormOpen(true) }} />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card mt-5 overflow-hidden hidden md:block">
            <table className="w-full">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="table-header">{t('lv.fields.name')}</th>
                  <th className="table-header">{t('lv.fields.category')}</th>
                  <th className="table-header">{t('lv.fields.lot')}</th>
                  <th className="table-header">{t('lv.fields.brand')}</th>
                  <th className="table-header text-right">{t('lv.fields.calvings')}</th>
                  <th className="table-header">{t('lv.fields.pregnancy')}</th>
                  <th className="table-header">{t('lv.animals.lastEvent')}</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {rows.map((a) => {
                  const ev = lastEvent(a);
                  return (
                    <tr key={a.id} className="hover:bg-surface-50 group">
                      <td className="table-cell">
                        <Link to={`/ganaderia/animales/${a.slug}`} className="flex items-center gap-3 min-w-0">
                          <AnimalAvatar animal={a} size="sm" />
                          <span className="min-w-0">
                            <span className="block font-medium text-surface-900 truncate">{a.name}{a.aliases?.length ? <span className="text-surface-400 font-normal"> · {a.aliases.join(', ')}</span> : null}</span>
                            <span className="block text-xs text-surface-500">{a.tag ? `${t('lv.fields.tag')} ${a.tag}` : a.dam_name ? t('lv.daughterOf', { name: a.dam_name }) : t(`lv.sex.${a.sex}`)}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="table-cell">{t(`lv.category.${a.category}`)}{a.status !== 'activo' && <span className="ml-2"><StatusBadge status={a.status} /></span>}</td>
                      <td className="table-cell">{a.lot || <span className="text-surface-400">—</span>}</td>
                      <td className="table-cell"><BrandChip brand={a.brand} /></td>
                      <td className="table-cell text-right tabular-nums">{a.sex === 'H' && a.calvings ? a.calvings : <span className="text-surface-400">—</span>}</td>
                      <td className="table-cell">
                        {a.pregnant === true ? <span className="badge-blue">{a.preg_months != null ? t('lv.monthsPregnant', { n: formatNum(a.preg_months) }) : t('lv.pregnant')}</span>
                          : a.pregnant === false ? <span className="text-surface-500 text-xs">{t('lv.notPregnant')}</span>
                          : <span className="text-surface-400">—</span>}
                      </td>
                      <td className="table-cell">
                        {ev ? <span className="text-xs"><span className="text-surface-700">{t(`lv.types.${ev.type}`)}</span> <span className="text-surface-400">· {fmtDate(ev.date, locale)}</span></span> : <span className="text-surface-400">—</span>}
                      </td>
                      <td className="table-cell text-right whitespace-nowrap">
                        <button type="button" onClick={() => setEventFor(a)} className="btn-ghost text-xs py-1 px-2 opacity-0 group-hover:opacity-100 focus:opacity-100">{t('lv.recordEvent')}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone cards */}
          <div className="mt-4 space-y-2 md:hidden">
            {rows.map((a) => {
              const ev = lastEvent(a);
              return (
                <Link key={a.id} to={`/ganaderia/animales/${a.slug}`} className="card flex items-center gap-3 px-4 py-3">
                  <AnimalAvatar animal={a} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{a.name}</span>
                      <BrandChip brand={a.brand} />
                      {a.status !== 'activo' && <StatusBadge status={a.status} />}
                    </div>
                    <div className="text-xs text-surface-500 truncate mt-0.5">
                      {t(`lv.category.${a.category}`)}{a.lot ? ` · ${a.lot}` : ''}{a.tag ? ` · ${a.tag}` : ''}
                      {a.pregnant === true ? ` · ${a.preg_months != null ? t('lv.monthsPregnant', { n: formatNum(a.preg_months) }) : t('lv.pregnant')}` : ''}
                    </div>
                    {ev && <div className="text-xs text-surface-400 truncate mt-0.5">{t(`lv.types.${ev.type}`)} · {fmtDate(ev.date, locale)}{eventSummary(ev, t, byId) ? ` · ${eventSummary(ev, t, byId)}` : ''}</div>}
                  </div>
                  <ChevronRight size={16} className="text-surface-300 shrink-0" />
                </Link>
              );
            })}
          </div>
        </>
      )}

      <AnimalForm open={formOpen} onClose={() => setFormOpen(false)} defaults={newDefaults} />
      <EventForm open={!!eventFor} onClose={() => setEventFor(null)} animal={eventFor?.id ? eventFor : null} />
    </div>
  );
}
