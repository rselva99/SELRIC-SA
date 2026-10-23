import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, X } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { useT } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { useHerd } from './HerdContext';
import { AnimalAvatar, EventIcon } from './components';
import { EVENT_TYPES, FEMALE_EVENTS, CURRENCIES, todayISO, isActive } from './lib';

// Record one event: pick the animal (or come in with one), pick the type,
// fill the two or three fields that type needs, save. The RPC applies what
// the event means to the card (calvings, pregnancy, weight, lot, status).

function searchAnimals(animals, q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return animals
    .filter((a) => a.name.toLowerCase().includes(s) || (a.tag && a.tag.toLowerCase().includes(s)) || (a.aliases || []).some((x) => x.toLowerCase().includes(s)))
    .sort((a, b) => (isActive(b) - isActive(a)) || a.name.localeCompare(b.name))
    .slice(0, 8);
}

const EMPTY_DATA = { calf_sex: 'H', create_calf: true, calf_name: '', result: 'S', months: '', kg: '', liters: '', shift: 'am', product: '', dose: '', reason: '', kind: 'monta', sire_id: '', sire: '', lot: '', buyer: '', price: '', currency: 'NIO', cause: '' };

export default function EventForm({ open, onClose, animal: fixedAnimal = null, type: initialType = null, onSaved }) {
  const { t } = useT();
  const { animals, lots, recordEvent } = useHerd();
  const [animal, setAnimal] = useState(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState(null);
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState(EMPTY_DATA);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset when the modal opens — not on every herd refresh while it is open.
  useEffect(() => {
    if (!open) return;
    setAnimal(fixedAnimal || null);
    setQuery('');
    setType(initialType || null);
    setDate(todayISO());
    setData(EMPTY_DATA);
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixedAnimal?.id, initialType]);

  const matches = useMemo(() => searchAnimals(animals, query), [animals, query]);
  const sires = useMemo(() => animals.filter((a) => a.sex === 'M' && isActive(a) && a.species === (animal?.species || 'bovino')), [animals, animal]);
  const types = useMemo(() => EVENT_TYPES.filter((e) => !animal || animal.sex === 'H' || !FEMALE_EVENTS.has(e.key)), [animal]);
  const def = type ? EVENT_TYPES.find((e) => e.key === type) : null;

  const set = (k) => (e) => setData((d) => ({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const num = (v) => (v === '' || v == null ? null : Number(v));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!animal) { toast.error(t('lv.event.pickAnimal')); return; }
    if (!type) { toast.error(t('lv.event.pickType')); return; }
    const d = {};
    for (const f of def.fields) {
      const v = data[f];
      if (f === 'create_calf') d.create_calf = !!v;
      else if (f === 'calf_name') { if (v.trim()) d.calf_name = v.trim(); }
      else if (f === 'months' || f === 'kg' || f === 'liters' || f === 'price') { if (num(v) != null && Number.isFinite(num(v))) d[f] = num(v); }
      else if (f === 'sire') { if (data.sire_id) d.sire_id = data.sire_id; else if (data.sire.trim()) d.sire = data.sire.trim(); }
      else if (typeof v === 'string') { if (v.trim()) d[f] = v.trim(); }
      else if (v != null) d[f] = v;
    }
    if (type === 'peso' && d.kg == null) { toast.error(t('lv.event.kgRequired')); return; }
    if (type === 'leche' && d.liters == null) { toast.error(t('lv.event.litersRequired')); return; }
    if (type === 'traslado' && !d.lot) { toast.error(t('lv.event.lotRequired')); return; }
    setSaving(true);
    try {
      const res = await recordEvent({ animal_id: animal.id, type, date, data: d, note: note.trim() });
      toast.success(t('lv.event.saved', { type: t(`lv.types.${type}`), name: animal.name }));
      onSaved?.(res);
      onClose();
    } catch (err) {
      toast.error(err.message || t('lv.event.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const label = 'block text-xs font-semibold text-surface-600 mb-1.5';
  const seg = (on) => cn('flex-1 py-1.5 rounded-md text-sm font-medium transition-colors', on ? 'bg-white shadow-card text-surface-900' : 'text-surface-500 hover:text-surface-800');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={animal ? t('lv.event.titleFor', { name: animal.name }) : t('lv.event.title')}
      size="lg"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" form="lv-event-form" disabled={saving || !animal || !type} className="btn-primary">
            {saving ? <Spinner size="sm" className="text-white" /> : t('lv.event.save')}
          </button>
        </div>
      )}
    >
      <form id="lv-event-form" onSubmit={handleSubmit} className="space-y-5">
        {/* 1. The animal */}
        {!fixedAnimal && (
          <div>
            <label htmlFor="lv-ev-animal" className={label}>{t('lv.event.animal')}</label>
            {animal ? (
              <div className="flex items-center gap-3 rounded-lg border border-surface-300 bg-surface-50 px-3 py-2">
                <AnimalAvatar animal={animal} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{animal.name}</div>
                  <div className="text-xs text-surface-500">{t(`lv.category.${animal.category}`)}{animal.tag ? ` · ${animal.tag}` : ''}{animal.lot ? ` · ${animal.lot}` : ''}</div>
                </div>
                <button type="button" onClick={() => { setAnimal(null); setType(null); }} className="p-1 rounded text-surface-400 hover:text-surface-700 hover:bg-surface-100" aria-label={t('common.cancel')}><X size={16} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                <input id="lv-ev-animal" type="text" value={query} onChange={(e) => setQuery(e.target.value)} className="input-field pl-9" placeholder={t('lv.event.searchPh')} autoFocus autoComplete="off" />
                {matches.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 mt-1 card max-h-64 overflow-y-auto py-1" role="listbox">
                    {matches.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => { setAnimal(a); setQuery(''); }} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-50">
                          <AnimalAvatar animal={a} size="sm" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-medium truncate">{a.name}{!isActive(a) && <span className="ml-1.5 text-xs text-surface-400">({t(`lv.status.${a.status}`)})</span>}</span>
                            <span className="block text-xs text-surface-500">{t(`lv.category.${a.category}`)}{a.tag ? ` · ${a.tag}` : ''}{a.lot ? ` · ${a.lot}` : ''}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* 2. What happened */}
        <div>
          <label className={label}>{t('lv.event.type')}</label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5" role="radiogroup">
            {types.map((e) => {
              const on = type === e.key;
              return (
                <button key={e.key} type="button" role="radio" aria-checked={on} onClick={() => setType(e.key)} title={t(`lv.types.${e.key}`)}
                  className={cn('flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium transition-colors min-w-0', on ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-surface-200 bg-white text-surface-600 hover:border-surface-300')}>
                  <EventIcon type={e.key} size="sm" />
                  <span className="truncate max-w-full">{t(`lv.types.${e.key}`)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. The details */}
        {def && (
          <div className="grid sm:grid-cols-2 gap-4 rounded-xl bg-surface-50 border border-surface-200 p-4">
            <div>
              <label htmlFor="lv-ev-date" className={label}>{t('lv.fields.date')}</label>
              <input id="lv-ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-field" required />
            </div>

            {def.fields.includes('calf_sex') && (
              <div>
                <label className={label}>{t('lv.event.calfSex')}</label>
                <div className="flex rounded-lg bg-surface-100 p-0.5" role="radiogroup">
                  {['H', 'M'].map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={data.calf_sex === s} onClick={() => setData((d) => ({ ...d, calf_sex: s }))} className={seg(data.calf_sex === s)}>
                      {t(s === 'M' ? 'lv.calfMale' : 'lv.calfFemale')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {def.fields.includes('create_calf') && (
              <div className="sm:col-span-2 grid sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-2.5 text-sm text-surface-700 select-none">
                  <input type="checkbox" checked={!!data.create_calf} onChange={set('create_calf')} className="w-4 h-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500/30" />
                  {t('lv.event.createCalf')}
                </label>
                {data.create_calf && (
                  <div>
                    <input type="text" value={data.calf_name} onChange={set('calf_name')} className="input-field" placeholder={t('lv.event.calfNamePh', { name: animal?.name || '' })} aria-label={t('lv.event.calfName')} />
                  </div>
                )}
              </div>
            )}

            {def.fields.includes('result') && (
              <div>
                <label className={label}>{t('lv.event.result')}</label>
                <div className="flex rounded-lg bg-surface-100 p-0.5" role="radiogroup">
                  {['S', 'N'].map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={data.result === r} onClick={() => setData((d) => ({ ...d, result: r }))} className={seg(data.result === r)}>
                      {t(r === 'S' ? 'lv.pregnant' : 'lv.notPregnant')}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {def.fields.includes('months') && data.result === 'S' && (
              <div>
                <label htmlFor="lv-ev-months" className={label}>{t('lv.event.months')}</label>
                <input id="lv-ev-months" type="number" inputMode="decimal" step="0.5" min="0" max="12" value={data.months} onChange={set('months')} className="input-field" placeholder="6" />
              </div>
            )}

            {def.fields.includes('kg') && (
              <div>
                <label htmlFor="lv-ev-kg" className={label}>{t('lv.event.kg')}</label>
                <input id="lv-ev-kg" type="number" inputMode="decimal" step="0.5" min="0" value={data.kg} onChange={set('kg')} className="input-field" placeholder="380" required={type === 'peso'} />
              </div>
            )}
            {def.fields.includes('liters') && (
              <div>
                <label htmlFor="lv-ev-liters" className={label}>{t('lv.event.liters')}</label>
                <input id="lv-ev-liters" type="number" inputMode="decimal" step="0.5" min="0" value={data.liters} onChange={set('liters')} className="input-field" placeholder="4" required />
              </div>
            )}
            {def.fields.includes('shift') && (
              <div>
                <label className={label}>{t('lv.event.shiftLabel')}</label>
                <div className="flex rounded-lg bg-surface-100 p-0.5" role="radiogroup">
                  {['am', 'pm'].map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={data.shift === s} onClick={() => setData((d) => ({ ...d, shift: s }))} className={seg(data.shift === s)}>
                      {t(`lv.shift.${s}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {def.fields.includes('reason') && (
              <div>
                <label htmlFor="lv-ev-reason" className={label}>{t('lv.event.reason')}</label>
                <input id="lv-ev-reason" type="text" value={data.reason} onChange={set('reason')} className="input-field" placeholder={t('lv.event.reasonPh')} />
              </div>
            )}
            {def.fields.includes('product') && (
              <div>
                <label htmlFor="lv-ev-product" className={label}>{t('lv.event.product')}</label>
                <input id="lv-ev-product" type="text" value={data.product} onChange={set('product')} className="input-field" placeholder={t('lv.event.productPh')} />
              </div>
            )}
            {def.fields.includes('dose') && (
              <div>
                <label htmlFor="lv-ev-dose" className={label}>{t('lv.event.dose')}</label>
                <input id="lv-ev-dose" type="text" value={data.dose} onChange={set('dose')} className="input-field" placeholder="5 ml" />
              </div>
            )}

            {def.fields.includes('kind') && (
              <div>
                <label className={label}>{t('lv.event.serviceKind')}</label>
                <div className="flex rounded-lg bg-surface-100 p-0.5" role="radiogroup">
                  {['monta', 'ia'].map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={data.kind === k} onClick={() => setData((d) => ({ ...d, kind: k }))} className={seg(data.kind === k)}>
                      {t(`lv.serviceKind.${k}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {def.fields.includes('sire') && (
              <div>
                <label htmlFor="lv-ev-sire" className={label}>{t('lv.fields.sire')}</label>
                {sires.length ? (
                  <select id="lv-ev-sire" value={data.sire_id} onChange={set('sire_id')} className="input-field">
                    <option value="">{t('lv.form.unknown')}</option>
                    {sires.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : (
                  <input id="lv-ev-sire" type="text" value={data.sire} onChange={set('sire')} className="input-field" placeholder={t('lv.event.sirePh')} />
                )}
              </div>
            )}

            {def.fields.includes('lot') && (
              <div>
                <label htmlFor="lv-ev-lot" className={label}>{t('lv.event.newLot')}</label>
                <input id="lv-ev-lot" type="text" value={data.lot} onChange={set('lot')} className="input-field" list="lv-ev-lots" placeholder={t('lv.form.lotPh')} required />
                <datalist id="lv-ev-lots">{lots.map((l) => <option key={l} value={l} />)}</datalist>
              </div>
            )}

            {def.fields.includes('buyer') && (
              <div>
                <label htmlFor="lv-ev-buyer" className={label}>{t('lv.event.buyer')}</label>
                <input id="lv-ev-buyer" type="text" value={data.buyer} onChange={set('buyer')} className="input-field" placeholder={t('lv.event.buyerPh')} />
              </div>
            )}
            {def.fields.includes('price') && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="lv-ev-price" className={label}>{t('lv.event.price')}</label>
                  <input id="lv-ev-price" type="number" inputMode="decimal" step="0.01" min="0" value={data.price} onChange={set('price')} className="input-field" placeholder="0.00" />
                </div>
                <div className="w-24">
                  <label htmlFor="lv-ev-cur" className={label}>{t('lv.event.currency')}</label>
                  <select id="lv-ev-cur" value={data.currency} onChange={set('currency')} className="input-field">
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c === 'NIO' ? 'C$' : 'US$'}</option>)}
                  </select>
                </div>
              </div>
            )}
            {def.fields.includes('cause') && (
              <div>
                <label htmlFor="lv-ev-cause" className={label}>{t('lv.event.cause')}</label>
                <input id="lv-ev-cause" type="text" value={data.cause} onChange={set('cause')} className="input-field" placeholder={t('lv.event.causePh')} />
              </div>
            )}

            <div className="sm:col-span-2">
              <label htmlFor="lv-ev-note" className={label}>{t('lv.fields.note')}</label>
              <textarea id="lv-ev-note" value={note} onChange={(e) => setNote(e.target.value)} className="input-field min-h-[64px]" placeholder={t('lv.event.notePh')} />
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
