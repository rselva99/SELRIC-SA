import { useMemo, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { useT } from '../../i18n/I18nContext';
import { inputCls } from './docParts';

// The competitor dataset, edited as a form: one market, one competitor at a
// time — name, region, pricing model, entry and comparable prices, tiers,
// every feature as 0 / 1 / 2, the two bullet lists, source and date. A raw
// JSON view of the whole dataset sits behind a toggle as the fallback. Saving
// hands the new dataset back; the caller writes it as a new document version.

const MARKETS = ['business', 'ganaderia'];
const lines = (xs) => (xs || []).join('\n');
const unlines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const numOrNull = (s) => { if (s === '' || s == null) return null; const n = Number(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };

export default function CompetitorForm({ dataset, onSave, onClose, busy }) {
  const { t, lang } = useT();
  const T = (k, vars) => t(`ceoComp.${k}`, vars);
  const [data, setData] = useState(() => structuredClone(dataset));
  const [market, setMarket] = useState('business');
  const [key, setKey] = useState(() => dataset.business?.competitors?.[0]?.key || '');
  const [raw, setRaw] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState('');

  const M = data[market];
  const idx = useMemo(() => (M?.competitors || []).findIndex((c) => c.key === key), [M, key]);
  const c = idx >= 0 ? M.competitors[idx] : null;
  const update = (fn) => setData((d) => { const n = structuredClone(d); fn(n[market].competitors[idx], n); return n; });
  const field = (label, value, onChange, extra = {}) => (
    <label className="block"><span className="block text-xs font-medium text-surface-600 mb-1">{label}</span><input className={inputCls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...extra} /></label>
  );

  function pickMarket(m) { setMarket(m); setKey(data[m]?.competitors?.[0]?.key || ''); }
  function openRaw() { setRawText(JSON.stringify(data, null, 2)); setRawError(''); setRaw(true); }
  function applyRaw() { try { const parsed = JSON.parse(rawText); if (!parsed.business || !parsed.ganaderia) throw new Error('markets'); setData(parsed); setRaw(false); setRawError(''); } catch { setRawError(T('invalidJson')); } }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-white shadow-modal overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-surface-200 px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="font-display text-lg text-brand-950">{T('editDataset')}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => (raw ? setRaw(false) : openRaw())} className="btn-secondary text-xs">{raw ? T('form') : T('raw')}</button>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-surface-400 hover:bg-surface-100" aria-label={T('cancel')}><X size={18} /></button>
          </div>
        </div>

        {raw ? (
          <div className="px-5 py-4">
            <textarea className={inputCls + ' font-mono text-xs leading-relaxed'} rows={30} value={rawText} onChange={(e) => setRawText(e.target.value)} />
            {rawError && <div className="mt-1 text-xs text-red-600">{rawError}</div>}
            <div className="mt-3 flex gap-2"><button type="button" onClick={applyRaw} className="btn-primary">{T('form')} ←</button></div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="block text-xs font-medium text-surface-600 mb-1">{T('market')}</span>
                <select className={inputCls} value={market} onChange={(e) => pickMarket(e.target.value)}>{MARKETS.map((m) => <option key={m} value={m}>{T(m)}</option>)}</select></label>
              <label className="block"><span className="block text-xs font-medium text-surface-600 mb-1">{T('competitor')}</span>
                <select className={inputCls} value={key} onChange={(e) => setKey(e.target.value)}>{(M?.competitors || []).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></label>
            </div>

            {c && (<>
              <div className="grid grid-cols-2 gap-3">
                {field(T('name'), c.name, (v) => update((x) => { x.name = v; }))}
                {field(T('region'), c.region, (v) => update((x) => { x.region = v; }))}
              </div>
              {field(T('model'), c.pricing?.model, (v) => update((x) => { (x.pricing ||= {}).model = v; }))}
              {c.self ? (
                <div className="rounded-lg bg-brand-50 border border-brand-200 px-3 py-2 text-xs text-brand-900">{T('ours')}: {T('fromModel')} — <span className="font-mono">{c.pricing?.priceToken}</span></div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {field(T('entryPrice'), c.pricing?.entryUsdMonth, (v) => update((x) => { (x.pricing ||= {}).entryUsdMonth = numOrNull(v); }), { inputMode: 'decimal' })}
                  {field(T('comparablePrice'), c.pricing?.comparableUsdMonth, (v) => update((x) => { (x.pricing ||= {}).comparableUsdMonth = numOrNull(v); }), { inputMode: 'decimal' })}
                  {field(T('comparableNote'), c.pricing?.comparableNote, (v) => update((x) => { (x.pricing ||= {}).comparableNote = v; }))}
                </div>
              )}
              {!c.self && (
                <div>
                  <div className="text-xs font-medium text-surface-600 mb-1">{T('tiers')}</div>
                  <div className="space-y-1.5">
                    {(c.pricing?.tiers || []).map((tier, i) => (
                      <div key={i} className="grid grid-cols-[1fr_90px_70px_1fr_auto] gap-2 items-center">
                        <input className={inputCls} placeholder={T('tierName')} value={tier.name ?? ''} onChange={(e) => update((x) => { x.pricing.tiers[i].name = e.target.value; })} />
                        <input className={inputCls} placeholder={T('usdMonth')} inputMode="decimal" value={tier.usdMonth ?? ''} onChange={(e) => update((x) => { x.pricing.tiers[i].usdMonth = numOrNull(e.target.value); })} />
                        <input className={inputCls} placeholder={T('users')} inputMode="numeric" value={tier.users ?? ''} onChange={(e) => update((x) => { x.pricing.tiers[i].users = numOrNull(e.target.value); })} />
                        <input className={inputCls} placeholder={T('note')} value={tier.note ?? ''} onChange={(e) => update((x) => { x.pricing.tiers[i].note = e.target.value; })} />
                        <button type="button" onClick={() => update((x) => { x.pricing.tiers.splice(i, 1); })} className="p-1.5 text-surface-400 hover:text-red-600" aria-label={T('remove')}><Trash2 size={14} /></button>
                      </div>
                    ))}
                    <button type="button" onClick={() => update((x) => { ((x.pricing ||= {}).tiers ||= []).push({ name: '', usdMonth: null }); })} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"><Plus size={13} /> {T('addTier')}</button>
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-medium text-surface-600 mb-1">{T('features')} <span className="font-normal text-surface-400">· {T('scoreLegend')}</span></div>
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {(M.features || []).map((f) => (
                    <div key={f.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-surface-700 truncate">{lang === 'es' && f.es ? f.es : f.label}</span>
                      <div className="inline-flex rounded-md border border-surface-200 overflow-hidden shrink-0">
                        {[0, 1, 2].map((v) => <button key={v} type="button" onClick={() => update((x) => { (x.features ||= {})[f.key] = v; })} className={`px-2.5 py-1 text-xs font-mono ${(c.features?.[f.key] ?? 0) === v ? (v === 2 ? 'bg-brand-600 text-white' : v === 1 ? 'bg-brand-200 text-brand-900' : 'bg-surface-200 text-surface-700') : 'text-surface-400 hover:bg-surface-50'}`}>{v}</button>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {!c.self && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block"><span className="block text-xs font-medium text-surface-600 mb-1">{T('betterAtUs')} <span className="font-normal text-surface-400">· {T('oneLine')}</span></span><textarea rows={5} className={inputCls} value={lines(c.betterAtUs)} onChange={(e) => update((x) => { x.betterAtUs = unlines(e.target.value); })} /></label>
                  <label className="block"><span className="block text-xs font-medium text-surface-600 mb-1">{T('weakerThanUs')} <span className="font-normal text-surface-400">· {T('oneLine')}</span></span><textarea rows={5} className={inputCls} value={lines(c.weakerThanUs)} onChange={(e) => update((x) => { x.weakerThanUs = unlines(e.target.value); })} /></label>
                </div>
              )}
              <div className="grid grid-cols-[1fr_150px] gap-3">
                {field(T('source'), c.source, (v) => update((x) => { x.source = v; }))}
                {field(T('checked'), c.checked, (v) => update((x) => { x.checked = v; }), { type: 'date' })}
              </div>
            </>)}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-100">
              <button type="button" disabled={busy} onClick={onClose} className="btn-secondary">{T('cancel')}</button>
              <button type="button" disabled={busy} onClick={() => onSave(data, c ? `${T('editDataset')}: ${c.name}` : T('editDataset'))} className="btn-primary">{busy ? <Spinner size="sm" className="text-white" /> : <><Save size={15} /> {T('save')}</>}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
