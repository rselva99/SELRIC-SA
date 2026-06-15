// Stage 1 — Book Balance Sheet Builder skeleton.
//
// What this page does in Stage 1:
//   • Lists the years that already have rows in book_bs_lines.
//   • "+ Add Year" inserts the seeded line skeleton from
//     src/lib/bookBalanceSheet.js for the chosen year.
//   • Shows the seeded sections + line titles read-only with a clear
//     "Stage 2 will make these editable" note.
//   • Per-year Delete (lines + statement) so the user can re-seed during
//     testing without going into the database.
//
// What it intentionally does NOT do yet (saved for later stages):
//   • Per-line editing of beginning balance / mappings / adjustments → Stage 2
//   • Multi-year roll-forward + compare view                         → Stage 3
//   • Lock / Official statement + PDF                                → Stage 4
//   • Per-transaction picker                                         → Stage 5

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  BOOK_BS_STRUCTURE,
  SEED_LINE_TITLES,
  buildSeedLinesForYear,
  bookGroupLabel,
  bookGroupOrder,
} from '../../lib/bookBalanceSheet';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import toast from 'react-hot-toast';
import {
  BookOpen, Plus, ChevronLeft, Trash2, Info, Lock, AlertCircle,
} from 'lucide-react';

export default function BookBalanceSheetPage() {
  const { user } = useAuth();
  const [years, setYears]               = useState([]);
  const [statements, setStatements]     = useState({});  // { 2024: { status, locked_at, ... } }
  const [selectedYear, setSelectedYear] = useState(null);
  const [lines, setLines]               = useState([]);
  const [yearsLoading, setYearsLoading] = useState(true);
  const [linesLoading, setLinesLoading] = useState(false);
  const [addingYear, setAddingYear]     = useState(false);
  const [deletingYear, setDeletingYear] = useState(false);

  // ── Load existing years (distinct year column from book_bs_lines) ────────
  async function loadYears() {
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
      const ys = [...set].sort((a, b) => b - a); // newest first
      setYears(ys);

      const sm = {};
      (stmtRows || []).forEach(s => { sm[s.year] = s; });
      setStatements(sm);

      // Default-select the most recent year, but don't override an explicit
      // selection the user already made.
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
  }

  // ── Load lines for the selected year ─────────────────────────────────────
  async function loadLines(year) {
    if (year == null) { setLines([]); return; }
    setLinesLoading(true);
    try {
      const { data, error } = await supabase
        .from('book_bs_lines')
        .select('*')
        .eq('year', year)
        .order('section_code', { ascending: true })
        .order('display_order', { ascending: true });
      if (error) throw error;
      setLines(data || []);
    } catch (err) {
      console.error('book-bs: load lines failed', err);
      toast.error(err.message || 'Failed to load lines');
      setLines([]);
    } finally {
      setLinesLoading(false);
    }
  }

  useEffect(() => { loadYears(); }, []);
  useEffect(() => { loadLines(selectedYear); }, [selectedYear]);

  // ── Add Year flow ────────────────────────────────────────────────────────
  //
  // Prompt the user for the year, validate, then seed the lines from
  // BOOK_BS_STRUCTURE + SEED_LINE_TITLES. The unique index on
  // (year, section_code, lower(title)) protects against double-seed if
  // the user re-clicks; we surface that as a friendly toast.
  async function handleAddYear() {
    const input = window.prompt('Add year (YYYY)', String(new Date().getFullYear()));
    if (input == null) return;
    const year = parseInt(input.trim(), 10);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      toast.error('Enter a year between 2000 and 2100');
      return;
    }
    if (years.includes(year)) {
      toast.error(`Year ${year} already exists — select it from the tabs`);
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
      + 'Stage 1 only — this is here so you can re-seed during testing. '
      + 'Mappings, adjustments, and any locked statement for this year will '
      + 'also be removed by the ON DELETE CASCADE on the line rows.'
    )) return;

    setDeletingYear(true);
    try {
      // Cascade kills mappings + adjustments + line_txns via the FK on line_id.
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

  // ── Group lines by section_code for rendering ────────────────────────────
  const linesBySection = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      if (!m.has(l.section_code)) m.set(l.section_code, []);
      m.get(l.section_code).push(l);
    }
    return m;
  }, [lines]);

  // Sections rendered in the order BOOK_BS_STRUCTURE defines, regardless of
  // what the user has in the DB. Sections with no rows are still shown so
  // the skeleton remains visually obvious even after a partial delete.
  const sectionsForRender = useMemo(() => {
    return BOOK_BS_STRUCTURE
      .slice()
      .sort((a, b) => bookGroupOrder(a.group) - bookGroupOrder(b.group));
  }, []);

  const stmt = selectedYear != null ? statements[selectedYear] : null;
  const lockedAt = stmt?.locked_at ? new Date(stmt.locked_at).toLocaleString() : null;

  // ── Render ───────────────────────────────────────────────────────────────
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
            Stage 1 — schema and skeleton. Editing comes in Stage 2.
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
          <div className="font-semibold mb-0.5">Stage 1 of 4 (5)</div>
          You can seed a year here from the firm's book skeleton — line titles
          only, no dollar values, no account numbers. Editing (beginning
          balances, mapped categories, manual adjustments) lands in Stage 2.
          Locking and the official PDF land in Stage 4.
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
            No years yet. Click <span className="font-semibold text-surface-700">Add Year</span> to seed one from the firm's book skeleton.
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

      {/* Selected-year body */}
      {selectedYear == null ? (
        !yearsLoading && years.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Stage 1 ready — schema applied, no years seeded yet"
            description="Click Add Year to populate the firm's book balance-sheet skeleton (section headers + line titles) for the year. Each line will be editable starting in Stage 2."
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
              title="Stage-1 only — removes lines + statement so you can re-seed"
              className="btn-ghost text-xs inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              {deletingYear ? <Spinner size="sm" /> : <Trash2 size={12} />}
              Delete year (Stage-1 testing only)
            </button>
          </div>

          {/* Sections */}
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
                            <th className="table-header w-12 text-right">#</th>
                            <th className="table-header">Line</th>
                            <th className="table-header text-right">Beginning</th>
                            <th className="table-header text-right">Confirmed ending</th>
                            <th className="table-header text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((l, i) => (
                            <tr key={l.id} className="border-b border-surface-50">
                              <td className="table-cell text-right font-mono text-xs text-surface-400">{i + 1}</td>
                              <td className="table-cell text-sm">{l.title}</td>
                              <td className="table-cell text-right font-mono text-xs text-surface-500">
                                ${Number(l.beginning_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="table-cell text-right font-mono text-xs text-surface-500">
                                {l.ending_balance_confirmed == null
                                  ? <span className="text-surface-300">—</span>
                                  : `$${Number(l.ending_balance_confirmed).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </td>
                              <td className="table-cell text-right">
                                <span className="text-[10px] uppercase tracking-wider text-surface-400">
                                  {l.confirmed_at ? 'confirmed' : 'draft'}
                                </span>
                              </td>
                            </tr>
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
              <span className="font-semibold text-surface-700">Stage 2 will add:</span> editable beginning
              balance per line; mapped CoA categories (multi-select) with computed activity for the year;
              manual adjustments (signed amount + note); a "mapping vs. manual" mode indicator per line;
              and per-line Confirm.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
