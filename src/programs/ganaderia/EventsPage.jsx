import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Search, ChevronDown, MoreHorizontal, Trash2, Milk, CalendarDays } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { useRegistrar } from './RegistrarSheet';
import { ActionSheet } from './Sheet';
import {
  ChapaTag, EventIcon, eventSummary, fmtDate, PageTitle, Card, Chip, ChipRow, Loading, LoadFailed, fieldCls,
} from './components';
import { addDays, todayISO, typeOrder, isActive, formatNum } from './lib';

// Eventos: the notebook, newest day first. A line for the week, chips for the
// type, one chip for the range. Each day says what it held; the day's milk
// folds into one line that opens. When this morning's milk is not written
// down yet, a dashed line asks for it.

const RANGES = ['7', '30', '90', '365', 'all'];
const DAYS_PAGE = 21;

export default function EventsPage() {
  const { t, tn, locale } = useT();
  const { animals, events, byId, loading, error, deleteEvent } = useHerd();
  const registrar = useRegistrar();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [rangeOpen, setRangeOpen] = useState(false);
  const [openMilk, setOpenMilk] = useState({});
  const [days, setDays] = useState(DAYS_PAGE);
  const [menu, setMenu] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const today = todayISO();

  const type = params.get('type') || '';
  const range = RANGES.includes(params.get('range')) ? params.get('range') : '30';
  const setP = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const week = useMemo(() => {
    const from = addDays(today, -6);
    const list = events.filter((e) => e.date >= from && e.date <= today);
    const counts = {};
    let liters = 0;
    for (const e of list) {
      if (e.type === 'leche') liters += Number(e.data?.liters) || 0;
      else counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return { counts, liters, any: list.length > 0 };
  }, [events, today]);

  const order = useMemo(() => typeOrder(events), [events]);
  const typeCounts = useMemo(() => {
    const m = {};
    for (const e of events) m[e.type] = (m[e.type] || 0) + 1;
    return m;
  }, [events]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const since = range === 'all' ? null : addDays(today, -(Number(range) - 1));
    return events
      .filter((e) => !type || e.type === type)
      .filter((e) => !since || e.date >= since)
      .filter((e) => {
        if (!s) return true;
        const a = byId[e.animal_id];
        return (a && (a.name.toLowerCase().includes(s) || String(a.tag || '').toLowerCase().includes(s))) || (e.note && e.note.toLowerCase().includes(s));
      });
  }, [events, byId, type, range, q, today]);

  // Day groups: the day's events, and its milk set apart.
  const groups = useMemo(() => {
    const out = [];
    for (const e of rows) {
      let g = out[out.length - 1];
      if (!g || g.date !== e.date) { g = { date: e.date, items: [], milk: [] }; out.push(g); }
      (e.type === 'leche' && type !== 'leche' ? g.milk : g.items).push(e);
    }
    return out;
  }, [rows, type]);

  async function handleDelete(ev) {
    try {
      await deleteEvent(ev.id);
      toast.success(t('lv.ficha.eventDeleted'));
    } catch (err) {
      toast.error(err.message || t('lv.form.saveFailed'));
    }
  }

  if (loading) return <Loading />;
  if (error) return <LoadFailed />;

  const weekParts = [
    ...order.filter((k) => week.counts[k]).map((k) => tn(`lv.count.${k}`, week.counts[k])),
    week.liters > 0 ? t('lv.events.weekMilk', { l: formatNum(week.liters, 0) }) : null,
  ].filter(Boolean);
  const milkedToday = events.some((e) => e.type === 'leche' && e.date === today);
  const hasCows = animals.some((a) => isActive(a) && a.category === 'vaca');
  const dayLabel = (d) => (d === today ? t('lv.events.today') : d === addDays(today, -1) ? t('lv.events.yesterday')
    : fmtDate(d, locale, { weekday: 'long', day: 'numeric', month: 'long', year: d.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' }));

  const row = (ev, { showDate = false } = {}) => {
    const a = byId[ev.animal_id];
    const summary = eventSummary(ev, t, byId);
    return (
      <li key={ev.id} className="flex items-center gap-3 min-h-[60px] pl-3 pr-1 py-1.5">
        <EventIcon type={ev.type} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] truncate">
            {a ? <Link to={`/ganaderia/animales/${a.slug}`} className="font-semibold text-finca-ink hover:underline">{a.name}</Link> : <span className="font-semibold">—</span>}
            <span className="text-finca-ink2"> · {t(`lv.types.${ev.type}`)}</span>
          </div>
          {(summary || ev.note || showDate) && (
            <div className="text-[13px] text-finca-ink2 truncate">{[summary, ev.note].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        {a && <ChapaTag animal={a} size="sm" className="hidden sm:inline-flex" />}
        <button type="button" onClick={() => setMenu(ev)} className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-finca-ink2 hover:bg-finca-lineSoft hover:text-finca-ink"
          aria-label={t('lv.ficha.eventActions', { type: t(`lv.types.${ev.type}`), date: fmtDate(ev.date, locale) })} data-testid="lv-event-menu">
          <MoreHorizontal size={20} />
        </button>
      </li>
    );
  };

  return (
    <div className="animate-rise">
      <PageTitle sub={weekParts.length ? `${t('lv.events.thisWeek')}: ${weekParts.join(' · ')}` : t('lv.events.weekEmpty')}>
        {t('nav.lvEvents')}
      </PageTitle>

      {hasCows && !milkedToday && (
        <button type="button" onClick={() => registrar.open({ type: 'leche' })} data-testid="lv-milk-cta"
          className="mt-4 w-full min-h-[56px] flex items-center gap-3 px-4 rounded-2xl border-2 border-dashed border-finca-lecheInk/50 bg-finca-leche/40 text-left text-finca-lecheInk hover:bg-finca-leche/70 transition-colors">
          <Milk size={20} aria-hidden="true" />
          <span className="flex-1 text-[15px] font-semibold">{new Date().getHours() < 12 ? t('lv.events.milkCtaMorning') : t('lv.events.milkCta')}</span>
        </button>
      )}

      <div className="relative mt-4 md:max-w-lg">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-finca-ink2" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className={cn(fieldCls, 'pl-11')}
          placeholder={t('lv.events.searchPh')} aria-label={t('lv.events.searchPh')} autoComplete="off" />
      </div>

      <ChipRow label={t('lv.event.type')} className="mt-3">
        <Chip onClick={() => setRangeOpen(true)} aria-haspopup="dialog" data-testid="lv-range-chip" className="border-finca-field">
          <CalendarDays size={15} aria-hidden="true" /> {t(`lv.events.rangeChip.${range}`)} <ChevronDown size={14} aria-hidden="true" />
        </Chip>
        <Chip on={!type} onClick={() => setP('type', '')}>{t('lv.events.allTypes')}</Chip>
        {order.filter((k) => typeCounts[k]).map((k) => (
          <Chip key={k} on={type === k} onClick={() => setP('type', type === k ? '' : k)} count={typeCounts[k]}>{t(`lv.types.${k}`)}</Chip>
        ))}
      </ChipRow>

      <div className="mt-4 space-y-4">
        {groups.length === 0 && <Card className="px-5 py-10 text-center text-[15px] text-finca-ink2">{t('lv.events.empty')}</Card>}
        {groups.slice(0, days).map((g) => {
          const milkL = g.milk.reduce((s, e) => s + (Number(e.data?.liters) || 0), 0)
            + (type === 'leche' ? g.items.reduce((s, e) => s + (Number(e.data?.liters) || 0), 0) : 0);
          const count = g.items.length + g.milk.length;
          const open = !!openMilk[g.date];
          return (
            <section key={g.date} aria-label={dayLabel(g.date)}>
              <h2 className="flex items-baseline gap-2 px-1 mb-1.5">
                <span className="inline-block text-[15px] font-semibold text-finca-ink first-letter:uppercase">{dayLabel(g.date)}</span>
                <span className="text-[13px] text-finca-ink2">· {tn('lv.events.dayCount', count)}{milkL > 0 ? ` · ${formatNum(milkL, 0)} L` : ''}</span>
              </h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-finca-line">
                  {g.items.map((ev) => row(ev))}
                  {g.milk.length > 0 && (
                    <li>
                      <button type="button" onClick={() => setOpenMilk((m) => ({ ...m, [g.date]: !open }))} aria-expanded={open}
                        className="w-full flex items-center gap-3 min-h-[60px] px-3 text-left hover:bg-finca-lineSoft/50">
                        <EventIcon type="leche" />
                        <span className="flex-1 min-w-0 text-[15px]">
                          <span className="font-semibold">{t('lv.types.leche')}</span>
                          <span className="text-finca-ink2"> · {tn('lv.events.milkings', g.milk.length)} · {formatNum(milkL, 0)} L</span>
                        </span>
                        <ChevronDown size={20} className={cn('shrink-0 mr-3 text-finca-ink2 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                      </button>
                      {open && <ul className="divide-y divide-finca-line border-t border-finca-line bg-finca-lineSoft/30">{g.milk.map((ev) => row(ev))}</ul>}
                    </li>
                  )}
                </ul>
              </Card>
            </section>
          );
        })}
        {groups.length > days && (
          <div className="text-center">
            <button type="button" onClick={() => setDays((d) => d + DAYS_PAGE)} className="min-h-[48px] px-5 rounded-[14px] text-[15px] font-semibold text-finca-green hover:bg-finca-lineSoft">
              {tn('lv.events.moreDays', groups.length - days)}
            </button>
          </div>
        )}
      </div>

      <ActionSheet open={rangeOpen} onClose={() => setRangeOpen(false)} title={t('lv.events.rangeTitle')}
        actions={RANGES.map((r) => ({ key: r, label: t(`lv.events.rangeChip.${r}`), active: range === r, autoFocus: range === r, onClick: () => setP('range', r === '30' ? '' : r) }))} />

      <ActionSheet open={!!menu} onClose={() => setMenu(null)}
        title={menu ? `${byId[menu.animal_id]?.name || '—'} · ${t(`lv.types.${menu.type}`)}` : ''} subtitle={menu ? fmtDate(menu.date, locale) : ''}
        actions={[{ key: 'delete', label: t('lv.ficha.deleteEvent'), icon: Trash2, danger: true, onClick: () => setConfirm(menu) }]} />

      <ActionSheet open={!!confirm} onClose={() => setConfirm(null)} title={t('lv.ficha.deleteEventTitle')} subtitle={t('lv.ficha.deleteEventBody')}
        actions={[{ key: 'yes', label: t('tx.delete'), icon: Trash2, danger: true, onClick: () => handleDelete(confirm) }]} />
    </div>
  );
}
