import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUSINESS_CHECKS, CHECKS, HERD_CHECKS, healthScore, latestByCheck, runChecks } from '../src/lib/checks/index.js';
import { lenderStatementsFrom } from '../src/lib/checks/fetch.js';
import { payableMonths } from '../src/lib/checks/business/payableKeptCurrent.js';
import * as tb from '../src/lib/checks/business/tbBalanced.js';
import * as legs from '../src/lib/checks/business/cashLegSingle.js';
import * as dup from '../src/lib/checks/business/duplicateCandidates.js';
import * as accrued from '../src/lib/checks/business/accruedNoCash.js';
import * as returned from '../src/lib/checks/business/returnedUnpaired.js';
import * as mc from '../src/lib/checks/business/merchantClearing.js';
import { translations } from '../src/i18n/translations.js';
import { makeBusiness } from './fixtures/synthetic-business.js';
import { makeHerd } from './fixtures/synthetic-herd.js';

// The Spanish and English catalog lines live in translations.js; the
// migration's seed must say the same thing (see the last suite).

// The checks engine. Every row below is invented: the synthetic business in
// tests/fixtures/synthetic-business.js, or a handful of rows written here.
// `today` is pinned so ages and "this month" hold.
const TODAY = '2026-11-07';
const byKey = (results) => Object.fromEntries(results.map((r) => [r.key, r]));
const tx = (o) => ({ id: o.id || Math.random().toString(36).slice(2), voided: false, posted: true, reference: null, bank_statement_id: null, journal_entry_id: null, ...o });

describe('checks — the clean synthetic business', () => {
  const { data } = makeBusiness({ today: TODAY });
  const results = runChecks(data, { today: TODAY, program: 'business' });

  it('runs every Business check and every one passes', () => {
    expect(results).toHaveLength(15);
    const bad = results.filter((r) => r.status !== 'green').map((r) => `${r.key}: ${r.count} · ${JSON.stringify(r.detail.rows.slice(0, 2))}`);
    expect(bad).toEqual([]);
  });

  it('has something to check for every check (none skipped)', () => {
    expect(results.filter((r) => r.detail.skipped).map((r) => r.key)).toEqual([]);
    expect(healthScore(results)).toMatchObject({ score: 100, green: 15, amber: 0, red: 0, skipped: 0 });
  });

  it('is the same business every time (seeded)', () => {
    const again = makeBusiness({ today: TODAY });
    expect(again.data.transactions.length).toBe(data.transactions.length);
    expect(again.data.transactions[40]).toEqual(data.transactions[40]);
  });
});

describe('checks — one planted problem per check', () => {
  const { data, planted } = makeBusiness({ today: TODAY, issues: true });
  const R = byKey(runChecks(data, { today: TODAY, program: 'business' }));

  it('flags every check, each at its own severity', () => {
    for (const c of BUSINESS_CHECKS) expect([c.key, R[c.key].status]).toEqual([c.key, c.severity]);
  });

  it('trial balance: the month with the entry typed wrong, off by 20', () => {
    expect(R.tb_balanced.count).toBe(1);
    expect(R.tb_balanced.detail.months).toEqual([{ month: planted.tb_balanced.month, difference: 20 }]);
    expect(R.tb_balanced.detail.rows[0].amount).toBe(20);
  });

  it('cash legs: one missing, one doubled', () => {
    expect(R.cash_leg_single.count).toBe(2);
    expect(R.cash_leg_single.detail).toMatchObject({ missing: 1, extra: 1 });
    expect(R.cash_leg_single.detail.rows.map((r) => r.id)).toContain(planted.cash_leg_single.missing);
  });

  it('orphans: a line without its entry and an entry without lines', () => {
    expect(R.orphan_lines.count).toBe(2);
    expect(R.orphan_lines.detail.rows.map((r) => r.kind).sort()).toEqual(['entry', 'line']);
  });

  it('statement ties: one statement 250 off its printed ending', () => {
    expect(R.statement_ties.count).toBe(1);
    expect(R.statement_ties.amount).toBe(250);
  });

  it('checks without payee: the two blanked, with their amounts', () => {
    expect(R.check_no_payee.count).toBe(planted.check_no_payee.count);
    expect(R.check_no_payee.amount).toBe(planted.check_no_payee.amount);
  });

  it('returned items: the chargeback with no deposit to pair', () => {
    expect(R.returned_unpaired.count).toBe(1);
    expect(R.returned_unpaired.amount).toBe(310.37);
  });

  it('merchant clearing: the month whose deposits came up 6% short', () => {
    expect(R.merchant_clearing.count).toBe(1);
    expect(R.merchant_clearing.detail.rows[0].id).toBe(planted.merchant_clearing.month);
    expect(R.merchant_clearing.amount).toBeCloseTo(planted.merchant_clearing.residual, 1);
  });

  it('sales tax and tips: the skipped payment stays owed in every later month', () => {
    expect(R.sales_tax.detail.rows[0].id).toBe(planted.sales_tax.month);
    expect(R.sales_tax.amount).toBeCloseTo(planted.sales_tax.unpaid, 2);
    expect(R.tips.detail.rows.map((r) => r.id)).toContain(planted.tips.month);
    // Tips may wait half a month; what is listed is what is held beyond that.
    expect(R.tips.detail.months.find((m) => m.month === planted.tips.month).owed).toBeCloseTo(planted.tips.unpaid, 2);
    expect(R.tips.amount).toBeGreaterThan(0);
  });

  it('payroll: the paycheck that never matched a cleared check', () => {
    expect(R.payroll_cleared.count).toBe(1);
    expect(R.payroll_cleared.detail.rows[0].id).toBe(planted.payroll_cleared.id);
  });

  it('accruals: the 1,250 bill booked 120 days ago, never paid', () => {
    expect(R.accrued_no_cash.count).toBe(1);
    expect(R.accrued_no_cash.amount).toBe(1250);
  });

  it('duplicates: the utilities bill typed in by hand next to the bank row', () => {
    expect(R.duplicate_candidates.count).toBe(1);
    expect(R.duplicate_candidates.detail.rows[0].pair).toBe(planted.duplicate_candidates.of);
  });

  it('closed months: the adjustment dated inside a closed month, entered after the close', () => {
    expect(R.closed_period_entries.count).toBe(1);
    expect(R.closed_period_entries.detail.rows[0].date.slice(0, 7)).toBe(planted.closed_period_entries.month);
  });

  it('unknown deposits: one with no category, one Uncategorized', () => {
    expect(R.unknown_deposits).toMatchObject({ count: 2, amount: 2440 });
  });

  it('loan: the lender says 300 more than the ledger', () => {
    expect(R.loan_vs_lender.count).toBe(1);
    expect(R.loan_vs_lender.detail.rows[0].amount).toBe(-300);
  });

  it('caps the drill-down rows but keeps the full count', () => {
    for (const r of Object.values(R)) expect(r.detail.rows.length).toBeLessThanOrEqual(50);
  });

  it('scores the run: 8 amber at half, 7 red at nothing', () => {
    const h = healthScore(Object.values(R));
    expect(h).toMatchObject({ green: 0, amber: 8, red: 7, score: Math.round(100 * 4 / 15) });
  });
});

describe('checks — period runs', () => {
  const { data, planted } = makeBusiness({ today: TODAY, issues: true });

  it('a month without the planted problem passes that check', () => {
    const R = byKey(runChecks(data, { today: TODAY, period: '2026-01' }));
    expect(R.tb_balanced.status).toBe('green');
    expect(R.unknown_deposits.status).toBe('green');
  });

  it('the planted month fails it', () => {
    const R = byKey(runChecks(data, { today: TODAY, period: planted.tb_balanced.month }));
    expect(R.tb_balanced.status).toBe('red');
    expect(R.unknown_deposits.count).toBe(2);
  });
});

describe('checks — single checks on hand-made rows', () => {
  it('trial balance skips a workspace with no journal', () => {
    expect(tb.run({ entries: [], lines: [] }).detail.skipped).toBe('no_journal_lines');
  });

  it('trial balance ignores voided entries', () => {
    const entries = [{ id: 'e1', date: '2026-01-05', status: 'voided' }, { id: 'e2', date: '2026-01-06', status: 'posted' }];
    const lines = [{ journal_entry_id: 'e1', debit_amount: 10, credit_amount: 0 }, { journal_entry_id: 'e2', debit_amount: 5, credit_amount: 0 }, { journal_entry_id: 'e2', debit_amount: 0, credit_amount: 5 }];
    expect(tb.run({ entries, lines }).status).toBe('green');
  });

  it('a legacy batch cash leg covers one row each', () => {
    const categories = [{ name: 'Rent', type: 'expense' }];
    const a = tx({ id: 'a', date: '2024-03-01', amount: -100, type: 'debit', category: 'Rent', bank_statement_id: 's' });
    const b = tx({ id: 'b', date: '2024-03-01', amount: -100, type: 'debit', category: 'Rent', bank_statement_id: 's' });
    const legacy = tx({ id: 'l', date: '2024-03-01', amount: -100, type: 'credit', category: 'Cash & Bank', bank_statement_id: 's', reference: 'CASH-LEG-2024' });
    const r = legs.run({ categories, transactions: [a, b, legacy] });
    expect(r.count).toBe(1);
    expect(r.detail.missing).toBe(1);
  });

  it('two rows of one journal entry are never a duplicate pair', () => {
    const rows = [tx({ date: '2026-02-01', amount: 50, type: 'debit', category: 'Supplies', journal_entry_id: 'j1' }), tx({ date: '2026-02-02', amount: 50, type: 'debit', category: 'Supplies', journal_entry_id: 'j2' })];
    expect(dup.run({ transactions: rows }).count).toBe(0);
  });

  it('a duplicate pair needs the same direction and category', () => {
    const a = tx({ date: '2026-02-01', amount: -50, type: 'debit', category: 'Supplies', bank_statement_id: 's1' });
    const b = tx({ date: '2026-02-03', amount: 50.3, type: 'debit', category: 'Supplies' });
    const c = tx({ date: '2026-02-03', amount: 50.3, type: 'credit', category: 'Supplies' });
    expect(dup.run({ transactions: [a, b] }).count).toBe(1);
    expect(dup.run({ transactions: [a, c] }).count).toBe(0);
  });

  it('an accrual paid in two parts is settled', () => {
    const categories = [{ name: 'Accounts Payable', type: 'liability' }];
    const rows = [
      tx({ date: '2026-01-01', amount: 900, type: 'credit', category: 'Accounts Payable' }),
      tx({ date: '2026-02-01', amount: 400, type: 'debit', category: 'Accounts Payable' }),
      tx({ date: '2026-03-01', amount: 500, type: 'debit', category: 'Accounts Payable' }),
    ];
    expect(accrued.run({ categories, transactions: rows }, { today: TODAY }).status).toBe('green');
    expect(accrued.run({ categories, transactions: rows.slice(0, 2) }, { today: TODAY }).amount).toBe(500);
  });

  it('a returned item pairs with the deposit of its amount before it, once', () => {
    const dep = tx({ id: 'd', date: '2026-03-01', amount: 120, type: 'credit', category: 'Food Sales', bank_statement_id: 's' });
    const r1 = tx({ id: 'r1', date: '2026-03-04', amount: -120, type: 'debit', description: 'RETURNED ITEM', category: 'Returned', bank_statement_id: 's' });
    const r2 = tx({ id: 'r2', date: '2026-03-06', amount: -120, type: 'debit', description: 'RETURNED ITEM', category: 'Returned', bank_statement_id: 's' });
    expect(returned.run({ transactions: [dep, r1] }).count).toBe(0);
    expect(returned.run({ transactions: [dep, r1, r2] }).detail.rows.map((r) => r.id)).toEqual(['r2']);
  });

  it('merchant clearing within 2% passes, beyond it fails', () => {
    const sale = tx({ date: '2026-04-30', amount: 1000, type: 'debit', category: 'Merchant Clearing', journal_entry_id: 'j' });
    const dep = (a) => tx({ date: '2026-04-30', amount: a, type: 'credit', category: 'Merchant Clearing', bank_statement_id: 's' });
    expect(mc.run({ transactions: [sale, dep(985)] }).status).toBe('green');
    expect(mc.run({ transactions: [sale, dep(970)] }).status).toBe('red');
  });

  it('a payable is not late in the month that has not ended', () => {
    const rows = [tx({ date: '2026-10-31', amount: 100, type: 'credit' }), tx({ date: '2026-11-03', amount: 80, type: 'credit' })];
    const m = payableMonths(rows, { today: '2026-11-05' });
    expect(m.map((x) => x.late)).toEqual([false, false]);
    expect(payableMonths(rows, { today: '2026-12-05' })[1].late).toBe(true);
  });

  it('builds lender statements only from loan lines with a confirmed balance and mapped accounts', () => {
    const lines = [{ id: 'l1', year: 2025, title: 'Equipment loan', ending_balance_confirmed: 10 }, { id: 'l2', year: 2025, title: 'Inventory', ending_balance_confirmed: 5 }, { id: 'l3', year: 2025, title: 'Note payable', ending_balance_confirmed: null }];
    const maps = [{ line_id: 'l1', category_name: 'Loan A' }, { line_id: 'l2', category_name: 'Inventory' }];
    expect(lenderStatementsFrom(lines, maps)).toEqual([{ id: 'l1', label: 'Equipment loan', as_of: '2025-12-31', balance: 10, categories: ['Loan A'] }]);
  });

  it('a check that throws is a red result, not a crashed run', () => {
    const results = runChecks({ transactions: [null] }, { today: TODAY });
    expect(results.length).toBe(CHECKS.length);
    expect(results.some((r) => r.detail.error)).toBe(true);
  });
});

describe('checks — stored runs and the score', () => {
  it('keeps the newest row per check', () => {
    const rows = [{ check_key: 'a', run_at: '2026-11-01T00:00:00Z', status: 'red' }, { check_key: 'a', run_at: '2026-11-02T00:00:00Z', status: 'green' }, { check_key: 'b', run_at: '2026-10-01T00:00:00Z', status: 'amber' }];
    const m = latestByCheck(rows);
    expect(m.get('a').status).toBe('green');
    expect(m.size).toBe(2);
  });

  it('has no score when nothing was checked', () => {
    expect(healthScore(runChecks({}, { today: TODAY })).score).toBeNull();
  });
});

describe('checks — the herd', () => {
  // A made-up finca with one of every problem the four herd checks look for.
  const animal = (id, o) => ({ id, slug: id, name: id, species: 'bovino', category: 'vaca', sex: 'H', status: 'activo', tag: '', dam_id: null, dam_name: '', ...o });
  const animals = [
    animal('Canela', { pregnant: true, preg_date: '2026-09-01', preg_months: 5 }),
    animal('Lucero', { category: '' }),
    animal('Pinta', { category: 'vaka' }),
    animal('Rosa', { species: 'porcino', category: 'vaca' }),
    animal('Cerdita', { species: 'porcino', category: 'cerda' }),
    animal('Luna', { pregnant: true }),
    animal('Mora', { pregnant: true }),
    animal('Vendida', { pregnant: true, status: 'vendido' }),
    animal('Toro', { category: 'toro', sex: 'M' }),
    animal('Nube', { category: 'ternera', dam_id: 'Canela' }),
    animal('Sol', { category: 'ternero', sex: 'M', dam_id: 'gone' }),
    animal('Rayo', { category: 'ternero', sex: 'M', dam_id: 'Toro' }),
    animal('Brisa', { category: 'ternera', dam_name: ' canela ' }),
    animal('Trueno', { category: 'ternero', sex: 'M', dam_name: 'Vieja Blanca' }),
  ];
  const events = [
    { id: 'e1', animal_id: 'Canela', type: 'palpacion', date: '2026-09-01', data: { result: 'S', months: 5 } },
    { id: 'e2', animal_id: 'Mora', type: 'palpacion', date: '2026-10-01', data: { result: 'N' } },
    { id: 'e3', animal_id: 'Canela', type: 'leche', date: '2026-11-06', data: { liters: 9 } },
    { id: 'e4', animal_id: 'deleted-cow', type: 'parto', date: '2026-10-12', data: {} },
  ];
  const R = byKey(runChecks({ animals, events }, { today: TODAY, program: 'ganaderia' }));

  it('runs the four herd checks and nothing else', () => {
    expect(Object.keys(R)).toEqual(['herd_orphan_events', 'herd_no_category', 'herd_pregnant_no_palpacion', 'herd_dam_unresolved']);
    expect(Object.values(R).every((r) => r.program === 'ganaderia' && r.amount === 0)).toBe(true);
  });

  it('finds the event whose animal is gone', () => {
    expect(R.herd_orphan_events).toMatchObject({ status: 'red', count: 1 });
    expect(R.herd_orphan_events.detail.rows[0]).toMatchObject({ id: 'e4', type: 'parto', date: '2026-10-12' });
  });

  it('finds an empty category and one the species does not have', () => {
    expect(R.herd_no_category).toMatchObject({ status: 'amber', count: 3 });
    expect(R.herd_no_category.detail.rows.map((r) => [r.name, r.kind])).toEqual([['Lucero', 'none'], ['Pinta', 'unknown'], ['Rosa', 'unknown']]);
  });

  it('finds active animals marked pregnant with no positive palpación', () => {
    expect(R.herd_pregnant_no_palpacion).toMatchObject({ status: 'amber', count: 2 });
    expect(R.herd_pregnant_no_palpacion.detail.rows.map((r) => [r.name, r.kind])).toEqual([['Luna', 'none'], ['Mora', 'negative_only']]);
  });

  it('finds mothers that do not resolve: a missing card, a male, a name with no card', () => {
    expect(R.herd_dam_unresolved).toMatchObject({ status: 'amber', count: 3 });
    expect(R.herd_dam_unresolved.detail.rows.map((r) => [r.name, r.kind, r.dam])).toEqual([
      ['Rayo', 'male', 'Toro'], ['Sol', 'missing', ''], ['Trueno', 'unlinked', 'Vieja Blanca'],
    ]);
  });

  it('passes the clean synthetic finca and finds exactly what was planted in the other', () => {
    const clean = runChecks(makeHerd({ today: TODAY }).data, { today: TODAY, program: 'ganaderia' });
    expect(clean.map((r) => [r.key, r.status, r.count])).toEqual(HERD_CHECKS.map((c) => [c.key, 'green', 0]));
    const h = makeHerd({ today: TODAY, issues: true });
    const found = byKey(runChecks(h.data, { today: TODAY, program: 'ganaderia' }));
    for (const c of HERD_CHECKS) expect([c.key, found[c.key].status, found[c.key].count]).toEqual([c.key, c.severity, h.planted[c.key]]);
  });

  it('says there is nothing to check on an empty herd', () => {
    const empty = runChecks({ animals: [], events: [] }, { today: TODAY, program: 'ganaderia' });
    expect(empty.map((r) => [r.status, r.detail.skipped])).toEqual([
      ['green', 'no_events'], ['green', 'no_animals'], ['green', 'no_pregnant'], ['green', 'no_dams'],
    ]);
    expect(healthScore(empty).score).toBeNull();
  });
});

describe('checks — the catalog', () => {
  const sql = readFileSync(new URL('../migrations/2026-11-07-integrity-checks.sql', import.meta.url), 'utf8');
  const unq = (s) => s.replace(/''/g, "'");

  it('every check has a name and a "what to do" line in English and Spanish', () => {
    for (const c of CHECKS) for (const lang of ['en', 'es']) {
      const item = translations[lang].checks.items[c.key];
      expect(item?.name, `${lang} ${c.key}`).toBeTruthy();
      expect(item?.action, `${lang} ${c.key}`).toBeTruthy();
    }
  });

  it('the migration seeds the same names, actions and severities as the app', () => {
    for (const c of CHECKS) {
      const block = sql.split(`('${c.key}', '`)[1];
      expect(block, c.key).toBeTruthy();
      const program = block.split("'")[0];
      const rest = block.slice(block.indexOf("'") + 1);
      const [severity, nameEn, nameEs, actionEn, actionEs] = [...rest.slice(0, 900).matchAll(/'((?:[^']|'')*)'/g)].map((m) => unq(m[1]));
      expect([program, severity]).toEqual([c.program, c.severity]);
      expect([nameEn, nameEs, actionEn, actionEs]).toEqual([
        translations.en.checks.items[c.key].name, translations.es.checks.items[c.key].name,
        translations.en.checks.items[c.key].action, translations.es.checks.items[c.key].action,
      ]);
    }
  });
});
