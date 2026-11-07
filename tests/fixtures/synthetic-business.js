// An invented restaurant, generated the same way every time: "Demo Bistro
// (synthetic)". Twelve months of books in the shape SelRic stores them —
// sales and fee journal entries with their mirrored ledger rows, monthly bank
// statements whose rows carry the cash legs the trigger would write, payroll
// paid by check, sales tax remitted the month after, tips paid out, a loan,
// closed months. Every number comes from a seeded generator; none is real.
//
//   makeBusiness({ today, months = 12, issues = false, seed = 7 })
//     → { org, user, profile, programs, tables: { <table>: rows }, data, planted }
//
// `tables` uses the database's column names (the smoke's mocked Supabase
// serves it). `data` is the checks engine's input (what src/lib/checks/fetch.js
// reads). With `issues: true` one problem is planted for each Business check;
// `planted` lists what was planted, by check key, for the tests.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const PREFIX = { org: 'fe11c0de', user: 'fe11a5e5', cat: 'c0000001', tx: 'c0000002', je: 'c0000003', jl: 'c0000004', st: 'c0000005', ck: 'c0000006', pl: 'c0000007', pc: 'c0000008', bs: 'c0000009', bm: 'c000000a', misc: 'c000000b' };
const uid = (kind, n) => `${PREFIX[kind]}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const pad = (n) => String(n).padStart(2, '0');
const ym = (y, m) => `${y}-${pad(m)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (date, n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);

export const SYNTHETIC_ORG_ID = uid('org', 1);
export const SYNTHETIC_USER_ID = uid('user', 1);

export const CATEGORIES = [
  ['Food Sales', 'revenue'], ['Bar Sales', 'revenue'],
  ['Food Cost', 'expense'], ['Liquor Cost', 'expense'], ['Payroll', 'expense'], ['Payroll Taxes', 'expense'],
  ['Rent', 'expense'], ['Utilities', 'expense'], ['Card Processing Fees', 'expense'], ['Repairs & Maintenance', 'expense'],
  ['Supplies', 'expense'], ['Interest Expense', 'expense'], ['Depreciation Expense', 'expense'],
  ['Cash & Bank', 'asset'], ['Merchant Clearing', 'asset'], ['Equipment', 'asset'], ['Accumulated Depreciation', 'asset'], ['Returned Items Receivable', 'asset'],
  ['Sales Tax Payable', 'liability'], ['Tips Payable', 'liability'], ['Accounts Payable', 'liability'], ['Equipment Loan', 'liability'],
  ["Owner's Capital", 'equity'], ['Uncategorized', 'expense'],
];

export function makeBusiness({ today = '2026-11-07', months = 12, issues = false, seed = 7, name = 'Demo Bistro (synthetic)', mode = 'full' } = {}) {
  const r = rng(seed);
  const n = { tx: 0, je: 0, jl: 0, st: 0, ck: 0, pl: 0, pc: 0, misc: 0 };
  const next = (k) => uid(k, ++n[k]);
  const ts = (date, hour = 18) => `${date}T${pad(hour)}:00:00.000Z`;

  const categories = CATEGORIES.map(([cname, type], i) => ({ id: uid('cat', i + 1), name: cname, type, archived: false, org_id: SYNTHETIC_ORG_ID, created_at: '2025-01-01T00:00:00.000Z', description: null }));
  const transactions = [], entries = [], lines = [], statements = [], checks = [], payrollLines = [], periodClose = [];
  const planted = {};

  // ── journal entries: header, lines, and one mirrored ledger row per line ──
  /** @param {string} date @param {string} description @param {any[]} legs @param {{ reference?: string, createdAt?: string }} [opts] */
  function postJE(date, description, legs, { reference, createdAt } = {}) {
    const id = next('je');
    const ref = reference || `JE-SYN-${pad(n.je)}${pad(n.je % 97)}`;
    const total = round2(legs.reduce((s, l) => s + (l.dr || 0), 0));
    entries.push({ id, reference: ref, date, description, memo: null, total_amount: total, status: 'posted', entry_type: 'manual', created_at: createdAt || ts(addDays(date, 1), 9), posted_at: createdAt || ts(addDays(date, 1), 9), org_id: SYNTHETIC_ORG_ID });
    for (const l of legs) {
      lines.push({ id: next('jl'), journal_entry_id: id, account_id: null, description, debit_amount: round2(l.dr || 0), credit_amount: round2(l.cr || 0), category: l.cat, created_at: createdAt || ts(addDays(date, 1), 9), org_id: SYNTHETIC_ORG_ID });
      const amount = round2(l.dr || l.cr);
      transactions.push({ id: next('tx'), date, description, amount, type: l.dr ? 'debit' : 'credit', category: l.cat, supplier: null, reference: ref, account_id: null, bank_statement_id: null, journal_entry_id: id, posted: true, voided: false, reconciled: false, verified: false, created_at: createdAt || ts(addDays(date, 1), 9), import_key: null, org_id: SYNTHETIC_ORG_ID });
    }
    return id;
  }
  // ── bank rows: one per statement line; expense rows get their cash leg ──
  const expense = new Set(CATEGORIES.filter(([, t]) => t === 'expense').map(([c]) => c));
  function bank(stmt, date, description, amount, type, cat, { leg = true, supplier = null } = {}) {
    const id = next('tx');
    const t = { id, date, description, amount: type === 'debit' ? -round2(amount) : round2(amount), type, category: cat, supplier, reference: null, account_id: null, bank_statement_id: stmt.id, journal_entry_id: null, posted: true, voided: false, reconciled: true, verified: true, created_at: ts(addDays(date, 1), 7), import_key: `syn-${id.slice(-6)}`, org_id: SYNTHETIC_ORG_ID };
    transactions.push(t);
    if (leg && cat && expense.has(cat)) {
      transactions.push({ ...t, id: next('tx'), description: `[Cash leg] ${description}`, category: 'Cash & Bank', type: type === 'debit' ? 'credit' : 'debit', reference: `CASH-LEG-${id}`, import_key: null });
    }
    return t;
  }

  // ── the months ──
  const [ty, tm, td] = today.split('-').map(Number);
  const list = [];
  for (let i = months - 1; i >= 0; i--) { const d = new Date(Date.UTC(ty, tm - 1 - i, 1)); list.push([d.getUTCFullYear(), d.getUTCMonth() + 1]); }
  const firstDate = `${ym(...list[0])}-01`;
  const K = months - 3; // the month the issues go into
  let balance = 25000;
  let prevTax = 0;
  const employees = ['Employee A', 'Employee B', 'Employee C'];
  let checkNo = 1001;

  postJE(firstDate, 'Opening balances', [
    { cat: 'Equipment', dr: 60000 }, { cat: 'Cash & Bank', dr: 25000 },
    { cat: 'Equipment Loan', cr: 40000 }, { cat: "Owner's Capital", cr: 45000 },
  ], { reference: 'JE-OPENING' });

  list.forEach(([y, m], i) => {
    const month = ym(y, m);
    const current = y === ty && m === tm;
    const end = current ? td : lastDay(y, m);
    const at = (day) => `${month}-${pad(Math.min(day, end))}`;
    const has = (day) => day <= end;
    const close = `${month}-${pad(end)}`;

    const F = round2(26000 + 5000 * Math.sin(i / 1.7) + r() * 3000) * (current ? end / lastDay(y, m) : 1);
    const B = round2(11000 + 2500 * Math.cos(i / 2.1) + r() * 1500) * (current ? end / lastDay(y, m) : 1);
    const food = round2(F), bar = round2(B);
    const T = round2((food + bar) * 0.0925), P = round2((food + bar) * 0.085);
    const gross = round2(food + bar + T + P);
    const card = round2(gross * 0.82), cash = round2(gross - card);
    const fee = round2(card * 0.026);

    postJE(close, `Sales ${month}`, [
      { cat: 'Merchant Clearing', dr: card }, { cat: 'Cash & Bank', dr: cash },
      { cat: 'Food Sales', cr: food }, { cat: 'Bar Sales', cr: bar }, { cat: 'Sales Tax Payable', cr: T }, { cat: 'Tips Payable', cr: P },
    ]);
    postJE(close, `Card processing fees ${month}`, [{ cat: 'Card Processing Fees', dr: fee }, { cat: 'Merchant Clearing', cr: fee }]);
    postJE(at(28), `Depreciation ${month}`, [{ cat: 'Depreciation Expense', dr: 500 }, { cat: 'Accumulated Depreciation', cr: 500 }]);
    if (has(5)) postJE(at(5), `Repairs bill ${month}`, [{ cat: 'Repairs & Maintenance', dr: 600 }, { cat: 'Accounts Payable', cr: 600 }]);

    const stmt = { id: next('st'), file_name: `synthetic-statement-${month}.pdf`, period: month, period_start: `${month}-01`, period_end: close, upload_date: ts(addDays(close, 1), 8), created_at: ts(addDays(close, 1), 8), transaction_count: 0, statement_totals: null, match_status: 'matched', extracted_data: null, file_url: null, file_path: null, org_id: SYNTHETIC_ORG_ID };
    statements.push(stmt);
    const before = transactions.length;

    // Card deposits settle the month's card sales less the fee, in four parts.
    let short = 0;
    if (issues && i === K - 1) { short = round2(card * 0.06); planted.merchant_clearing = { month, residual: short }; }
    const net = round2(card - fee - short);
    const parts = [0.24, 0.26, 0.25];
    let paid = 0;
    [7, 14, 21].forEach((d, j) => { const a = round2(net * parts[j]); paid += a; bank(stmt, at(d), 'CARD PROCESSOR DEPOSIT', a, 'credit', 'Merchant Clearing'); });
    bank(stmt, close, 'CARD PROCESSOR DEPOSIT', round2(net - paid), 'credit', 'Merchant Clearing');
    bank(stmt, at(10), 'CASH DEPOSIT', cash, 'credit', 'Cash & Bank', { leg: false });

    const rent = bank(stmt, at(1), 'RENT PAYMENT', 4500, 'debit', 'Rent');
    const util = has(12) ? bank(stmt, at(12), 'CITY UTILITIES', round2(780 + r() * 260), 'debit', 'Utilities') : null;
    [4, 11, 18].filter(has).forEach((d) => bank(stmt, at(d), 'PRODUCE SUPPLIER', round2(food * 0.1 + r() * 200), 'debit', 'Food Cost'));
    if (has(16)) bank(stmt, at(16), 'BEVERAGE DISTRIBUTOR', round2(bar * 0.24), 'debit', 'Liquor Cost');
    if (has(9)) bank(stmt, at(9), 'RESTAURANT SUPPLY', round2(300 + r() * 250), 'debit', 'Supplies');
    if (has(25)) bank(stmt, at(25), 'REPAIRS BILL PAYMENT', 600, 'debit', 'Accounts Payable', { leg: false });
    if (has(22)) { bank(stmt, at(22), 'LENDER PAYMENT PRINCIPAL', 800, 'debit', 'Equipment Loan', { leg: false }); bank(stmt, at(22), 'LENDER PAYMENT INTEREST', 150, 'debit', 'Interest Expense'); }
    // Sales tax for last month, remitted on the 20th.
    if (prevTax > 0 && has(20)) {
      if (issues && i === K) planted.sales_tax = { month, unpaid: prevTax };
      else bank(stmt, at(20), 'STATE SALES TAX', prevTax, 'debit', 'Sales Tax Payable', { leg: false });
    }
    prevTax = T;
    // Tips go out at month end.
    if (issues && i === K - 2) planted.tips = { month, unpaid: P };
    else bank(stmt, close, 'TIPS PAYOUT', P, 'debit', 'Tips Payable', { leg: false });

    // Payroll: two pay dates, one check per employee, cleared two days later.
    let taxes = 0;
    [13, 26].filter((d) => has(d + 2)).forEach((d) => {
      employees.forEach((who, e) => {
        const grossPay = round2(1700 + e * 350 + r() * 120), eeTax = round2(grossPay * 0.11), netPay = round2(grossPay - eeTax), erTax = round2(grossPay * 0.0765);
        taxes += eeTax + erTax;
        const ck = { id: next('ck'), check_no: String(checkNo++), amount: netPay, clear_date: at(d + 2), payee: who, source_statement: stmt.file_name, account_id: null, status: 'classified', classified_entry_id: null, source_tag: 'synthetic', notes: null, match_tag: null, returned_flag: false, returned_date: null, returned_amount: null, return_source: null, created_at: ts(at(d + 3), 8), updated_at: ts(at(d + 3), 8), org_id: SYNTHETIC_ORG_ID };
        checks.push(ck);
        bank(stmt, at(d + 2), `CHECK ${ck.check_no}`, netPay, 'debit', 'Payroll');
        payrollLines.push({ id: next('pl'), pay_date: at(d), period_start: at(d - 12), period_end: at(d), employee_name: who, is_starred: false, pay_month: month, gross_pay: grossPay, employee_taxes: eeTax, net_pay: netPay, employer_taxes: erTax, er_tax_is_estimate: false, match_status: 'matched_check', matched_check_id: ck.id, matched_transaction_id: null, match_confidence: 'high', match_day_delta: 2, notes: null, source_tag: 'synthetic', created_at: ts(at(d + 3), 8), updated_at: ts(at(d + 3), 8), org_id: SYNTHETIC_ORG_ID });
      });
    });
    if (taxes > 0 && has(28)) bank(stmt, at(28), 'IRS EFTPS', round2(taxes), 'debit', 'Payroll Taxes');
    // A customer's check that bounced, paired with its deposit (every business
    // has one now and then; it is the case the returned-items check passes).
    if (i === 2) {
      bank(stmt, at(3), 'CUSTOMER CHECK DEPOSIT', 212.4, 'credit', 'Cash & Bank', { leg: false });
      bank(stmt, at(7), 'RETURNED ITEM', 212.4, 'debit', 'Returned Items Receivable', { leg: false });
    }

    // ── planted problems, one per check ──
    if (issues && i === K) {
      planted.tb_balanced = { month, difference: 20 };
      postJE(at(8), 'Supplies (typed wrong)', [{ cat: 'Supplies', dr: 120 }, { cat: 'Cash & Bank', cr: 100 }]);
      const legIdx = transactions.findIndex((t) => t.reference === `CASH-LEG-${rent.id}`);
      transactions.splice(legIdx, 1);
      planted.cash_leg_single = { missing: rent.id };
      const emptyId = next('je');
      entries.push({ id: emptyId, reference: 'JE-SYN-EMPTY', date: at(9), description: 'Entry left without lines', memo: null, total_amount: 75, status: 'posted', entry_type: 'manual', created_at: ts(at(10), 9), posted_at: ts(at(10), 9), org_id: SYNTHETIC_ORG_ID });
      lines.push({ id: next('jl'), journal_entry_id: uid('je', 9999), account_id: null, description: 'Line of a deleted entry', debit_amount: 45, credit_amount: 0, category: 'Supplies', created_at: ts(at(9), 9), org_id: SYNTHETIC_ORG_ID });
      planted.orphan_lines = { count: 2 };
      bank(stmt, at(17), 'RETURNED ITEM CHARGEBACK', 310.37, 'debit', 'Returned Items Receivable', { leg: false });
      planted.returned_unpaired = { amount: 310.37 };
      bank(stmt, at(19), 'DEPOSIT', 1800, 'credit', null, { leg: false });
      bank(stmt, at(23), 'MOBILE DEPOSIT', 640, 'credit', 'Uncategorized');
      planted.unknown_deposits = { count: 2, amount: 2440 };
    }
    if (issues && i === K - 1) {
      const dup = transactions.findIndex((t) => t.reference === `CASH-LEG-${util?.id}`);
      if (dup >= 0) transactions.push({ ...transactions[dup], id: next('tx') });
      planted.cash_leg_extra = { extra: util?.id };
      if (util) {
        transactions.push({ ...util, id: next('tx'), date: addDays(util.date, 3), description: 'City utilities (entered by hand)', amount: Math.abs(util.amount), bank_statement_id: null, reference: null, import_key: null, created_at: ts(addDays(util.date, 4), 10) });
        planted.duplicate_candidates = { of: util.id };
      }
      const noPayee = checks.filter((c) => c.clear_date.startsWith(month)).slice(0, 2);
      noPayee.forEach((c) => { c.payee = null; });
      planted.check_no_payee = { count: noPayee.length, amount: round2(noPayee.reduce((s, c) => s + c.amount, 0)) };
      const pl = payrollLines.filter((l) => l.pay_month === month)[0];
      pl.match_status = 'unmatched'; pl.matched_check_id = null;
      planted.payroll_cleared = { id: pl.id, amount: pl.net_pay };
    }

    // The statement's printed summary, from the rows imported from it.
    const rows = transactions.slice(before).filter((t) => t.bank_statement_id === stmt.id && !String(t.reference || '').startsWith('CASH-LEG-'));
    const dep = round2(rows.filter((t) => t.type === 'credit').reduce((s, t) => s + Math.abs(t.amount), 0));
    const wd = round2(rows.filter((t) => t.type === 'debit').reduce((s, t) => s + Math.abs(t.amount), 0));
    const ending = round2(balance + dep - wd);
    stmt.transaction_count = rows.length;
    stmt.statement_totals = { beginning_balance: balance, deposits: dep, withdrawals: wd, checks: 0, fees: 0, returned_checks: 0, auto_transfers: 0, ending_balance: ending };
    if (issues && i === K - 2) { stmt.statement_totals = { ...stmt.statement_totals, ending_balance: round2(ending + 250) }; planted.statement_ties = { statement: stmt.id, drift: 250 }; }
    balance = ending;

    // Months more than two back are closed on the 10th of the next month.
    if (i <= months - 3) {
      const nx = m === 12 ? ym(y + 1, 1) : ym(y, m + 1);
      periodClose.push({ id: next('pc'), period: month, status: 'closed', closed_by: SYNTHETIC_USER_ID, closed_at: `${nx}-10T12:00:00.000Z`, notes: null, created_at: `${nx}-10T12:00:00.000Z`, snapshot: null, snapshot_at: null, org_id: SYNTHETIC_ORG_ID });
    }
  });

  // An entry posted into a closed month after it was closed.
  if (issues) {
    const [y1, m1] = list[1];
    const lateDate = `${ym(y1, m1)}-15`;
    postJE(lateDate, 'Late adjustment', [{ cat: 'Supplies', dr: 95 }, { cat: 'Accounts Payable', cr: 95 }], { createdAt: ts(addDays(today, -1), 11) });
    // The 95 is then paid, so only the closed-month check sees it.
    transactions.push({ id: next('tx'), date: addDays(today, -1), description: 'Late adjustment payment', amount: 95, type: 'debit', category: 'Accounts Payable', supplier: null, reference: null, account_id: null, bank_statement_id: null, journal_entry_id: null, posted: true, voided: false, reconciled: false, verified: false, created_at: ts(addDays(today, -1), 12), import_key: null, org_id: SYNTHETIC_ORG_ID });
    planted.closed_period_entries = { month: ym(y1, m1) };
    const billDate = addDays(today, -120);
    postJE(billDate, 'Equipment service bill', [{ cat: 'Repairs & Maintenance', dr: 1250 }, { cat: 'Accounts Payable', cr: 1250 }]);
    planted.accrued_no_cash = { amount: 1250 };
  }

  // The loan's lender statement at the first year end inside the data.
  const yearEnd = list.find(([, m]) => m === 12) || list[0];
  const loanAtYearEnd = 40000 - 800 * list.slice(0, list.findIndex((x) => x === yearEnd) + 1).length;
  const bsLine = { id: uid('bs', 1), year: yearEnd[0], section_code: 'L20', title: 'Equipment loan', display_order: 20, beginning_balance: 40000, ending_balance_confirmed: issues ? loanAtYearEnd + 300 : loanAtYearEnd, confirmed_by: SYNTHETIC_USER_ID, confirmed_at: `${yearEnd[0] + 1}-01-20T12:00:00.000Z`, created_at: `${yearEnd[0] + 1}-01-20T12:00:00.000Z`, updated_at: `${yearEnd[0] + 1}-01-20T12:00:00.000Z`, org_id: SYNTHETIC_ORG_ID };
  const bsMap = { id: uid('bm', 1), line_id: bsLine.id, category_id: categories.find((c) => c.name === 'Equipment Loan').id, category_name: 'Equipment Loan', created_at: bsLine.created_at, org_id: SYNTHETIC_ORG_ID };
  if (issues) planted.loan_vs_lender = { difference: 300 };

  const org = { id: SYNTHETIC_ORG_ID, name, slug: 'demo-bistro-synthetic', business_type: 'restaurant', is_legacy: false, created_by: SYNTHETIC_USER_ID, created_at: `${firstDate}T00:00:00.000Z`, updated_at: `${firstDate}T00:00:00.000Z`, plan: 'pilot', accounting_mode: mode, config: mode === 'simple' ? { configured: true } : {}, is_internal: false, is_test: true };
  const user = { id: SYNTHETIC_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'owner@demo-bistro.invalid', email_confirmed_at: `${firstDate}T00:00:00.000Z`, app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Demo Owner' }, created_at: `${firstDate}T00:00:00.000Z` };
  const profile = { id: SYNTHETIC_USER_ID, org_id: SYNTHETIC_ORG_ID, role: 'admin', full_name: 'Demo Owner', email: user.email, locale: 'en', created_at: user.created_at };
  const programs = [{ program: 'business', plan: 'pilot', enabled_at: org.created_at, org_id: SYNTHETIC_ORG_ID }];

  const tables = {
    organizations: [org], profiles: [profile], org_programs: programs, categories,
    accounts: [], products: [], supplier_categories: [], tasks: [], invoices: [], customers: [], sales: [], sale_items: [],
    transactions, journal_entries: entries, journal_entry_lines: lines, bank_statements: statements, checks,
    payroll_lines: payrollLines, payroll_months: [], period_close: periodClose, close_checklist: [],
    book_bs_lines: [bsLine], book_bs_line_mappings: [bsMap], daily_sales: [],
  };
  const data = {
    categories, transactions, entries, lines, statements, checks, payrollLines, periodClose,
    lenderStatements: [{ id: bsLine.id, label: bsLine.title, as_of: `${bsLine.year}-12-31`, balance: bsLine.ending_balance_confirmed, categories: ['Equipment Loan'] }],
  };
  return { org, user, profile, programs, tables, data, planted, months: list.map(([y, m]) => ym(y, m)) };
}
