import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { toast } from 'react-hot-toast';
import BridgePanel from './BridgePanel';
import JEPreview from './JEPreview';

const usd = (n) => {
  const num = Number(n || 0);
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const csvEsc = (v) => {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};

function downloadCsv(filename, rows) {
  const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function PayrollPage() {
  const [loadState, setLoadState] = useState('loading');
  const [months, setMonths] = useState([]);
  const [lines, setLines] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [filter, setFilter] = useState({ status: 'all', search: '' });
  const [sortKey, setSortKey] = useState('pay_date');
  const [sortDir, setSortDir] = useState('asc');
  const [previewBasis, setPreviewBasis] = useState('accrual'); // 'accrual' | 'net_cash'

  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      const [monthsRes, linesRes] = await Promise.all([
        fetchAll(supabase.from('payroll_months').select('*')),
        fetchAll(supabase.from('payroll_lines').select('*')),
      ]);
      setMonths(monthsRes.sort((a, b) => (a.pay_month < b.pay_month ? -1 : 1)));
      setLines(linesRes);
      setLoadState('ready');
    } catch (e) {
      console.error(e);
      setLoadState('error');
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const linesByMonth = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      if (!m.has(l.pay_month)) m.set(l.pay_month, []);
      m.get(l.pay_month).push(l);
    }
    return m;
  }, [lines]);

  const selectedMonthObj = months.find(m => m.pay_month === selectedMonth) || null;
  const selectedMonthLines = selectedMonth ? (linesByMonth.get(selectedMonth) || []) : [];

  const filteredSortedLines = useMemo(() => {
    let arr = [...selectedMonthLines];
    if (filter.status !== 'all') arr = arr.filter(l => l.match_status === filter.status);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      arr = arr.filter(l => (l.employee_name || '').toLowerCase().includes(q));
    }
    arr.sort((a, b) => {
      const va = a[sortKey]; const vb = b[sortKey];
      if (va === vb) return 0;
      const cmp = va < vb ? -1 : 1;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [selectedMonthLines, filter, sortKey, sortDir]);

  const selectedLine = filteredSortedLines.find(l => l.id === selectedLineId) || null;

  const linkCheck = useCallback(async (line, check) => {
    const { error } = await supabase.from('payroll_lines').update({
      matched_check_id: check.id,
      matched_transaction_id: null,
      match_status: 'matched_check',
      match_confidence: Math.abs(Number(check.amount) - Number(line.net_pay)) < 0.005 ? 'exact' : 'near',
      match_day_delta: Math.round((new Date(check.clear_date) - new Date(line.pay_date)) / 86400000),
    }).eq('id', line.id);
    if (error) { toast.error('Link failed: ' + error.message); return; }
    toast.success(`Linked Ck#${check.check_no}`);
    await loadData();
  }, [loadData]);

  const linkTxn = useCallback(async (line, txn) => {
    const { error } = await supabase.from('payroll_lines').update({
      matched_check_id: null,
      matched_transaction_id: txn.id,
      match_status: 'matched_txn',
      match_confidence: 'name',
      match_day_delta: Math.round((new Date(txn.date) - new Date(line.pay_date)) / 86400000),
    }).eq('id', line.id);
    if (error) { toast.error('Link failed: ' + error.message); return; }
    toast.success(`Linked txn ${txn.date}`);
    await loadData();
  }, [loadData]);

  const unlink = useCallback(async (line) => {
    const { error } = await supabase.from('payroll_lines').update({
      matched_check_id: null,
      matched_transaction_id: null,
      match_status: 'unmatched',
      match_confidence: null,
      match_day_delta: null,
    }).eq('id', line.id);
    if (error) { toast.error('Unlink failed: ' + error.message); return; }
    toast.success('Unlinked');
    await loadData();
  }, [loadData]);

  const markNoDisbursement = useCallback(async (line) => {
    const { error } = await supabase.from('payroll_lines').update({
      match_status: 'no_disbursement',
      matched_check_id: null,
      matched_transaction_id: null,
    }).eq('id', line.id);
    if (error) { toast.error('Update failed: ' + error.message); return; }
    toast.success('Marked no disbursement');
    await loadData();
  }, [loadData]);

  const exportMonth = useCallback((month) => {
    const monthObj = months.find(m => m.pay_month === month);
    if (!monthObj) return;
    const jeRows = [
      ['line', 'account', 'DR', 'CR'],
      ['1', 'Payroll expense (gross)', usd(monthObj.total_gross), ''],
      ['2', 'Payroll tax expense (est)', usd(monthObj.total_er_tax), ''],
      ['3', 'Cash & Bank', '', usd(monthObj.total_net)],
      ['4', 'Payroll Taxes Payable', '', usd(monthObj.total_ee_tax + monthObj.total_er_tax)],
    ].map(r => r.map(csvEsc).join(','));
    downloadCsv(`payroll_preview_${month}.csv`, ['TENTATIVE — NOT POSTED', `pay_month,${month}`, '', ...jeRows]);
  }, [months]);

  const exportAll = useCallback(() => {
    const lines = ['TENTATIVE — NOT POSTED', 'pay_month,account,DR,CR'];
    for (const m of months) {
      lines.push(`${m.pay_month},Payroll expense (gross),${m.total_gross.toFixed(2)},`);
      lines.push(`${m.pay_month},Payroll tax expense (est),${m.total_er_tax.toFixed(2)},`);
      lines.push(`${m.pay_month},Cash & Bank,,${m.total_net.toFixed(2)}`);
      lines.push(`${m.pay_month},Payroll Taxes Payable,,${(m.total_ee_tax + m.total_er_tax).toFixed(2)}`);
    }
    downloadCsv(`payroll_preview_all_months.csv`, lines);
  }, [months]);

  if (loadState === 'loading') {
    return <div className="p-6"><div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" /></div>;
  }
  if (loadState === 'error') {
    return <div className="p-6 text-red-600">Failed to load payroll data.</div>;
  }

  const isEmpty = months.length === 0;

  return (
    <div className="p-6 space-y-4 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payroll</h1>
          <p className="text-sm text-gray-500">Individual paycheck rows from the 2024 register, bridged to checks and transactions.</p>
        </div>
        <div className="flex gap-2 items-center">
          <span className="inline-flex items-center px-2 py-1 rounded bg-amber-100 text-amber-800 text-xs font-semibold">TENTATIVE — NOT POSTED</span>
          <button className="btn-secondary text-xs" onClick={exportAll} disabled={isEmpty}>Export all months (CSV)</button>
        </div>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <div className="text-lg font-semibold text-gray-700">No payroll data loaded yet</div>
          <p className="text-sm text-gray-500 mt-2 max-w-lg mx-auto">
            The <code>payroll_lines</code> and <code>payroll_months</code> tables are empty. To populate:
          </p>
          <ol className="mt-3 text-left inline-block text-sm text-gray-600 space-y-1">
            <li>1. Drop <code>payroll_2024_named.csv</code> at <code>~/Documents/selric-exports/</code> (983 rows, full employee names)</li>
            <li>2. Run <code>node scripts/payroll_tab_phase1.mjs</code> — must tie to spec totals</li>
            <li>3. Run <code>WRITE_ENABLED=YES CPA_SIGNOFF=YES node scripts/load_payroll_lines.mjs --commit</code></li>
            <li>4. Run <code>WRITE_ENABLED=YES CPA_SIGNOFF=YES node scripts/populate_payroll_months.mjs --commit</code></li>
            <li>5. Run <code>WRITE_ENABLED=YES CPA_SIGNOFF=YES node scripts/preseed_payroll_bridge.mjs --commit</code></li>
            <li>6. Reload this page</li>
          </ol>
        </div>
      )}

      {/* Month list */}
      {!isEmpty && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Month</th>
                <th className="px-3 py-2 text-right">Lines</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2 text-right">EE tax</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-3 py-2 text-right">ER tax (est)</th>
                <th className="px-3 py-2 text-right">Loaded</th>
                <th className="px-3 py-2 text-right">Plug</th>
                <th className="px-3 py-2 text-right">Fragments</th>
                <th className="px-3 py-2 text-right">Booked total</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2 text-center">Bridge</th>
                <th className="px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {months.map(m => {
                const bookedTotal = Number(m.existing_booked_total || 0) || (Number(m.existing_plug_amount || 0) + Number(m.existing_fragment_amount || 0));
                const variance = Number(m.total_loaded || 0) - bookedTotal;
                const bridgedLines = (linesByMonth.get(m.pay_month) || []).filter(l => l.match_status !== 'unmatched').length;
                const bridgedNet = Number(m.matched_to_check_net || 0) + Number(m.matched_to_txn_net || 0);
                const unbridgedNet = Number(m.unmatched_net || 0);
                const bridgeReady = unbridgedNet <= 0.005;
                const isSel = selectedMonth === m.pay_month;
                return (
                  <tr
                    key={m.pay_month}
                    className={`cursor-pointer hover:bg-blue-50 ${isSel ? 'bg-blue-50 font-medium' : ''}`}
                    onClick={() => { setSelectedMonth(m.pay_month === selectedMonth ? null : m.pay_month); setSelectedLineId(null); }}
                  >
                    <td className="px-3 py-2">{m.pay_month}</td>
                    <td className="px-3 py-2 text-right">{m.line_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd(m.total_gross)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd(m.total_ee_tax)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{usd(m.total_net)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{usd(m.total_er_tax)} <span className="text-xs">(est)</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{usd(m.total_loaded)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{usd(m.existing_plug_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{usd(m.existing_fragment_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{usd(bookedTotal)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${variance > 0 ? 'text-red-600' : 'text-green-700'}`}>{usd(variance)}</td>
                    <td className="px-3 py-2 text-center text-xs">
                      <div>{bridgedLines} of {m.line_count} lines</div>
                      <div className="text-gray-500">{usd(bridgedNet)} bridged · <span className={unbridgedNet > 0 ? 'text-amber-700' : 'text-green-700'}>{usd(unbridgedNet)} unbridged</span></div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {bridgeReady
                        ? <span className="inline-flex px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs">bridged</span>
                        : <span className="inline-flex px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">partial</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Selected month detail */}
      {selectedMonthObj && (
        <div className="rounded-lg border border-blue-300 bg-blue-50/40 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{selectedMonth} — {selectedMonthObj.line_count} paychecks</h2>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" onClick={() => exportMonth(selectedMonth)}>Export preview CSV</button>
              <button className="btn-secondary text-xs" onClick={() => setSelectedMonth(null)}>Close</button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 items-center text-sm">
            <label>Filter:
              <select className="ml-2 border rounded px-2 py-1 text-xs" value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
                <option value="all">All</option>
                <option value="unmatched">Unmatched</option>
                <option value="matched_check">Matched to check</option>
                <option value="matched_txn">Matched to txn</option>
                <option value="no_disbursement">No disbursement</option>
              </select>
            </label>
            <label>Search:
              <input className="ml-2 border rounded px-2 py-1 text-xs" placeholder="employee name" value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} />
            </label>
            <span className="text-xs text-gray-500">Showing {filteredSortedLines.length} of {selectedMonthLines.length}</span>
          </div>

          {/* Paycheck list */}
          <div className="rounded border border-gray-200 bg-white max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  {[
                    ['pay_date', 'Pay date'], ['employee_name', 'Employee'],
                    ['gross_pay', 'Gross'], ['employee_taxes', 'EE tax'], ['net_pay', 'Net'],
                    ['match_status', 'Match'], [null, 'Linked'],
                  ].map(([k, label]) => (
                    <th key={label} className="px-2 py-1 text-left cursor-pointer" onClick={() => k && (setSortDir(sortKey === k && sortDir === 'asc' ? 'desc' : 'asc'), setSortKey(k))}>
                      {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSortedLines.map(l => (
                  <tr
                    key={l.id}
                    className={`hover:bg-blue-50 cursor-pointer ${selectedLineId === l.id ? 'bg-blue-100' : ''}`}
                    onClick={() => setSelectedLineId(l.id === selectedLineId ? null : l.id)}
                  >
                    <td className="px-2 py-1">{l.pay_date}</td>
                    <td className="px-2 py-1">{l.employee_name} {l.is_starred ? '★' : ''}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{usd(l.gross_pay)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{usd(l.employee_taxes)}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">{usd(l.net_pay)}</td>
                    <td className="px-2 py-1">
                      {l.match_status === 'matched_check' && <span className="text-green-700">check {l.match_confidence ? `(${l.match_confidence})` : ''}</span>}
                      {l.match_status === 'matched_txn' && <span className="text-green-700">txn {l.match_confidence ? `(${l.match_confidence})` : ''}</span>}
                      {l.match_status === 'unmatched' && <span className="text-amber-700">unmatched</span>}
                      {l.match_status === 'no_disbursement' && <span className="text-gray-500">no disbursement</span>}
                    </td>
                    <td className="px-2 py-1 text-xs text-gray-600">
                      {l.matched_check_id ? `check ${l.matched_check_id.slice(0, 8)}` : (l.matched_transaction_id ? `txn ${l.matched_transaction_id.slice(0, 8)}` : '—')}
                      {(l.matched_check_id || l.matched_transaction_id) && (
                        <button className="ml-2 text-red-600" onClick={(e) => { e.stopPropagation(); unlink(l); }}>unlink</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bridge panel + JE preview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BridgePanel
              line={selectedLine}
              onLinkCheck={linkCheck}
              onLinkTxn={linkTxn}
              onMarkNoDisbursement={markNoDisbursement}
            />
            <JEPreview
              month={selectedMonthObj}
              basis={previewBasis}
              onBasisChange={setPreviewBasis}
            />
          </div>

          {/* Post placeholder */}
          <div className="rounded border border-gray-300 bg-gray-50 p-3 text-xs">
            <button
              className="btn-primary opacity-40 cursor-not-allowed"
              disabled
              title="Future action: BEFORE posting the replacement, will reverse BOTH the plug JE AND every payroll-tagged fragment (Venmo/CashApp/ATM/Zelle etc.) for this month. Both must be reversed — otherwise the fragments double-count against the new gross-basis JE. Not implemented in this build."
            >
              Post replacement JE (disabled — build placeholder)
            </button>
            <span className="ml-3 text-gray-500">
              This build has no post button. Future action must reverse BOTH the plug JE
              ({selectedMonthObj.existing_plug_je_id ? selectedMonthObj.existing_plug_je_id.slice(0, 8) : 'none'})
              AND all payroll-tagged fragment rows ({usd(Number(selectedMonthObj.existing_fragment_amount || 0))} for this month)
              before posting the replacement — otherwise the fragments double-count.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
