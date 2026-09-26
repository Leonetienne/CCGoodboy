import { describe, expect, it } from 'vitest';
import { AUTO_STACK, autoSpreeNext, autoStackSize } from '../../src/autoplay/buy-streak';
import type { AutoCollectCtx, PurchaseCandidate } from '../../src/autoplay/collector';
import { autoDecide } from '../../src/autoplay/strategy';
import { AUTO_PREF_WIZARD } from '../../src/autoplay/valuation-tables';

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
    cfg: { insignificantShare: 0.001, reachSec: 1800 },
    biscuitBase: null,
    cursor: null,
    nonCursor: 0,
    clicksPerSec: 0,
    clickUnit: 1,
    ...overrides,
  };
}

function upgrade(name: string, cost: number, dCps: number): PurchaseCandidate {
  return { kind: 'upgrade', type: 'cookie', name, obj: { name, buy: () => {} } as never, cost, dCps };
}

const anywhere = () => true;

/** Replays a visit the way AutoPlayEngine.buySpree() does (15% price step per building buy,
 * an upgrade leaves the store, bank shrinking), starting with the tick's pick. Returns the
 * names bought in order. */
function spree(cands: PurchaseCandidate[], x: AutoCollectCtx, reachable: (c: PurchaseCandidate) => boolean = anywhere, max = 100): string[] {
  let bank = x.bank;
  const list = cands.map((c) => ({ ...c }));
  const out: string[] = [];
  let last = autoDecide(list, x).buy;

  while (last && out.length < max) {
    bank -= last.cost;
    out.push(last.name);
    if (last.kind === 'building') last.cost *= 1.15;
    else list.splice(list.indexOf(last), 1);
    last = autoSpreeNext(autoDecide(list, { ...x, bank }), last, bank, reachable);
  }

  return out;
}

describe('buying streak (AUTO-14)', () => {
  it('continues only while the building is the pick this tick', () => {
    const cursor = building('Cursor', 500, 10);
    const farm = building('Farm', 1100, 20);
    // tight bank, nothing insignificant (0.1% of 1000 = 1 cookie): Cursor stays the pick
    expect(autoSpreeNext(autoDecide([cursor, farm], ctx()), cursor, 1000, anywhere)).toBe(cursor);
    // pocket money (1% of the bank covers both): the Farm is the pick now, and neither is junk
    // (0.1% of 2e5 = 200): the visit ends
    expect(autoSpreeNext(autoDecide([cursor, farm], ctx({ bank: 2e5 })), cursor, 2e5, anywhere)).toBeNull();
  });

  it('streaks 100 cursors on a flush bank once nothing bigger is left', () => {
    expect(spree([building('Cursor', 15, 0.1)], ctx({ bank: 1e15 }))).toHaveLength(100);
  });

  it('stops when it is not affordable any more', () => {
    expect(spree([building('Cursor', 400, 1)], ctx({ bank: 1000 }))).toHaveLength(2);
  });
});

describe('stacks of 10 (AUTO-14)', () => {
  it('buys 10 at a press while the stack is pocket money', () => {
    const cursor = building('Cursor', 15, 0.1);
    const x = ctx({ bank: 1e15 });
    expect(autoStackSize(autoDecide([cursor], x), cursor, 300, x)).toBe(AUTO_STACK);
  });

  it('buys one at a time once the stack is a real share of the bank, or would eat the pick', () => {
    const cursor = building('Cursor', 15, 0.1);
    const farm = building('Farm', 1100, 8);
    // stack 5000 > 1% of 1e5
    const x = ctx({ bank: 1e5 });
    expect(autoStackSize(autoDecide([cursor], x), cursor, 5000, x)).toBe(1);
    // stack 500 is junk, but only 1400 in the bank and the Farm (1100) is the pick
    const y = ctx({ bank: 1400 });
    const d = autoDecide([cursor, farm], y);
    expect(d.buy).toBe(farm);
    expect(autoStackSize(d, cursor, 500, y)).toBe(1);
  });

  it('never stacks Wizard towers or upgrades', () => {
    const x = ctx({ bank: 1e15 });
    const wiz = building('Wizard tower', 15, 1, AUTO_PREF_WIZARD);
    expect(autoStackSize(autoDecide([wiz], x), wiz, 300, x)).toBe(1);
    const up = upgrade('A', 15, 1);
    expect(autoStackSize(autoDecide([up], x), up, 300, x)).toBe(1);
  });
});

describe('junk spree (AUTO-18)', () => {
  it('buys every insignificant upgrade in one visit', () => {
    // 0.1% of 1e6 -> insignificant up to 1000
    const ups = [upgrade('A', 50, 1), upgrade('B', 100, 1), upgrade('C', 200, 1)];
    expect(spree(ups, ctx({ bank: 1e6 })).sort()).toEqual(['A', 'B', 'C']);
  });

  it('does not hop to something that is not insignificant', () => {
    const ups = [upgrade('Junk', 50, 1), upgrade('Big', 5000, 100)];
    // Big is the pick (payback 50s), then Junk; Big itself is only the first buy
    expect(spree(ups, ctx({ bank: 1e6 }))).toEqual(['Big', 'Junk']);
    // tight bank: Big first (the biggest CpS gain); Junk (50 of the 1000 left) isn't junk any
    // more, so the visit ends
    expect(spree([upgrade('Junk', 50, 10), upgrade('Big', 5000, 100)], ctx({ bank: 6000 }))).toEqual(['Big']);
  });

  it('skips junk the paw cannot reach and junk that would leave too little for the pick', () => {
    // insignificant up to 10% of the bank here (94), so Far and Near are junk and Pick isn't
    const cfg = { insignificantShare: 0.1, reachSec: 1800 };
    const d = autoDecide([upgrade('Far', 50, 1), upgrade('Near', 60, 1), upgrade('Pick', 900, 100)], ctx({ bank: 940, cfg }));
    expect(d.buy?.name).toBe('Pick');
    const last = upgrade('Other', 1, 1);
    // Pick (not junk, left to the next visit) needs 900 of 940: neither 50 nor 60 fits beside it
    expect(autoSpreeNext(d, last, 940, anywhere)).toBeNull();
    expect(autoSpreeNext(d, last, 1000, anywhere)?.name).toBe('Far');
    const far = (c: PurchaseCandidate) => c.name !== 'Far';
    const d2 = autoDecide([upgrade('Far', 50, 1), upgrade('Near', 60, 1)], ctx({ bank: 1000, cfg }));
    expect(autoSpreeNext(d2, last, 1000, far)?.name).toBe('Near');
    expect(autoSpreeNext(d2, last, 1000, () => false)).toBeNull();
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

  it('buys the biggest CpS gain first among what pays back before the target, on a tight bank too', () => {
    // 2000 banked: Mine (pp 1000s wait + 255s) is the target; Cursor, Grandma and Farm all pay
    // back sooner, so the Farm goes first, then the Grandma and the Cursor
    const d = autoDecide(cands(), ctx({ bank: 2000 }));
    expect(d.buy?.name).toBe('Farm');
    expect(d.buyable?.map((r) => r.c.name)).toEqual(['Farm', 'Grandma', 'Cursor']);
  });
});
