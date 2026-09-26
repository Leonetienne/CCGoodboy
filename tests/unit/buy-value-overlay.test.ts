import { describe, expect, it } from 'vitest';
import { buyValueRanks } from '../../src/autoplay/buy-value-overlay';
import type { PurchaseCandidate } from '../../src/autoplay/collector';
import type { DecisionRow } from '../../src/autoplay/strategy';

function row(name: string, payback: number, pref = 0): DecisionRow {
  const c: PurchaseCandidate = { kind: 'upgrade', type: 'cookie', name, obj: { name, buy: () => {} } as never, cost: payback, dCps: 1, pref };
  return { c, payback, pp: payback, impact: 0, wait: 0, affordable: true, insignificant: false, pref };
}

describe('"how good is a buy" ranks (BUY-2)', () => {
  it('ranks by payback on a log scale', () => {
    const [a, b, c] = [row('A', 10), row('B', 100), row('C', 1000)];
    const r = buyValueRanks({ rows: [a, b, c], buy: null });
    expect(r.get(a)).toBe(1);
    expect(r.get(b)).toBeCloseTo(0.5);
    expect(r.get(c)).toBe(0);
  });

  it('scores the pick and preferred options 100, and leaves them out of the others\' scale', () => {
    const [a, b, bingo, pick] = [row('A', 10), row('B', 1000), row('Bingo', 1e9, 3), row('Pick', 1e8)];
    const r = buyValueRanks({ rows: [a, b, bingo, pick], buy: pick.c });
    expect(r.get(bingo)).toBe(1);
    expect(r.get(pick)).toBe(1);
    expect(r.get(a)).toBe(1);
    expect(r.get(b)).toBe(0);
  });
});
