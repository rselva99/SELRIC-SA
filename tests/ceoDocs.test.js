import { describe, expect, it } from 'vitest';
import { compute } from '../src/lib/ceoModel.js';
import { parseSections, parseBlocks, resolve, plain, tableFor, TABLE_NAMES, FMT } from '../src/lib/ceoDocs.js';
import { syntheticAssumptions } from './fixtures/synthetic-model.js';
import { privateData, readPrivate, hasPrivateFile } from './helpers/private.js';

const R = compute(syntheticAssumptions());

describe('ceoDocs — parsing and tokens (synthetic)', () => {
  it('splits sections on anchored ## and ### headings and keeps the level', () => {
    const s = parseSections('## One {#one}\n\nBody.\n\n### One point one {#one-1}\n\nSub.\n\n### Not a section\n\n## Two {#two}\n\nEnd.');
    expect(s.map((x) => [x.key, x.level])).toEqual([['one', 2], ['one-1', 3], ['two', 2]]);
    expect(s[1].body).toContain('### Not a section');
  });

  it('resolves a token with its format, and marks an unknown path instead of blanking it', () => {
    const ctx = {};
    expect(resolve('ARR {{years.2.endARR|usd}}', R)).toBe(`ARR ${FMT.usd(R.years[2].endARR)}`);
    expect(resolve('{{nope.path|usd}}', R, ctx)).toBe('⟨nope.path⟩');
    expect(ctx.missing).toEqual(['nope.path']);
    expect(resolve('{{prices.business|nofmt}}', R, ctx)).toBe('⟨prices.business|nofmt?⟩');
  });

  it('does not split a table cell on the | inside a token', () => {
    const [t] = parseBlocks('| A | B |\n|---|---|\n| {{prices.business|usd}} | x |');
    expect(t.type).toBe('table');
    expect(t.rows[0]).toEqual(['{{prices.business|usd}}', 'x']);
  });

  it('recognises a computed table on its own line and every registered table builds', () => {
    expect(parseBlocks('{{table:years}}')[0]).toEqual({ type: 'ttable', name: 'years' });
    for (const name of TABLE_NAMES.filter((n) => !/^comp|milestones|roadmap|findings/.test(n))) {
      const t = tableFor(name, R, {});
      expect(t.head.length, name).toBeGreaterThan(0);
      for (const row of t.rows) expect(row.join(' '), name).not.toMatch(/⟨|undefined|NaN/);
    }
  });

  it('formats as the documents expect', () => {
    expect(FMT.usd(-1234.4)).toBe('−$1,234');
    expect(FMT.pct(0.5349)).toBe('53%');
    expect(FMT.pct1(0.018)).toBe('1.8%');
    expect(FMT.mon('2026-11')).toBe('Nov 26');
    expect(FMT.word(3)).toBe('three');
  });

  it('strips markup in plain()', () => {
    expect(plain('**Bold** and *it* {{prices.business|usd}}', R)).toBe(`Bold and it ${FMT.usd(R.prices.business)}`);
  });
});

// Every seeded document (the prose lives outside the repo) must resolve
// completely against the golden assumptions: no ⟨path⟩, no unknown table.
const P = privateData();
const DOCS = ['business_plan', 'market_gtm', 'findings', 'competition'];
describe.skipIf(!P || !DOCS.every((d) => hasPrivateFile(`docs/${d}.md`)))('ceoDocs — seeded documents (outside the repo)', () => {
  const RG = P ? compute(P.assumptions) : null;
  const docs = P ? {
    findings: parseSections(readPrivate('docs/findings.md')),
    plan: JSON.parse(readPrivate('docs/plan.json')),
    competition: JSON.parse(readPrivate('docs/competitors.json')),
  } : null;

  for (const doc of DOCS) {
    it(`${doc}: every token and table resolves`, () => {
      const unresolved = [];
      for (const s of parseSections(readPrivate(`docs/${doc}.md`))) {
        const ctx = {};
        resolve(s.title, RG, ctx);
        for (const b of parseBlocks(s.body)) {
          if (b.type === 'ttable') { if (!tableFor(b.name, RG, docs)) unresolved.push(`${s.key}: table:${b.name}`); continue; }
          for (const text of b.items || (b.rows ? [...b.head, ...b.rows.flat()] : [b.text || ''])) resolve(text, RG, ctx);
        }
        const out = plain(s.body, RG, docs);
        for (const m of ctx.missing || []) unresolved.push(`${s.key}: ${m}`);
        if (/⟨/.test(out)) unresolved.push(`${s.key}: ⟨…⟩ in output`);
      }
      expect(unresolved).toEqual([]);
    });
  }

  it('plan: every milestone and roadmap line resolves', () => {
    const ctx = {};
    for (const m of docs.plan.milestones) resolve(m.what, RG, ctx);
    for (const r of docs.plan.roadmap) resolve(r.actions, RG, ctx);
    expect(ctx.missing || []).toEqual([]);
  });
});
