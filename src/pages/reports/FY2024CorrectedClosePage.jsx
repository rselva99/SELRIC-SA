import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatCurrency } from '../../lib/utils';
import { ChevronLeft, AlertTriangle, Info } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';

const SCENARIO_SLUG = 'fy2024-corrected-close';

const STATEMENT_ORDER = [
  { key: 'PL', title: 'Profit & Loss' },
  { key: 'BS', title: 'Balance Sheet' },
  { key: 'EQUITY', title: 'Equity Roll-forward' },
  { key: 'RESIDUAL', title: 'Residual Decomposition' },
  { key: 'OPEN_ITEM', title: 'Open Items' },
];

const TIER_BADGE_CLASS = {
  A: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  B: 'bg-sky-100 text-sky-800 border-sky-200',
  C: 'bg-amber-100 text-amber-800 border-amber-200',
  D: 'bg-rose-100 text-rose-800 border-rose-200',
};

const TIER_LABEL = { A: 'TIED', B: 'DERIVED', C: 'ESTIMATED', D: 'ASSUMED' };

function TierBadge({ tier }) {
  if (!tier) return null;
  const cls = TIER_BADGE_CLASS[tier] || 'bg-gray-100 text-gray-800 border-gray-200';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cls}`}
      title={TIER_LABEL[tier] || tier}
    >
      [{tier}]
    </span>
  );
}

// Deficit-safe currency display. Negative values render in parentheses AND red.
function fmtEquity(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (num === 0) return formatCurrency(0);
  if (num < 0) return `(${formatCurrency(Math.abs(num))})`;
  return formatCurrency(num);
}

function AmountCell({ amount, isEquity }) {
  if (amount === null || amount === undefined) return <td className="text-right text-gray-400">—</td>;
  const num = Number(amount);
  const isNegative = num < 0;
  const cls = isNegative ? 'text-rose-700 font-semibold' : 'text-gray-900';
  const display = isEquity ? fmtEquity(num) : (isNegative ? `(${formatCurrency(Math.abs(num))})` : formatCurrency(num));
  return <td className={`text-right whitespace-nowrap ${cls}`}>{display}</td>;
}

function LineRow({ line, isEquity, isPerPartner }) {
  return (
    <tr className="border-t border-gray-100">
      <td className="py-1.5 pl-2 pr-3">
        <div className="flex items-center gap-2">
          <span>{line.line_label}</span>
          {isPerPartner && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-rose-50 text-rose-700 border-rose-200"
              title="ASSUMED — pending Justin's opening capital accounts"
            >
              <AlertTriangle size={10} /> [D] pending Justin
            </span>
          )}
        </div>
        {line.note && (
          <div className="text-xs text-gray-500 mt-0.5">{line.note}</div>
        )}
      </td>
      <td className="py-1.5 px-2">
        <TierBadge tier={line.evidence_tier} />
      </td>
      <AmountCell amount={line.amount} isEquity={isEquity} />
      <td className="py-1.5 px-2 text-xs text-gray-500 whitespace-nowrap" title={line.source_ref || ''}>
        {line.source_ref || ''}
      </td>
    </tr>
  );
}

export default function FY2024CorrectedClosePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [scenario, setScenario] = useState(null);
  const [lines, setLines]     = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: sc, error: e1 } = await supabase
          .from('close_scenarios')
          .select('*')
          .eq('slug', SCENARIO_SLUG)
          .maybeSingle();
        if (e1) throw e1;
        if (!sc) {
          if (!cancelled) {
            setError('Scenario has not been loaded yet. Run the migration and then the local loader.');
            setLoading(false);
          }
          return;
        }
        const { data: ln, error: e2 } = await supabase
          .from('close_scenario_lines')
          .select('*')
          .eq('scenario_id', sc.id)
          .order('sort_order');
        if (e2) throw e2;
        if (!cancelled) {
          setScenario(sc);
          setLines(ln || []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const bySection = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      if (!m.has(l.statement)) m.set(l.statement, []);
      m.get(l.statement).push(l);
    }
    return m;
  }, [lines]);

  return (
    <div className="animate-fade-in space-y-4">
      {/* Persistent scenario banner */}
      <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded flex items-start gap-3">
        <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold text-amber-900">
            SCENARIO — PROPOSED, NOT POSTED. The ledger is unchanged.
          </div>
          <div className="text-sm text-amber-800 mt-0.5">
            Every figure below is derived from source documents and is presented for review only. No transaction, journal entry, or book_bs row was modified to produce these numbers.
          </div>
        </div>
      </div>

      {/* Header */}
      <div>
        <Link to="/reports" className="text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 mb-1">
          <ChevronLeft size={12} /> Back to Reports
        </Link>
        <h1 className="page-title">FY2024 Corrected Close (Scenario View)</h1>
        {scenario && (
          <div className="text-sm text-gray-600 mt-1">
            {scenario.label} · status <span className="font-mono text-xs">{scenario.status}</span>
            {scenario.notes && <span> · {scenario.notes}</span>}
          </div>
        )}
      </div>

      {loading && <div className="py-8"><Spinner /></div>}

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded p-4 text-sm text-rose-800">
          <div className="font-semibold mb-1">Cannot load scenario</div>
          <div>{error}</div>
        </div>
      )}

      {!loading && !error && scenario && (
        <div className="space-y-6">
          {STATEMENT_ORDER.map(({ key, title }) => {
            const sectionLines = bySection.get(key) || [];
            if (sectionLines.length === 0) return null;
            const isEquity = key === 'EQUITY' || key === 'RESIDUAL';
            const isPerPartnerSection = key === 'EQUITY';
            return (
              <section key={key} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
                  <span className="text-xs text-gray-500">{sectionLines.length} lines</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-600">
                      <tr>
                        <th className="text-left pl-2 pr-3 py-2">Line</th>
                        <th className="text-left px-2 py-2 w-20">Tier</th>
                        <th className="text-right px-2 py-2 w-40">Amount</th>
                        <th className="text-left px-2 py-2 w-56">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectionLines.map(l => (
                        <LineRow
                          key={l.id}
                          line={l}
                          isEquity={isEquity}
                          isPerPartner={isPerPartnerSection && !/(SUM|basis|method)/i.test(l.line_label || '')}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          {/* Tier legend */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 text-xs text-gray-600 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1"><Info size={12} /> Evidence tiers:</div>
            <span><TierBadge tier="A" /> TIED to source document</span>
            <span><TierBadge tier="B" /> DERIVED from A inputs</span>
            <span><TierBadge tier="C" /> ESTIMATED (model stated)</span>
            <span><TierBadge tier="D" /> ASSUMED (no support)</span>
          </div>
        </div>
      )}
    </div>
  );
}
