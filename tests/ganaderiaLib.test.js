import { describe, expect, it } from 'vitest';
import {
  pregnancyMonths, overdueForPalpation, todayMilk, milkSeries, topMilkers, lotComposition,
  needsYou, typeOrder, nextTag, matchAnimals, byTag, daysUntil, EVENT_TYPES,
  monthAdd, calvingsByMonth, milkPerCow, pregnancyTimeline,
} from '../src/programs/ganaderia/lib.js';

// The herd helpers behind Inicio, Animales, the Ficha and Registrar. Every
// animal and event below is made up; `today` is pinned so the dates hold.
const TODAY = '2026-11-01';
const cow = (o) => ({ id: o.name, species: 'bovino', status: 'activo', sex: 'H', category: 'vaca', flags: [], ...o });
const milk = (animal_id, date, liters) => ({ type: 'leche', animal_id, date, data: { liters } });

describe('ganaderia lib — pregnancy', () => {
  it('adds the time since the check to the months found at the check', () => {
    expect(pregnancyMonths(cow({ name: 'A', pregnant: true, preg_months: 5, preg_date: TODAY }), TODAY)).toBe(5);
    // 61 days after a 5-month check is about 7 months.
    expect(pregnancyMonths(cow({ name: 'A', pregnant: true, preg_months: 5, preg_date: '2026-09-01' }), TODAY)).toBe(7);
  });

  it('is null for an animal that is not pregnant', () => {
    expect(pregnancyMonths(cow({ name: 'A', pregnant: false }), TODAY)).toBeNull();
  });

  it('counts days until a date, negative once it has passed', () => {
    expect(daysUntil('2026-11-11', TODAY)).toBe(10);
    expect(daysUntil('2026-10-30', TODAY)).toBe(-2);
  });
});

describe('ganaderia lib — overdueForPalpation', () => {
  it('flags an open cow never checked, or last checked more than 90 days ago', () => {
    expect(overdueForPalpation(cow({ name: 'A' }), 90, TODAY)).toBe(true);
    expect(overdueForPalpation(cow({ name: 'A', preg_date: '2026-07-01' }), 90, TODAY)).toBe(true);
    expect(overdueForPalpation(cow({ name: 'A', preg_date: '2026-10-01' }), 90, TODAY)).toBe(false);
  });

  it('takes the newer of the card date and the latest palpación event', () => {
    const events = [{ type: 'palpacion', date: '2026-10-15' }];
    expect(overdueForPalpation(cow({ name: 'A', preg_date: '2026-05-01' }), 90, TODAY, events)).toBe(false);
  });

  it('leaves out pregnant cows, closed cards and other categories', () => {
    expect(overdueForPalpation(cow({ name: 'A', pregnant: true }), 90, TODAY)).toBe(false);
    expect(overdueForPalpation(cow({ name: 'A', status: 'vendido' }), 90, TODAY)).toBe(false);
    expect(overdueForPalpation(cow({ name: 'A', category: 'ternera' }), 90, TODAY)).toBe(false);
    expect(overdueForPalpation(cow({ name: 'A', category: 'vaquilla' }), 90, TODAY)).toBe(true);
  });
});

describe('ganaderia lib — milk', () => {
  const events = [
    milk('a', TODAY, 6.5), milk('b', TODAY, 4), milk('a', '2026-10-31', 7),
    milk('c', '2026-10-20', 30), { type: 'peso', animal_id: 'a', date: TODAY, data: { kg: 400 } },
  ];

  it('sums today’s litres and counts the milkings', () => {
    expect(todayMilk(events, TODAY)).toEqual({ liters: 10.5, milkings: 2 });
    expect(todayMilk([], TODAY)).toEqual({ liters: 0, milkings: 0 });
  });

  it('gives one point per day, oldest first, zero on days with nothing', () => {
    const s = milkSeries(events, 7, TODAY);
    expect(s).toHaveLength(7);
    expect(s[0].date).toBe('2026-10-26');
    expect(s.at(-1)).toEqual({ date: TODAY, liters: 10.5 });
    expect(s.at(-2)).toEqual({ date: '2026-10-31', liters: 7 });
    expect(s.slice(0, 5).every((p) => p.liters === 0)).toBe(true);
  });

  it('ranks the best milkers inside the window only', () => {
    expect(topMilkers(events, 7, TODAY)).toEqual([{ animal_id: 'a', liters: 13.5 }, { animal_id: 'b', liters: 4 }]);
    expect(topMilkers(events, 14, TODAY, 1)).toEqual([{ animal_id: 'c', liters: 30 }]);
  });
});

describe('ganaderia lib — lotComposition', () => {
  it('counts active animals per lot, biggest lot first, with the mix by group', () => {
    const herd = [
      cow({ name: 'A', lot: 'Potrero 1', pregnant: true }), cow({ name: 'B', lot: 'Potrero 1' }),
      cow({ name: 'C', lot: 'Potrero 1', category: 'ternera' }), cow({ name: 'D', lot: 'Potrero 2', category: 'toro', sex: 'M' }),
      cow({ name: 'E', category: 'vaquilla' }), cow({ name: 'F', lot: 'Potrero 2', status: 'vendido' }),
    ];
    const lots = lotComposition(herd);
    expect(lots.map((l) => [l.lot, l.total])).toEqual([['Potrero 1', 3], ['', 1], ['Potrero 2', 1]]);
    expect(lots[0].pregnant).toBe(1);
    expect(lots[0].groups).toEqual({ hembras: 2, jovenes: 0, crias: 1, machos: 0 });
    expect(lots[1].groups.jovenes).toBe(1);
    expect(lots[2].groups.machos).toBe(1);
  });
});

describe('ganaderia lib — the Informes series', () => {
  // Canela checked at 5 months on 1 Sep calves 10 Jan; Estrella's calving
  // (12 Jul) is late; Pinta has no check date; Vendida is no longer here.
  const herd = [
    cow({ name: 'Canela', pregnant: true, preg_date: '2026-09-01', preg_months: 5 }),
    cow({ name: 'Estrella', pregnant: true, preg_date: '2026-01-01', preg_months: 3 }),
    cow({ name: 'Pinta', pregnant: true }),
    cow({ name: 'Vendida', pregnant: true, preg_date: '2026-09-01', preg_months: 5, status: 'vendido' }),
  ];
  const partos = [
    { type: 'parto', animal_id: 'A', date: '2025-11-20' },
    { type: 'parto', animal_id: 'B', date: '2026-10-05' },
    { type: 'parto', animal_id: 'C', date: '2026-11-01' },
    { type: 'palpacion', animal_id: 'C', date: '2026-10-05' },
  ];

  it('adds months across a year end', () => {
    expect(monthAdd('2026-11', 2)).toBe('2027-01');
    expect(monthAdd('2026-11', -11)).toBe('2025-12');
  });

  it('counts calvings recorded over the last year and expected ahead, a late one in this month', () => {
    const s = calvingsByMonth(herd, partos, TODAY);
    expect(s.map((r) => r.month)).toEqual([
      '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
      '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01',
    ]);
    expect(s[0]).toEqual({ month: '2025-12', recorded: 0, expected: null });
    expect(s.find((r) => r.month === '2026-10')).toEqual({ month: '2026-10', recorded: 1, expected: null });
    expect(s.find((r) => r.month === '2026-11')).toEqual({ month: '2026-11', recorded: 1, expected: 1 });
    expect(s.find((r) => r.month === '2026-12')).toEqual({ month: '2026-12', recorded: null, expected: 0 });
    expect(s.at(-1)).toEqual({ month: '2027-01', recorded: null, expected: 1 });
  });

  it('ends at this month when nothing is expected', () => {
    expect(calvingsByMonth([], partos, TODAY).at(-1).month).toBe('2026-11');
  });

  it('gives litres per cow-day by week, a gap for a week with no milk', () => {
    const events = [milk('A', '2026-10-20', 10), milk('A', '2026-10-20', 6), milk('B', '2026-10-21', 8), milk('A', '2026-11-01', 9), milk('A', '2026-10-11', 50)];
    expect(milkPerCow(events, 3, TODAY)).toEqual([
      { date: '2026-10-12', liters: 0, cows: 0, cowDays: 0, perCow: null },
      { date: '2026-10-19', liters: 24, cows: 2, cowDays: 2, perCow: 12 },
      { date: '2026-10-26', liters: 9, cows: 1, cowDays: 1, perCow: 9 },
    ]);
  });

  it('lists the pregnant animals by due month, the late one now and the undated one last', () => {
    const t = pregnancyTimeline(herd, TODAY);
    expect(t.map((g) => [g.month, g.rows.map((r) => r.animal.name)])).toEqual([
      ['2026-11', ['Estrella']], ['2027-01', ['Canela']], [null, ['Pinta']],
    ]);
    expect(t[0].rows[0]).toMatchObject({ date: '2026-07-12', days: -112 });
    expect(t[1].rows[0]).toMatchObject({ date: '2027-01-10', days: 70 });
  });
});

describe('ganaderia lib — needsYou', () => {
  // Bovine gestation is 283 days; a 9-month check on a date puts calving about 9 days later.
  const herd = [
    cow({ name: 'Late', pregnant: true, preg_months: 9, preg_date: '2026-10-01' }),   // due ~10-10, overdue
    cow({ name: 'Soon', pregnant: true, preg_months: 9, preg_date: '2026-10-28' }),   // due ~11-06
    cow({ name: 'Later', pregnant: true, preg_months: 8, preg_date: '2026-10-25' }),  // due ~12-04
    cow({ name: 'Far', pregnant: true, preg_months: 2, preg_date: TODAY }),           // months away
    cow({ name: 'Open', preg_date: '2026-03-01' }),
    cow({ name: 'Calf', category: 'ternera', flags: ['por_confirmar'] }),
    cow({ name: 'Old', flags: ['vender'], preg_date: '2026-10-20' }),
    cow({ name: 'Gone', status: 'vendido', pregnant: true, preg_months: 9, preg_date: '2026-10-28' }),
  ];
  const rows = needsYou(herd, TODAY);

  it('puts overdue calvings first, then the ones due within the window, soonest first', () => {
    expect(rows.filter((r) => r.animal).map((r) => [r.kind, r.animal.name])).toEqual([
      ['overdue', 'Late'], ['due', 'Soon'], ['due', 'Later'],
    ]);
    expect(rows[0].days).toBeGreaterThan(0);
  });

  it('adds one line for the cows due a palpación and one per action flag', () => {
    const tail = rows.filter((r) => !r.animal);
    expect(tail).toEqual([
      { kind: 'unchecked', n: 1 },
      { kind: 'flag', flag: 'por_confirmar', n: 1 },
      { kind: 'flag', flag: 'vender', n: 1 },
    ]);
  });

  it('returns nothing for a herd with nothing due', () => {
    expect(needsYou([cow({ name: 'A', preg_date: '2026-10-20' })], TODAY)).toEqual([]);
  });
});

describe('ganaderia lib — Registrar helpers', () => {
  it('orders the record tiles by use, the vocabulary order breaking ties', () => {
    const order = typeOrder([{ type: 'leche' }, { type: 'leche' }, { type: 'peso' }]);
    expect(order.slice(0, 3)).toEqual(['leche', 'peso', 'parto']);
    expect(order).toHaveLength(EVENT_TYPES.length);
    expect(typeOrder([])).toEqual(EVENT_TYPES.map((e) => e.key));
  });

  it('proposes the next chapa, keeping the zero padding', () => {
    expect(nextTag([{ tag: '0812' }, { tag: '0099' }, { tag: 'A-7' }])).toBe('0813');
    expect(nextTag([{ tag: '1024' }, { tag: '12' }])).toBe('1025');
    expect(nextTag([{ tag: 'AB/12' }, {}])).toBe('');
  });

  it('finds a number by chapa first, then names; active animals before closed ones', () => {
    const herd = [
      cow({ name: 'Golondrina', tag: '1275' }), cow({ name: 'Canela', tag: '127' }),
      cow({ name: 'Paloma 127', tag: '' }), cow({ name: 'Vieja', tag: '127', status: 'vendido' }),
      cow({ name: 'Mora', tag: '9', aliases: ['La Gorda'], brand: 'AB', dam_name: 'Canela' }),
    ];
    expect(matchAnimals(herd, '127').map((a) => a.name)).toEqual(['Canela', 'Vieja', 'Golondrina', 'Paloma 127']);
    expect(matchAnimals(herd, 'gorda').map((a) => a.name)).toEqual(['Mora']);
    expect(matchAnimals(herd, 'can').map((a) => a.name)).toEqual(['Canela', 'Mora']);
    expect(matchAnimals(herd, '  ')).toBe(herd);
  });

  it('sorts by chapa numerically, animals without one after, by name', () => {
    const list = [{ name: 'B', tag: '' }, { name: 'C', tag: '100' }, { name: 'A', tag: null }, { name: 'D', tag: '20' }];
    expect([...list].sort(byTag).map((a) => a.name)).toEqual(['D', 'C', 'A', 'B']);
  });
});
