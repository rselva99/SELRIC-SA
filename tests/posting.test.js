import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The posting helpers (postJournalEntry, journalReference, the period-lock
// wrapper) and the opening-balances flow, against a scripted stand-in for the
// Supabase client: every query and RPC is answered by `db.answer(call)` and
// recorded in `db.calls`. Nothing here reaches a database. The opening lines
// are read from the module and only compared with themselves, so no figure is
// written in this file.

const db = vi.hoisted(() => {
  /** @type {{ calls: any[], answer: (call: any) => any, client?: any }} */
  const state = { calls: [], answer: () => ({ data: null, error: null }) };
  const from = (table) => {
    const call = { table, method: 'select', filters: [], payload: null };
    const q = {
      select() { return q; },
      insert(p) { call.method = 'insert'; call.payload = p; return q; },
      update(p) { call.method = 'update'; call.payload = p; return q; },
      delete() { call.method = 'delete'; return q; },
      eq(col, v) { call.filters.push(['eq', col, v]); return q; },
      ilike(col, v) { call.filters.push(['ilike', col, v]); return q; },
      order() { return q; },
      limit() { return q; },
      single() { return q; },
      maybeSingle() { return q; },
      then(ok, fail) { state.calls.push(call); return Promise.resolve().then(() => state.answer(call)).then(ok, fail); },
    };
    return q;
  };
  const rpc = (fn, args) => { const call = { rpc: fn, args }; state.calls.push(call); return Promise.resolve().then(() => state.answer(call)); };
  state.client = { from, rpc };
  return state;
});
vi.mock('../src/lib/supabase', () => ({ supabase: db.client }));

const { postJournalEntry, UnbalancedJournalEntryError } = await import('../src/lib/postJournalEntry.js');
const { nextJournalReference, insertJournalEntryWithRetry } = await import('../src/lib/journalReference.js');
const { PeriodClosedError, isPeriodLockedError, periodFromLockedError, wrapIfPeriodLocked, periodOf, checkPeriodStatus, reopenPeriod } = await import('../src/lib/periodLock.js');
const OB = await import('../src/lib/openingBalances.js');

const LINES = [
  { account_id: null, description: 'Rent', debit_amount: 120, credit_amount: 0, category: 'Rent' },
  { account_id: null, description: 'Cash', debit_amount: 0, credit_amount: 120, category: 'Cash' },
];
const ENTRY = { date: '2026-10-01', description: 'Synthetic rent', status: 'posted', entry_type: 'simple' };
const refs = (...list) => list.map((reference) => ({ reference }));
const COLLISION = { code: '23505', message: 'duplicate key value violates unique constraint' };
const LOCKED = { code: 'P0001', message: 'PERIOD_LOCKED: 2026-09 is closed. Reopen it first.' };
const rpcCalls = () => db.calls.filter((c) => c.rpc);

beforeEach(() => { db.calls.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('posting — references', () => {
  it('takes the highest plain JE-NNN and adds one, ignoring the other sequences', async () => {
    db.answer = () => ({ data: refs('JE-007', 'JE-DA-2024-05', 'JE-OPENING', 'JE-012', 'JE-CAP-003', null), error: null });
    expect(await nextJournalReference()).toBe('JE-013');
    expect(db.calls[0].filters).toContainEqual(['ilike', 'reference', 'JE-%']);
  });

  it('starts at JE-001 and pads to three digits', async () => {
    db.answer = () => ({ data: [], error: null });
    expect(await nextJournalReference()).toBe('JE-001');
    db.answer = () => ({ data: refs('JE-1041'), error: null });
    expect(await nextJournalReference()).toBe('JE-1042');
  });

  it('a failed read is thrown, not turned into JE-001', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.answer = () => ({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(nextJournalReference()).rejects.toMatchObject({ code: '42501' });
  });
});

describe('posting — postJournalEntry', () => {
  it('refuses fewer than two lines, unbalanced lines and a zero entry before any request', async () => {
    await expect(postJournalEntry({ entry: ENTRY, lines: [LINES[0]] })).rejects.toBeInstanceOf(UnbalancedJournalEntryError);
    await expect(postJournalEntry({ entry: ENTRY, lines: [LINES[0], { ...LINES[1], credit_amount: 119.99 }] })).rejects.toThrow(/unbalanced/);
    await expect(postJournalEntry({ entry: ENTRY, lines: [{ debit_amount: 0 }, { credit_amount: 0 }] })).rejects.toThrow(/positive/);
    await expect(postJournalEntry({ lines: LINES })).rejects.toThrow(/entry required/);
    expect(db.calls).toHaveLength(0);
  });

  it('allocates the reference, sends header, lines and transactions in one RPC, and returns what the database says', async () => {
    db.answer = (c) => (c.rpc ? { data: { entry_id: 'je-1', reference: 'JE-005', line_count: 2, debits: 120, credits: 120 }, error: null } : { data: refs('JE-004'), error: null });
    const txns = [{ date: '2026-10-01', amount: 120, type: 'debit', category: 'Rent' }];
    const out = await postJournalEntry({ entry: ENTRY, lines: LINES, txns });
    expect(out).toEqual({ entry_id: 'je-1', reference: 'JE-005', line_count: 2, debits: 120, credits: 120 });
    const [call] = rpcCalls();
    expect(call.rpc).toBe('post_journal_entry');
    expect(call.args.p_entry).toMatchObject({ ...ENTRY, reference: 'JE-005' });
    expect(call.args.p_lines).toBe(LINES);
    expect(call.args.p_txns).toBe(txns);
  });

  it('falls back to its own sums when the RPC answers with less', async () => {
    db.answer = (c) => (c.rpc ? { data: {}, error: null } : { data: [], error: null });
    expect(await postJournalEntry({ entry: ENTRY, lines: LINES })).toMatchObject({ reference: 'JE-001', line_count: 2, debits: 120, credits: 120 });
  });

  it('on a reference collision allocates again and retries, telling the caller each reference', async () => {
    let n = 0;
    db.answer = (c) => (c.rpc ? (++n === 1 ? { data: null, error: COLLISION } : { data: { entry_id: 'je-2' }, error: null }) : { data: refs(n === 0 ? 'JE-009' : 'JE-010'), error: null });
    const seen = [];
    const out = await postJournalEntry({ entry: ENTRY, lines: LINES, onRef: (r) => seen.push(r) });
    expect(seen).toEqual([{ reference: 'JE-010', attempt: 1 }, { reference: 'JE-011', attempt: 2 }]);
    expect(out.reference).toBe('JE-011');
  });

  it("drops a caller's own reference after it collides", async () => {
    let n = 0;
    db.answer = (c) => (c.rpc ? (++n === 1 ? { data: null, error: COLLISION } : { data: { entry_id: 'je-3' }, error: null }) : { data: refs('JE-020'), error: null });
    const entry = { ...ENTRY, reference: 'JE-OPENING' };
    const out = await postJournalEntry({ entry, lines: LINES });
    expect(rpcCalls().map((c) => c.args.p_entry.reference)).toEqual(['JE-OPENING', 'JE-021']);
    expect(out.reference).toBe('JE-021');
  });

  it('gives up after five collisions, keeping the last error as the cause', async () => {
    db.answer = (c) => (c.rpc ? { data: null, error: COLLISION } : { data: [], error: null });
    const err = await postJournalEntry({ entry: ENTRY, lines: LINES }).catch((e) => e);
    expect(err.message).toMatch(/after 5 attempts/);
    expect(err.cause).toBe(COLLISION);
    expect(rpcCalls()).toHaveLength(5);
  });

  it("turns the database's balance check into UnbalancedJournalEntryError and a closed period into PeriodClosedError", async () => {
    db.answer = (c) => (c.rpc ? { data: null, error: { code: '23514', message: 'journal entry does not balance' } } : { data: [], error: null });
    await expect(postJournalEntry({ entry: ENTRY, lines: LINES })).rejects.toBeInstanceOf(UnbalancedJournalEntryError);
    db.answer = (c) => (c.rpc ? { data: null, error: LOCKED } : { data: [], error: null });
    const err = await postJournalEntry({ entry: ENTRY, lines: LINES }).catch((e) => e);
    expect(err).toBeInstanceOf(PeriodClosedError);
    expect(err.period).toBe('2026-09');
    expect(err.original).toBe(LOCKED);
  });

  it('any other error is thrown as it came, without a retry', async () => {
    const other = { code: '42501', message: 'permission denied' };
    db.answer = (c) => (c.rpc ? { data: null, error: other } : { data: [], error: null });
    await expect(postJournalEntry({ entry: ENTRY, lines: LINES })).rejects.toBe(other);
    expect(rpcCalls()).toHaveLength(1);
  });
});

describe('posting — insertJournalEntryWithRetry', () => {
  it('inserts the header with a fresh reference and returns the row', async () => {
    db.answer = (c) => (c.method === 'insert' ? { data: { id: 'je-9', ...c.payload }, error: null } : { data: refs('JE-001'), error: null });
    const out = await insertJournalEntryWithRetry({ date: '2026-10-02', description: 'Synthetic' });
    expect(out.reference).toBe('JE-002');
    expect(out.data).toMatchObject({ id: 'je-9', reference: 'JE-002', description: 'Synthetic' });
  });

  it('retries a collision, wraps a closed period, throws anything else', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let n = 0;
    db.answer = (c) => (c.method === 'insert' ? (++n < 3 ? { data: null, error: COLLISION } : { data: { id: 'x' }, error: null }) : { data: [], error: null });
    const seen = [];
    await insertJournalEntryWithRetry({}, { onRef: (r) => seen.push(r.attempt) });
    expect(seen).toEqual([1, 2, 3]);

    db.answer = (c) => (c.method === 'insert' ? { data: null, error: LOCKED } : { data: [], error: null });
    await expect(insertJournalEntryWithRetry({})).rejects.toBeInstanceOf(PeriodClosedError);

    const other = { code: '23503', message: 'foreign key' };
    db.answer = (c) => (c.method === 'insert' ? { data: null, error: other } : { data: [], error: null });
    await expect(insertJournalEntryWithRetry({})).rejects.toBe(other);

    db.answer = (c) => (c.method === 'insert' ? { data: null, error: COLLISION } : { data: [], error: null });
    await expect(insertJournalEntryWithRetry({})).rejects.toThrow(/after 5 attempts/);
  });
});

describe('posting — the period-lock error', () => {
  it('recognises the trigger by its code or its marker, and reads the period', () => {
    expect(isPeriodLockedError(LOCKED)).toBe(true);
    expect(isPeriodLockedError({ message: 'PERIOD_LOCKED: 2025-12 is closed' })).toBe(true);
    expect(isPeriodLockedError({ code: '23505' })).toBe(false);
    expect(isPeriodLockedError(null)).toBe(false);
    expect(periodFromLockedError(LOCKED)).toBe('2026-09');
    expect(periodFromLockedError({ message: 'other' })).toBeNull();
    expect(wrapIfPeriodLocked(COLLISION)).toBe(COLLISION);
  });

  it("reads a date's period from period_close: closed, open-with-no-row, or an error", async () => {
    expect(periodOf('2026-09-30')).toBe('2026-09');
    db.answer = () => ({ data: { period: '2026-09', status: 'closed', closed_at: '2026-10-05T00:00:00Z', closed_by: 'u-1' }, error: null });
    expect(await checkPeriodStatus('2026-09-30')).toEqual({ period: '2026-09', status: 'closed', closedAt: '2026-10-05T00:00:00Z', closedBy: 'u-1' });
    expect(db.calls[0]).toMatchObject({ table: 'period_close', filters: [['eq', 'period', '2026-09']] });
    db.answer = () => ({ data: null, error: null });
    expect(await checkPeriodStatus('2026-10-01')).toBeNull();
    expect(await checkPeriodStatus('')).toBeNull();
    db.answer = () => ({ data: null, error: { message: 'read failed' } });
    await expect(checkPeriodStatus('2026-10-01')).rejects.toMatchObject({ message: 'read failed' });
  });

  it('reopening sets the period open and logs it; a failed log does not undo the reopen', async () => {
    db.answer = (c) => {
      if (c.method === 'insert') throw new Error('audit log not writable');
      return { data: null, error: null };
    };
    await expect(reopenPeriod('2026-09', 'u-1')).resolves.toBeUndefined();
    const [upd, log] = db.calls;
    expect(upd).toMatchObject({ table: 'period_close', method: 'update', payload: { status: 'open', closed_at: null, closed_by: null }, filters: [['eq', 'period', '2026-09']] });
    expect(log).toMatchObject({ table: 'accountant_audit_log', method: 'insert', payload: { action: 'reopen_period', period: '2026-09', approved_by: 'u-1' } });
    db.answer = (c) => (c.method === 'update' ? { data: null, error: { message: 'not allowed' } } : { data: null, error: null });
    await expect(reopenPeriod('2026-09')).rejects.toMatchObject({ message: 'not allowed' });
  });
});

describe('opening balances', () => {
  const specs = [...OB.REQUIRED_OPENING_CATEGORIES, ...OB.REQUIRED_OPERATIONAL_CATEGORIES];
  // A chart of accounts that already holds the categories the flow must reuse.
  const reuseOnly = specs.filter((s) => s.reuse).map((s) => ({ name: s.name, type: s.type }));
  const everything = specs.map((s) => ({ name: s.name, type: s.type }));

  it('the opening lines balance, match the stated total and each sit on one side', () => {
    expect(Math.abs(OB.sumDebits(OB.OPENING_LINES) - OB.sumCredits(OB.OPENING_LINES))).toBeLessThan(0.005);
    expect(Math.abs(OB.sumDebits(OB.OPENING_LINES) - OB.OPENING_EXPECTED_TOTAL)).toBeLessThan(0.005);
    for (const l of OB.OPENING_LINES) expect((l.debit > 0) !== (l.credit > 0)).toBe(true);
  });

  it('every opening line posts to a category the flow makes sure exists', () => {
    const names = new Set(specs.map((s) => s.name));
    for (const l of OB.OPENING_LINES) expect(names.has(l.category)).toBe(true);
  });

  it('creates the missing categories, reuses the present ones, refuses a wrong type or a missing must-reuse', async () => {
    const added = [];
    const add = async (name, type) => { added.push([name, type]); };
    const r = await OB.ensureOpeningCategories(reuseOnly, add);
    expect(r.reused.sort()).toEqual(reuseOnly.map((c) => c.name).sort());
    expect(added.map(([n]) => n).sort()).toEqual(specs.filter((s) => !s.reuse).map((s) => s.name).sort());
    expect(r.created).toEqual(added.map(([n]) => n));

    const wrong = everything.map((c, i) => (i === 0 ? { ...c, type: c.type === 'asset' ? 'expense' : 'asset' } : c));
    await expect(OB.ensureOpeningCategories(wrong, add)).rejects.toThrow(/expects type/);
    if (reuseOnly.length) await expect(OB.ensureOpeningCategories([], add)).rejects.toThrow(/refuses to create/);
  });

  it('does not post twice: an existing JE-OPENING is returned untouched unless replace is asked', async () => {
    const existing = { id: 'je-open', reference: OB.OPENING_REFERENCE };
    db.answer = (c) => (c.table === 'journal_entries' && c.method === 'select' ? { data: [existing], error: null } : { data: null, error: null });
    const r = await OB.postOpeningJE({ userId: 'u-1', existingCategories: everything, addCategory: async () => {} });
    expect(r).toMatchObject({ posted: false, existing });
    expect(db.calls.filter((c) => c.method === 'delete' || c.rpc)).toHaveLength(0);
  });

  it('replace deletes the old entry (its transactions first) and posts the lines through the RPC, balanced', async () => {
    const existing = { id: 'je-open', reference: OB.OPENING_REFERENCE };
    db.answer = (c) => {
      if (c.rpc) return { data: { entry_id: 'je-new', reference: OB.OPENING_REFERENCE }, error: null };
      if (c.table === 'journal_entries' && c.method === 'select') return { data: [existing], error: null };
      return { data: null, error: null };
    };
    const r = await OB.postOpeningJE({ userId: 'u-1', existingCategories: everything, addCategory: async () => {}, replace: true });
    expect(r).toMatchObject({ posted: true, replaced: true, je: { id: 'je-new', reference: OB.OPENING_REFERENCE } });
    const deletes = db.calls.filter((c) => c.method === 'delete');
    expect(deletes.map((c) => c.table)).toEqual(['transactions', 'journal_entries']);
    expect(deletes[0].filters).toContainEqual(['eq', 'journal_entry_id', 'je-open']);
    const [call] = rpcCalls();
    expect(call.args.p_entry).toMatchObject({ reference: OB.OPENING_REFERENCE, date: OB.OPENING_DATE, created_by: 'u-1' });
    const dr = call.args.p_lines.reduce((s, l) => s + l.debit_amount, 0);
    const cr = call.args.p_lines.reduce((s, l) => s + l.credit_amount, 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.005);
    expect(call.args.p_txns).toHaveLength(OB.OPENING_LINES.length);
    expect(call.args.p_txns.every((t) => t.posted && t.reference === OB.OPENING_REFERENCE)).toBe(true);
  });

  it('a failed lookup or delete stops the flow before anything is posted', async () => {
    db.answer = (c) => (c.table === 'journal_entries' && c.method === 'select' ? { data: null, error: { message: 'read failed' } } : { data: null, error: null });
    await expect(OB.postOpeningJE({ userId: 'u-1', existingCategories: everything, addCategory: async () => {} })).rejects.toMatchObject({ message: 'read failed' });
    db.answer = (c) => {
      if (c.table === 'journal_entries' && c.method === 'select') return { data: [{ id: 'je-open' }], error: null };
      if (c.method === 'delete') return { data: null, error: { message: 'delete failed' } };
      return { data: null, error: null };
    };
    await expect(OB.postOpeningJE({ userId: 'u-1', existingCategories: everything, addCategory: async () => {}, replace: true })).rejects.toMatchObject({ message: 'delete failed' });
    expect(rpcCalls()).toHaveLength(0);
  });
});
