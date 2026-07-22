import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';

const usd = (n) => {
  const num = Number(n || 0);
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function dayShift(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dayDelta(a, b) {
  return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);
}
function lastNameOf(name) {
  // "Broadbear, David" → "Broadbear"; "David Broadbear" → "Broadbear"
  if (!name) return '';
  const s = String(name).trim();
  if (s.includes(',')) return s.split(',')[0].trim();
  const parts = s.split(/\s+/);
  return parts[parts.length - 1];
}

export default function BridgePanel({ line, onLinkCheck, onLinkTxn, onMarkNoDisbursement }) {
  const [checkCands, setCheckCands] = useState([]);
  const [txnCands, setTxnCands] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    if (!line) { setCheckCands([]); setTxnCands([]); return; }
    setLoading(true);
    try {
      const net = Number(line.net_pay);
      const lo = net - 0.50, hi = net + 0.50;
      const winStart = dayShift(line.pay_date, -2);
      const winEnd   = dayShift(line.pay_date, +14);
      const wideStart = dayShift(line.pay_date, -14);
      const wideEnd   = dayShift(line.pay_date, +14);

      const [checks, txnByAmt, txnByName] = await Promise.all([
        fetchAll(supabase.from('checks').select('id, check_no, amount, clear_date, status, notes')
          .gte('amount', lo).lte('amount', hi)
          .gte('clear_date', winStart).lte('clear_date', winEnd)),
        fetchAll(supabase.from('transactions').select('id, date, description, amount, type, category')
          .gte('amount', lo).lte('amount', hi)
          .gte('date', wideStart).lte('date', wideEnd)
          .eq('posted', true).eq('voided', false)),
        (async () => {
          const ln = lastNameOf(line.employee_name);
          if (!ln || ln.length < 3) return [];
          return await fetchAll(supabase.from('transactions').select('id, date, description, amount, type, category')
            .gte('date', wideStart).lte('date', wideEnd)
            .ilike('description', `%${ln}%`)
            .eq('posted', true).eq('voided', false));
        })(),
      ]);

      const ranked = checks.map(c => ({ ...c, delta: dayDelta(c.clear_date, line.pay_date) }))
                            .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      setCheckCands(ranked);

      // Merge txn by amount + txn by name (dedup)
      const map = new Map();
      for (const t of txnByAmt) map.set(t.id, { ...t, matchReason: 'amount' });
      for (const t of txnByName) {
        if (map.has(t.id)) map.get(t.id).matchReason = 'amount+name';
        else map.set(t.id, { ...t, matchReason: 'name' });
      }
      const txnList = [...map.values()].map(t => ({ ...t, delta: dayDelta(t.date, line.pay_date) }))
                                        .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
      setTxnCands(txnList);
    } finally { setLoading(false); }
  }, [line]);

  useEffect(() => { search(); }, [search]);

  if (!line) {
    return (
      <div className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <div className="font-semibold text-gray-700 mb-2">Bridge panel</div>
        Select a paycheck above to see candidate checks and transactions.
      </div>
    );
  }

  return (
    <div className="rounded border border-gray-200 bg-white p-4 text-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-700">Bridge: {line.employee_name}</div>
          <div className="text-xs text-gray-500">Pay {line.pay_date} · Net {usd(line.net_pay)} · Status: {line.match_status}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={search} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
          <button className="btn-secondary text-xs" onClick={() => onMarkNoDisbursement(line)}>Mark no disbursement</button>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-600 mt-2">CHECKS (±$0.50, {line.pay_date} −2..+14)</div>
        {checkCands.length === 0 && <div className="text-xs text-gray-500 italic">No candidate checks.</div>}
        {checkCands.length > 0 && (
          <table className="w-full text-xs mt-1">
            <thead className="bg-gray-50"><tr>
              <th className="px-2 py-1 text-left">Ck#</th>
              <th className="px-2 py-1 text-right">Amount</th>
              <th className="px-2 py-1 text-left">Cleared</th>
              <th className="px-2 py-1 text-center">Δd</th>
              <th className="px-2 py-1 text-left">Status</th>
              <th className="px-2 py-1"></th>
            </tr></thead>
            <tbody>
              {checkCands.map(c => (
                <tr key={c.id}>
                  <td className="px-2 py-1">{c.check_no}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usd(c.amount)}</td>
                  <td className="px-2 py-1">{c.clear_date}</td>
                  <td className="px-2 py-1 text-center">{c.delta}</td>
                  <td className="px-2 py-1">{c.status}</td>
                  <td className="px-2 py-1 text-right"><button className="btn-primary text-xs py-0" onClick={() => onLinkCheck(line, c)}>link</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-600 mt-3">TRANSACTIONS (±$0.50 in ±14d, OR name-match on last name)</div>
        {txnCands.length === 0 && <div className="text-xs text-gray-500 italic">No candidate transactions.</div>}
        {txnCands.length > 0 && (
          <table className="w-full text-xs mt-1">
            <thead className="bg-gray-50"><tr>
              <th className="px-2 py-1 text-left">Date</th>
              <th className="px-2 py-1 text-right">Amount</th>
              <th className="px-2 py-1 text-left">Category</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-center">Match</th>
              <th className="px-2 py-1"></th>
            </tr></thead>
            <tbody>
              {txnCands.map(t => (
                <tr key={t.id}>
                  <td className="px-2 py-1">{t.date}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usd(t.amount)}</td>
                  <td className="px-2 py-1">{t.category}</td>
                  <td className="px-2 py-1 max-w-xs truncate" title={t.description}>{t.description}</td>
                  <td className="px-2 py-1 text-center text-xs text-gray-500">{t.matchReason}</td>
                  <td className="px-2 py-1 text-right"><button className="btn-primary text-xs py-0" onClick={() => onLinkTxn(line, t)}>link</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
