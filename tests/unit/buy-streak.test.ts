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

function continues(cands: PurchaseCandidate[], c: PurchaseCandidate, x: AutoCollectCtx): boolean {
  return autoStreakContinues(autoDecide(cands, x), c, x);
}

describe('buying streak (AUTO-14)', () => {
  it('keeps buying cursors on a huge bank even when another building is the better pick', () => {
    // The Farm has the better payback, so the one-per-task order would alternate; with a
    // quadrillion in the bank the cursor streak can go on without starving the Farm.
    const cursor = building('Cursor', 150, 0.1);
    const farm = building('Farm', 1100, 8);
    const x = ctx({ bank: 1e15 });

    expect(autoDecide([cursor, farm], x).buy).toBe(farm);
    expect(continues([cursor, farm], cursor, x)).toBe(true);
  });

  it('continues while it is itself the best pick', () => {
    const cursor = building('Cursor', 15, 1);
    expect(continues([cursor], cursor, ctx())).toBe(true);
  });

  it('stops when another buy would no longer be affordable after this one', () => {
    const cursor = building('Cursor', 150, 0.1);
    const farm = building('Farm', 1100, 8);
    expect(continues([cursor, farm], cursor, ctx({ bank: 1200 }))).toBe(false);
  });

  it('stops when it is not affordable any more', () => {
    const cursor = building('Cursor', 2000, 1);
    expect(continues([cursor], cursor, ctx({ bank: 1000 }))).toBe(false);
  });

  it('keeps the reserve', () => {
    const cursor = building('Cursor', 150, 1);
    expect(continues([cursor], cursor, ctx({ bank: 1000, reserve: 900 }))).toBe(false);
  });

  it('stops when a save target holds it back', () => {
    // A much better, not yet affordable target (pp < this one's payback) postpones the cursor.
    const cursor = building('Cursor', 700, 0.1); // payback 7000s, not insignificant (> 600)
    const big = building('Big', 2000, 100); // pp = 100 wait + 20 payback
    expect(continues([cursor, big], cursor, ctx({ bank: 1000 }))).toBe(false);
  });

  it('finds the building among the candidates, not an upgrade of the same name', () => {
    const up: PurchaseCandidate = { kind: 'upgrade', type: 'cookie', name: 'Cursor', obj: { name: 'Cursor' } as never, cost: 1, dCps: 1 };
    const b = building('Cursor', 15, 1);
    expect(streakCandidate([up, b], 'Cursor')).toBe(b);
    expect(streakCandidate([up], 'Cursor')).toBeNull();
  });
});
