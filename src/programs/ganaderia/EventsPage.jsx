import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Search, Trash2, X } from 'lucide-react';
import { useT } from '../../i18n/I18nContext';
import Spinner from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { AnimalAvatar, EventIcon, eventSummary, fmtDate } from './components';
import { EVENT_TYPES, addDays, todayISO } from './lib';
import EventForm from './EventForm';

// Eventos: one tile per thing that happens in the corral (tap, pick the
// animal, save) and the log of everything recorded, newest first.

const PAGE = 60;

export default function EventsPage() {
  const { t, locale } = useT();
  const { events, byId, loading, error, deleteEvent } = useHerd();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);     // null = closed, '' = open no type, 'parto' = open with type
  const [limit, setLimit] = useState(PAGE);
  const [confirmId, setConfirmId] = useState(null);
  const [busy, setBusy] = useState(false);

  const type = params.get('type') || '';
  const range = params.get('range') || 'all';
  const setP = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const since = range === '30' ? addDays(todayISO(), -30) : range === '90' ? addDays(todayISO(), -90) : range === '365' ? addDays(todayISO(), -365) : null;
    return events
      .filter((e) => !type || e.type === type)
      .filter((e) => !since || e.date >= since)
      .filter((e) => {
        if (!s) return true;
        const a = byId[e.animal_id];
        return (a && (a.name.toLowerCase().includes(s) || (a.tag && a.tag.toLowerCase().includes(s)))) || (e.note && e.note.toLowerCase().includes(s)) || (e.source && e.source.toLowerCase().includes(s));
      });
  }, [events, byId, type, range, q]);

  const counts = useMemo(() => {
    const m = {};
    for (const e of events) m[e.type] = (m[e.type] || 0) + 1;
    return m;
  }, [events]);

  async function handleDelete(id) {
    setBusy(true);
    try {
      await deleteEvent(id);
      toast.success(t('lv.ficha.eventDeleted'));
      setConfirmId(null);
    } catch (err) {
      toast.error(err.message || t('lv.form.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex items-center gap-3 text-surface-500 text-sm"><Spinner size="sm" /> {t('common.loading')}</div>;
  if (error) return <div className="card p-6 text-sm text-red-700">{t('lv.loadFailed')}</div>;

  // Group the visible rows by date so the log reads like the notebook.
  const groups = [];
  for (const e of rows.slice(0, limit)) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e); else groups.push({ date: e.date, items: [e] });
  }

  return (
    <div className="animate-fade-in">
      <div>
        <h1 className="page-title">{t('nav.lvEvents')}</h1>
        <p className="text-surface-500 text-sm mt-1">{t('lv.events.sub')}</p>
      </div>

      {/* Record tiles */}
      <div className="mt-5 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
        {EVENT_TYPES.map((e) => (
          <button key={e.key} type="button" onClick={() => setOpen(e.key)}
            className="card-hover flex flex-col items-center gap-2 px-2 py-3.5 text-xs font-medium text-surface-700">
            <EventIcon type={e.key} size="lg" />
            <span className="truncate max-w-full">{t(`lv.types.${e.key}`)}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="input-field pl-9" placeholder={t('lv.events.searchPh')} aria-label={t('lv.events.searchPh')} />
        </div>
        <div className="flex gap-2">
          <select value={type} onChange={(e) => setP('type', e.target.value)} className="input-field w-auto" aria-label={t('lv.event.type')}>
            <option value="">{t('lv.events.allTypes')}</option>
            {EVENT_TYPES.map((e) => <option key={e.key} value={e.key}>{t(`lv.types.${e.key}`)}{counts[e.key] ? ` (${counts[e.key]})` : ''}</option>)}
          </select>
          <div className="flex rounded-lg bg-surface-100 p-0.5">
            {['30', '90', '365', 'all'].map((r) => (
              <button key={r} type="button" onClick={() => setP('range', r === 'all' ? '' : r)} aria-pressed={range === r}
                className={cn('px-3 py-1.5 rounded-md text-xs font-medium transition-colors', range === r ? 'bg-white shadow-card text-surface-900' : 'text-surface-500 hover:text-surface-800')}>
                {t(`lv.events.range.${r}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      {type && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="text-surface-500">{t('lv.animals.showing', { n: rows.length })}</span>
          <button type="button" onClick={() => setP('type', '')} className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-800 border border-brand-100 pl-2.5 pr-1.5 py-0.5 font-medium">{t(`lv.types.${type}`)} <X size={12} /></button>
        </div>
      )}

      {/* Log */}
      <div className="card mt-4">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-sm text-surface-500 text-center">{t('lv.events.empty')}</p>
        ) : groups.map((g) => (
          <div key={g.date} className="border-b border-surface-100 last:border-b-0">
            <div className="px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-surface-500">{fmtDate(g.date, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
            <ul>
              {g.items.map((ev) => {
                const a = byId[ev.animal_id];
                const summary = eventSummary(ev, t, byId);
                return (
                  <li key={ev.id} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-surface-50">
                    <EventIcon type={ev.type} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {a ? <Link to={`/ganaderia/animales/${a.slug}`} className="font-medium hover:underline">{a.name}</Link> : <span className="font-medium">—</span>}
                        <span className="text-surface-500"> · {t(`lv.types.${ev.type}`)}</span>
                        {summary && <span className="text-surface-700"> · {summary}</span>}
                      </div>
                      {(ev.note || (ev.source && ev.origin !== 'app')) && <div className="text-xs text-surface-500 truncate">{ev.note || ev.source}</div>}
                    </div>
                    {a && <AnimalAvatar animal={a} size="sm" className="hidden sm:flex" />}
                    {confirmId === ev.id ? (
                      <span className="inline-flex items-center gap-1.5 text-xs shrink-0">
                        <span className="text-surface-600">{t('lv.ficha.deleteEventConfirm')}</span>
                        <button type="button" disabled={busy} onClick={() => handleDelete(ev.id)} className="rounded px-2 py-1 bg-red-600 text-white hover:bg-red-700">{t('tx.yes')}</button>
                        <button type="button" onClick={() => setConfirmId(null)} className="rounded px-2 py-1 bg-surface-100 text-surface-700 hover:bg-surface-200">{t('tx.no')}</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(ev.id)} className="p-1.5 rounded text-surface-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0" aria-label={t('tx.delete')}><Trash2 size={15} /></button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {rows.length > limit && (
          <div className="px-5 py-3 border-t border-surface-100 text-center">
            <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="btn-ghost text-sm">{t('lv.events.more', { n: rows.length - limit })}</button>
          </div>
        )}
      </div>

      <EventForm open={open !== null} onClose={() => setOpen(null)} type={open || null} />
    </div>
  );
}
