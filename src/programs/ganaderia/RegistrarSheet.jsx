import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, Check, ChevronRight, Minus, Plus } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { useT } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { Sheet } from './Sheet';
import { ChapaTag, EventIcon, fmtDate, btnClay, btnPaper, fieldCls, labelCls, catLabel } from './components';
import {
  EVENT_BY_KEY, FEMALE_EVENTS, BREEDING_FEMALE, CURRENCIES, GESTATION_DAYS,
  todayISO, addDays, isActive, typeOrder, nextTag, matchAnimals, byTag, formatNum,
} from './lib';

// Registrar: what happened → to which animal → the details. Three steps in one
// full-screen sheet, opened from anywhere through useRegistrar().open():
//
//   open()                                 starts at step 1
//   open({ type: 'leche' })                starts at the animal picker
//   open({ animalIds: [id] })              from a ficha: the picker is skipped
//   open({ type: 'leche', animalIds })     straight to the details
//
// Saving goes through lv_record_event (recordEvents), which applies what the
// event means to the card. The only other write is the new calf's chapa, set
// on the calf's own card once the RPC has created it.

const RegistrarContext = createContext(null);

export function RegistrarProvider({ children }) {
  const parent = useContext(RegistrarContext);
  const [request, setRequest] = useState(null);
  const value = useMemo(() => ({
    open: (opts = {}) => setRequest({ type: opts.type || null, animalIds: opts.animalIds || [], n: Date.now() }),
  }), []);
  if (parent) return children;
  return (
    <RegistrarContext.Provider value={value}>
      {children}
      <RegistrarSheet request={request} onClose={() => setRequest(null)} />
    </RegistrarContext.Provider>
  );
}

export function useRegistrar() {
  const ctx = useContext(RegistrarContext);
  if (!ctx) throw new Error('useRegistrar must be used within RegistrarProvider');
  return ctx;
}

const EMPTY = {
  outcome: 'H', openCalf: true, calfName: '', calfTag: '',
  result: 'S', months: '', kg: '', liters: '', shift: 'am',
  product: '', dose: '', reason: '', kind: 'monta', sire_id: '', sire: '',
  lot: '', buyer: '', price: '', currency: 'NIO', cause: '',
};

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// The animals a type can be recorded on: female-only events list the females,
// breeding ones first; milk lists the cows. A search reaches closed cards too.
function poolFor(type, animals, query) {
  const base = query ? animals : animals.filter(isActive);
  if (!FEMALE_EVENTS.has(type)) return base;
  return base.filter((a) => a.sex === 'H');
}

function Segmented({ value, options, onChange, label }) {
  return (
    <div className="flex gap-1 p-1 rounded-[14px] bg-finca-lineSoft" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('flex-1 min-h-[44px] px-3 rounded-[11px] text-[15px] font-semibold transition-colors', value === v ? 'bg-finca-surface text-finca-ink shadow-finca' : 'text-finca-ink2 hover:text-finca-ink')}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Field({ id, label, children, className }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

export default function RegistrarSheet({ request, onClose }) {
  const { t, tn, locale } = useT();
  const { animals, events, byId, eventsByAnimal, lots, recordEvents, saveAnimal } = useHerd();
  const [step, setStep] = useState(1);
  const [type, setType] = useState(null);
  const [ids, setIds] = useState([]);
  const [fixed, setFixed] = useState(false);
  const [query, setQuery] = useState('');
  const [kbd, setKbd] = useState('numeric');
  const [dateMode, setDateMode] = useState('hoy');
  const [otherDate, setOtherDate] = useState('');
  const [data, setData] = useState(EMPTY);
  const [liters, setLiters] = useState({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const open = !!request;
  const today = todayISO();

  // Reset when a new request opens the sheet — not on every herd refresh.
  useEffect(() => {
    if (!request) return;
    const preset = request.animalIds || [];
    setType(request.type);
    setIds(preset);
    setFixed(preset.length > 0);
    setStep(request.type ? (preset.length ? 3 : 2) : 1);
    setQuery('');
    setKbd('numeric');
    setDateMode('hoy');
    setOtherDate(addDays(today, -2));
    setData({ ...EMPTY, shift: new Date().getHours() < 12 ? 'am' : 'pm', calfTag: nextTag(animals) });
    setLiters({});
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

  const chosen = useMemo(() => ids.map((id) => byId[id]).filter(Boolean), [ids, byId]);
  const one = chosen.length === 1 ? chosen[0] : null;
  const def = type ? EVENT_BY_KEY[type] : null;
  const multi = type === 'leche' && !fixed;
  const date = dateMode === 'hoy' ? today : dateMode === 'ayer' ? addDays(today, -1) : otherDate;

  // Step 1: the tiles, most used first. A male on the ficha never sees the
  // female-only ones.
  const types = useMemo(() => {
    const male = fixed && chosen.length && chosen.every((a) => a.sex !== 'H');
    return typeOrder(events).filter((k) => !(male && FEMALE_EVENTS.has(k)));
  }, [events, fixed, chosen]);

  // Step 2: the picker.
  const yesterdayMilkers = useMemo(() => {
    const y = addDays(today, -1);
    return [...new Set(events.filter((e) => e.type === 'leche' && e.date === y).map((e) => e.animal_id))].filter((id) => byId[id] && isActive(byId[id]));
  }, [events, byId, today]);
  const candidates = useMemo(() => {
    if (!type) return [];
    const pool = poolFor(type, animals, query.trim());
    if (query.trim()) return matchAnimals(pool, query).slice(0, 60);
    const recent = new Set(yesterdayMilkers);
    return pool.slice().sort((a, b) => {
      if (type === 'leche' && recent.has(a.id) !== recent.has(b.id)) return recent.has(a.id) ? -1 : 1;
      if (FEMALE_EVENTS.has(type) && BREEDING_FEMALE.has(a.category) !== BREEDING_FEMALE.has(b.category)) return BREEDING_FEMALE.has(a.category) ? -1 : 1;
      return byTag(a, b);
    }).slice(0, 80);
  }, [type, animals, query, yesterdayMilkers]);

  const sires = useMemo(() => animals.filter((a) => a.sex === 'M' && isActive(a) && a.species === (one?.species || 'bovino')).sort(byTag), [animals, one]);
  const set = (k) => (e) => setData((d) => ({ ...d, [k]: e.target.value }));
  const put = (k, v) => setData((d) => ({ ...d, [k]: v }));

  function pickType(k) {
    setType(k);
    if (fixed) { setStep(3); return; }
    setIds([]);
    setQuery('');
    setStep(2);
  }
  function pickAnimal(a) {
    if (multi) { setIds((cur) => (cur.includes(a.id) ? cur.filter((x) => x !== a.id) : [...cur, a.id])); return; }
    setIds([a.id]);
    setStep(3);
  }
  function back() {
    if (step === 3) setStep(fixed ? 1 : 2);
    else if (step === 2) setStep(1);
  }

  // The event's data, as lv_record_event reads it. Returns an error message
  // instead when something required is missing.
  function buildData() {
    const d = {};
    switch (type) {
      case 'parto':
        if (data.outcome === 'dead') { d.calf_dead = true; d.create_calf = false; }
        else {
          d.calf_sex = data.outcome;
          d.create_calf = !!data.openCalf;
          if (data.openCalf && data.calfName.trim()) d.calf_name = data.calfName.trim();
        }
        break;
      case 'palpacion':
        d.result = data.result;
        if (data.result === 'S' && num(data.months) != null) d.months = num(data.months);
        break;
      case 'peso': case 'destete':
        if (num(data.kg) != null) d.kg = num(data.kg);
        else if (type === 'peso') return { error: t('lv.event.kgRequired') };
        break;
      case 'leche':
        d.shift = data.shift;
        break;
      case 'vacuna':
        if (data.product.trim()) d.product = data.product.trim();
        if (data.dose.trim()) d.dose = data.dose.trim();
        break;
      case 'salud':
        if (data.reason.trim()) d.reason = data.reason.trim();
        if (data.product.trim()) d.product = data.product.trim();
        break;
      case 'servicio':
        d.kind = data.kind;
        if (data.sire_id) d.sire_id = data.sire_id;
        else if (data.sire.trim()) d.sire = data.sire.trim();
        break;
      case 'traslado':
        if (!data.lot.trim()) return { error: t('lv.event.lotRequired') };
        d.lot = data.lot.trim();
        break;
      case 'venta':
        if (data.buyer.trim()) d.buyer = data.buyer.trim();
        if (num(data.price) != null) d.price = num(data.price);
        d.currency = data.currency;
        break;
      case 'muerte':
        if (data.cause.trim()) d.cause = data.cause.trim();
        break;
      default:
    }
    return { data: d };
  }

  function litersFor(a) {
    return num(chosen.length === 1 ? (liters[a.id] ?? data.liters) : liters[a.id]);
  }

  async function save() {
    if (!chosen.length) { toast.error(t('lv.event.pickAnimal')); return; }
    if (!date) { toast.error(t('lv.reg.pickDate')); return; }
    const built = buildData();
    if (built.error) { toast.error(built.error); return; }
    if (type === 'leche') {
      const missing = chosen.filter((a) => litersFor(a) == null);
      if (missing.length) { toast.error(t('lv.reg.litersMissing', { names: missing.map((a) => a.name).join(', ') })); return; }
    }
    const ps = chosen.map((a) => ({
      animal_id: a.id, type, date, note: note.trim(),
      data: type === 'leche' ? { ...built.data, liters: litersFor(a) } : built.data,
    }));
    setSaving(true);
    try {
      const results = await recordEvents(ps);
      const failed = chosen.filter((_, i) => !results[i].ok);
      const okCount = results.length - failed.length;

      // The calf's chapa goes on the calf's own card, once the RPC made it.
      if (type === 'parto' && built.data.create_calf && data.calfTag.trim() && results[0]?.ok && results[0].data?.calf_id) {
        try { await saveAnimal({ tag: data.calfTag.trim() }, results[0].data.calf_id); }
        catch { toast.error(t('lv.reg.calfTagFailed', { tag: data.calfTag.trim() })); }
      }

      if (!failed.length) {
        toast.success(one ? t('lv.event.saved', { type: t(`lv.types.${type}`), name: one.name }) : tn('lv.reg.savedMany', okCount));
        onClose();
        return;
      }
      const why = results.find((r) => !r.ok)?.error?.message;
      toast.error(okCount
        ? t('lv.reg.savedSome', { ok: okCount, total: results.length, names: failed.map((a) => a.name).join(', ') })
        : why || t('lv.event.saveFailed'));
      // Keep the ones that did not go through, so a second tap retries them.
      setIds(failed.map((a) => a.id));
    } catch (err) {
      toast.error(err.message || t('lv.event.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  // What saving will do, in the owner's words, under the button.
  function consequence() {
    if (!def || !chosen.length) return '';
    const name = one ? one.name : '';
    switch (type) {
      case 'parto':
        if (data.outcome === 'dead') return t('lv.reg.cq.partoDead', { name });
        if (data.openCalf) return data.calfTag.trim() ? t('lv.reg.cq.partoCalfTag', { name, tag: data.calfTag.trim() }) : t('lv.reg.cq.partoCalf', { name });
        return t('lv.reg.cq.parto', { name, n: (one?.calvings || 0) + 1 });
      case 'mal_parto': return t('lv.reg.cq.malParto', { name });
      case 'palpacion': {
        if (data.result !== 'S') return t('lv.reg.cq.empty', { name });
        const m = num(data.months);
        if (m == null) return t('lv.reg.cq.pregnant', { name });
        const gest = GESTATION_DAYS[one?.species] || GESTATION_DAYS.bovino;
        const due = addDays(date, Math.round(gest - m * 30.4));
        return t('lv.reg.cq.pregnantDue', { name, m: formatNum(m), date: fmtDate(due, locale, { day: 'numeric', month: 'long' }) });
      }
      case 'peso': return num(data.kg) != null ? t('lv.reg.cq.peso', { name, kg: formatNum(num(data.kg)) }) : '';
      case 'leche': {
        const total = chosen.reduce((s, a) => s + (litersFor(a) || 0), 0);
        return chosen.length === 1 ? t('lv.reg.cq.lecheOne', { name: chosen[0].name, l: formatNum(total) }) : t('lv.reg.cq.leche', { n: chosen.length, l: formatNum(total) });
      }
      case 'traslado': return data.lot.trim() ? t('lv.reg.cq.traslado', { name, lot: data.lot.trim() }) : '';
      case 'venta': return t('lv.reg.cq.venta', { name });
      case 'muerte': return t('lv.reg.cq.muerte', { name });
      default: return chosen.length === 1 ? t('lv.reg.cq.history', { name }) : tn('lv.reg.cq.historyMany', chosen.length);
    }
  }

  if (!open) return null;

  const typeLabel = type ? t(`lv.types.${type}`) : '';
  const whoLine = one ? [one.name, one.tag ? `${t('lv.fields.tag')} ${one.tag}` : null].filter(Boolean).join(' · ') : chosen.length ? tn('lv.reg.animalsCount', chosen.length) : '';

  // ── Step 1: what happened ────────────────────────────────────────────────
  if (step === 1) {
    return (
      <Sheet key="s1" open onClose={onClose} title={t('lv.reg.whatHappened')} subtitle={fixed ? whoLine : t('lv.reg.stepOf', { n: 1, of: 3 })}>
        <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
          {types.map((k, i) => (
            <button key={k} type="button" data-type={k} data-autofocus={i === 0 ? '' : undefined} onClick={() => pickType(k)}
              className="min-h-[88px] flex flex-col items-center justify-center gap-2 px-1 py-3 rounded-2xl bg-finca-surface border border-finca-line shadow-finca hover:border-finca-field active:bg-finca-lineSoft">
              <EventIcon type={k} size="lg" />
              <span className="text-[14px] font-semibold text-finca-ink text-center leading-tight">{t(`lv.types.${k}`)}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  // ── Step 2: which animal ──────────────────────────────────────────────────
  if (step === 2) {
    const footer = multi ? (
      <button type="button" onClick={() => setStep(3)} disabled={!ids.length} className={cn(btnClay, 'w-full')}>
        {ids.length ? tn('lv.reg.continueWith', ids.length) : t('lv.reg.pickCows')}
      </button>
    ) : null;
    return (
      <Sheet key="s2" open onClose={onClose} onBack={back} title={multi ? t('lv.reg.whichCows') : t('lv.reg.whichAnimal')} subtitle={typeLabel} footer={footer}>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-finca-ink2" aria-hidden="true" />
            <input type="search" inputMode={kbd} value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus=""
              className={cn(fieldCls, 'pl-11')} placeholder={t('lv.reg.searchPh')} aria-label={t('lv.reg.searchPh')} autoComplete="off" />
          </div>
          <button type="button" onClick={() => setKbd((k) => (k === 'numeric' ? 'text' : 'numeric'))}
            className="shrink-0 w-14 min-h-[48px] rounded-[12px] border border-finca-field bg-finca-surface text-[14px] font-bold text-finca-ink2"
            aria-label={kbd === 'numeric' ? t('lv.reg.kbdText') : t('lv.reg.kbdNumbers')}>
            {kbd === 'numeric' ? 'ABC' : '123'}
          </button>
        </div>

        {multi && yesterdayMilkers.length > 0 && !query && (
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => setIds(yesterdayMilkers)} className="min-h-[40px] px-3.5 rounded-full border border-finca-line bg-finca-surface text-[14px] font-medium">
              {tn('lv.reg.sameAsYesterday', yesterdayMilkers.length)}
            </button>
            {ids.length > 0 && (
              <button type="button" onClick={() => setIds([])} className="min-h-[40px] px-3.5 rounded-full text-[14px] font-medium text-finca-ink2">{t('lv.reg.clear')}</button>
            )}
          </div>
        )}

        <ul className="mt-3 space-y-1.5">
          {candidates.map((a) => {
            const on = ids.includes(a.id);
            return (
              <li key={a.id}>
                <button type="button" onClick={() => pickAnimal(a)}
                  role={multi ? 'checkbox' : undefined} aria-checked={multi ? on : undefined}
                  className={cn('w-full min-h-[64px] flex items-center gap-3 px-3 py-2 rounded-2xl border text-left transition-colors',
                    on ? 'bg-finca-greenSoft border-finca-green' : 'bg-finca-surface border-finca-line hover:border-finca-field')}>
                  <ChapaTag animal={a} size="md" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[16px] font-semibold text-finca-ink truncate">{a.name}</span>
                    <span className="block text-[13px] text-finca-ink2 truncate">
                      {catLabel(t, a.category)}{a.lot ? ` · ${a.lot}` : ''}{!isActive(a) ? ` · ${t(`lv.status.${a.status}`)}` : ''}
                    </span>
                  </span>
                  {multi ? (
                    <span className={cn('w-7 h-7 shrink-0 rounded-lg border-2 flex items-center justify-center', on ? 'bg-finca-green border-finca-green text-white' : 'border-finca-field')} aria-hidden="true">
                      {on && <Check size={18} strokeWidth={3} />}
                    </span>
                  ) : <ChevronRight size={20} className="shrink-0 text-finca-ink2" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
          {candidates.length === 0 && <li className="text-[14px] text-finca-ink2 text-center py-8">{t('lv.reg.noMatch')}</li>}
        </ul>
      </Sheet>
    );
  }

  // ── Step 3: the details ───────────────────────────────────────────────────
  const preview = consequence();
  const footer = (
    <div>
      <button type="button" onClick={save} disabled={saving || !chosen.length} className={cn(btnClay, 'w-full min-h-[52px]')}>
        {saving ? <Spinner size="sm" className="text-white" /> : t('lv.reg.save')}
      </button>
      {preview && <p className="mt-2 text-[13px] text-finca-ink2 text-center" aria-live="polite" data-testid="lv-consequence">{preview}</p>}
    </div>
  );

  return (
    <Sheet key="s3" open onClose={onClose} onBack={back} title={typeLabel} subtitle={whoLine} footer={footer}>
      <div className="space-y-5">
        {/* When */}
        <div>
          <span className={labelCls}>{t('lv.fields.date')}</span>
          <Segmented label={t('lv.fields.date')} value={dateMode === 'otra' ? null : dateMode} onChange={setDateMode}
            options={[['hoy', t('lv.reg.today')], ['ayer', t('lv.reg.yesterday')]]} />
          {dateMode === 'otra' ? (
            <input type="date" value={otherDate} max={today} onChange={(e) => setOtherDate(e.target.value)} className={cn(fieldCls, 'mt-2')} aria-label={t('lv.reg.otherDate')} />
          ) : (
            <button type="button" onClick={() => setDateMode('otra')} className="mt-1 min-h-[44px] text-[14px] font-medium text-finca-green underline underline-offset-2">{t('lv.reg.otherDate')}</button>
          )}
        </div>

        {type === 'parto' && (
          <>
            <div>
              <span className={labelCls}>{t('lv.reg.calfOutcome')}</span>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('lv.reg.calfOutcome')}>
                {[['H', t('lv.calfFemale')], ['M', t('lv.calfMale')], ['dead', t('lv.reg.calfDead')]].map(([v, text]) => (
                  <button key={v} type="button" role="radio" aria-checked={data.outcome === v} onClick={() => put('outcome', v)}
                    className={cn('min-h-[56px] px-2 rounded-2xl border text-[15px] font-semibold leading-tight',
                      data.outcome === v ? (v === 'dead' ? 'bg-finca-lineSoft border-finca-ink text-finca-ink' : 'bg-finca-greenSoft border-finca-green text-finca-green') : 'bg-finca-surface border-finca-line text-finca-ink')}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
            {data.outcome !== 'dead' && (
              <div className="rounded-2xl border border-finca-line bg-finca-surface">
                <button type="button" role="switch" aria-checked={data.openCalf} onClick={() => put('openCalf', !data.openCalf)}
                  className="w-full min-h-[60px] flex items-center gap-3 px-4 py-2 text-left">
                  <span className={cn('w-7 h-7 shrink-0 rounded-lg border-2 flex items-center justify-center', data.openCalf ? 'bg-finca-green border-finca-green text-white' : 'border-finca-field')} aria-hidden="true">
                    {data.openCalf && <Check size={18} strokeWidth={3} />}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[16px] font-semibold text-finca-ink">{t('lv.reg.openCalf')}</span>
                    <span className="block text-[13px] text-finca-ink2">{data.calfTag.trim() ? t('lv.reg.calfGetsTag', { tag: data.calfTag.trim() }) : t('lv.reg.calfNoTag')}</span>
                  </span>
                </button>
                {data.openCalf && (
                  <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 pb-4">
                    <Field id="lv-reg-calftag" label={t('lv.fields.tag')}>
                      <input id="lv-reg-calftag" type="text" inputMode="numeric" value={data.calfTag} onChange={set('calfTag')} className={fieldCls} />
                    </Field>
                    <Field id="lv-reg-calfname" label={t('lv.event.calfName')}>
                      <input id="lv-reg-calfname" type="text" value={data.calfName} onChange={set('calfName')} className={fieldCls} placeholder={t('lv.event.calfNamePh', { name: one?.name || '' })} />
                    </Field>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {type === 'palpacion' && (
          <>
            <Segmented label={t('lv.event.result')} value={data.result} onChange={(v) => put('result', v)}
              options={[['S', t('lv.pregnant')], ['N', t('lv.notPregnant')]]} />
            {data.result === 'S' && (
              <div>
                <label htmlFor="lv-reg-months" className={labelCls}>{t('lv.event.months')}</label>
                <div className="flex items-stretch gap-2">
                  <button type="button" onClick={() => put('months', String(Math.max(0, (num(data.months) ?? 1) - 0.5)))} className={cn(btnPaper, 'w-14 px-0')} aria-label={t('lv.reg.less')}><Minus size={20} /></button>
                  <input id="lv-reg-months" type="text" inputMode="decimal" value={data.months} onChange={set('months')} placeholder="—"
                    className={cn(fieldCls, 'text-center font-display text-[28px]')} />
                  <button type="button" onClick={() => put('months', String(Math.min(9.5, (num(data.months) ?? 0) + 0.5)))} className={cn(btnPaper, 'w-14 px-0')} aria-label={t('lv.reg.more')}><Plus size={20} /></button>
                </div>
              </div>
            )}
          </>
        )}

        {(type === 'peso' || type === 'destete') && (
          <Field id="lv-reg-kg" label={t('lv.event.kg')}>
            <input id="lv-reg-kg" type="text" inputMode="decimal" value={data.kg} onChange={set('kg')} placeholder="380" data-autofocus=""
              className={cn(fieldCls, 'font-display text-[28px] min-h-[60px]')} />
          </Field>
        )}

        {type === 'leche' && (
          <>
            <Segmented label={t('lv.event.shiftLabel')} value={data.shift} onChange={(v) => put('shift', v)}
              options={[['am', t('lv.shift.am')], ['pm', t('lv.shift.pm')]]} />
            {chosen.length === 1 ? (
              <Field id="lv-reg-liters" label={t('lv.event.liters')}>
                <input id="lv-reg-liters" type="text" inputMode="decimal" value={liters[chosen[0].id] ?? data.liters} onChange={(e) => setLiters({ [chosen[0].id]: e.target.value })} placeholder="8" data-autofocus=""
                  className={cn(fieldCls, 'font-display text-[28px] min-h-[60px]')} />
              </Field>
            ) : (
              <div>
                <span className={labelCls}>{t('lv.reg.litersEach')}</span>
                <ul className="space-y-1.5">
                  {chosen.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-3 min-h-[60px] px-3 rounded-2xl bg-finca-surface border border-finca-line">
                      <ChapaTag animal={a} size="sm" />
                      <label htmlFor={`lv-reg-l-${a.id}`} className="flex-1 min-w-0 text-[15px] font-semibold truncate">{a.name}</label>
                      <input id={`lv-reg-l-${a.id}`} type="text" inputMode="decimal" value={liters[a.id] ?? ''} data-autofocus={i === 0 ? '' : undefined}
                        onChange={(e) => setLiters((m) => ({ ...m, [a.id]: e.target.value }))} placeholder="L"
                        className={cn(fieldCls, 'w-24 text-right text-[18px] font-semibold')} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {type === 'vacuna' && (
          <div className="grid grid-cols-2 gap-3">
            <Field id="lv-reg-product" label={t('lv.event.product')}><input id="lv-reg-product" type="text" value={data.product} onChange={set('product')} className={fieldCls} placeholder={t('lv.event.productPh')} /></Field>
            <Field id="lv-reg-dose" label={t('lv.event.dose')}><input id="lv-reg-dose" type="text" value={data.dose} onChange={set('dose')} className={fieldCls} placeholder="5 ml" /></Field>
          </div>
        )}
        {type === 'salud' && (
          <div className="space-y-3">
            <Field id="lv-reg-reason" label={t('lv.event.reason')}><input id="lv-reg-reason" type="text" value={data.reason} onChange={set('reason')} className={fieldCls} placeholder={t('lv.event.reasonPh')} /></Field>
            <Field id="lv-reg-product" label={t('lv.event.product')}><input id="lv-reg-product" type="text" value={data.product} onChange={set('product')} className={fieldCls} placeholder={t('lv.event.productPh')} /></Field>
          </div>
        )}

        {type === 'servicio' && (
          <>
            <Segmented label={t('lv.event.serviceKind')} value={data.kind} onChange={(v) => put('kind', v)}
              options={[['monta', t('lv.serviceKind.monta')], ['ia', t('lv.serviceKind.ia')]]} />
            <Field id="lv-reg-sire" label={t('lv.fields.sire')}>
              {sires.length ? (
                <select id="lv-reg-sire" value={data.sire_id} onChange={set('sire_id')} className={fieldCls}>
                  <option value="">{t('lv.form.unknown')}</option>
                  {sires.map((a) => <option key={a.id} value={a.id}>{a.name}{a.tag ? ` · ${a.tag}` : ''}</option>)}
                </select>
              ) : (
                <input id="lv-reg-sire" type="text" value={data.sire} onChange={set('sire')} className={fieldCls} placeholder={t('lv.event.sirePh')} />
              )}
            </Field>
          </>
        )}

        {type === 'traslado' && (
          <div>
            <span className={labelCls}>{t('lv.event.newLot')}</span>
            {lots.filter((l) => l !== one?.lot).length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {lots.filter((l) => l !== one?.lot).map((l) => (
                  <button key={l} type="button" aria-pressed={data.lot === l} onClick={() => put('lot', l)}
                    className={cn('min-h-[44px] px-4 rounded-full border text-[15px] font-medium', data.lot === l ? 'bg-finca-forest border-finca-forest text-white' : 'bg-finca-surface border-finca-line text-finca-ink')}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            <input type="text" value={data.lot} onChange={set('lot')} className={fieldCls} placeholder={t('lv.reg.otherLot')} aria-label={t('lv.event.newLot')} />
          </div>
        )}

        {type === 'venta' && (
          <div className="space-y-3">
            <Field id="lv-reg-buyer" label={t('lv.event.buyer')}><input id="lv-reg-buyer" type="text" value={data.buyer} onChange={set('buyer')} className={fieldCls} placeholder={t('lv.event.buyerPh')} /></Field>
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <Field id="lv-reg-price" label={t('lv.event.price')}><input id="lv-reg-price" type="text" inputMode="decimal" value={data.price} onChange={set('price')} className={fieldCls} placeholder="0.00" /></Field>
              <Segmented label={t('lv.event.currency')} value={data.currency} onChange={(v) => put('currency', v)}
                options={CURRENCIES.map((c) => [c, c === 'NIO' ? 'C$' : 'US$'])} />
            </div>
          </div>
        )}

        {type === 'muerte' && (
          <Field id="lv-reg-cause" label={t('lv.event.cause')}><input id="lv-reg-cause" type="text" value={data.cause} onChange={set('cause')} className={fieldCls} placeholder={t('lv.event.causePh')} /></Field>
        )}

        <Field id="lv-reg-note" label={t('lv.fields.note')}>
          <textarea id="lv-reg-note" value={note} onChange={(e) => setNote(e.target.value)} className={cn(fieldCls, 'min-h-[80px] py-3')} placeholder={t('lv.event.notePh')} />
        </Field>
      </div>
    </Sheet>
  );
}
