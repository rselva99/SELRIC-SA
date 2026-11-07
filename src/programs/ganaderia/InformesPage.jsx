import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { cn } from '../../lib/cn';
import { monthLong } from '../../components/charts/theme';
import { runChecks } from '../../lib/checks/index.js';
import { useHerd } from './HerdContext';
import { HerdByLotChart, CalvingsChart, MilkPerCowChart } from './HerdCharts';
import { PageTitle, SectionTitle, Card, Loading, LoadFailed, ChapaTag, PregnancyBar, fmtDate } from './components';
import { isActive, pregnancyTimeline, todayISO } from './lib';

// Informes: the herd in charts (calvings by month, milk per cow, the herd by
// lot), the pregnancies in the order they are due, and the four herd checks
// run on the herd as it is loaded — nothing is saved from this page.

const ROWS_SHOWN = 5;

const STATUS = {
  green: { icon: CheckCircle2, cls: 'bg-finca-greenSoft text-finca-green' },
  amber: { icon: AlertTriangle, cls: 'bg-finca-amber text-finca-amberInk' },
  red: { icon: XCircle, cls: 'bg-finca-claySoft text-finca-clayText' },
  skipped: { icon: MinusCircle, cls: 'bg-finca-lineSoft text-finca-ink2' },
};

function StatusPill({ status }) {
  const { t } = useT();
  const s = STATUS[status] || STATUS.skipped;
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[13px] font-semibold shrink-0', s.cls)}>
      <Icon size={15} aria-hidden="true" /> {t(`checks.status.${status}`)}
    </span>
  );
}

// One herd check: its status, what it found, what to do, and the first rows
// with a link to each animal.
function HerdCheck({ r }) {
  const { t, locale } = useT();
  const status = r.detail?.skipped ? 'skipped' : r.status;
  const rows = r.detail?.rows || [];
  const line = (row) => t(`lv.reports.rows.${r.key}.${row.kind}`, {
    c: row.category, dam: row.dam || '—',
    type: row.type ? t(`lv.types.${row.type}`) : '', date: row.date ? fmtDate(row.date, locale) : '—',
  });
  return (
    <Card as="li" className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[16px] font-semibold text-finca-ink leading-snug">{t(`checks.items.${r.key}.name`)}</h3>
        <StatusPill status={status} />
      </div>
      {status === 'skipped' ? (
        <p className="text-[14px] text-finca-ink2 mt-1">{t(`checks.skipped.${r.detail.skipped}`)}</p>
      ) : r.count > 0 ? (
        <>
          <p className="text-[14px] text-finca-ink2 mt-1">{t('checks.count', { n: r.count })} · {t(`checks.items.${r.key}.action`)}</p>
          <ul className="mt-2 divide-y divide-finca-line">
            {rows.slice(0, ROWS_SHOWN).map((row) => (
              <li key={row.id}>
                {row.slug ? (
                  <Link to={`/ganaderia/animales/${row.slug}`} className="flex items-center gap-3 min-h-[48px] py-1.5 hover:bg-finca-lineSoft/50 -mx-2 px-2 rounded-lg">
                    <span className="text-[15px] font-semibold text-finca-ink truncate">{row.name}</span>
                    <span className="text-[13px] text-finca-ink2 truncate">{line(row)}</span>
                  </Link>
                ) : (
                  <div className="min-h-[48px] py-1.5 flex items-center text-[14px] text-finca-ink2">{line(row)}</div>
                )}
              </li>
            ))}
          </ul>
          {r.count > ROWS_SHOWN && <p className="text-[13px] text-finca-ink2 mt-1">{t('checks.moreRows', { n: r.count - ROWS_SHOWN })}</p>}
        </>
      ) : (
        <p className="text-[14px] text-finca-ink2 mt-1">{t('checks.noRows')}</p>
      )}
    </Card>
  );
}

export default function InformesPage() {
  const { t, tn, locale } = useT();
  const { animals, events, loading, error } = useHerd();
  const today = todayISO();

  const timeline = useMemo(() => pregnancyTimeline(animals, today), [animals, today]);
  const checks = useMemo(() => runChecks({ animals, events }, { program: 'ganaderia', today }), [animals, events, today]);
  const hasCows = useMemo(() => animals.some((a) => isActive(a) && a.category === 'vaca'), [animals]);

  if (loading) return <Loading />;
  if (error) return <LoadFailed />;

  return (
    <div className="animate-rise space-y-8">
      <PageTitle sub={t('lv.reports.sub')}>{t('lv.shell.reports')}</PageTitle>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <CalvingsChart animals={animals} events={events} today={today} />
        {hasCows && <MilkPerCowChart events={events} today={today} />}
        <div className={hasCows ? 'lg:col-span-2' : ''}><HerdByLotChart animals={animals} /></div>
      </div>

      {/* The pregnancies, by the month each is due. */}
      <section aria-labelledby="lv-preg">
        <SectionTitle><span id="lv-preg">{t('lv.reports.pregnancies')}</span></SectionTitle>
        <p className="text-[14px] text-finca-ink2 -mt-2 mb-3">{t('lv.reports.pregnanciesHint')}</p>
        {timeline.length === 0 ? (
          <Card className="px-4 py-4 text-[15px] text-finca-ink2">{t('lv.reports.pregnanciesNone')}</Card>
        ) : (
          <ol className="space-y-4">
            {timeline.map((g) => (
              <li key={g.month || 'none'}>
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-finca-ink2 mb-1.5">
                  {g.month ? monthLong(g.month, locale) : t('lv.reports.noDueDate')} · {g.rows.length}
                </h3>
                <Card as="ul" className="divide-y divide-finca-line overflow-hidden">
                  {g.rows.map(({ animal }) => (
                    <li key={animal.id}>
                      <Link to={`/ganaderia/animales/${animal.slug}`} className="flex items-center gap-3 min-h-[60px] px-4 py-2.5 hover:bg-finca-lineSoft/50">
                        <ChapaTag animal={animal} size="sm" />
                        <span className="w-24 sm:w-40 shrink-0 min-w-0">
                          <span className="block text-[15px] font-semibold text-finca-ink truncate">{animal.name}</span>
                          {animal.lot && <span className="block text-[12px] text-finca-ink2 truncate">{animal.lot}</span>}
                        </span>
                        <PregnancyBar animal={animal} today={today} className="flex-1" />
                      </Link>
                    </li>
                  ))}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* The herd checks. */}
      <section aria-labelledby="lv-checks">
        <SectionTitle count={checks.filter((r) => !r.detail?.skipped && r.status !== 'green').length}>
          <span id="lv-checks">{t('lv.reports.checks')}</span>
        </SectionTitle>
        <p className="text-[14px] text-finca-ink2 -mt-2 mb-3">{t('lv.reports.checksHint')} {tn('lv.reports.herdSize', animals.length)}</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {checks.map((r) => <HerdCheck key={r.key} r={r} />)}
        </ul>
      </section>
    </div>
  );
}
