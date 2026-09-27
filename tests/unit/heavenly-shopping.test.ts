import { describe, expect, it } from 'vitest';
import { HEAVENLY_VALUE, LUCKY_UPGRADES, planHeavenlyShopping, type HeavenlyShopInput } from '../../src/autoplay/heavenly-shopping';
import type { HeavenlyUpgradeInfo } from '../../src/game/types';

function up(name: string, price: number, parents: string[] = [], bought = false): HeavenlyUpgradeInfo {
  return { id: 0, name, price, bought, parents, canBePurchased: false };
}

// A small tree: A (10) -> B (100) -> C (1000); D (5) has no parent; lucky digit hangs off A.
const TREE = [up('A', 10), up('B', 100, ['A']), up('C', 1000, ['B']), up('D', 5), up('Lucky digit', 777, ['A'])];

/** 1 level per second from level 0 on: ETA to level L = L - pending. */
function shop(over: Partial<HeavenlyShopInput> = {}) {
  const pending = over.fromLevel ?? 0;
  return planHeavenlyShopping({
    heavenly: TREE,
    prestige: 0,
    heavenlyChips: 0,
    fromLevel: pending,
    etaTo: (level) => Math.max(0, level - pending),
    shopWaitSec: 0,
    luckyWaitSec: 0,
    values: { C: 2, D: 1 },
    ...over,
  });
}

describe('planHeavenlyShopping (ASC-9)', () => {
  it('buys a wish with its missing parents, parents first', () => {
    const p = shop({ fromLevel: 2000 });
    expect(p.items.map((i) => i.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(p.cost).toBe(1115);
    expect(p.level).toBe(2000);
    expect(p.waitFor).toBeNull();
    expect(p.chipsAt).toBe(2000);
  });

  it('counts owned parents as paid', () => {
    const p = shop({ fromLevel: 1100, heavenly: TREE.map((u) => (u.name === 'A' || u.name === 'B' ? { ...u, bought: true } : u)) });
    expect(p.items.map((i) => i.name)).toEqual(['C', 'D']);
    expect(p.cost).toBe(1005);
  });

  it('waits for the level that pays for the list, within the wait', () => {
    // 1110 chips for A+B+C: level 1110 is 110s away
    const p = shop({ fromLevel: 1000, shopWaitSec: 200 });
    expect(p.level).toBe(1115);
    expect(p.waitFor).toBe('D');
    expect(p.items.map((i) => i.name)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('buys what fits now and saves the best wish out of reach for next time', () => {
    // C (worth more) needs level 1110, D is affordable at once
    const p = shop({ fromLevel: 1000, shopWaitSec: 60 });
    expect(p.items.map((i) => i.name)).toEqual(['D']);
    expect(p.next).toEqual({ name: 'C', cost: 1110, level: 1115, etaSec: 115 });
    expect(p.level).toBe(1000);
  });

  it('takes the most valuable wish first, not the cheapest', () => {
    const tree = [up('P', 100), up('Q', 150)];
    const p = shop({ heavenly: tree, fromLevel: 200, values: { P: 1, Q: 5 } });
    expect(p.items.map((i) => i.name)).toEqual(['Q']);
    expect(p.next?.name).toBe('P');
  });

  it('buys a worthless parent only along with a valuable child that fits now', () => {
    const tree = [up('X', 10), up('Y', 1000, ['X'])];
    expect(shop({ heavenly: tree, fromLevel: 500, values: { Y: 5 } }).items).toEqual([]);
    expect(shop({ heavenly: tree, fromLevel: 2000, values: { Y: 5 } }).items.map((i) => i.name)).toEqual(['X', 'Y']);
  });

  it('only waits while it is a few chips short (maxExtraLevels)', () => {
    // A+B+C need level 1110 (110 levels above 1000), D then 1115
    const ok = shop({ fromLevel: 1000, shopWaitSec: 200, maxExtraLevels: 110 });
    expect(ok.items.map((i) => i.name)).toEqual(['A', 'B', 'C']);
    expect(ok.next?.name).toBe('D');
    const p = shop({ fromLevel: 1000, shopWaitSec: 200, maxExtraLevels: 100 });
    expect(p.items.map((i) => i.name)).toEqual(['D']);
    expect(p.next?.name).toBe('C');
    // lucky wishes only mind their time budget
    expect(shop({ fromLevel: 1000, values: { 'Lucky digit': 1 }, luckyWaitSec: 10, maxExtraLevels: 0 }).level).toBe(1007);
  });

  it('uses the chips owned already', () => {
    const p = shop({ fromLevel: 1000, prestige: 1000, heavenlyChips: 1200 });
    expect(p.items.map((i) => i.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(p.chipsAt).toBe(1200);
  });

  it('skips a lucky wish that is too far off without ending the list', () => {
    const p = shop({ fromLevel: 1000, values: { 'Lucky digit': 2, D: 1 }, luckyWaitSec: 1 });
    expect(p.skippedLucky.map((w) => w.name)).toEqual(['Lucky digit']);
    expect(p.items.map((i) => i.name)).toEqual(['D']);
  });

  it('keeps a lucky wish it already waits for up to twice the lucky wait (hysteresis)', () => {
    // Lucky digit's level 1007 is 7s away
    expect(shop({ fromLevel: 1000, values: { 'Lucky digit': 1 }, luckyWaitSec: 5 }).skippedLucky.map((w) => w.name)).toEqual(['Lucky digit']);
    expect(shop({ fromLevel: 1000, values: { 'Lucky digit': 1 }, luckyWaitSec: 5, luckyKeepSevens: 1 }).level).toBe(1007);
    expect(shop({ fromLevel: 1000, values: { 'Lucky digit': 1 }, luckyWaitSec: 3, luckyKeepSevens: 1 }).skippedLucky.map((w) => w.name)).toEqual(['Lucky digit']);
  });

  it('waits for a lucky level with enough 7s within the lucky wait', () => {
    const p = shop({ fromLevel: 1000, values: { 'Lucky digit': 1 }, luckyWaitSec: 10 });
    expect(p.level).toBe(1007);
    expect(p.waitFor).toBe('Lucky digit');
    expect(p.items.map((i) => i.name)).toEqual(['A', 'Lucky digit']);
  });

  it('keeps the 7s of a lucky upgrade when later wishes need more chips', () => {
    // after A + Lucky digit (787) at 1007, B + C bring it to 1887 chips: 1887 still has its 7;
    // with C at 1105 the 1892 chips would land on 1892, so the next level with a 7 is 1897
    const p = shop({ fromLevel: 1000, values: { 'Lucky digit': 2, C: 1 }, luckyWaitSec: 10, shopWaitSec: 10000 });
    expect(p.level).toBe(1887);
    const q = shop({
      fromLevel: 1000,
      heavenly: TREE.map((u) => (u.name === 'C' ? { ...u, price: 1005 } : u)),
      values: { 'Lucky digit': 2, C: 1 },
      luckyWaitSec: 10,
      shopWaitSec: 10000,
    });
    expect(q.level).toBe(1897);
  });

  it('skips names the game does not know', () => {
    const p = shop({ fromLevel: 100, values: { Nope: 5, D: 1 } });
    expect(p.items.map((i) => i.name)).toEqual(['D']);
  });

  it('has a sane default value table', () => {
    for (const l of LUCKY_UPGRADES) expect(HEAVENLY_VALUE[l.name]).toBeGreaterThan(0);
    for (const n of ['Permanent upgrade slot I', 'Permanent upgrade slot II', 'Permanent upgrade slot III', 'God', 'Chimera', 'Kitten wages', 'Cat ladies', 'Sucralosia Inutilis', 'Sugar craving', 'Keepsakes', 'Unshackled cursors', 'Unshackled flavor'])
      expect(HEAVENLY_VALUE[n]).toBeGreaterThan(0);
    for (const n of ['Sound test', 'Label printer', 'Classic dairy selection']) expect(HEAVENLY_VALUE[n]).toBe(0);
    expect(Math.max(...Object.values(HEAVENLY_VALUE))).toBe(HEAVENLY_VALUE.Legacy);
  });
});
