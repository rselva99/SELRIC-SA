// Book Balance Sheet Builder — Stages 1 + 2 + 3.
//
// Stage 1 (shipped): seed years from the L-code skeleton; per-section read-
// only line list; admin-only route + RLS.
//
// Stage 2 (shipped): per-line editor with beginning balance, CoA mappings,
// manual adjustments, computed-ending breakdown, MAPPING / MANUAL mode
// badge, Save Draft / Confirm. Confirmation snapshots
// ending_balance_confirmed; Save Draft on a previously confirmed line
// clears the snapshot.
//
// Stage 3 (this file):
//   • "+ Add Year" roll-forward — when a prior year exists, the new year
//     copies lines (title, section, display_order, mappings) and sets
//     beginning_balance = the prior year's ending_balance_confirmed for
//     each matching line. Prior lines that were never confirmed default
//     to $0 and the row carries an amber WARNING chip in both edit and
//     compare views.
//   • Multi-year compare view — read-only side-by-side table of the years
//     the user ticks, with a Δ ($ / %) column between every adjacent pair.
//     Each cell shows the best-available ending (confirmed if present,
//     else the live-computed value) with a small badge so origin is
//     unambiguous.
//
// Out of scope (later stages):
//   Stage 4 — year-level lock + official PDF
//   Stage 5 — per-transaction picker

import { useEffect, useMemo, useState, useCallback, Fragment } from 'react';
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
  computeLineEndingSummary,
} from '../../lib/bookBalanceSheet';
import { formatCurrency } from '../../lib/utils';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import toast from 'react-hot-toast';
import {
  BookOpen, Plus, ChevronLeft, ChevronDown, ChevronRight, Trash2, Info, Lock,
  AlertCircle, AlertTriangle, CheckCircle2, X, Save, Edit3, Layers, PenSquare,
  Columns,
} from 'lucide-react';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Lookup helper for the section descriptor; section objects are tiny so
// inlining the search is fine.
function findSection(code) { return bookSectionByCode(code); }

export default function BookBalanceSheetPage() {
  const { user } = useAuth();
  const { categories } = useData();

  // ── Top-level state ─────────────────────────────────────────────────────
  const [mode, setMode]                 = useState('edit');   // 'edit' | 'compare'
  const [years, setYears]               = useState([]);
  const [statements, setStatements]     = useState({});
  const [selectedYear, setSelectedYear] = useState(null);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [addingYear, setAddingYear]     = useState(false);
  const [deletingYear, setDeletingYear] = useState(false);

  // ── Edit-mode (year-scoped) state ───────────────────────────────────────
  const [lines, setLines]                       = useState([]);
  const [linesLoading, setLinesLoading]         = useState(false);
  const [transactions, setTransactions]         = useState([]);
  const [mappingsByLineId, setMappingsByLineId] = useState({});
  const [adjustmentsByLineId, setAdjustmentsByLineId] = useState({});
  // Set of current-year line ids whose prior-year sibling existed but was
  // never confirmed; surfaces a warning chip on the row.
  const [rolledFromUnconfirmed, setRolledFromUnconfirmed] = useState(new Set());
  const [expandedLineId, setExpandedLineId]     = useState(null);

  // ── Compare-mode state ──────────────────────────────────────────────────
  const [compareYears, setCompareYears]   = useState([]);     // years checked for comparison
  const [compareData, setCompareData]     = useState(null);   // {linesByYear, mByLine, aByLine, txnsByYear}
  const [compareLoading, setCompareLoading] = useState(false);

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
      // Initialize compareYears the first time we have data, or whenever the
      // currently-selected compare set falls out of sync with available years.
      setCompareYears((prev) => {
        if (!prev.length) return [...ys].sort((a, b) => a - b);
        const filtered = prev.filter(y => ys.includes(y));
        return filtered.length ? filtered : [...ys].sort((a, b) => a - b);
      });
    } catch (err) {
      console.error('book-bs: load years failed', err);
      toast.error(err.message || 'Failed to load years');
    } finally {
      setYearsLoading(false);
    }
  }, []);

  // Edit-mode loader for the selected year. Also reads the most recent
  // prior year's confirmation state so we can mark lines that rolled forward
  // from an UNCONFIRMED prior sibling — these are the ones whose beginning
  // balance defaulted to $0 because there was no trusted prior ending.
  const loadYearData = useCallback(async (year) => {
    if (year == null) {
      setLines([]); setTransactions([]); setMappingsByLineId({});
      setAdjustmentsByLineId({}); setRolledFromUnconfirmed(new Set());
      return;
    }
    setLinesLoading(true);
    try {
      const yearStart = `${year}-01-01`;
      const yearEnd   = `${year}-12-31`;

      const [
        { data: lineRows, error: lineErr },
        { data: txnRows,  error: txnErr  },
        { data: priorYearMeta, error: pyErr },
      ] = await Promise.all([
        supabase.from('book_bs_lines').select('*')
          .eq('year', year)
          .order('section_code', { ascending: true })
          .order('display_order', { ascending: true }),
        supabase.from('transactions')
          .select('id, date, description, category, amount, type, posted, reference')
          .gte('date', yearStart).lte('date', yearEnd)
          .eq('voided', false),
        supabase.from('book_bs_lines').select('year')
          .lt('year', year).order('year', { ascending: false }).limit(1),
      ]);
      if (lineErr) throw lineErr;
      if (txnErr)  throw txnErr;
      if (pyErr)   throw pyErr;
      const lineList = lineRows || [];
      setLines(lineList);
      setTransactions(txnRows || []);

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

      // Roll-forward warning: prior year's lines, keyed by (section, title).
      // A current line is marked rolled-from-unconfirmed when its prior-
      // sibling exists AND has ending_balance_confirmed = null.
      const priorYear = priorYearMeta?.[0]?.year ?? null;
      const warningSet = new Set();
      if (priorYear != null) {
        const { data: priorLines, error: plErr } = await supabase
          .from('book_bs_lines')
          .select('section_code, title, ending_balance_confirmed')
          .eq('year', priorYear);
        if (plErr) throw plErr;
        const priorByKey = new Map();
        for (const pl of priorLines || []) {
          priorByKey.set(`${pl.section_code}::${(pl.title || '').toLowerCase()}`, pl.ending_balance_confirmed);
        }
        for (const line of lineList) {
          const key = `${line.section_code}::${(line.title || '').toLowerCase()}`;
          if (priorByKey.has(key) && priorByKey.get(key) == null) {
            warningSet.add(line.id);
          }
        }
      }
      setRolledFromUnconfirmed(warningSet);
    } catch (err) {
      console.error('book-bs: load year data failed', err);
      toast.error(err.message || 'Failed to load year');
      setLines([]); setTransactions([]); setMappingsByLineId({});
      setAdjustmentsByLineId({}); setRolledFromUnconfirmed(new Set());
    } finally {
      setLinesLoading(false);
    }
  }, []);

  // Compare-mode loader — pulls everything needed to render N years side-
  // by-side. Heavy when many years are selected; runs only when compare
  // years actually change.
  const loadCompareData = useCallback(async (yearsToShow) => {
    if (!Array.isArray(yearsToShow) || yearsToShow.length === 0) {
      setCompareData(null);
      return;
    }
    setCompareLoading(true);
    try {
      const minY = Math.min(...yearsToShow);
      const maxY = Math.max(...yearsToShow);
      const [
        { data: lineRows, error: lineErr },
        { data: txnRows,  error: txnErr  },
      ] = await Promise.all([
        supabase.from('book_bs_lines').select('*').in('year', yearsToShow),
        supabase.from('transactions')
          .select('id, date, category, amount, type, posted')
          .gte('date', `${minY}-01-01`).lte('date', `${maxY}-12-31`)
          .eq('voided', false),
      ]);
      if (lineErr) throw lineErr;
      if (txnErr)  throw txnErr;
      const lineIds = (lineRows || []).map(l => l.id);
      let mappings = [];
      let adjustments = [];
      if (lineIds.length) {
        const [mRes, aRes] = await Promise.all([
          supabase.from('book_bs_line_mappings').select('*').in('line_id', lineIds),
          supabase.from('book_bs_line_adjustments').select('*').in('line_id', lineIds),
        ]);
        if (mRes.error) throw mRes.error;
        if (aRes.error) throw aRes.error;
        mappings    = mRes.data || [];
        adjustments = aRes.data || [];
      }

      const linesByYear = {};
      for (const l of lineRows || []) {
        (linesByYear[l.year] = linesByYear[l.year] || []).push(l);
      }
      const mByLine = {};
      for (const m of mappings) { (mByLine[m.line_id] = mByLine[m.line_id] || []).push(m); }
      const aByLine = {};
      for (const a of adjustments) { (aByLine[a.line_id] = aByLine[a.line_id] || []).push(a); }
      const txnsByYear = {};
      for (const t of txnRows || []) {
        const y = parseInt((t.date || '').slice(0, 4), 10);
        if (yearsToShow.includes(y)) {
          (txnsByYear[y] = txnsByYear[y] || []).push(t);
        }
      }
      setCompareData({ linesByYear, mByLine, aByLine, txnsByYear });
    } catch (err) {
      console.error('book-bs: load compare data failed', err);
      toast.error(err.message || 'Failed to load compare data');
      setCompareData(null);
    } finally {
      setCompareLoading(false);
    }
  }, []);

  useEffect(() => { loadYears(); }, [loadYears]);
  useEffect(() => {
    if (mode === 'edit') loadYearData(selectedYear);
  }, [mode, selectedYear, loadYearData]);
  useEffect(() => {
    if (mode === 'compare') loadCompareData(compareYears);
  }, [mode, compareYears, loadCompareData]);

  // ── Add Year (roll-forward) ─────────────────────────────────────────────
  //
  // When a prior year exists, the new year inherits the prior year's lines:
  //   • Same title + section_code + display_order.
  //   • beginning_balance defaults to prior.ending_balance_confirmed, or $0
  //     if the prior line was never confirmed. Lines that defaulted to $0
  //     get an in-app warning chip via the rolledFromUnconfirmed set.
  //   • Mappings copy over. Adjustments do NOT — they're year-specific.
  //
  // When no prior year exists, the seed skeleton from BOOK_BS_STRUCTURE +
  // SEED_LINE_TITLES is used with $0 beginnings throughout.
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
      // Most recent prior year, if any.
      const { data: priorMeta, error: pmErr } = await supabase
        .from('book_bs_lines')
        .select('year')
        .lt('year', year)
        .order('year', { ascending: false })
        .limit(1);
      if (pmErr) throw pmErr;
      const priorYear = priorMeta?.[0]?.year ?? null;

      if (priorYear == null) {
        // First year — use the seed skeleton.
        const rows = buildSeedLinesForYear(year);
        const { error } = await supabase.from('book_bs_lines').insert(rows);
        if (error) throw error;
        toast.success(`Seeded ${rows.length} lines for ${year}`);
      } else {
        // Roll forward from priorYear.
        const { data: priorLines, error: plErr } = await supabase
          .from('book_bs_lines')
          .select('id, section_code, title, display_order, ending_balance_confirmed')
          .eq('year', priorYear);
        if (plErr) throw plErr;
        const priorLineList = priorLines || [];

        const { data: priorMappings, error: pmErr2 } = await supabase
          .from('book_bs_line_mappings')
          .select('line_id, category_id, category_name')
          .in('line_id', priorLineList.map(l => l.id));
        if (pmErr2) throw pmErr2;
        const mByPriorLine = {};
        for (const m of priorMappings || []) {
          (mByPriorLine[m.line_id] = mByPriorLine[m.line_id] || []).push(m);
        }

        // Build new-year line inserts.
        const newRows = priorLineList.map(pl => ({
          year,
          section_code: pl.section_code,
          title: pl.title,
          display_order: pl.display_order,
          beginning_balance: pl.ending_balance_confirmed ?? 0,
          ending_balance_confirmed: null,
        }));

        const { data: insertedLines, error: insErr } = await supabase
          .from('book_bs_lines')
          .insert(newRows)
          .select('id, section_code, title');
        if (insErr) throw insErr;

        // Match each new line back to its prior line by (section, title), then
        // copy mappings across.
        const newLineByKey = new Map();
        for (const nl of insertedLines || []) {
          newLineByKey.set(`${nl.section_code}::${(nl.title || '').toLowerCase()}`, nl.id);
        }
        const newMappingRows = [];
        for (const pl of priorLineList) {
          const newLineId = newLineByKey.get(`${pl.section_code}::${(pl.title || '').toLowerCase()}`);
          if (!newLineId) continue;
          const ms = mByPriorLine[pl.id] || [];
          for (const m of ms) {
            newMappingRows.push({
              line_id: newLineId,
              category_id: m.category_id,
              category_name: m.category_name,
            });
          }
        }
        if (newMappingRows.length) {
          const { error: mErr } = await supabase
            .from('book_bs_line_mappings')
            .insert(newMappingRows);
          if (mErr) throw mErr;
        }

        const unconfirmedCount = priorLineList.filter(l => l.ending_balance_confirmed == null).length;
        if (unconfirmedCount > 0) {
          toast(`Rolled forward ${priorLineList.length} lines from ${priorYear} · ${unconfirmedCount} prior were unconfirmed → defaulted to $0 (warning chips shown)`, { icon: '⚠️', duration: 6000 });
        } else {
          toast.success(`Rolled forward ${priorLineList.length} lines from ${priorYear} (all prior endings confirmed)`);
        }
      }
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

  // ── Derived ─────────────────────────────────────────────────────────────
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

  const sortedYearsAsc = useMemo(() => [...years].sort((a, b) => a - b), [years]);

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
            Stage 3 — per-line editor, "+ Add Year" roll-forward, multi-year compare. Lock + PDF land in Stage 4.
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
          <div className="font-semibold mb-0.5">Stage 3 of 4 (5)</div>
          Adding a year now <span className="font-semibold">rolls forward</span> the previous year's lines, mappings, and
          beginning balances (from confirmed endings). Unconfirmed prior lines default to $0 with a
          <span className="text-amber-700 font-semibold"> WARNING</span> chip. The
          <span className="font-semibold"> Compare Years</span> tab shows years side-by-side with YoY deltas (read-only).
          Stage 4 will add year-level locking and the official PDF.
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-surface-500 font-semibold">View</span>
        <div className="inline-flex bg-surface-100 rounded-lg p-1">
          {[
            { id: 'edit',    label: 'Edit Year',    icon: Edit3 },
            { id: 'compare', label: 'Compare Years', icon: Columns },
          ].map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setMode(t.id); setExpandedLineId(null); }}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition inline-flex items-center gap-1.5 ${mode === t.id ? 'bg-white shadow-sm text-surface-900' : 'text-surface-500 hover:text-surface-700'}`}
              >
                <Icon size={12} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {mode === 'edit' ? (
        <EditView
          yearsLoading={yearsLoading}
          years={years}
          statements={statements}
          selectedYear={selectedYear}
          setSelectedYear={(y) => { setSelectedYear(y); setExpandedLineId(null); }}
          handleAddYear={handleAddYear}
          stmt={stmt}
          lockedAt={lockedAt}
          handleDeleteYear={handleDeleteYear}
          deletingYear={deletingYear}
          linesLoading={linesLoading}
          sectionsForRender={sectionsForRender}
          linesBySection={linesBySection}
          mappingsByLineId={mappingsByLineId}
          adjustmentsByLineId={adjustmentsByLineId}
          rolledFromUnconfirmed={rolledFromUnconfirmed}
          transactions={transactions}
          allCategories={allCategories}
          user={user}
          reloadLine={reloadLine}
          expandedLineId={expandedLineId}
          setExpandedLineId={setExpandedLineId}
        />
      ) : (
        <CompareView
          years={sortedYearsAsc}
          compareYears={compareYears}
          setCompareYears={setCompareYears}
          compareData={compareData}
          compareLoading={compareLoading}
          statements={statements}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit view (single-year editor)
// ─────────────────────────────────────────────────────────────────────────────

function EditView({
  yearsLoading, years, statements, selectedYear, setSelectedYear, handleAddYear,
  stmt, lockedAt, handleDeleteYear, deletingYear, linesLoading, sectionsForRender,
  linesBySection, mappingsByLineId, adjustmentsByLineId, rolledFromUnconfirmed,
  transactions, allCategories, user, reloadLine, expandedLineId, setExpandedLineId,
}) {
  return (
    <>
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
                  onClick={() => setSelectedYear(y)}
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
            title="No years seeded yet"
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
                              rolledFromUnconfirmed={rolledFromUnconfirmed.has(line.id)}
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
              <span className="font-semibold text-surface-700">Stage 4 will add:</span>{' '}
              year-level Lock Statement (snapshots the whole year as an official document) and the
              book-structured PDF export with supporting detail.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compare view (read-only multi-year)
// ─────────────────────────────────────────────────────────────────────────────

function CompareView({ years, compareYears, setCompareYears, compareData, compareLoading, statements }) {
  // Toggle a year in the compare set. Always keeps the array sorted ascending
  // so the columns render oldest-leftmost.
  function toggleYear(y) {
    setCompareYears(prev => {
      const set = new Set(prev);
      if (set.has(y)) set.delete(y); else set.add(y);
      return [...set].sort((a, b) => a - b);
    });
  }

  // Group lines from all years by (section_code, lower(title)) so the same
  // logical line lines up across columns even if titles drift on case.
  const compareRows = useMemo(() => {
    if (!compareData) return [];
    const { linesByYear, mByLine, aByLine, txnsByYear } = compareData;

    const byKey = new Map();
    for (const y of compareYears) {
      const yLines = linesByYear[y] || [];
      for (const line of yLines) {
        const key = `${line.section_code}::${(line.title || '').toLowerCase()}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            key,
            section: findSection(line.section_code),
            section_code: line.section_code,
            title: line.title,
            display_order: line.display_order,
            byYear: {},
          });
        }
        byKey.get(key).byYear[y] = line;
      }
    }

    const rows = [];
    for (const info of byKey.values()) {
      const cells = compareYears.map(y => {
        const line = info.byYear[y];
        if (!line) return { year: y, missing: true };
        const mappings    = mByLine[line.id] || [];
        const adjustments = aByLine[line.id] || [];
        const txns        = txnsByYear[y] || [];
        const summary = computeLineEndingSummary(line, mappings, adjustments, txns, info.section);
        return {
          year: y,
          missing: false,
          line,
          ...summary,
          isMapping: mappings.length > 0,
        };
      });
      rows.push({ ...info, cells });
    }

    rows.sort((a, b) => {
      const ag = bookGroupOrder(a.section?.group);
      const bg = bookGroupOrder(b.section?.group);
      if (ag !== bg) return ag - bg;
      if (a.section_code !== b.section_code) return a.section_code.localeCompare(b.section_code);
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.title.localeCompare(b.title);
    });

    return rows;
  }, [compareData, compareYears]);

  return (
    <div className="space-y-4">
      {/* Year picker */}
      <div className="card p-4 space-y-2">
        <div className="text-xs uppercase tracking-wider text-surface-500 font-semibold">Years to compare</div>
        {years.length === 0 ? (
          <div className="text-sm text-surface-400">
            No years seeded yet. Add at least two years from the Edit Year tab to make this view useful.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {years.map(y => {
              const selected = compareYears.includes(y);
              const s = statements[y];
              const locked = s?.status === 'locked';
              return (
                <button
                  key={y}
                  onClick={() => toggleYear(y)}
                  className={`px-3 py-1.5 rounded-md text-sm font-mono border transition inline-flex items-center gap-1.5 ${
                    selected
                      ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                      : 'bg-white text-surface-500 border-surface-200 hover:border-brand-400'
                  }`}
                >
                  {y}
                  {locked && <Lock size={11} className={selected ? 'text-white/80' : 'text-amber-600'} />}
                </button>
              );
            })}
            {compareYears.length < 2 && (
              <span className="text-[11px] text-surface-400 inline-flex items-center">
                Pick at least two years to see deltas.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      {compareLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : !compareData || compareYears.length === 0 ? null : (
        <CompareTable rows={compareRows} years={compareYears} />
      )}

      <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs text-surface-500 flex items-start gap-2">
        <AlertCircle size={14} className="text-surface-400 mt-0.5 flex-shrink-0" />
        <div>
          Cells show the <span className="font-semibold text-surface-700">best-available ending</span> for each (year, line):
          the green <span className="font-semibold text-green-700">confirmed</span> snapshot when it exists, otherwise
          the live <span className="font-semibold text-surface-700">computed</span> value (begin + activity + adjustments).
          Δ columns compare adjacent years. Read-only here — edits happen in the Edit Year view.
        </div>
      </div>
    </div>
  );
}

function CompareTable({ rows, years }) {
  // Columns: a Line column + per-year cells with Δ columns between.
  // Computed deltas: amount and pct. pct is null if prior is 0.
  function delta(curr, prev) {
    if (curr?.missing || prev?.missing || curr == null || prev == null) return { missing: true };
    const c = Number(curr.end) || 0;
    const p = Number(prev.end) || 0;
    const amt = round2(c - p);
    const pct = p === 0 ? null : (amt / Math.abs(p)) * 100;
    return { missing: false, amount: amt, pct };
  }

  // Group rendering by section group so the visual flow stays Assets →
  // Liabilities → Equity. Within each group, sections render in the
  // structure order BOOK_BS_STRUCTURE defines.
  let lastGroup = null;
  let lastSection = null;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-100 bg-surface-50">
            <th className="px-3 py-2 text-left text-xs font-semibold text-surface-600 uppercase tracking-wider sticky left-0 bg-surface-50 z-10 min-w-[280px]">Line</th>
            {years.flatMap((y, i) => {
              const cells = [
                <th key={`y${y}`} className="px-3 py-2 text-right text-xs font-semibold text-surface-600 uppercase tracking-wider w-32">{y}</th>,
              ];
              if (i < years.length - 1) {
                cells.push(
                  <th key={`d${y}`} className="px-3 py-2 text-right text-[11px] font-semibold text-surface-500 uppercase tracking-wider w-32">
                    Δ {y}→{years[i + 1]}
                  </th>
                );
              }
              return cells;
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-center text-sm text-surface-400" colSpan={1 + years.length + Math.max(0, years.length - 1)}>
                Nothing to compare yet. Add lines via the Edit Year view.
              </td>
            </tr>
          ) : (
            rows.map(row => {
              const groupChanged = row.section?.group !== lastGroup;
              const sectionChanged = row.section_code !== lastSection;
              const groupRow = groupChanged ? (
                <tr key={`g-${row.section?.group || 'other'}-${row.key}`} className="bg-brand-50/60">
                  <td className="px-3 py-1 text-[11px] uppercase tracking-wider font-bold text-brand-700"
                      colSpan={1 + years.length + Math.max(0, years.length - 1)}>
                    {bookGroupLabel(row.section?.group)}
                  </td>
                </tr>
              ) : null;
              const sectionRow = sectionChanged ? (
                <tr key={`s-${row.section_code}-${row.key}`} className="bg-surface-50/70">
                  <td className="px-3 py-1 text-[11px] uppercase tracking-wider text-surface-500"
                      colSpan={1 + years.length + Math.max(0, years.length - 1)}>
                    <span className="font-mono mr-2">{row.section_code}</span> · {row.section?.title || row.section_code}
                    {row.section?.contra && <span className="ml-2 text-amber-700">· contra</span>}
                  </td>
                </tr>
              ) : null;
              lastGroup = row.section?.group;
              lastSection = row.section_code;
              return (
                <Fragment key={row.key}>
                  {groupRow}
                  {sectionRow}
                  <tr className="border-b border-surface-50 hover:bg-surface-50/40">
                    <td className="px-3 py-2 sticky left-0 bg-white z-[1] min-w-[280px]">
                      <div className="text-sm">{row.title}</div>
                    </td>
                    {row.cells.flatMap((cell, i) => {
                      const out = [<CompareCell key={`c-${row.key}-${i}`} cell={cell} />];
                      if (i < row.cells.length - 1) {
                        const d = delta(row.cells[i + 1], cell);
                        out.push(<DeltaCell key={`d-${row.key}-${i}`} d={d} />);
                      }
                      return out;
                    })}
                  </tr>
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function CompareCell({ cell }) {
  if (cell?.missing) {
    return <td className="px-3 py-2 text-right text-xs text-surface-300">—</td>;
  }
  const isConfirmed = cell.source === 'confirmed';
  return (
    <td className="px-3 py-2 text-right">
      <div className={`font-mono text-xs ${isConfirmed ? 'text-green-700 font-semibold' : 'text-surface-800'}`}>
        {formatCurrency(cell.end)}
      </div>
      <div className={`text-[10px] uppercase tracking-wider ${isConfirmed ? 'text-green-700' : 'text-surface-400'}`}>
        {isConfirmed ? 'confirmed' : 'computed'}
      </div>
    </td>
  );
}

function DeltaCell({ d }) {
  if (d?.missing) {
    return <td className="px-3 py-2 text-right text-xs text-surface-300">—</td>;
  }
  const positive = d.amount >= 0;
  const cls = d.amount === 0 ? 'text-surface-400' : positive ? 'text-green-700' : 'text-red-700';
  const pctText = d.pct == null
    ? '—'
    : `${positive ? '+' : ''}${d.pct.toFixed(1)}%`;
  return (
    <td className="px-3 py-2 text-right">
      <div className={`font-mono text-xs ${cls}`}>
        {positive ? '+' : ''}{formatCurrency(d.amount)}
      </div>
      <div className={`text-[10px] ${cls}`}>{pctText}</div>
    </td>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row + editor (Stage 2; Stage 3 wires in the rolled-from-unconfirmed chip)
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

function RolledUnconfirmedChip() {
  return (
    <span
      title="Prior year's ending was not confirmed; this beginning defaulted to $0. Update before confirming this line."
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold bg-amber-100 text-amber-800 border border-amber-200 ml-1.5 cursor-help"
    >
      <AlertTriangle size={10} /> rolled / unconfirmed
    </span>
  );
}

function BookBSLineRow({ line, section, mappings, adjustments, transactions, expanded, onToggle, allCategories, user, rolledFromUnconfirmed, onSaved }) {
  const isMapping = mappings.length > 0;

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
          {rolledFromUnconfirmed && <RolledUnconfirmedChip />}
        </td>
        <td className="table-cell">
          <ModeBadge isMapping={isMapping} />
        </td>
        <td className="table-cell text-right font-mono text-xs">
          {formatCurrency(line.beginning_balance)}
        </td>
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
              rolledFromUnconfirmed={rolledFromUnconfirmed}
              onSaved={async () => { await onSaved(); }}
              onCancel={onToggle}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function LineEditor({ line, section, initialMappings, initialAdjustments, transactions, allCategories, user, confirmedAt, rolledFromUnconfirmed, onSaved, onCancel }) {
  const [beginning, setBeginning] = useState(String(line.beginning_balance ?? 0));
  const [mappings, setMappings]   = useState(initialMappings.map(m => ({ category_id: m.category_id, category_name: m.category_name })));
  const [adjustments, setAdjustments] = useState(
    initialAdjustments.map(a => ({ id: a.id, amount: a.amount, note: a.note, created_at: a.created_at }))
  );

  const [newMappingCategoryId, setNewMappingCategoryId] = useState('');
  const [newAdjAmount, setNewAdjAmount] = useState('');
  const [newAdjNote, setNewAdjNote]     = useState('');
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    setBeginning(String(line.beginning_balance ?? 0));
  }, [line.id, line.beginning_balance]);

  const isMappingDriven = mappings.length > 0;

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

  async function save(confirmIt) {
    setSaving(true);
    try {
      const lineUpdate = {
        beginning_balance: round2(beginningNum),
        updated_at: new Date().toISOString(),
      };
      if (confirmIt) {
        lineUpdate.ending_balance_confirmed = computedEnd;
        lineUpdate.confirmed_by             = user?.id || null;
        lineUpdate.confirmed_at             = new Date().toISOString();
      } else {
        lineUpdate.ending_balance_confirmed = null;
        lineUpdate.confirmed_by             = null;
        lineUpdate.confirmed_at             = null;
      }
      const { error: lineErr } = await supabase.from('book_bs_lines').update(lineUpdate).eq('id', line.id);
      if (lineErr) throw lineErr;

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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ModeBadge isMapping={isMappingDriven} />
          <span className="text-[10px] uppercase tracking-wider text-surface-400">{naturalSideLabel}</span>
          {rolledFromUnconfirmed && <RolledUnconfirmedChip />}
        </div>
        {confirmedAt && (
          <div className="text-[11px] text-green-700 inline-flex items-center gap-1">
            <CheckCircle2 size={12} /> Confirmed · {confirmedAt}
            <span className="text-amber-700 ml-2">— editing will reset confirmation when you save</span>
          </div>
        )}
      </div>

      {rolledFromUnconfirmed && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 flex items-start gap-2">
          <AlertTriangle size={12} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <div>
            Beginning balance defaulted to $0 because the prior year's matching line was never confirmed.
            Either confirm the prior-year line first (its ending will flow forward on next year's add), or
            update this beginning balance manually before confirming this line.
          </div>
        </div>
      )}

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
