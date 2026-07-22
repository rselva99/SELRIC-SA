import React from 'react';

const usd = (n) => {
  const num = Number(n || 0);
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * JE Preview — recomputes from the passed `month` on every render.
 * Never store the preview amount; always derive from live data.
 *
 * Accrual basis: DR Payroll expense (gross) + DR Payroll tax expense (est)
 *              / CR Cash & Bank (net) + CR Payroll Taxes Payable (EE tax + ER tax)
 * Net-cash basis (comparison): DR Payroll expense (net) / CR Cash & Bank (net) — the current plug shape.
 */
export default function JEPreview({ month, basis, onBasisChange }) {
  if (!month) return null;

  const gross = Number(month.total_gross || 0);
  const eeTax = Number(month.total_ee_tax || 0);
  const netPay = Number(month.total_net || 0);
  const erTax = Number(month.total_er_tax || 0);
  const totalLoaded = gross + erTax;
  const plug = Number(month.existing_plug_amount || 0);
  const fragments = Number(month.existing_fragment_amount || 0);
  // Booked today = plug + fragments. Fall back to computed sum if the field isn't populated yet.
  const bookedTotal = Number(month.existing_booked_total || 0) || (plug + fragments);
  const unbridgedNet = Number(month.unmatched_net || 0);

  let lines;
  let ready = unbridgedNet <= 0.005;
  let bookedToday = bookedTotal;
  let posted = 0; // if a replacement JE is later posted, this would be its size

  if (basis === 'accrual') {
    lines = [
      { account: 'Payroll expense (gross)',    dr: gross, cr: 0 },
      { account: 'Payroll tax expense (est)',  dr: erTax, cr: 0 },
      { account: 'Cash & Bank',                dr: 0,     cr: netPay },
      { account: 'Payroll Taxes Payable',      dr: 0,     cr: eeTax + erTax },
    ];
    posted = totalLoaded;
  } else {
    lines = [
      { account: 'Payroll expense (net)',      dr: netPay, cr: 0 },
      { account: 'Cash & Bank',                dr: 0,      cr: netPay },
    ];
    posted = netPay;
  }
  const totalDR = lines.reduce((s, l) => s + l.dr, 0);
  const totalCR = lines.reduce((s, l) => s + l.cr, 0);
  const balanced = Math.abs(totalDR - totalCR) < 0.005;

  const netChange = posted - bookedToday;

  return (
    <div className="rounded border border-gray-200 bg-white p-4 text-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-gray-700">Tentative JE preview — {month.pay_month}</div>
          <div className="text-xs text-gray-500">Recomputed live. No posting occurs.</div>
        </div>
        <div className="text-xs">
          <label>Basis:
            <select className="ml-2 border rounded px-2 py-0.5" value={basis} onChange={e => onBasisChange(e.target.value)}>
              <option value="accrual">Accrual (gross + ER tax)</option>
              <option value="net_cash">Net-cash (mirrors current plug)</option>
            </select>
          </label>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-2 py-1 text-left">Account</th>
            <th className="px-2 py-1 text-right">DR</th>
            <th className="px-2 py-1 text-right">CR</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="px-2 py-1">{l.account}</td>
              <td className="px-2 py-1 text-right tabular-nums">{l.dr > 0 ? usd(l.dr) : ''}</td>
              <td className="px-2 py-1 text-right tabular-nums">{l.cr > 0 ? usd(l.cr) : ''}</td>
            </tr>
          ))}
          <tr className="border-t font-semibold">
            <td className="px-2 py-1">Total</td>
            <td className="px-2 py-1 text-right tabular-nums">{usd(totalDR)}</td>
            <td className="px-2 py-1 text-right tabular-nums">{usd(totalCR)}</td>
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div>Balanced: <span className={balanced ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>{balanced ? 'YES' : 'NO'}</span></div>
          <div>Booked today (plug + fragments): <span className="tabular-nums">{usd(bookedToday)}</span> <span className="text-gray-500">(plug {usd(plug)} + frag {usd(fragments)})</span></div>
          <div>Net change if posted: <span className={`tabular-nums ${netChange > 0 ? 'text-red-700' : 'text-green-700'}`}>{usd(netChange)}</span></div>
        </div>
        <div className="text-right">
          {ready ? (
            <span className="inline-block px-2 py-1 rounded bg-green-100 text-green-800 text-xs">READY (all lines bridged)</span>
          ) : (
            <span className="inline-block px-2 py-1 rounded bg-amber-100 text-amber-800 text-xs">
              NOT READY — {usd(unbridgedNet)} of net pay is not yet bridged
            </span>
          )}
        </div>
      </div>

      <div className="text-xs text-amber-700 border-t pt-2 italic">
        TENTATIVE — NOT POSTED. Future action must first reverse BOTH the plug JE
        ({month.existing_plug_je_id ? month.existing_plug_je_id.slice(0, 8) : 'none'})
        AND the {usd(fragments)} of payroll-tagged fragment rows for this month, then post the replacement.
      </div>
    </div>
  );
}
