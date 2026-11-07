import { describe, expect, it } from 'vitest';
import { THEMES, money, moneyShort, percent, monthShort, monthLong } from '../src/components/charts/theme.js';
import { contrast, deltaE } from './helpers/color.js';

// The chart palettes are checked, not eyeballed: every pair of series hues
// must stay apart under normal vision and the three colour deficiencies, and
// every mark must stand out from its surface. Run for light and dark.

describe.each(Object.values(THEMES))('$name chart palette', (th) => {
  const identity = [...th.series, th.other];
  it('every pair of series hues is apart for every kind of vision (ΔE ≥ 8, normal ≥ 15)', () => {
    for (let i = 0; i < identity.length; i++) {
      for (let j = i + 1; j < identity.length; j++) {
        const d = deltaE(identity[i], identity[j]);
        expect(d.normal, `${identity[i]} vs ${identity[j]}`).toBeGreaterThanOrEqual(15);
        expect(Math.min(d.protan, d.deutan, d.tritan), `${identity[i]} vs ${identity[j]}`).toBeGreaterThanOrEqual(8);
      }
    }
  });
  it('series hues and the bridge tones reach 3:1 against the surface', () => {
    for (const c of [...th.series, th.up, th.down, th.total]) expect(contrast(c, th.surface), c).toBeGreaterThanOrEqual(3);
  });
  it('tick and label text reaches 4.5:1', () => {
    expect(contrast(th.text, th.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(th.ink, th.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it('the bridge tones are apart from each other', () => {
    for (const [a, b] of [[th.up, th.down], [th.up, th.total], [th.down, th.total]]) {
      const d = deltaE(a, b);
      expect(Math.min(d.normal, d.protan, d.deutan, d.tritan)).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('formatters', () => {
  it('money and short money', () => {
    expect(money(12345.6)).toBe('$12,346');
    expect(money(null)).toBe('—');
    expect(moneyShort(12345)).toBe('$12.3K');
    expect(moneyShort(-4000)).toBe('-$4K');
  });
  it('percent from a fraction', () => {
    expect(percent(0.026)).toBe('2.6%');
    expect(percent(null)).toBe('—');
  });
  it('months in both languages', () => {
    expect(monthShort('2026-11')).toBe('Nov 26');
    expect(monthShort('2026-01', 'es-US')).toBe('ene 26');
    expect(monthLong('2026-11')).toBe('November 2026');
  });
});
