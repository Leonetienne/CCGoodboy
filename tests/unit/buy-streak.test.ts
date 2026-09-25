import { describe, expect, it } from 'vitest';
import { autoStreakContinues, streakCandidate } from '../../src/autoplay/buy-streak';
import type { AutoCollectCtx, PurchaseCandidate } from '../../src/autoplay/collector';
import { autoDecide } from '../../src/autoplay/strategy';

function building(name: string, cost: number, dCps: number, pref = 0): PurchaseCandidate {
  return { kind: 'building', type: 'building', name, obj: { name, buy: () => {} }, cost, dCps, pref };
}

function ctx(overrides: Partial<AutoCollectCtx> = {}): AutoCollectCtx {
  return {
    cps: 10,
    mult: 1,
    income: 10,
    bank: 1000,
    reserve: 0,
    cfg: { insignificantSec: 60, goodFactor: 1.2, biggerImpact: 3, reachSec: 1800 },
    biscuitBase: null,
    cursor: null,
    nonCursor: 0,
    clicksPerSec: 0,
    clickUnit: 1,
    ...overrides,
  };
}

/** Replays the streak on `name` the way AutoPlayEngine.buyStreak() does (15% price step per
 * buy, bank shrinking), returning how many it bought in a row including the first. */
function streakLength(cands: PurchaseCandidate[], name: string, x: AutoCollectCtx, max = 100): number {
  let bank = x.bank;
  let n = 0;
  const list = cands.map((c) => ({ ...c }));

  while (n < max) {
    const c = streakCandidate(list, name)!;
    if (!autoStreakContinues(autoDecide(list, { ...x, bank }), c)) break;
    bank -= c.cost;
    c.cost *= 1.15;
    n++;
  }

  return n;
}

describe('buying streak (AUTO-14)', () => {
  it('continues only while the building is the pick this tick', () => {
    const cursor = building('Cursor', 15, 1);
    const farm = building('Farm', 1100, 8);
    expect(autoStreakContinues(autoDecide([cursor, farm], ctx()), cursor)).toBe(true);
    expect(autoStreakContinues(autoDecide([cursor, farm], ctx({ bank: 1e15 })), cursor)).toBe(false);
  });

  it('streaks 100 cursors on a flush bank once nothing bigger is left', () => {
    expect(streakLength([building('Cursor', 15, 0.1)], 'Cursor', ctx({ bank: 1e15 }))).toBe(100);
  });

  it('does not streak past a better purchase on a tight bank', () => {
    // payback: Cursor 150s rising 15% per copy vs Farm 137.5s -> Farm first
    const cands = [building('Cursor', 15, 0.1), building('Farm', 1100, 8)];
    expect(streakLength(cands, 'Cursor', ctx({ bank: 2000 }))).toBe(0);
  });

  it('stops when it is not affordable any more', () => {
    expect(streakLength([building('Cursor', 400, 1)], 'Cursor', ctx({ bank: 1000 }))).toBe(2);
  });

  it('finds the building among the candidates, not an upgrade of the same name', () => {
    const up: PurchaseCandidate = { kind: 'upgrade', type: 'cookie', name: 'Cursor', obj: { name: 'Cursor' } as never, cost: 1, dCps: 1 };
    const b = building('Cursor', 15, 1);
    expect(streakCandidate([up, b], 'Cursor')).toBe(b);
    expect(streakCandidate([up], 'Cursor')).toBeNull();
  });
});

describe('buy order on a flush bank (AUTO-4)', () => {
  // Real base values: the higher tiers have the WORSE payback (cost ~10x, CpS only ~5-8x).
  const cands = () => [
    building('Cursor', 15, 0.1),
    building('Grandma', 100, 1),
    building('Farm', 1100, 8),
    building('Mine', 12000, 47),
    building('Factory', 130000, 260),
  ];

  it('buys the biggest CpS gain first when everything is pocket money', () => {
    expect(autoDecide(cands(), ctx({ bank: 1e15 })).buy?.name).toBe('Factory');
  });

  it('still buys the best payback first when the bank is tight', () => {
    // floor 20: Grandma 100s beats Farm 137.5s and Cursor 150s
    expect(autoDecide(cands(), ctx({ bank: 2000 })).buy?.name).toBe('Grandma');
  });

  it('ranks buildings costing a real share of the bank by payback, ahead of pocket money', () => {
    // floor 10000: Mine 12000/47 = 255 beats Factory 500, Farm 10000/8 = 1250, Cursor 100000
    expect(autoDecide(cands(), ctx({ bank: 1e6 })).buy?.name).toBe('Mine');
  });
});
