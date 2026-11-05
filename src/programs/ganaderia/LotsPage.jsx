import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { useHerd } from './HerdContext';
import { PageTitle, LotBar, GroupLegend, Loading, LoadFailed, countCat } from './components';
import { lotComposition, isActive } from './lib';

// Lotes: every lot with its head count, how many are pregnant and the mix.
// A lot opens Animales filtered to it.

export default function LotsPage() {
  const { t, tn } = useT();
  const { animals, loading, error } = useHerd();
  const lots = useMemo(() => lotComposition(animals), [animals]);

  if (loading) return <Loading />;
  if (error) return <LoadFailed />;

  const total = animals.filter(isActive).length;

  return (
    <div className="animate-rise">
      <PageTitle sub={`${tn('lv.lots.count', lots.length)} · ${tn('lv.animals.activeCount', total)}`}>{t('lv.shell.lots')}</PageTitle>
      {lots.length === 0 ? (
        <p className="mt-5 text-[15px] text-finca-ink2">{t('lv.home.noAnimals')}</p>
      ) : (
        <ul className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lots.map((l) => (
            <li key={l.lot || '_'}>
              <Link to={`/ganaderia/animales?lote=${encodeURIComponent(l.lot || '_')}`}
                className="block rounded-2xl bg-finca-surface border border-finca-line shadow-finca px-4 py-4 hover:border-finca-field transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[16px] font-semibold text-finca-ink truncate">{l.lot || t('lv.noLot')}</div>
                    <div className="text-[13px] text-finca-ink2">{l.pregnant ? tn('lv.lots.pregnant', l.pregnant) : t('lv.lots.nonePregnant')}</div>
                  </div>
                  <div className="font-display text-[34px] leading-none tabular-nums">{l.total}</div>
                  <ChevronRight size={20} className="text-finca-ink2 self-center" aria-hidden="true" />
                </div>
                <LotBar groups={l.groups} total={l.total} className="mt-3" />
                <GroupLegend groups={l.groups} className="mt-2" />
                <div className="text-[12px] text-finca-ink2 mt-2 truncate">
                  {Object.entries(l.cats).sort((x, y) => y[1] - x[1]).map(([c, n]) => countCat(n, c, t)).join(' · ')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
