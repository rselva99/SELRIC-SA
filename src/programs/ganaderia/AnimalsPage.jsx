import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search, ChevronRight, X } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import {
  ChapaTag, StatusBadge, PregnancyBar, Chip, ChipRow, PageTitle, Card, Loading, LoadFailed, fmtDate,
  btnPaper, fieldCls, catLabel,
} from './components';
import { isActive, overdueForPalpation, matchAnimals, byTag, todayISO, ageParts } from './lib';
import AnimalForm from './AnimalForm';

// Animales: the herd, grouped by lot, found by chapa or name. One row of
// chips for what kind of animal, one for the lot; both live in the URL so
// Inicio and Lotes can link straight in. A table on wide screens.

const KINDS = ['', 'vacas', 'prenadas', 'crias', 'sin_palpar', 'cerrados'];
const CALVES = new Set(['ternero', 'ternera', 'lechon']);
const NO_LOT = '_';

export default function AnimalsPage() {
  const { t, tn, locale } = useT();
  const { animals, eventsByAnimal, loading, error } = useHerd();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const today = todayISO();

  const kind = KINDS.includes(params.get('f')) ? params.get('f') : '';
  const lot = params.get('lote') ?? '';
  const flag = params.get('flag') ?? '';
  const setP = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const view = useMemo(() => {
    const is = {
      '': () => true,
      vacas: (a) => a.category === 'vaca' || a.category === 'cerda',
      prenadas: (a) => a.pregnant === true,
      crias: (a) => CALVES.has(a.category),
      sin_palpar: (a) => overdueForPalpation(a, 90, today, eventsByAnimal[a.id] || []),
      cerrados: () => true,
    };
    const byStatus = (k) => (k === 'cerrados' ? animals.filter((a) => !isActive(a)) : animals.filter(isActive));
    const inLot = (a) => !lot || (lot === NO_LOT ? !a.lot : a.lot === lot);
    const hasFlag = (a) => !flag || a.flags?.includes(flag);
    const counts = Object.fromEntries(KINDS.map((k) => [k, byStatus(k).filter(is[k]).filter(inLot).filter(hasFlag).length]));
    const rows = byStatus(kind).filter(is[kind]).filter(inLot).filter(hasFlag);
    const lots = [...new Set(animals.filter(isActive).map((a) => a.lot || ''))]
      .sort((x, y) => (x === '') - (y === '') || x.localeCompare(y, locale));
    return { counts, rows, lots };
  }, [animals, eventsByAnimal, kind, lot, flag, today, locale]);

  const searching = q.trim().length > 0;
  const found = useMemo(() => (searching ? matchAnimals(view.rows, q) : view.rows), [view.rows, q, searching]);

  // Grouped by lot, biggest first; no grouping while searching, so the best
  // match stays on top.
  const groups = useMemo(() => {
    if (searching) return [{ lot: null, rows: found }];
    const m = new Map();
    for (const a of found) {
      const k = a.lot || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    return [...m.entries()]
      .map(([k, rows]) => ({ lot: k, rows: rows.sort(byTag) }))
      .sort((x, y) => (x.lot === '') - (y.lot === '') || y.rows.length - x.rows.length || x.lot.localeCompare(y.lot, locale));
  }, [found, searching, locale]);

  const newDefaults = useMemo(() => (lot && lot !== NO_LOT ? { lot } : null), [lot]);

  if (loading) return <Loading />;
  if (error) return <LoadFailed />;

  const nActive = animals.filter(isActive).length;
  const lastEvent = (a) => eventsByAnimal[a.id]?.[0];
  const ageOf = (a) => {
    const p = ageParts(a.birth_date, today);
    if (!p) return null;
    return p.years ? t('lv.ageYM', { y: p.years, m: p.months }) : p.months ? t('lv.ageM', { m: p.months }) : t('lv.ageD', { d: p.days });
  };
  const groupHead = (g) => {
    const preg = g.rows.filter((a) => a.pregnant === true).length;
    return (
      <>
        <span className="text-finca-ink">{g.lot || t('lv.noLot')}</span>
        <span className="text-finca-ink2"> · {g.rows.length}</span>
        {preg > 0 && <span className="text-finca-clayText"> · {tn('lv.lots.pregnant', preg)}</span>}
      </>
    );
  };

  return (
    <div className="animate-rise">
      <PageTitle
        sub={`${tn('lv.animals.activeCount', nActive)} · ${tn('lv.animals.onRecord', animals.length)}`}
        action={<button type="button" onClick={() => setFormOpen(true)} className={cn(btnPaper, 'min-h-[44px] px-3.5 text-[15px]')}><Plus size={18} /> <span className="hidden sm:inline">{t('lv.newAnimal')}</span><span className="sm:hidden">{t('lv.animals.newShort')}</span></button>}
      >
        {t('nav.lvAnimals')}
      </PageTitle>

      {/* Search: a number finds the chapa first. */}
      <div className="relative mt-4 md:max-w-lg">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-finca-ink2" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className={cn(fieldCls, 'pl-11')}
          placeholder={t('lv.animals.searchPh')} aria-label={t('lv.animals.searchPh')} autoComplete="off" />
      </div>

      <ChipRow label={t('lv.animals.kindLabel')} className="mt-3">
        {KINDS.map((k) => (
          <Chip key={k || 'all'} on={kind === k} onClick={() => setP('f', k)} count={view.counts[k]}>
            {t(`lv.animals.kind.${k || 'all'}`)}
          </Chip>
        ))}
      </ChipRow>
      {view.lots.length > 1 && (
        <ChipRow label={t('lv.fields.lot')} className="mt-1">
          <Chip on={!lot} onClick={() => setP('lote', '')}>{t('lv.animals.allLots')}</Chip>
          {view.lots.map((l) => (
            <Chip key={l || NO_LOT} on={lot === (l || NO_LOT)} onClick={() => setP('lote', l || NO_LOT)}>{l || t('lv.noLot')}</Chip>
          ))}
        </ChipRow>
      )}
      {flag && (
        <div className="mt-2 flex items-center gap-2">
          <Chip on onClick={() => setP('flag', '')} aria-label={t('lv.animals.removeFilter', { name: t(`lv.flags.${flag}`) })}>
            {t(`lv.flags.${flag}`)} <X size={14} aria-hidden="true" />
          </Chip>
        </div>
      )}

      {found.length === 0 ? (
        <Card className="mt-5 px-5 py-10 text-center">
          <p className="text-[16px] font-semibold text-finca-ink">{animals.length ? t('lv.animals.noMatch') : t('lv.animals.emptyTitle')}</p>
          {!animals.length && <p className="text-[14px] text-finca-ink2 mt-1">{t('lv.animals.emptyBody')}</p>}
          {!animals.length && <button type="button" onClick={() => setFormOpen(true)} className={cn(btnPaper, 'mt-4')}><Plus size={18} /> {t('lv.newAnimal')}</button>}
        </Card>
      ) : (
        <>
          {/* Phone and tablet: rows grouped by lot. */}
          <div className="lg:hidden mt-4 space-y-5">
            {groups.map((g) => (
              <section key={g.lot ?? 'search'}>
                {g.lot != null && <h2 className="text-[15px] font-semibold mb-2 px-1">{groupHead(g)}</h2>}
                <ul className="space-y-1.5">
                  {g.rows.map((a) => {
                    const ev = lastEvent(a);
                    return (
                      <li key={a.id}>
                        <Link to={`/ganaderia/animales/${a.slug}`} className="flex items-center gap-3 min-h-[64px] px-3 py-2 rounded-2xl bg-finca-surface border border-finca-line shadow-finca hover:border-finca-field transition-colors">
                          <ChapaTag animal={a} size="md" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[16px] font-semibold text-finca-ink truncate">{a.name}</span>
                            <span className="block text-[13px] text-finca-ink2 truncate">
                              {[catLabel(t, a.category), ageOf(a), searching ? a.lot : null, ev ? `${t(`lv.types.${ev.type}`)} ${fmtDate(ev.date, locale, { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          {a.pregnant === true && isActive(a) ? <PregnancyBar animal={a} today={today} className="w-[7.5rem] shrink-0" />
                            : !isActive(a) ? <StatusBadge status={a.status} className="shrink-0" /> : null}
                          <ChevronRight size={18} className="shrink-0 text-finca-ink2" aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          {/* Wide screens: one table, a header row per lot. */}
          <Card className="hidden lg:block mt-5 overflow-hidden">
            <table className="w-full text-[14px]">
              <thead className="text-finca-ink2">
                <tr className="border-b border-finca-line">
                  <th scope="col" className="text-left font-semibold px-4 py-3 w-[7rem]">{t('lv.fields.tag')}</th>
                  <th scope="col" className="text-left font-semibold px-3 py-3">{t('lv.fields.name')}</th>
                  <th scope="col" className="text-left font-semibold px-3 py-3">{t('lv.fields.category')}</th>
                  <th scope="col" className="text-left font-semibold px-3 py-3 w-[13rem]">{t('lv.fields.pregnancy')}</th>
                  <th scope="col" className="text-right font-semibold px-3 py-3">{t('lv.fields.calvings')}</th>
                  <th scope="col" className="text-left font-semibold px-4 py-3">{t('lv.animals.lastEvent')}</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.lot ?? 'search'} className="divide-y divide-finca-line">
                  {g.lot != null && (
                    <tr className="bg-finca-lineSoft/70">
                      <th scope="colgroup" colSpan={6} className="text-left font-semibold px-4 py-2">{groupHead(g)}</th>
                    </tr>
                  )}
                  {g.rows.map((a) => {
                    const ev = lastEvent(a);
                    return (
                      <tr key={a.id} className="hover:bg-finca-lineSoft/40">
                        <td className="px-4 py-2.5">
                          <Link to={`/ganaderia/animales/${a.slug}`} className="inline-flex items-center gap-2.5" tabIndex={-1} aria-hidden="true">
                            <ChapaTag animal={a} size="sm" />
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <Link to={`/ganaderia/animales/${a.slug}`} className="font-semibold text-finca-ink hover:underline">{a.name}</Link>
                          {!isActive(a) && <StatusBadge status={a.status} className="ml-2" />}
                        </td>
                        <td className="px-3 py-2.5 text-finca-ink2">{catLabel(t, a.category)}{ageOf(a) ? ` · ${ageOf(a)}` : ''}</td>
                        <td className="px-3 py-2.5">
                          {a.pregnant === true && isActive(a) ? <PregnancyBar animal={a} today={today} className="w-44" />
                            : a.sex === 'H' && a.pregnant === false ? <span className="text-finca-ink2">{t('lv.notPregnant')}</span>
                            : <span className="text-finca-ink2">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.sex === 'H' && a.calvings ? a.calvings : <span className="text-finca-ink2">—</span>}</td>
                        <td className="px-4 py-2.5 text-finca-ink2 whitespace-nowrap">{ev ? `${t(`lv.types.${ev.type}`)} · ${fmtDate(ev.date, locale, { day: 'numeric', month: 'short' })}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </Card>
        </>
      )}

      <AnimalForm open={formOpen} onClose={() => setFormOpen(false)} defaults={newDefaults} />
    </div>
  );
}
