import { describe, expect, it } from 'vitest';
import type { AutoCollectCtx, PurchaseCandidate } from '../../src/autoplay/collector';
import { autoDecide, shopPickAt, type DecisionRow } from '../../src/autoplay/strategy';
import { AUTO_PREF_GOLDEN, AUTO_PREF_WIZARD } from '../../src/autoplay/valuation-tables';

function candidate(name: string, cost: number, dCps: number, pref = 0): PurchaseCandidate {
  return { kind: 'building', type: 'building', name, obj: { name, buy: () => {} }, cost, dCps, pref };
}

function ctx(overrides: Partial<AutoCollectCtx> = {}): AutoCollectCtx {
  return {
    cps: 10,
    mult: 1,
    income: 10,
    bank: 1000,
    reserve: 0,
    cfg: {
      insignificantShare: 0.001,
      goodFactor: 1.2,
      biggerImpact: 3,
      reachSec: 1800,
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
    // cost 5 <= 0.1% of the bank (10): insignificant, bought regardless of payback quality.
    const cands = [candidate('Cheap trinket', 5, 1)];
    const d = autoDecide(cands, ctx({ bank: 10_000 }));

    expect(d.buy?.name).toBe('Cheap trinket');
    expect(d.why).toBe('insignificant cost');
  });

  it('buys an affordable item with a nominally bad payback when nothing better is on offer or being saved for', () => {
    // No absolute payback ceiling any more: as the ONLY, hence best-ranked, candidate this is
    // simply the best available option, so it buys even though its payback (100,000s) would
    // have failed the old fixed 24h cap. Cost (1000) is kept above the insignificant threshold
    // (0.1% of the bank = 100) so that rule doesn't decide this on its own.
    const cands = [candidate('Slow but only option', 1000, 0.01)]; // payback 100,000s
    const d = autoDecide(cands, ctx({ bank: 100_000 }));

    expect(d.buy?.name).toBe('Slow but only option');
    expect(d.why).toBe('best available');
  });

  it('among several buyable options, picks the best payback first', () => {
    const cands = [
      candidate('Slow payback', 100, 1), // payback 100
      candidate('Fast payback', 100, 10), // payback 10
    ];

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

  it('reports "nothing in reach" only when nothing is affordable within reachSec, regardless of payback', () => {
    // reachSec = 10: wait (100s at income 100) is NOT in reach, so there's nothing to buy or
    // save for, even though the candidate's payback would otherwise be perfectly fine.
    const cands = [candidate('Too far off', 10000, 100)]; // payback 100, wait 100s
    const d = autoDecide(cands, ctx({ bank: 0, income: 100, reserve: 0, cfg: { insignificantShare: 0.001, goodFactor: 1.2, biggerImpact: 3, reachSec: 10 } }));

    expect(d.buy).toBeNull();
    expect(d.save).toBeNull();
    expect(d.note).toBe('nothing in reach');
  });

  it('postpones a small affordable purchase in favor of saving for a much bigger, good-deal one', () => {
    // Small: affordable right now (cost == avail), decent but unremarkable payback. Cost is kept
    // above the insignificant threshold (0.1% of the bank = 1) so the impact postponement
    // actually gets a chance to apply — insignificant purchases are exempt from it.
    const small = candidate('Small upgrade', 1000, 100); // payback 10, impact 10
    // Big: not affordable yet, but its pp is close enough to count as a "good deal", with
    // >= 3x the impact of small, and small costs > 10% of big's cost (1000 > 0.1*4000=400).
    const big = candidate('Big upgrade', 4000, 1200); // payback 3.33, impact 120

    const c = ctx({ cps: 10, income: 2000, bank: 1000, reserve: 0 });
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
    const small = candidate('Tiny upgrade', 300, 100); // payback 3, affordable
    const big = candidate('Big upgrade', 4000, 1200);

    const c = ctx({ cps: 10, income: 2000, bank: 300, reserve: 0 });
    const d = autoDecide([small, big], c);

    expect(d.buy?.name).toBe('Tiny upgrade');
  });

  it('an insignificant purchase is exempt from the impact postponement next to a much bigger save target', () => {
    // Big target: not affordable (wait 0.85s at income 1000), a good deal (its own bestPP), and
    // >= 3x the impact of the trinket (30 vs 3.75) — normally enough to postpone the trinket,
    // since the trinket also costs > 10% of big's cost (150 > 100). But the trinket is
    // insignificant (150 <= the whole bank here, insignificantShare 1) and pays back faster than the
    // target's pp (4 < 4.18), so it still goes out.
    const trinket = candidate('Trinket', 150, 37.5); // payback 4, impact 3.75
    const big = candidate('Big upgrade', 1000, 300); // payback 3.33, impact 30

    const d = autoDecide([trinket, big], ctx({ bank: 150, income: 1000, reserve: 0, cfg: { insignificantShare: 1, goodFactor: 1.2, biggerImpact: 3, reachSec: 1800 } }));

    expect(d.buy?.name).toBe('Trinket');
    expect(d.why).toBe('insignificant cost');
    expect(d.save?.name).toBe('Big upgrade');
  });

  it('holds back insignificant purchases that pay back slower than a save target (early game)', () => {
    // Early game: every cheap building's next copy costs ~55s of CpS, so all of them are
    // "insignificant" and used to eat the whole income; the Bank, far better even counting the
    // wait, was never reached.
    const cursor = candidate('Cursor', 535_000, 50); // payback 10,700s
    const grandma = candidate('Grandma', 504_000, 60); // payback 8,400s
    const bank = candidate('Bank', 1_400_000, 1_400); // payback 1,000s
    const d = autoDecide([cursor, grandma, bank], ctx({ cps: 9_505, income: 9_505, bank: 600_000 }));

    expect(d.buy).toBeNull();
    expect(d.save?.name).toBe('Bank');
  });

  it('sorts a preferred candidate above an ordinary one even when its payback is worse', () => {
    // Both happen to be insignificant here too, but preference ordering wins regardless: sort
    // is by preference tier first, payback second, so the golden upgrade goes out first either
    // way.
    const ordinary = candidate('Fast payback building', 100, 10); // payback 10
    const golden = candidate('Golden upgrade', 100, 1, AUTO_PREF_GOLDEN); // payback 100

    const d = autoDecide([ordinary, golden], ctx({ bank: 1000, income: 10 }));

    expect(d.buy?.name).toBe('Golden upgrade');
    expect(d.why).toBe('preferred');
  });

  it('sorts preferred candidates before ordinary ones regardless of payback', () => {
    const ordinary = candidate('Fast payback building', 100, 10); // payback 10
    const golden = candidate('Golden upgrade', 100, 1, AUTO_PREF_GOLDEN); // payback 100

    const d = autoDecide([ordinary, golden], ctx({ bank: 100000, income: 10000 }));

    expect(d.buy?.name).toBe('Golden upgrade');
  });

  it('buys an affordable wizard tower even with a nominally terrible payback', () => {
    const ordinary = candidate('Fast payback building', 100, 10); // payback 10
    const wizard = candidate('Wizard tower', 100, 0.001, AUTO_PREF_WIZARD); // payback 100,000s

    const d = autoDecide([ordinary, wizard], ctx({ bank: 1000, income: 10 }));

    expect(d.buy?.name).toBe('Wizard tower');
    expect(d.why).toBe('wizard target');
  });

  it('keeps buying Wizard towers while a far-off golden upgrade waits, and only saves for it in reach', () => {
    // a quadrillion golden upgrade, years away at 1e6/s, and a Wizard tower costing billions
    const golden = candidate('Golden upgrade', 1e15, 1e5, AUTO_PREF_GOLDEN);
    const wizard = candidate('Wizard tower', 2e9, 1, AUTO_PREF_WIZARD);

    const far = autoDecide([golden, wizard], ctx({ cps: 1e6, income: 1e6, bank: 3e9, reserve: 0 }));
    expect(far.buy?.name).toBe('Wizard tower');
    expect(far.save).toBeNull();

    // in reach (1e15 - 3e9 at 1e12/s = ~1000s): saved for, and the Wizard tower still goes out
    const near = autoDecide([golden, wizard], ctx({ cps: 1e12, income: 1e12, bank: 3e9, reserve: 0 }));
    expect(near.buy?.name).toBe('Wizard tower');
    expect(near.save?.name).toBe('Golden upgrade');
  });

  it('does not save for anything beyond the in-reach window', () => {
    const wizard = candidate('Wizard tower', 10000, 1, AUTO_PREF_WIZARD); // wait = 100s at income 100

    // reachSec = 10: 100s to afford it is NOT in reach, so the bot does not queue it as a
    // save target and buys nothing.
    const d = autoDecide([wizard], ctx({ bank: 0, income: 100, reserve: 0, cfg: { insignificantShare: 0.001, goodFactor: 1.2, biggerImpact: 3, reachSec: 10 } }));

    expect(d.buy).toBeNull();
    expect(d.save).toBeNull();
    expect(d.note).toBe('nothing in reach');
  });

  it('saves for a preferred candidate first when nothing is affordable', () => {
    const ordinary = candidate('Big building', 10000, 100); // pp 100
    const wizard = candidate('Wizard tower', 5000, 25, AUTO_PREF_WIZARD); // pp 200

    const d = autoDecide([ordinary, wizard], ctx({ bank: 0, income: 100, reserve: 0 }));

    expect(d.buy).toBeNull();
    expect(d.save?.name).toBe('Wizard tower');
  });

  it('reports a save target alongside an unrelated buy happening the same tick', () => {
    // A cheap, affordable, preferred candidate (exempt from postponement) buys immediately...
    const wizard = candidate('Wizard tower', 50, 0.5, AUTO_PREF_WIZARD); // affordable, preferred, payback 100
    // ...while a big, not-yet-affordable, good-deal candidate (pp 99 + 10 <= 1.2 x 100) is
    // independently being saved for. It must not be crowded out of `save` just because something
    // else is bought this tick.
    const big = candidate('Big building', 10000, 1000); // payback 10, not affordable

    const d = autoDecide([wizard, big], ctx({ bank: 50, income: 100, reserve: 0 }));

    expect(d.buy?.name).toBe('Wizard tower');
    expect(d.save?.name).toBe('Big building');
  });

  it('does not save for a terrible deal just because a far better one is slightly out of reach', () => {
    // The shipment-101 case: at 3.5 CpS a 6000 shipment worth 0.003% of CpS is in reach
    // (1714s), an 8000 upgrade worth +2% CpS is just past reachSec (2286s). Measured only
    // against what is in reach, the shipment would be "the best deal" and the save target.
    const shipment = candidate('Shipment', 6000, 0.00003 * 3.5);
    const upgrade = candidate('+2% upgrade', 8000, 0.02 * 3.5);

    const d = autoDecide([shipment, upgrade], ctx({ cps: 3.5, income: 3.5, bank: 0, reserve: 0 }));

    expect(d.buy).toBeNull();
    expect(d.save).toBeNull();
    expect(d.note).toBe('nothing worth saving for in reach');
  });

  it('saves for the far better option once it comes into reach, holding the bad one back', () => {
    // Same pair with 6000 banked: the shipment is affordable, but the upgrade is now 571s away,
    // a good deal with ~670x the impact, so the shipment is postponed in favor of saving for it.
    const shipment = candidate('Shipment', 6000, 0.00003 * 3.5);
    const upgrade = candidate('+2% upgrade', 8000, 0.02 * 3.5);

    const d = autoDecide([shipment, upgrade], ctx({ cps: 3.5, income: 3.5, bank: 6000, reserve: 0 }));

    expect(d.buy).toBeNull();
    expect(d.save?.name).toBe('+2% upgrade');
  });

  it('saves for a research step whose impact is diluted by its delay instead of dumping the bank on worse deals', () => {
    // The One mind case: cps 11.3T, 9Q banked, One mind costs 16Q. As a chain step its dCps is
    // cost / (chain payback incl. ~6h of wrinkler delay) -> payback ~22,000s, impact only ~6.4%.
    // An 8Q upgrade worth +2.5% CpS (payback ~28,000s) has well over a third of that impact, so the
    // impact rule alone never held it back; but One mind, even counting the wait, is the better
    // deal, so the upgrade must wait.
    const cps = 11.3e12;
    const oneMind = candidate('One mind', 16e15, 16e15 / 22_000);
    const upgrade = candidate('8Q upgrade', 8e15, 0.025 * cps);

    const d = autoDecide([oneMind, upgrade], ctx({ cps, income: cps, bank: 9e15, reserve: 0 }));

    expect(d.buy).toBeNull();
    expect(d.save?.name).toBe('One mind');
  });

  it('still buys an affordable option that is a better deal than the save target', () => {
    const cps = 11.3e12;
    const oneMind = candidate('One mind', 16e15, 16e15 / 22_000);
    const great = candidate('Great upgrade', 2e15, 2e15 / 5_000); // payback 5,000s

    const d = autoDecide([oneMind, great], ctx({ cps, income: cps, bank: 9e15, reserve: 0 }));

    expect(d.buy?.name).toBe('Great upgrade');
  });
});

describe('shopPickAt (AUTO-9: no press without a purchase)', () => {
  const cand = (name: string, cost: number) => ({ name, cost }) as unknown as PurchaseCandidate;
  const row = (c: PurchaseCandidate) => ({ c }) as DecisionRow;
  const a = cand('A', 100);
  const b = cand('B', 50);

  it('buys the item the paw is at when it is still the pick', () => {
    expect(shopPickAt({ buy: a, buyable: [row(a), row(b)] }, 'A', 1000)!.c).toBe(a);
  });

  it('still buys it when it is one of this tick\'s purchases and leaves enough for the pick', () => {
    expect(shopPickAt({ buy: a, buyable: [row(a), row(b)] }, 'B', 150)!.c).toBe(b);
    expect(shopPickAt({ buy: a, buyable: [row(a), row(b)] }, 'B', 149)).toBeNull();
  });

  it('refuses when the plan changed its mind (held back, or nothing to buy)', () => {
    expect(shopPickAt({ buy: a, buyable: [row(a)] }, 'B', 1e9)).toBeNull();
    expect(shopPickAt({ buy: null }, 'A', 1e9)).toBeNull();
  });
});
