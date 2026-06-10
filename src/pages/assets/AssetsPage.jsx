import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  CAPITALIZE_REMINDER,
  CAPITALIZE_REMINDER_SHORT,
  undoBlockers,
  undoCapitalization,
  findReclassJEForAsset,
} from '../../lib/capitalize';
import {
  combinedMonthly,
  monthlyForAsset,
  monthsThrough,
  existingDepreciationPeriods,
  generateDepreciationThrough,
  projectedTotalAcrossPeriods,
  DEPRECIATION_START_PERIOD,
} from '../../lib/depreciation';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import toast from 'react-hot-toast';
import {
  Plus, ChevronDown, ChevronRight, Edit3, Archive, RotateCcw,
  Loader2, CheckCircle2, AlertCircle, Calculator, Sprout, Undo2, Info,
} from 'lucide-react';

// ── Seed spec — exactly what the dry-run promised. Asserted before insert. ──
const ASSET_SEEDS = [
  { name: 'Construction Costs LHI',          asset_class: 'Leasehold Improvements', asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 15, cost:    1204.62 },
  { name: 'Kitchen Equipment',               asset_class: 'Kitchen & Bar Equipment', asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 15, cost:  109247.16 },
  { name: 'Light and Sound',                 asset_class: 'Technology & POS',        asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 15, cost:    6943.36 },
  { name: 'Patio',                           asset_class: 'Patio & Furniture',       asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 15, cost:    1500.00 },
  { name: 'POS Hardware - Spoton',           asset_class: 'Technology & POS',        asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 15, cost:   10189.16 },
  { name: 'LHI - Additions from DWC',        asset_class: 'Leasehold Improvements', asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 15, cost:  189467.23 },
  { name: 'LHI - Additions from John & Sarah', asset_class: 'Leasehold Improvements', asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 15, cost: 237260.59 },
  { name: 'Doors',                           asset_class: 'Building Components',     asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 39, cost:    8801.91 },
  { name: 'Drywall',                         asset_class: 'Building Components',     asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 39, cost:   10265.05 },
  { name: 'Electrical Work',                 asset_class: 'Building Components',     asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 39, cost:   56451.98 },
  { name: 'Floors',                          asset_class: 'Building Components',     asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 39, cost:   30035.70 },
  { name: 'Framing',                         asset_class: 'Building Components',     asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 39, cost:    3429.83 },
  { name: 'HVAC',                            asset_class: 'Building Components',     asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 39, cost:   34783.19 },
  { name: 'Plumbing',                        asset_class: 'Building Components',     asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 39, cost:   78594.18 },
  { name: 'Flooring - Tile',                 asset_class: 'Building Components',     asset_type: 'depreciable', in_service_date: '2022-01-01', life_years: 39, cost:    8170.93 },
  { name: 'Patio Heaters',                   asset_class: 'Patio & Furniture',       asset_type: 'depreciable', in_service_date: '2023-03-10', life_years:  7, cost:    3690.00 },
  { name: 'Fencing',                         asset_class: 'Patio & Furniture',       asset_type: 'depreciable', in_service_date: '2023-02-05', life_years:  7, cost:   11899.00 },
  { name: 'Patio Lighting',                  asset_class: 'Patio & Furniture',       asset_type: 'depreciable', in_service_date: '2023-03-10', life_years: 15, cost:    7290.00 },
  { name: 'Pergolas',                        asset_class: 'Patio & Furniture',       asset_type: 'depreciable', in_service_date: '2023-05-01', life_years: 15, cost:    8997.00 },
  { name: 'Catering Equipment',              asset_class: 'Kitchen & Bar Equipment', asset_type: 'depreciable', in_service_date: '2023-10-20', life_years: 15, cost:    5200.00 },
  { name: 'Start-up Costs',                  asset_class: 'Intangibles',             asset_type: 'amortizable', in_service_date: '2022-01-01', life_years: 15, cost:  175564.72 },
];

const EXPECTED_DEPRECIABLE_TOTAL = 823420.89;
const EXPECTED_GRAND_TOTAL       = 998985.61;

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function AssetsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [assets, setAssets]   = useState([]);
  // Map asset.id → originating transaction row, populated alongside assets so
  // we can offer Undo capitalization without a per-row query.
  const [originByAssetId, setOriginByAssetId] = useState({});
  const [state, setState]     = useState('loading'); // loading | error | ready
  const [error, setError]     = useState(null);

  const [editing, setEditing] = useState(null); // asset row or 'new'
  const [seedOpen, setSeedOpen]   = useState(false);
  const [depOpen, setDepOpen]     = useState(false);
  const [depPreset, setDepPreset] = useState(null); // { through, replace } when opened from a deep link
  const [undoTarget, setUndoTarget] = useState(null); // asset row

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    const [assetsRes, originsRes] = await Promise.all([
      supabase.from('assets').select('*').order('asset_class').order('name'),
      supabase.from('transactions').select('id, date, description, supplier, amount, category, capitalized_asset_id').not('capitalized_asset_id', 'is', null).eq('voided', false),
    ]);
    if (assetsRes.error) { setError(assetsRes.error); setState('error'); return; }
    setAssets(assetsRes.data || []);
    const map = {};
    for (const t of originsRes.data || []) map[t.capitalized_asset_id] = t;
    setOriginByAssetId(map);
    setState('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  // Deep-link from the Capitalize success toast: ?openDA=replace&through=YYYY-MM
  // opens the depreciation modal preset to that month with Replace ticked.
  useEffect(() => {
    if (searchParams.get('openDA') !== 'replace') return;
    const through = searchParams.get('through') || null;
    setDepPreset({ through, replace: true });
    setDepOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('openDA');
    next.delete('through');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Compute per-asset NBV from theoretical straight-line schedule.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const enriched = useMemo(() => assets.map(a => {
    const monthly = monthlyForAsset(a);
    const endDate = a.status === 'retired' && a.retired_date ? a.retired_date : today;
    const monthsActive = monthsBetween(a.in_service_date, endDate);
    const capped = Math.min(monthsActive, (Number(a.life_years) || 0) * 12);
    const accum  = Math.min(monthly * capped, Number(a.cost) || 0);
    const nbv    = Math.max(0, (Number(a.cost) || 0) - accum);
    return { ...a, monthly, accum, nbv };
  }), [assets, today]);

  const summary = useMemo(() => {
    const active = enriched.filter(a => a.status === 'active');
    return {
      totalCost: enriched.reduce((s, a) => s + Number(a.cost || 0), 0),
      totalAccum: enriched.reduce((s, a) => s + a.accum, 0),
      totalNBV:  enriched.reduce((s, a) => s + a.nbv,   0),
      monthly:    active.reduce((s, a) => s + a.monthly, 0),
      activeCount: active.length,
    };
  }, [enriched]);

  const byClass = useMemo(() => {
    const map = new Map();
    for (const a of enriched) {
      const list = map.get(a.asset_class) || [];
      list.push(a);
      map.set(a.asset_class, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [enriched]);

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
        <div>
          <h1 className="page-title">Assets</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            Fixed-asset register · straight-line depreciation &amp; amortization
          </p>
        </div>
        <div className="flex gap-2">
          {assets.length === 0 && state === 'ready' && (
            <button onClick={() => setSeedOpen(true)} className="btn-secondary text-sm flex items-center gap-2">
              <Sprout size={14} /> Seed initial assets
            </button>
          )}
          <button onClick={() => setDepOpen(true)} disabled={assets.length === 0} className="btn-secondary text-sm flex items-center gap-2">
            <Calculator size={14} /> Generate D&amp;A
          </button>
          <button onClick={() => setEditing({})} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> New Asset
          </button>
        </div>
      </div>

      <CapitalizeReminderCard />

      {state === 'loading' && <div className="flex justify-center py-10"><Spinner size="lg" /></div>}
      {state === 'error' && (
        <div className="card p-5 border-red-200 bg-red-50 text-sm text-red-700">
          Could not load assets: {error?.message || 'unknown error'}.
          <button onClick={load} className="ml-3 underline">Retry</button>
        </div>
      )}

      {state === 'ready' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5">
            <StatPill label="Active assets" value={summary.activeCount} />
            <StatPill label="Total cost"    value={formatCurrency(summary.totalCost)} />
            <StatPill label="Accumulated D&A"  value={formatCurrency(summary.totalAccum)} tone="amber" />
            <StatPill label="Net Book Value" value={formatCurrency(summary.totalNBV)} tone="green" />
          </div>

          {assets.length === 0 ? (
            <div className="card p-10 text-center">
              <div className="text-surface-500 text-sm">No assets yet. Seed the initial 21-asset register, or add one manually.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {byClass.map(([cls, list]) => {
                const classCost  = list.reduce((s, a) => s + Number(a.cost  || 0), 0);
                const classAccum = list.reduce((s, a) => s + a.accum, 0);
                const classNBV   = list.reduce((s, a) => s + a.nbv,   0);
                return (
                  <div key={cls} className="card overflow-hidden">
                    <div className="px-5 py-3 bg-surface-50 border-b border-surface-100 flex items-center justify-between">
                      <div>
                        <span className="font-display text-base">{cls}</span>
                        <span className="ml-2 text-xs text-surface-400">{list.length} {list.length === 1 ? 'asset' : 'assets'}</span>
                      </div>
                      <div className="text-xs text-surface-500 flex items-center gap-5 font-mono">
                        <span>Cost <span className="text-surface-800 font-semibold">{formatCurrency(classCost)}</span></span>
                        <span>Accum <span className="text-amber-700 font-semibold">{formatCurrency(classAccum)}</span></span>
                        <span>NBV <span className="text-green-700 font-semibold">{formatCurrency(classNBV)}</span></span>
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-surface-400">
                          <th className="px-5 py-2 text-left">Asset</th>
                          <th className="px-3 py-2 text-left">In service</th>
                          <th className="px-3 py-2 text-right">Life (yrs)</th>
                          <th className="px-3 py-2 text-right">Cost</th>
                          <th className="px-3 py-2 text-right">Monthly</th>
                          <th className="px-3 py-2 text-right">NBV</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map(a => (
                          <tr key={a.id} className={`border-t border-surface-50 hover:bg-surface-50 ${a.status === 'retired' ? 'opacity-60' : ''}`}>
                            <td className="px-5 py-2.5">
                              <div className="text-sm font-medium">{a.name}{a.status === 'retired' && <span className="ml-2 text-[10px] uppercase tracking-wider text-surface-400">retired</span>}</div>
                              {a.serial_or_location && <div className="text-[10px] text-surface-400">{a.serial_or_location}</div>}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs">{formatDate(a.in_service_date)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-xs">{a.life_years}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-xs">{formatCurrency(a.cost)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-xs">{a.status === 'active' ? formatCurrency(a.monthly) : '—'}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-xs text-green-700">{formatCurrency(a.nbv)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="inline-flex items-center justify-end gap-0.5">
                                {originByAssetId[a.id] && (
                                  <button
                                    onClick={() => setUndoTarget(a)}
                                    className="btn-ghost p-1.5 text-surface-400 hover:text-red-600"
                                    title="Undo capitalization">
                                    <Undo2 size={13} />
                                  </button>
                                )}
                                <button onClick={() => setEditing(a)} className="btn-ghost p-1.5 text-surface-400 hover:text-brand-600" title="Edit"><Edit3 size={13} /></button>
                                {a.status === 'active' ? (
                                  <button onClick={() => retireAsset(a, load)} className="btn-ghost p-1.5 text-surface-400 hover:text-amber-600" title="Retire"><Archive size={13} /></button>
                                ) : (
                                  <button onClick={() => unretireAsset(a, load)} className="btn-ghost p-1.5 text-surface-400 hover:text-green-600" title="Unretire"><RotateCcw size={13} /></button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <AssetForm
        asset={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load(); }}
      />

      <SeedModal
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        onSeeded={async () => { setSeedOpen(false); await load(); }}
      />

      <DepreciationModal
        open={depOpen}
        onClose={() => { setDepOpen(false); setDepPreset(null); }}
        assets={assets}
        userId={user?.id}
        preset={depPreset}
        onPosted={() => { setDepOpen(false); setDepPreset(null); }}
      />

      <UndoCapitalizeModal
        asset={undoTarget}
        originatingTxn={undoTarget ? originByAssetId[undoTarget.id] : null}
        onClose={() => setUndoTarget(null)}
        onUndone={async () => { setUndoTarget(null); await load(); }}
      />
    </div>
  );
}

async function retireAsset(asset, reload) {
  const date = prompt('Retirement date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
  if (!date) return;
  const { error } = await supabase.from('assets').update({ status: 'retired', retired_date: date }).eq('id', asset.id);
  if (error) { toast.error(error.message); return; }
  toast.success(`Retired "${asset.name}"`);
  await reload();
}

async function unretireAsset(asset, reload) {
  const { error } = await supabase.from('assets').update({ status: 'active', retired_date: null }).eq('id', asset.id);
  if (error) { toast.error(error.message); return; }
  toast.success(`Restored "${asset.name}"`);
  await reload();
}

// ── helpers ─────────────────────────────────────────────────────────────────
function monthsBetween(startDate, endDate) {
  const a = new Date(startDate);
  const b = new Date(endDate);
  if (b < a) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

function StatPill({ label, value, tone = 'neutral' }) {
  const cls = { green: 'text-green-700', amber: 'text-amber-700', red: 'text-red-700', neutral: 'text-surface-800' }[tone];
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{label}</div>
      <div className={`font-mono text-lg font-semibold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}

// ── Add / edit asset form ───────────────────────────────────────────────────
function AssetForm({ asset, open, onClose, onSaved }) {
  const isNew = asset && !asset.id;
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (asset && asset.id) {
      setForm({
        name: asset.name || '',
        asset_class: asset.asset_class || '',
        asset_type: asset.asset_type || 'depreciable',
        in_service_date: asset.in_service_date || '',
        life_years: String(asset.life_years || ''),
        cost: String(asset.cost || ''),
        serial_or_location: asset.serial_or_location || '',
        notes: asset.notes || '',
      });
    } else {
      setForm(emptyForm());
    }
  }, [open, asset]);

  function emptyForm() {
    return { name: '', asset_class: '', asset_type: 'depreciable', in_service_date: '', life_years: '', cost: '', serial_or_location: '', notes: '' };
  }

  async function submit(e) {
    e.preventDefault();
    const cost = parseFloat(form.cost);
    if (!form.name.trim() || !form.asset_class.trim() || !form.in_service_date || !form.life_years || !cost) {
      toast.error('Name, class, in-service date, life, and cost are required');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        asset_class: form.asset_class.trim(),
        asset_type: form.asset_type,
        in_service_date: form.in_service_date,
        life_years: parseFloat(form.life_years),
        cost,
        serial_or_location: form.serial_or_location.trim() || null,
        notes: form.notes.trim() || null,
      };
      const op = isNew
        ? supabase.from('assets').insert(payload)
        : supabase.from('assets').update(payload).eq('id', asset.id);
      const { error } = await op;
      if (error) throw error;
      toast.success(isNew ? 'Asset added' : 'Asset updated');
      await onSaved();
    } catch (err) {
      toast.error(err.message || 'Failed to save asset');
    } finally {
      setBusy(false);
    }
  }

  const cost = parseFloat(form.cost) || 0;
  const lowCostWarning = cost > 0 && cost < 2500;

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New Asset' : 'Edit Asset'}>
      <form onSubmit={submit} className="space-y-3 p-1">
        <Field label="Name">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-field" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Class">
            <input value={form.asset_class} onChange={e => setForm({ ...form, asset_class: e.target.value })} className="input-field" placeholder="Kitchen & Bar Equipment" />
          </Field>
          <Field label="Type">
            <select value={form.asset_type} onChange={e => setForm({ ...form, asset_type: e.target.value })} className="input-field">
              <option value="depreciable">Depreciable</option>
              <option value="amortizable">Amortizable</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="In service">
            <input type="date" value={form.in_service_date} onChange={e => setForm({ ...form, in_service_date: e.target.value })} className="input-field" />
          </Field>
          <Field label="Life (yrs)">
            <input type="number" min="0" step="0.5" value={form.life_years} onChange={e => setForm({ ...form, life_years: e.target.value })} className="input-field" />
          </Field>
          <Field label="Cost">
            <input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} className="input-field" />
          </Field>
        </div>
        {lowCostWarning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
            {CAPITALIZE_REMINDER_SHORT}
          </div>
        )}
        <Field label="Serial / location (optional)">
          <input value={form.serial_or_location} onChange={e => setForm({ ...form, serial_or_location: e.target.value })} className="input-field" />
        </Field>
        <Field label="Notes (optional)">
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-field" rows={2} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {isNew ? 'Add asset' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ── Seed modal — shows the 21 rows + asserts totals before insert ──────────
function SeedModal({ open, onClose, onSeeded }) {
  const [busy, setBusy] = useState(false);

  const depreciable = ASSET_SEEDS.filter(a => a.asset_type === 'depreciable').reduce((s, a) => s + a.cost, 0);
  const grand       = ASSET_SEEDS.reduce((s, a) => s + a.cost, 0);
  const balanced    = Math.abs(depreciable - EXPECTED_DEPRECIABLE_TOTAL) < 0.005 && Math.abs(grand - EXPECTED_GRAND_TOTAL) < 0.005;

  async function seed() {
    if (!balanced) { toast.error('Seed totals do not match the spec — refusing.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('assets').insert(ASSET_SEEDS.map(a => ({ ...a })));
      if (error) throw error;
      toast.success(`Seeded ${ASSET_SEEDS.length} assets · total ${formatCurrency(grand)}`);
      await onSeeded();
    } catch (err) {
      toast.error(err.message || 'Seed failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Seed initial assets">
      <div className="space-y-3 p-1">
        <p className="text-sm text-surface-600">
          One-time seed of {ASSET_SEEDS.length} assets from the CPA's fixed-asset register.
          The button is disabled if the totals don't match the spec.
        </p>
        <div className="rounded-lg border border-surface-100 max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-50 text-[10px] uppercase tracking-wider text-surface-500">
              <tr>
                <th className="px-3 py-1.5 text-left">Name</th>
                <th className="px-3 py-1.5 text-left">Class</th>
                <th className="px-3 py-1.5 text-right">Life</th>
                <th className="px-3 py-1.5 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {ASSET_SEEDS.map(a => (
                <tr key={a.name} className="border-t border-surface-50">
                  <td className="px-3 py-1 truncate max-w-[160px]" title={a.name}>{a.name}</td>
                  <td className="px-3 py-1 text-surface-500 truncate max-w-[160px]">{a.asset_class}</td>
                  <td className="px-3 py-1 text-right font-mono">{a.life_years}y</td>
                  <td className="px-3 py-1 text-right font-mono">{formatCurrency(a.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs space-y-0.5 font-mono">
          <div className="flex justify-between"><span>Depreciable subtotal</span><span>{formatCurrency(depreciable)} <span className={Math.abs(depreciable - EXPECTED_DEPRECIABLE_TOTAL) < 0.005 ? 'text-green-700' : 'text-red-700'}>(expected {formatCurrency(EXPECTED_DEPRECIABLE_TOTAL)})</span></span></div>
          <div className="flex justify-between"><span>Grand total</span><span>{formatCurrency(grand)} <span className={Math.abs(grand - EXPECTED_GRAND_TOTAL) < 0.005 ? 'text-green-700' : 'text-red-700'}>(expected {formatCurrency(EXPECTED_GRAND_TOTAL)})</span></span></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={seed} disabled={!balanced || busy} className="btn-primary flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />}
            Insert {ASSET_SEEDS.length} assets
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Depreciation catch-up modal ─────────────────────────────────────────────
function DepreciationModal({ open, onClose, assets, userId, onPosted, preset }) {
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [endPeriod, setEndPeriod] = useState(defaultPeriod);
  const [replace, setReplace]     = useState(false);
  const [existing, setExisting]   = useState(null); // Set<string> of YYYY-MM already posted
  const [busy, setBusy]           = useState(false);

  // Apply preset (deep-link from Capitalize) when the modal opens.
  useEffect(() => {
    if (!open || !preset) return;
    if (preset.through) setEndPeriod(preset.through);
    if (preset.replace) setReplace(true);
  }, [open, preset]);

  const monthly = useMemo(() => combinedMonthly(assets, endPeriod), [assets, endPeriod]);
  const periods = useMemo(() => monthsThrough(endPeriod), [endPeriod]);
  const willPostPeriods = useMemo(() => {
    if (!existing) return periods;
    return periods.filter(p => replace || !existing.has(p));
  }, [periods, existing, replace]);
  const willPost = willPostPeriods.length;
  // Sum per-period monthly across the periods we'd actually post — handles
  // assets that come online mid-range or hit end-of-life so the total isn't
  // a flat months×rate estimate.
  const projectedTotal = useMemo(
    () => projectedTotalAcrossPeriods(assets, willPostPeriods),
    [assets, willPostPeriods]
  );

  useEffect(() => {
    if (!open) return;
    setExisting(null);
    existingDepreciationPeriods(periods).then(setExisting).catch(() => setExisting(new Set()));
  }, [open, periods]);

  async function run() {
    setBusy(true);
    try {
      const res = await generateDepreciationThrough({ endPeriod, assets, userId, replace });
      const parts = [];
      if (res.posted.length)   parts.push(`posted ${res.posted.length}`);
      if (res.replaced.length) parts.push(`replaced ${res.replaced.length}`);
      if (res.skipped.length)  parts.push(`skipped ${res.skipped.length}`);
      toast.success(`D&A · ${parts.join(' · ') || 'nothing to do'} · total ${formatCurrency(res.total)}`);
      onPosted?.();
    } catch (err) {
      toast.error(err.message || 'D&A run failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate Depreciation & Amortization">
      <div className="space-y-3 p-1">
        <p className="text-sm text-surface-600">
          Posts one journal entry per month from {DEPRECIATION_START_PERIOD} through the period below.
          Each JE debits <span className="font-mono">Depreciation &amp; Amortization</span> and credits <span className="font-mono">Accumulated D&amp;A</span>.
          Months that already have a JE-DA are skipped unless you tick Replace.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Through (month)">
            <input type="month" value={endPeriod} onChange={e => setEndPeriod(e.target.value)} className="input-field" />
          </Field>
          <Field label="Combined monthly D&A">
            <div className="font-mono text-lg font-semibold pt-1.5">{formatCurrency(monthly)}</div>
          </Field>
        </div>

        <div className="rounded-lg border border-surface-100 bg-surface-50/60 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span>Months in range</span><span className="font-mono">{periods.length}</span></div>
          <div className="flex justify-between"><span>Already posted</span><span className="font-mono">{existing ? existing.size : '…'}</span></div>
          <div className="flex justify-between font-semibold"><span>Will post now</span><span className="font-mono">{willPost} {willPost === 1 ? 'month' : 'months'} · {formatCurrency(projectedTotal)}</span></div>
        </div>

        <label className="flex items-center gap-2 text-sm text-surface-700 cursor-pointer">
          <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
          Replace existing months (wipe + re-post — use after adding or retiring assets)
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={run} disabled={busy || monthly <= 0.005 || willPost === 0} className="btn-primary flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />}
            Post {willPost} {willPost === 1 ? 'month' : 'months'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Capitalization rule reminder — same wording everywhere ──────────────────
function CapitalizeReminderCard() {
  return (
    <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 mb-4 text-xs text-surface-600 flex items-start gap-2">
      <Info size={14} className="mt-0.5 text-surface-500 flex-shrink-0" />
      <span>{CAPITALIZE_REMINDER}</span>
    </div>
  );
}

// ── Undo capitalization modal ───────────────────────────────────────────────
function UndoCapitalizeModal({ asset, originatingTxn, onClose, onUndone }) {
  const [busy, setBusy]   = useState(false);
  const [je, setJE]       = useState(null); // reclass JE if found
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!asset) { setJE(null); setLoaded(false); return; }
    setLoaded(false);
    findReclassJEForAsset(asset.id)
      .then(setJE)
      .catch(() => setJE(null))
      .finally(() => setLoaded(true));
  }, [asset?.id]);

  if (!asset) return null;

  const blockers = undoBlockers(originatingTxn, asset);
  const canUndo = blockers.length === 0 && loaded && !!je;

  async function run() {
    setBusy(true);
    try {
      const { undoneJE } = await undoCapitalization({ originatingTxn, asset });
      toast.success(`Undid capitalization · removed ${undoneJE} and asset "${asset.name}"`);
      await onUndone();
    } catch (err) {
      toast.error(err.message || 'Undo failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!asset} onClose={busy ? () => {} : onClose} title="Undo capitalization">
      <div className="space-y-3 p-1">
        <p className="text-sm text-surface-600">
          Reverses the capitalize for <span className="font-semibold">{asset.name}</span>. This is a 3-step undo:
        </p>
        <ul className="text-sm space-y-1.5">
          <li className="flex items-start gap-2"><span className="text-surface-400">1.</span><span>Void / delete the reclass JE {je ? <span className="font-mono font-semibold">{je.reference}</span> : <span className="text-amber-700">(searching…)</span>} and its mirrored transactions.</span></li>
          <li className="flex items-start gap-2"><span className="text-surface-400">2.</span><span>Delete the asset row <span className="font-mono">{asset.name}</span> (cost {formatCurrency(asset.cost)}).</span></li>
          <li className="flex items-start gap-2"><span className="text-surface-400">3.</span><span>Clear the back-reference on transaction <span className="font-mono text-xs">{originatingTxn?.id?.slice(0, 8) || '—'}</span> so the row becomes capitalizable again.</span></li>
        </ul>

        {blockers.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="text-red-700 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">Cannot undo</div>
                <ul className="list-disc pl-4 mt-0.5 text-xs">
                  {blockers.map(b => <li key={b}>{b}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {loaded && !je && blockers.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
            Reclass JE not found. Refusing to undo to avoid a silent half-rollback — investigate manually.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button onClick={run} disabled={!canUndo || busy} className="btn-primary flex items-center gap-2">
            {busy && <Loader2 size={14} className="animate-spin" />}
            Undo capitalization
          </button>
        </div>
      </div>
    </Modal>
  );
}
