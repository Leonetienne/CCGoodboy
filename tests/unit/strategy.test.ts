import { describe, expect, it } from 'vitest';
import type { AutoCollectCtx, PurchaseCandidate } from '../../src/autoplay/collector';
import { autoDecide } from '../../src/autoplay/strategy';

function candidate(name: string, cost: number, dCps: number): PurchaseCandidate {
  return { kind: 'building', type: 'building', name, obj: { name, buy: () => {} }, cost, dCps };
}

function ctx(overrides: Partial<AutoCollectCtx> = {}): AutoCollectCtx {
  return {
    cps: 10,
    mult: 1,
    income: 10,
    bank: 1000,
    reserve: 0,
    cfg: {
      insignificantSec: 1,
      goodFactor: 1.2,
      biggerImpact: 3,
      reachSec: 1800,
      maxPaybackSec: 86400,
    },
    biscuitBase: null,
    cursor: null,
    nonCursor: 0,
    clicksPerSec: 0,
    clickUnit: 1,
    ...overrides,
  };
}

describe('autoDecide', () => {
  it('buys nothing when there are no candidates', () => {
    const d = autoDecide([], ctx());
    expect(d.buy).toBeNull();
    expect(d.note).toBe('nothing in reach');
  });

  it('buys an affordable, insignificantly-cheap item at once', () => {
    // cost 5 <= insignificantSec(1) * income(10) = 10: insignificant. As the only candidate
    // it is also trivially its own best pp, so `good()` reports true first (the code checks
    // good() before falling back to the insignificant-cost reason).
    const cands = [candidate('Cheap trinket', 5, 1)];
    const d = autoDecide(cands, ctx({ bank: 100 }));

    expect(d.buy?.name).toBe('Cheap trinket');
    expect(d.why).toBe('good payback');
  });

  it('reports "insignificant cost" for a cheap item whose payback alone would not be a good deal', () => {
    // A candidate with an excellent payback, in reach (high income shrinks its wait) but not
    // yet affordable, sets a very low bestPP.
    const great = candidate('Great deal (saving up)', 1_000_000, 1_000_000); // payback 1
    // A cheap, affordable item with a much worse payback: not "good" next to bestPP, but still
    // insignificant relative to the (also high) income, and far too cheap next to `great` to
    // trigger postponement.
    const cheap = candidate('Cheap trinket', 5, 0.05); // payback 100

    const d = autoDecide([great, cheap], ctx({ bank: 100, income: 1_000_000 }));

    expect(d.buy?.name).toBe('Cheap trinket');
    expect(d.why).toBe('insignificant cost');
  });

  it('among several buyable options, picks the best payback first', () => {
    const cands = [
      candidate('Slow payback', 100, 1), // payback 100
      candidate('Fast payback', 100, 10), // payback 10
    ];

    // Both affordable (bank covers both), both insignificant cost-wise is irrelevant here since
    // goodFactor picks the best pp: fast payback (10) beats slow (100) regardless of goodFactor.
    const d = autoDecide(cands, ctx({ bank: 100000, income: 10000 }));

    expect(d.buy?.name).toBe('Fast payback');
  });

  it('reports what it is saving for when nothing is affordable yet', () => {
    const cands = [candidate('Big building', 10000, 100)]; // payback 100, needs saving
    const d = autoDecide(cands, ctx({ bank: 0, income: 100, reserve: 0 }));

    expect(d.buy).toBeNull();
    expect(d.save?.name).toBe('Big building');
    expect(d.note).toBe('saving');
  });

  it('excludes a candidate whose payback exceeds maxPaybackSec unless insignificant', () => {
    const cands = [candidate('Forever payback', 1000, 0.001)]; // payback = 1,000,000s
    const d = autoDecide(cands, ctx({ bank: 100000, cfg: { insignificantSec: 1, goodFactor: 1.2, biggerImpact: 3, reachSec: 1800, maxPaybackSec: 86400 } }));

    expect(d.buy).toBeNull();
    expect(d.save).toBeNull();
    expect(d.note).toBe('nothing in reach');
  });

  it('postpones a small affordable purchase in favor of saving for a much bigger, good-deal one', () => {
    // Small: affordable right now (cost == avail), decent but unremarkable payback.
    const small = candidate('Small upgrade', 50, 5); // payback 10, impact 0.5
    // Big: not affordable yet, but its pp is close enough to count as a "good deal", with
    // >= 3x the impact of small, and small costs > 10% of big's cost (50 > 0.1*200=20).
    const big = candidate('Big upgrade', 200, 60); // payback 3.33, impact 6

    const c = ctx({ cps: 10, income: 100, bank: 50, reserve: 0 });
    const d = autoDecide([small, big], c);

    // Nothing should be bought right now: the small one is postponed in favor of saving for
    // the much bigger, much higher-impact one.
    expect(d.buy).toBeNull();
    expect(d.save?.name).toBe('Big upgrade');
  });

  it('buys the small item once a cheaper option makes the big one no longer the best deal', () => {
    // Same big candidate as above, but a cheap, excellent-payback small candidate now has the
    // best pp in the field, which pulls the "good deal" bar down far enough that the big
    // candidate no longer qualifies as a postponement target, so nothing holds the small one back.
    const small = candidate('Tiny upgrade', 15, 5); // payback 3, affordable
    const big = candidate('Big upgrade', 200, 60);

    const c = ctx({ cps: 10, income: 100, bank: 50, reserve: 0 });
    const d = autoDecide([small, big], c);

    expect(d.buy?.name).toBe('Tiny upgrade');
  });
});
