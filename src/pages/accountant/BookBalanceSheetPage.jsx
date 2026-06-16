// Book Balance Sheet Builder — Stage 1 + Stage 2.
//
// Stage 1 (shipped): seed years from the L-code skeleton; per-section read-
// only line list; admin-only route + RLS.
//
// Stage 2 (this file): per-line editor. Each line gets:
//   • Beginning balance input.
//   • Category mappings (multi-select from CoA); each chip shows the year's
//     activity sum (signed under the line's natural side — see
//     lineActivityIsDebitNatural in src/lib/bookBalanceSheet.js).
//   • Manual adjustments (signed amount + note + add/remove).
//   • Computed ending balance with the breakdown shown inline.
//   • Hybrid-mode indicator: a MAPPING-DRIVEN badge (green) when mappings
//     exist, MANUAL-ONLY (gray) when there are none. The badge sits on
//     the line row so you can tell hand-keyed lines from ledger-pulled
//     lines at a glance without opening the editor.
//   • Save Draft / Confirm / Cancel. Confirm snapshots
//     ending_balance_confirmed + stamps confirmed_by + confirmed_at.
//     Save Draft on a previously-confirmed line clears confirmation back
//     to draft (edits invalidate prior confirmation).
//
// Out of scope (later stages):
//   Stage 3 — multi-year columns + roll-forward
//   Stage 4 — year-level lock + official PDF
//   Stage 5 — per-transaction picker

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import {
  BOOK_BS_STRUCTURE,
  SEED_LINE_TITLES,
  buildSeedLinesForYear,
  bookSectionByCode,
  bookGroupLabel,
  bookGroupOrder,
  lineActivityIsDebitNatural,
  computeMappingActivity,
  computeLineEnding,
} from '../../lib/bookBalanceSheet';
import { formatCurrency } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import toast from 'react-hot-toast';
import {
  BookOpen, Plus, ChevronLeft, ChevronDown, ChevronRight, Trash2, Info, Lock,
  AlertCircle, CheckCircle2, X, Save, Edit3, Layers, PenSquare,
} from 'lucide-react';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function BookBalanceSheetPage() {
  const { user } = useAuth();
  const { categories } = useData();

  // ── Year + statement state ──────────────────────────────────────────────
  const [years, setYears]               = useState([]);
  const [statements, setStatements]     = useState({});
  const [selectedYear, setSelectedYear] = useState(null);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [addingYear, setAddingYear]     = useState(false);
  const [deletingYear, setDeletingYear] = useState(false);

  // ── Year-scoped data ────────────────────────────────────────────────────
  const [lines, setLines]                       = useState([]);
  const [linesLoading, setLinesLoading]         = useState(false);
  const [transactions, setTransactions]         = useState([]);     // year-scoped, voided=false
  const [mappingsByLineId, setMappingsByLineId] = useState({});
  const [adjustmentsByLineId, setAdjustmentsByLineId] = useState({});
  const [expandedLineId, setExpandedLineId]     = useState(null);

  // ── Loaders ─────────────────────────────────────────────────────────────
  const loadYears = useCallback(async () => {
    setYearsLoading(true);
    try {
      const [{ data: lineRows, error: lineErr }, { data: stmtRows, error: stmtErr }] = await Promise.all([
        supabase.from('book_bs_lines').select('year'),
        supabase.from('book_bs_statements').select('*'),
      ]);
      if (lineErr) throw lineErr;
      if (stmtErr) throw stmtErr;
      const set = new Set((lineRows || []).map(r => r.year));
      (stmtRows || []).forEach(s => set.add(s.year));
      const ys = [...set].sort((a, b) => b - a);
      setYears(ys);
      const sm = {};
      (stmtRows || []).forEach(s => { sm[s.year] = s; });
      setStatements(sm);
      setSelectedYear((current) => {
        if (current != null && ys.includes(current)) return current;
        return ys[0] ?? null;
      });
    } catch (err) {
      console.error('book-bs: load years failed', err);
      toast.error(err.message || 'Failed to load years');
    } finally {
      setYearsLoading(false);
    }
  }, []);

  // Single year load: lines + mappings + adjustments + year's transactions.
  // Done together so the per-line editor can render the activity sum next
  // to each mapping chip without an extra round trip.
  const loadYearData = useCallback(async (year) => {
    if (year == null) {
      setLines([]); setTransactions([]); setMappingsByLineId({}); setAdjustmentsByLineId({});
      return;
    }
    setLinesLoading(true);
    try {
      const yearStart = `${year}-01-01`;
      const yearEnd   = `${year}-12-31`;

      const [
        { data: lineRows, error: lineErr },
        { data: txnRows,  error: txnErr  },
      ] = await Promise.all([
        supabase.from('book_bs_lines').select('*')
          .eq('year', year)
          .order('section_code', { ascending: true })
          .order('display_order', { ascending: true }),
        supabase.from('transactions')
          .select('id, date, description, category, amount, type, posted, reference')
          .gte('date', yearStart).lte('date', yearEnd)
          .eq('voided', false),
      ]);
      if (lineErr) throw lineErr;
      if (txnErr)  throw txnErr;
      const lineList = lineRows || [];
      setLines(lineList);
      setTransactions(txnRows || []);

      // Mappings + adjustments for every line in one query each, grouped by line_id.
      const lineIds = lineList.map(l => l.id);
      let mappings = [];
      let adjustments = [];
      if (lineIds.length) {
        const [mRes, aRes] = await Promise.all([
          supabase.from('book_bs_line_mappings').select('*').in('line_id', lineIds),
          supabase.from('book_bs_line_adjustments').select('*').in('line_id', lineIds).order('created_at', { ascending: true }),
        ]);
        if (mRes.error) throw mRes.error;
        if (aRes.error) throw aRes.error;
        mappings    = mRes.data || [];
        adjustments = aRes.data || [];
      }
      const mByLine = {};
      for (const m of mappings) { (mByLine[m.line_id] = mByLine[m.line_id] || []).push(m); }
      setMappingsByLineId(mByLine);
      const aByLine = {};
      for (const a of adjustments) { (aByLine[a.line_id] = aByLine[a.line_id] || []).push(a); }
      setAdjustmentsByLineId(aByLine);
    } catch (err) {
      console.error('book-bs: load year data failed', err);
      toast.error(err.message || 'Failed to load year');
      setLines([]); setTransactions([]); setMappingsByLineId({}); setAdjustmentsByLineId({});
    } finally {
      setLinesLoading(false);
    }
  }, []);

  useEffect(() => { loadYears(); }, [loadYears]);
  useEffect(() => { loadYearData(selectedYear); }, [selectedYear, loadYearData]);

  // ── Year management ─────────────────────────────────────────────────────
  async function handleAddYear() {
    const input = window.prompt('Add year (YYYY)', String(new Date().getFullYear()));
    if (input == null) return;
    const year = parseInt(input.trim(), 10);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      toast.error('Enter a year between 2000 and 2100');
      return;
    }
    if (years.includes(year)) {
      toast.error(`Year ${year} already exists`);
      setSelectedYear(year);
      return;
    }
    setAddingYear(true);
    try {
      const rows = buildSeedLinesForYear(year);
      const { error } = await supabase.from('book_bs_lines').insert(rows);
      if (error) throw error;
      toast.success(`Seeded ${rows.length} lines for ${year}`);
      await loadYears();
      setSelectedYear(year);
    } catch (err) {
      console.error('book-bs: add year failed', err);
      toast.error(err.message || 'Failed to add year');
    } finally {
      setAddingYear(false);
    }
  }

  async function handleDeleteYear() {
    if (selectedYear == null) return;
    if (!confirm(
      `Delete every line + the statement row for ${selectedYear}?\n\n`
      + 'Mappings, adjustments, and any locked statement for this year will '
      + 'cascade-delete with the line rows.'
    )) return;
    setDeletingYear(true);
    try {
      await supabase.from('book_bs_lines').delete().eq('year', selectedYear);
      await supabase.from('book_bs_statements').delete().eq('year', selectedYear);
      toast.success(`Removed ${selectedYear}`);
      setSelectedYear(null);
      await loadYears();
    } catch (err) {
      console.error('book-bs: delete year failed', err);
      toast.error(err.message || 'Failed to delete year');
    } finally {
      setDeletingYear(false);
    }
  }

  // ── Reload after the editor saves a single line (cheaper than refetching
  //    everything: we already have the line's mappings + adjustments
  //    locally in the editor, but re-fetching keeps the truth source the DB).
  async function reloadLine(lineId) {
    const [{ data: lineRow, error: e1 }, { data: m, error: e2 }, { data: a, error: e3 }] = await Promise.all([
      supabase.from('book_bs_lines').select('*').eq('id', lineId).single(),
      supabase.from('book_bs_line_mappings').select('*').eq('line_id', lineId),
      supabase.from('book_bs_line_adjustments').select('*').eq('line_id', lineId).order('created_at', { ascending: true }),
    ]);
    if (e1 || e2 || e3) {
      console.warn('book-bs: line reload partially failed', e1, e2, e3);
      return;
    }
    setLines(prev => prev.map(l => l.id === lineId ? lineRow : l));
    setMappingsByLineId(prev => ({ ...prev, [lineId]: m || [] }));
    setAdjustmentsByLineId(prev => ({ ...prev, [lineId]: a || [] }));
  }

  // ── Group lines by section for rendering ─────────────────────────────────
  const linesBySection = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      if (!m.has(l.section_code)) m.set(l.section_code, []);
      m.get(l.section_code).push(l);
    }
    return m;
  }, [lines]);

  const sectionsForRender = useMemo(
    () => BOOK_BS_STRUCTURE.slice().sort((a, b) => bookGroupOrder(a.group) - bookGroupOrder(b.group)),
    []
  );

  const stmt = selectedYear != null ? statements[selectedYear] : null;
  const lockedAt = stmt?.locked_at ? new Date(stmt.locked_at).toLocaleString() : null;

  // Expense + revenue categories from useData() exposed to the editor so its
  // dropdown can offer any CoA category (revenue, expense, asset, etc.) for
  // mapping. The chart of accounts itself is the multi-select source.
  const allCategories = useMemo(() => {
    return (categories || [])
      .filter(c => !c.archived)
      .slice()
      .sort((a, b) => {
        const at = (a.type || '').toLowerCase();
        const bt = (b.type || '').toLowerCase();
        if (at !== bt) return at.localeCompare(bt);
        return (a.name || '').localeCompare(b.name || '');
      });
  }, [categories]);

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link to="/accountant" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 mb-1">
            <ChevronLeft size={12} /> Back to Accountant
          </Link>
          <h1 className="page-title flex items-center gap-2">
            <BookOpen size={26} className="text-brand-600" />
            Book Balance Sheet Builder
          </h1>
          <p className="text-surface-500 text-sm mt-0.5">
            Stage 2 — per-line editor. Roll-forward + lock + PDF land in Stages 3 and 4.
          </p>
        </div>
        <button
          onClick={handleAddYear}
          disabled={addingYear}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
        >
          {addingYear ? <Spinner size="sm" className="text-white" /> : <Plus size={14} />}
          Add Year
        </button>
      </div>

      {/* Stage notice */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
        <Info size={14} className="text-amber-700 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-semibold mb-0.5">Stage 2 of 4 (5)</div>
          Every line is editable: beginning balance, mapped CoA categories,
          manual adjustments, computed ending. Each line shows a clear
          <span className="font-semibold"> MAPPING</span> /
          <span className="font-semibold"> MANUAL</span> badge so you always
          know whether the number is pulled from the ledger or hand-keyed.
          Confirm per line snapshots the ending. Year-level lock + PDF
          land in Stage 4.
        </div>
      </div>

      {/* Year tabs */}
      <div className="card p-4">
        <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold mb-2">Years</div>
        {yearsLoading ? (
          <div className="flex items-center gap-2 text-sm text-surface-500">
            <Spinner size="sm" /> Loading…
          </div>
        ) : years.length === 0 ? (
          <div className="text-sm text-surface-400">
            No years yet. Click <span className="font-semibold text-surface-700">Add Year</span> to seed one.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {years.map(y => {
              const isActive = y === selectedYear;
              const s = statements[y];
              const locked = s?.status === 'locked';
              return (
                <button
                  key={y}
                  onClick={() => { setSelectedYear(y); setExpandedLineId(null); }}
                  className={`px-3 py-1.5 rounded-md text-sm font-mono border transition inline-flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                      : 'bg-white text-surface-700 border-surface-200 hover:border-brand-400'
                  }`}
                >
                  {y}
                  {locked && <Lock size={11} className={isActive ? 'text-white/80' : 'text-amber-600'} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Body */}
      {selectedYear == null ? (
        !yearsLoading && years.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Stage 2 ready — no years seeded yet"
            description="Click Add Year to populate the firm's book balance-sheet skeleton, then click a line to start editing."
            action={{ label: 'Add Year', onClick: handleAddYear }}
          />
        ) : null
      ) : (
        <div className="space-y-4">
          {/* Year toolbar */}
          <div className="card p-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Working on</div>
              <div className="font-display text-2xl text-surface-900 mt-0.5">{selectedYear}</div>
              {stmt && (
                <div className="mt-1 inline-flex items-center gap-1 text-[11px]">
                  {stmt.status === 'locked' ? (
                    <>
                      <Lock size={11} className="text-amber-700" />
                      <span className="text-amber-800 font-semibold">Locked</span>
                      {lockedAt && <span className="text-amber-700">· {lockedAt}</span>}
                    </>
                  ) : (
                    <span className="text-surface-500">Status: draft</span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={handleDeleteYear}
              disabled={deletingYear}
              title="Removes lines + statement so you can re-seed"
              className="btn-ghost text-xs inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              {deletingYear ? <Spinner size="sm" /> : <Trash2 size={12} />}
              Delete year
            </button>
          </div>

          {/* Sections + lines */}
          {linesLoading ? (
            <div className="flex justify-center py-12"><Spinner size="lg" /></div>
          ) : (
            <div className="space-y-4">
              {sectionsForRender.map(section => {
                const rows = linesBySection.get(section.code) || [];
                return (
                  <div key={section.code} className="card overflow-hidden">
                    <div className="px-5 py-3 border-b border-surface-100 bg-surface-50 flex items-center gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-white border border-surface-200 text-surface-600">
                        {section.code}
                      </span>
                      <h3 className="section-title">{section.title}</h3>
                      <span className="ml-auto text-[10px] uppercase tracking-wider text-surface-400">
                        {bookGroupLabel(section.group)}{section.contra ? ' · contra' : ''}
                      </span>
                    </div>
                    {rows.length === 0 ? (
                      <div className="px-5 py-4 text-xs text-surface-400 italic">
                        No lines for this section in {selectedYear}.
                        {(SEED_LINE_TITLES[section.code] || []).length > 0 && (
                          <> They were seeded by Add Year but may have been removed during testing.</>
                        )}
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-surface-100 text-left">
                            <th className="table-header w-8"></th>
                            <th className="table-header">Line</th>
                            <th className="table-header w-32">Mode</th>
                            <th className="table-header text-right w-32">Beginning</th>
                            <th className="table-header text-right w-32">Computed end</th>
                            <th className="table-header text-right w-32">Confirmed</th>
                            <th className="table-header w-24"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((line) => (
                            <BookBSLineRow
                              key={line.id}
                              line={line}
                              section={section}
                              mappings={mappingsByLineId[line.id] || []}
                              adjustments={adjustmentsByLineId[line.id] || []}
                              transactions={transactions}
                              expanded={expandedLineId === line.id}
                              onToggle={() => setExpandedLineId(expandedLineId === line.id ? null : line.id)}
                              allCategories={allCategories}
                              user={user}
                              onSaved={async () => { await reloadLine(line.id); }}
                            />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs text-surface-500 flex items-start gap-2">
            <AlertCircle size={14} className="text-surface-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold text-surface-700">Stage 3 will add:</span>{' '}
              "+ Add Year" rolls forward beginning balances from the previous
              year's confirmed endings; side-by-side multi-year comparison
              view with YoY deltas.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row + editor
// ─────────────────────────────────────────────────────────────────────────────

function ModeBadge({ isMapping }) {
  return isMapping ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold bg-green-100 text-green-700 border border-green-200">
      <Layers size={10} /> Mapping
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold bg-surface-100 text-surface-600 border border-surface-200">
      <PenSquare size={10} /> Manual
    </span>
  );
}

function BookBSLineRow({ line, section, mappings, adjustments, transactions, expanded, onToggle, allCategories, user, onSaved }) {
  const isMapping = mappings.length > 0;

  // Live computed ending — recomputed cheaply on every render. Caches inside
  // computeMappingActivity make this O(txns × mappings); fine at our scale.
  const activitySum = useMemo(
    () => mappings.reduce((s, m) => s + computeMappingActivity(transactions, m.category_name, section), 0),
    [mappings, transactions, section]
  );
  const adjustmentsSum = useMemo(
    () => adjustments.reduce((s, a) => s + (Number(a.amount) || 0), 0),
    [adjustments]
  );
  const computedEnd = computeLineEnding(line.beginning_balance, activitySum, adjustmentsSum);

  const confirmed     = line.confirmed_at != null;
  const confirmedAt   = line.confirmed_at ? new Date(line.confirmed_at).toLocaleString() : null;

  return (
    <>
      <tr className="border-b border-surface-50 hover:bg-surface-50 transition cursor-pointer" onClick={onToggle}>
        <td className="table-cell text-surface-400">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="table-cell">
          <span className="font-medium text-sm">{line.title}</span>
        </td>
        <td className="table-cell">
          <ModeBadge isMapping={isMapping} />
        </td>
        <td className="table-cell text-right font-mono text-xs">{formatCurrency(line.beginning_balance)}</td>
        <td className="table-cell text-right font-mono text-xs">{formatCurrency(computedEnd)}</td>
        <td className="table-cell text-right font-mono text-xs">
          {line.ending_balance_confirmed == null
            ? <span className="text-surface-300">—</span>
            : <span className="text-green-700 font-semibold">{formatCurrency(line.ending_balance_confirmed)}</span>}
        </td>
        <td className="table-cell text-right">
          {confirmed ? (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-green-700 font-semibold">
              <CheckCircle2 size={11} /> Confirmed
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-surface-400">Draft</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface-50/40">
          <td colSpan={7} className="px-5 py-4">
            <LineEditor
              line={line}
              section={section}
              initialMappings={mappings}
              initialAdjustments={adjustments}
              transactions={transactions}
              allCategories={allCategories}
              user={user}
              confirmedAt={confirmedAt}
              onSaved={async () => { await onSaved(); }}
              onCancel={onToggle}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────
//
// Local state mirrors the line's three saveable surfaces:
//   beginning  — single numeric input
//   mappings   — array of {category_id, category_name} (no new-row flag; we
//                diff against initialMappings to know what to insert/delete)
//   adjustments— array of {id?, amount, note} (rows without id are new)
// "Save Draft" / "Confirm" both flush local state to the DB; the only
// difference is whether ending_balance_confirmed gets snapshot-stamped.

function LineEditor({ line, section, initialMappings, initialAdjustments, transactions, allCategories, user, confirmedAt, onSaved, onCancel }) {
  const [beginning, setBeginning] = useState(String(line.beginning_balance ?? 0));
  const [mappings, setMappings]   = useState(initialMappings.map(m => ({ category_id: m.category_id, category_name: m.category_name })));
  const [adjustments, setAdjustments] = useState(
    initialAdjustments.map(a => ({ id: a.id, amount: a.amount, note: a.note, created_at: a.created_at }))
  );

  const [newMappingCategoryId, setNewMappingCategoryId] = useState('');
  const [newAdjAmount, setNewAdjAmount] = useState('');
  const [newAdjNote, setNewAdjNote]     = useState('');
  const [saving, setSaving]             = useState(false);

  // Allow the editor to refresh when the parent line changes (e.g. after
  // reloadLine swaps the row in place).
  useEffect(() => {
    setBeginning(String(line.beginning_balance ?? 0));
  }, [line.id, line.beginning_balance]);

  const isMappingDriven = mappings.length > 0;

  // Compute activity for each mapping under the line's natural sign.
  const activityByMapping = useMemo(() => {
    return mappings.map(m => ({
      ...m,
      activity: computeMappingActivity(transactions, m.category_name, section),
    }));
  }, [mappings, transactions, section]);

  const activitySum    = activityByMapping.reduce((s, m) => s + m.activity, 0);
  const adjustmentsSum = adjustments.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const beginningNum   = Number(beginning) || 0;
  const computedEnd    = computeLineEnding(beginningNum, activitySum, adjustmentsSum);

  const naturalSideLabel = lineActivityIsDebitNatural(section)
    ? 'Activity = Σ debits − Σ credits'
    : 'Activity = Σ credits − Σ debits';

  // ── Mapping ops (local state) ─────────────────────────────────────────
  function addMapping() {
    if (!newMappingCategoryId) return;
    const cat = allCategories.find(c => c.id === newMappingCategoryId);
    if (!cat) return;
    if (mappings.some(m => m.category_id === cat.id)) {
      toast.error('That category is already mapped to this line');
      return;
    }
    setMappings(prev => [...prev, { category_id: cat.id, category_name: cat.name }]);
    setNewMappingCategoryId('');
  }

  function removeMapping(category_id) {
    setMappings(prev => prev.filter(m => m.category_id !== category_id));
  }

  // ── Adjustment ops (local state) ──────────────────────────────────────
  function addAdjustment() {
    const amt = parseFloat(newAdjAmount);
    if (!Number.isFinite(amt) || amt === 0) {
      toast.error('Enter a non-zero amount (negative is allowed)');
      return;
    }
    if (!newAdjNote.trim()) {
      toast.error('Note is required for every adjustment');
      return;
    }
    setAdjustments(prev => [
      ...prev,
      { id: undefined, amount: round2(amt), note: newAdjNote.trim(), created_at: new Date().toISOString() },
    ]);
    setNewAdjAmount('');
    setNewAdjNote('');
  }

  function removeAdjustment(idx) {
    setAdjustments(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Save ──────────────────────────────────────────────────────────────
  async function save(confirmIt) {
    setSaving(true);
    try {
      // 1. Update line: beginning + (confirmation snapshot or clear).
      const lineUpdate = {
        beginning_balance: round2(beginningNum),
        updated_at: new Date().toISOString(),
      };
      if (confirmIt) {
        lineUpdate.ending_balance_confirmed = computedEnd;
        lineUpdate.confirmed_by             = user?.id || null;
        lineUpdate.confirmed_at             = new Date().toISOString();
      } else {
        // Saving as draft clears any prior confirmation — edits invalidate
        // the snapshot, so Stage 4's lock can't trust a stale confirmation.
        lineUpdate.ending_balance_confirmed = null;
        lineUpdate.confirmed_by             = null;
        lineUpdate.confirmed_at             = null;
      }
      const { error: lineErr } = await supabase.from('book_bs_lines').update(lineUpdate).eq('id', line.id);
      if (lineErr) throw lineErr;

      // 2. Mappings diff: insert new, delete removed.
      const origIds   = new Set(initialMappings.map(m => m.category_id));
      const newIds    = new Set(mappings.map(m => m.category_id));
      const toInsert  = mappings.filter(m => !origIds.has(m.category_id));
      const toRemove  = initialMappings.filter(m => !newIds.has(m.category_id));
      if (toInsert.length) {
        const { error } = await supabase.from('book_bs_line_mappings').insert(
          toInsert.map(m => ({ line_id: line.id, category_id: m.category_id, category_name: m.category_name }))
        );
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await supabase.from('book_bs_line_mappings').delete()
          .eq('line_id', line.id)
          .in('category_id', toRemove.map(m => m.category_id));
        if (error) throw error;
      }

      // 3. Adjustments diff: insert rows without id; delete by id where the
      //    id existed before but isn't in the current local set.
      const origAdjIds   = new Set(initialAdjustments.map(a => a.id));
      const keptAdjIds   = new Set(adjustments.filter(a => a.id).map(a => a.id));
      const newAdjRows   = adjustments.filter(a => !a.id);
      const removedIds   = [...origAdjIds].filter(id => !keptAdjIds.has(id));
      if (newAdjRows.length) {
        const { error } = await supabase.from('book_bs_line_adjustments').insert(
          newAdjRows.map(a => ({ line_id: line.id, amount: a.amount, note: a.note, created_by: user?.id || null }))
        );
        if (error) throw error;
      }
      if (removedIds.length) {
        const { error } = await supabase.from('book_bs_line_adjustments').delete().in('id', removedIds);
        if (error) throw error;
      }

      toast.success(confirmIt ? `Confirmed ${line.title}` : `Saved ${line.title}`);
      await onSaved();
    } catch (err) {
      console.error('book-bs editor save failed:', err);
      toast.error(err.message || 'Failed to save line');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-surface-200 bg-white p-4 space-y-4">

      {/* Top row: badge + (was confirmed?) banner */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ModeBadge isMapping={isMappingDriven} />
          <span className="text-[10px] uppercase tracking-wider text-surface-400">{naturalSideLabel}</span>
        </div>
        {confirmedAt && (
          <div className="text-[11px] text-green-700 inline-flex items-center gap-1">
            <CheckCircle2 size={12} /> Confirmed · {confirmedAt}
            <span className="text-amber-700 ml-2">— editing will reset confirmation when you save</span>
          </div>
        )}
      </div>

      {/* Beginning balance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-surface-500 font-semibold mb-1">
            Beginning balance
          </label>
          <input
            type="number"
            step="0.01"
            value={beginning}
            onChange={(e) => setBeginning(e.target.value)}
            className="input-field text-sm"
            placeholder="0.00"
          />
        </div>
      </div>

      {/* Mappings */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-surface-600 font-semibold inline-flex items-center gap-1.5">
            <Layers size={12} /> Mappings
            <span className="text-surface-400 font-normal normal-case tracking-normal">
              · {isMappingDriven ? 'line is mapping-driven' : 'no mappings → line is manual-only'}
            </span>
          </div>
        </div>

        {mappings.length > 0 ? (
          <div className="space-y-1">
            {activityByMapping.map((m) => (
              <div key={m.category_id} className="flex items-center justify-between gap-3 px-3 py-1.5 bg-surface-50 rounded-md border border-surface-100">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm truncate">{m.category_name}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="font-mono text-xs text-surface-700">
                    {m.activity >= 0 ? '+' : ''}{formatCurrency(m.activity)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMapping(m.category_id)}
                    className="text-surface-400 hover:text-red-600 p-1"
                    title="Remove mapping"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-surface-400 italic">No mappings yet — pick one below if this line should pull from the ledger.</div>
        )}

        <div className="flex items-center gap-2">
          <select
            value={newMappingCategoryId}
            onChange={(e) => setNewMappingCategoryId(e.target.value)}
            className="input-field text-xs flex-1 max-w-md"
          >
            <option value="">— add a CoA category —</option>
            {allCategories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {c.type ? `· ${c.type}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addMapping}
            disabled={!newMappingCategoryId}
            className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Plus size={12} /> Map
          </button>
        </div>
      </div>

      {/* Adjustments */}
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-surface-600 font-semibold inline-flex items-center gap-1.5">
          <Edit3 size={12} /> Manual adjustments
          <span className="text-surface-400 font-normal normal-case tracking-normal">
            · signed; every entry needs a note
          </span>
        </div>

        {adjustments.length > 0 ? (
          <div className="space-y-1">
            {adjustments.map((a, idx) => (
              <div key={a.id || `new-${idx}`} className="flex items-center gap-3 px-3 py-1.5 bg-surface-50 rounded-md border border-surface-100">
                <span className={`font-mono text-xs w-28 text-right ${Number(a.amount) >= 0 ? 'text-surface-700' : 'text-red-700'}`}>
                  {Number(a.amount) >= 0 ? '+' : ''}{formatCurrency(a.amount)}
                </span>
                <span className="text-xs text-surface-700 flex-1">{a.note}</span>
                <button
                  type="button"
                  onClick={() => removeAdjustment(idx)}
                  className="text-surface-400 hover:text-red-600 p-1"
                  title="Remove adjustment"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-surface-400 italic">No adjustments yet.</div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            step="0.01"
            value={newAdjAmount}
            onChange={(e) => setNewAdjAmount(e.target.value)}
            className="input-field text-xs w-28"
            placeholder="0.00"
          />
          <input
            type="text"
            value={newAdjNote}
            onChange={(e) => setNewAdjNote(e.target.value)}
            className="input-field text-xs flex-1 max-w-md"
            placeholder="Note (required)"
          />
          <button
            type="button"
            onClick={addAdjustment}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* Breakdown */}
      <div className="rounded-lg bg-surface-50 border border-surface-100 p-3 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="uppercase tracking-wider text-surface-500 text-[10px] font-semibold">Beginning</div>
            <div className="font-mono">{formatCurrency(beginningNum)}</div>
          </div>
          <div>
            <div className="uppercase tracking-wider text-surface-500 text-[10px] font-semibold">
              Activity ({mappings.length} map{mappings.length === 1 ? '' : 's'})
            </div>
            <div className={`font-mono ${activitySum < 0 ? 'text-red-700' : 'text-surface-700'}`}>
              {activitySum >= 0 ? '+' : ''}{formatCurrency(activitySum)}
            </div>
          </div>
          <div>
            <div className="uppercase tracking-wider text-surface-500 text-[10px] font-semibold">
              Adjustments ({adjustments.length})
            </div>
            <div className={`font-mono ${adjustmentsSum < 0 ? 'text-red-700' : 'text-surface-700'}`}>
              {adjustmentsSum >= 0 ? '+' : ''}{formatCurrency(adjustmentsSum)}
            </div>
          </div>
          <div>
            <div className="uppercase tracking-wider text-surface-500 text-[10px] font-semibold">Ending (computed)</div>
            <div className="font-mono font-semibold">{formatCurrency(computedEnd)}</div>
          </div>
        </div>
        {section?.contra && (
          <div className="mt-2 text-[11px] text-amber-700 inline-flex items-center gap-1">
            <Info size={11} /> Contra line — stored positive; rendered in parentheses and subtracted from the {bookGroupLabel(section.group).toLowerCase()} total in Stage 4's PDF.
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} disabled={saving} className="btn-ghost text-xs">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => save(false)}
          disabled={saving}
          className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50"
        >
          {saving ? <Spinner size="sm" /> : <Save size={12} />}
          Save Draft
        </button>
        <button
          type="button"
          onClick={() => save(true)}
          disabled={saving}
          className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50"
        >
          {saving ? <Spinner size="sm" className="text-white" /> : <CheckCircle2 size={12} />}
          Confirm
        </button>
      </div>
    </div>
  );
}
