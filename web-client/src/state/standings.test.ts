// standings.test.ts — oka/uma parity with engine/helpers.js applyOkaUma.
//
// Cases mirror engine/tests/rules.test.js so a divergence in either direction
// fails loudly: basics, all-tie, and tied-group averaging.

import { describe, test, expect } from 'vitest';
import { applyOkaUma } from './standings';

describe('applyOkaUma', () => {
  test('oka/uma basics (41, 6, -16, -31)', () => {
    const totals = applyOkaUma([31000, 26000, 24000, 19000]).map((r) => r.total);
    expect(totals).toEqual([41, 6, -16, -31]);
  });

  test('all-tie zeros out', () => {
    const rows = applyOkaUma([25000, 25000, 25000, 25000]);
    expect(rows.every((r) => r.total === 0)).toBe(true);
  });

  test('tied groups average uma (25, 25, -25, -25)', () => {
    const totals = applyOkaUma([30000, 30000, 20000, 20000]).map((r) => r.total);
    expect(totals).toEqual([25, 25, -25, -25]);
  });

  test('first-place tie splits the oka', () => {
    const rows = applyOkaUma([30000, 30000, 20000, 20000]);
    expect(rows[0].oka).toBe(10);
    expect(rows[0].place).toBe(1);
    expect(rows[2].place).toBe(3);
  });

  test('results sort by total, seat breaks ties', () => {
    const rows = applyOkaUma([19000, 24000, 26000, 31000]);
    expect(rows.map((r) => r.seat)).toEqual([3, 2, 1, 0]);
  });
});
