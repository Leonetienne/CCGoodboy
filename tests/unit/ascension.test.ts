import { beforeEach, describe, expect, it } from 'vitest';
import { AscensionPlanner, ASC_INCOME_WINDOW_MS, compactLine, heavenLines, heavenScreenLines, planLines, savingProgress, verdictLines } from '../../src/autoplay/ascension';
import { heavenlyStyle, legacyLabelLines } from '../../src/autoplay/ascension-overlay';
import { cookiesForLevel, levelForBoost, levelForCookies, luckyMinDigit, planAscension, type AscensionInput } from '../../src/autoplay/ascension-strategy';
import { countSevens, countSevensFrom, luckyWindowEnd, nextLevelWithSevens, nextLuckyTarget } from '../../src/autoplay/heavenly-shopping';
import { PersistedData } from '../../src/core/persisted-data';
import type { HeavenlyUpgradeInfo } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function up(name: string, price: number, parents: string[], bought = false, id = 0): HeavenlyUpgradeInfo {
  return { id, name, price, bought, parents, canBePurchased: false };
}

/** The golden chain of the heavenly tree with the game's prices. */
function luckyTree(owned: string[] = []): HeavenlyUpgradeInfo[] {
  const list = [
    up('Legacy', 1, []),
    up('Heavenly cookies', 3, ['Legacy']),
    up('Heavenly luck', 77, ['Heavenly cookies']),
    up('Lasting fortune', 777, ['Heavenly luck']),
    up('Decisive fate', 7777, ['Lasting fortune']),
    up('Lucky digit', 777, ['Heavenly luck']),
    up('Lucky number', 77777, ['Lucky digit', 'Lasting fortune']),
    up('Lucky payout', 77777777, ['Lucky number', 'Decisive fate']),
  ];
  return list.map((u) => ({ ...u, bought: owned.includes(u.name) }));
}

/** All-time cookies just past `level` (exactly on the boundary the cube root can land a hair
 * below it, which the game floors the same way). */
function atLevel(level: number): number {
  return cookiesForLevel(level, 3) * (1 + 1e-9);
}

const ALL_BUT_LUCKY = ['Legacy', 'Heavenly cookies', 'Heavenly luck', 'Lasting fortune', 'Decisive fate'];

function input(over: Partial<AscensionInput> = {}): AscensionInput {
  return {
    prestige: 0,
    heavenlyChips: 0,
    totalCookies: 0,
    hcFactor: 3,
    income: 0,
    runSec: 3600,
    heavenly: [],
    luckyWaitSec: 86400,
    shopWaitSec: 21600,
    shopWaitShare: 0.1,
    // gate off: these fixtures are about stagnation and lucky levels (ASC-8 has its own tests)
    minBoost: 1,
    ...over,
  };
}

describe('countSevens / nextLevelWithSevens (lucky upgrades showIf)', () => {
  it('counts the 7s anywhere in the level, like the game', () => {
    expect(countSevens(1234)).toBe(0);
    expect(countSevens(1774)).toBe(2);
    expect(countSevens(70707)).toBe(3);
    expect(countSevens(7777)).toBe(4);
  });

  it('finds the nearest level with enough 7s', () => {
    expect(nextLevelWithSevens(7, 1)).toBe(7);
    expect(nextLevelWithSevens(8, 1)).toBe(17);
    expect(nextLevelWithSevens(100, 2)).toBe(177);
    expect(nextLevelWithSevens(1000, 4)).toBe(7777);
    expect(nextLevelWithSevens(7778, 4)).toBe(17777);
    expect(nextLevelWithSevens(1_000_000_000, 4)).toBe(1_000_007_777);
  });
});

describe('aiming the 7s at digits that hold still (ASC-15)', () => {
  it('picks the lowest digit whose value holds long enough', () => {
    expect(luckyMinDigit(60, 30)).toBe(0); // a level a minute: the last digit is fine
    expect(luckyMinDigit(5, 30)).toBe(1); // 10 levels = 50s
    expect(luckyMinDigit(0.1, 30)).toBe(3); // 1,000 levels = 100s
    expect(luckyMinDigit(Infinity, 30)).toBe(0);
  });

  it('counts only the 7s at that digit and above', () => {
    expect(countSevensFrom(1777, 0)).toBe(3);
    expect(countSevensFrom(1777, 2)).toBe(1); // "17"
    expect(countSevensFrom(1777, 3)).toBe(0); // "1"
  });

  it('skips a lucky level whose window is almost over (ASC-12)', () => {
    expect(luckyWindowEnd(1_177_950, 2, 3)).toBe(1_177_999); // 1,178,000 has one 7 only
    expect(luckyWindowEnd(1_177_950, 1, 3)).toBe(1_178_999); // ... enough for one
    expect(luckyWindowEnd(1107, 1, 0)).toBe(1107);
    expect(luckyWindowEnd(1170, 1, 0)).toBe(1179);
    expect(luckyWindowEnd(1170, 0, 0)).toBe(Infinity);
    // inside the block with 50 levels left: fine for 10, not for 500
    expect(nextLuckyTarget(1_177_950, 2, 3, 10)).toBe(1_177_950);
    expect(nextLuckyTarget(1_177_950, 2, 3, 500)).toBe(1_277_000);
    expect(nextLuckyTarget(1_000_000, 1, 3, 500)).toBe(1_007_000);
  });

  it('finds the first level whose upper digits have the 7s, the lower ones free', () => {
    expect(nextLevelWithSevens(1_000_000, 1, 3)).toBe(1_007_000);
    expect(nextLevelWithSevens(1_007_450, 1, 3)).toBe(1_007_450); // already inside the block
    expect(nextLevelWithSevens(1_000_000, 2, 2)).toBe(1_007_700);
  });

  it('plans a lucky level whose 7s hold through the last steps, not one that flips at once', () => {
    // ~10 levels per second near level 1,100,000: the last digits flip far too fast
    const level = 1_100_000;
    const levelCost = cookiesForLevel(level + 1, 3) - cookiesForLevel(level, 3);
    const p = planAscension(
      input({
        prestige: 1_000_000,
        heavenlyChips: 700,
        totalCookies: atLevel(level),
        income: levelCost * 10,
        runSec: 3600,
        heavenly: luckyTree(ALL_BUT_LUCKY),
      }),
    );
    expect(p.luckyDigit).toBe(3); // 1,000 levels = 100s >= 30s
    // the chips pay for Lucky number too: the first level with two 7s above the free digits
    expect(p.shop.level).toBe(1_177_000);
    expect(p.shop.waitFor).toBe('Lucky number');
    expect(p.shop.items.map((i) => i.name)).toEqual(['Lucky digit', 'Lucky number']);
  });
});

describe('prestige math (Game.HowMuchPrestige)', () => {
  it('turns cookies into levels and back', () => {
    expect(levelForCookies(1e12, 3)).toBe(1);
    expect(levelForCookies(8e12 - 1, 3)).toBe(1);
    expect(levelForCookies(atLevel(1000), 3)).toBe(1000);
    // exactly on the boundary the float cube root floors one level lower, as in the game
    expect(levelForCookies(1000 ** 3 * 1e12, 3)).toBe(999);
    expect(cookiesForLevel(10, 3)).toBe(1e15);
  });
});

describe('planAscension (ASC-2..4/9)', () => {
  it('has nothing to gain below one level', () => {
    const p = planAscension(input({ totalCookies: 5e11 }));
    expect(p.gain).toBe(0);
    expect(p.verdict).toBe('no-gain');
    expect(p.cookiesToNextLevel).toBeCloseTo(5e11);
  });

  it('adds the gain to the chips', () => {
    const p = planAscension(input({ prestige: 1000, heavenlyChips: 50, totalCookies: atLevel(1100) }));
    expect(p.pendingLevel).toBe(1100);
    expect(p.gain).toBe(100);
    expect(p.chipsAfter).toBe(150);
  });

  it('keeps growing while the marginal level rate beats the run average', () => {
    // level 1100 costs 3 x 1100^2 x 1e12 ~ 3.6e18 per level; 1e16/s -> ~10 levels/h; avg 100 levels over 24h ~ 4/h
    const p = planAscension(input({ prestige: 1000, totalCookies: atLevel(1100), income: 1e16, runSec: 24 * 3600 }));
    expect(p.rateNow).toBeGreaterThan(p.rateAvg);
    expect(p.verdict).toBe('growing');
  });

  it('would ascend once the run stagnates', () => {
    const p = planAscension(input({ prestige: 1000, totalCookies: atLevel(1100), income: 1e14, runSec: 24 * 3600 }));
    expect(p.stagnating).toBe(true);
    expect(p.verdict).toBe('ascend');
  });

  it('waits for an affordable lucky level within the lucky wait (ASC-9)', () => {
    // pending 1100 has no 7; Lucky digit at 1107 is 7 levels (~2.6e19 cookies) away at 1e16/s = ~43min
    const p = planAscension(
      input({
        prestige: 1000,
        heavenlyChips: 700,
        totalCookies: atLevel(1100),
        income: 1e16,
        heavenly: luckyTree(ALL_BUT_LUCKY),
      }),
    );
    expect(p.stagnating).toBe(true);
    expect(p.shop.level).toBe(1107);
    expect(p.shop.waitFor).toBe('Lucky digit');
    expect(p.shop.items.map((i) => i.name)).toEqual(['Lucky digit']);
    expect(p.verdict).toBe('waiting');
    expect(p.shop.etaSec).toBeGreaterThan(0);
  });

  it('goes for the higher lucky tier too when it is within the wait', () => {
    // pending 1170 already has one 7; 1177 has two
    const p = planAscension(
      input({
        prestige: 0,
        heavenlyChips: 100000,
        totalCookies: atLevel(1170),
        income: 5e16, // ~80s per level: the last digit holds the 60s
        heavenly: luckyTree(ALL_BUT_LUCKY),
      }),
    );
    expect(p.shop.items.map((i) => i.name)).toEqual(['Lucky digit', 'Lucky number']);
    expect(p.shop.level).toBe(1177);
    expect(p.shop.waitFor).toBe('Lucky number');
    expect(p.verdict).toBe('waiting');
  });

  it('ascends at once when the pending level already has the 7s', () => {
    const p = planAscension(
      input({
        prestige: 1000,
        heavenlyChips: 700,
        totalCookies: atLevel(1107),
        income: 1e14,
        runSec: 24 * 3600,
        heavenly: luckyTree(ALL_BUT_LUCKY),
      }),
    );
    expect(p.shop.level).toBe(1107);
    expect(p.verdict).toBe('ascend');
    expect(verdictLines(p)[0]).toBe('ASCEND NOW');
    expect(heavenLines(p.shop)).toEqual(['Buy in heaven: 1 upgrade (777 chips)']);
  });

  it('does not wait past the lucky wait setting', () => {
    const p = planAscension(
      input({
        prestige: 1000,
        heavenlyChips: 700,
        totalCookies: atLevel(1100),
        income: 1e16,
        heavenly: luckyTree(ALL_BUT_LUCKY),
        luckyWaitSec: 60,
      }),
    );
    expect(p.shop.skippedLucky.map((w) => w.name)).toContain('Lucky digit');
    expect(p.verdict).toBe('ascend');
  });

  it('does not wait for a lucky upgrade whose chips are days away', () => {
    // 777 chips from 0: level 1777, ~5 days at 1e16/s
    const p = planAscension(
      input({
        prestige: 1000,
        heavenlyChips: 0,
        totalCookies: atLevel(1100),
        income: 1e16,
        heavenly: luckyTree(ALL_BUT_LUCKY),
      }),
    );
    expect(p.shop.skippedLucky.find((w) => w.name === 'Lucky digit')?.level).toBe(1777);
    expect(p.verdict).toBe('ascend');
  });

  it('knows the window of levels that keep the 7s the list needs (ASC-12)', () => {
    // 1107 has one 7; 1108 has none
    const p = planAscension(input({ prestige: 1000, heavenlyChips: 700, totalCookies: atLevel(1107), income: 1e16, runSec: 3600, heavenly: luckyTree(ALL_BUT_LUCKY) }));
    expect(p.shop.sevens).toBe(1);
    expect(p.shop.level).toBe(1107);
    expect(p.luckyEnd).toBe(1107);

    // 1170 .. 1179 all have a 7
    const q = planAscension(input({ prestige: 1000, heavenlyChips: 700, totalCookies: atLevel(1170), income: 1e16, runSec: 3600, heavenly: luckyTree(ALL_BUT_LUCKY) }));
    expect(q.luckyEnd).toBe(1179);

    // nothing lucky on the list: any level will do
    const r = planAscension(input({ prestige: 1000, totalCookies: atLevel(1100), income: 1e16 }));
    expect(r.shop.sevens).toBe(0);
    expect(r.luckyEnd).toBe(Infinity);
  });

  it('times the routine with its own income: no wrinklers, nothing clicked (ASC-12)', () => {
    // measured 1e16/s (fat wrinklers): a 10 min routine would cover ~1.6 levels, past 1107
    const base = { prestige: 1000, heavenlyChips: 700, totalCookies: atLevel(1107), income: 1e16, runSec: 3600, heavenly: luckyTree(ALL_BUT_LUCKY) };
    const fast = planAscension(input({ ...base, leadSec: 600, routineIncome: 1e16 }));
    expect(fast.shop.level).toBe(1117);
    expect(fast.routineEtaSec).toBeCloseTo((cookiesForLevel(1117, 3) - atLevel(1107)) / 1e16, 0);
    // but only 1e15/s once they are popped: 1107 easily outlasts the routine
    const p = planAscension(input({ ...base, leadSec: 600, routineIncome: 1e15 }));
    expect(p.shop.level).toBe(1107);
    expect(p.routineEtaSec).toBe(0);
    // no routine income at all: never on its way
    expect(planAscension(input({ ...base, totalCookies: atLevel(1100), leadSec: 600, routineIncome: 0 })).routineEtaSec).toBe(Infinity);
  });

  it('only aims at a lucky level still ahead once the routine before ascending is done (ASC-12)', () => {
    // pending 1107 has its 7 now, but ~6 min per level: after a 10 min routine it is gone
    const base = { prestige: 1000, heavenlyChips: 700, totalCookies: atLevel(1107), income: 1e16, runSec: 3600, heavenly: luckyTree(ALL_BUT_LUCKY) };
    expect(planAscension(input(base)).shop.level).toBe(1107);

    const p = planAscension(input({ ...base, leadSec: 600 }));
    expect(p.shop.level).toBe(1117);
    expect(p.luckyEnd).toBe(1117);
    expect(p.verdict).toBe('waiting');
    expect(p.shop.etaSec).toBeGreaterThan(600);
  });

  it('does not wait 25K chips for Unholy bait on top of a +47,826 ascension (ASC-9)', () => {
    const p = planAscension(
      input({
        prestige: 4317,
        totalCookies: atLevel(52143),
        income: 2e22, // the 21K extra levels would come within the 6h budget
        heavenly: [
          { id: 1, name: 'Heavenly cookies', price: 24700, bought: false, parents: [], canBePurchased: true },
          { id: 2, name: 'Unholy bait', price: 44444, bought: false, parents: [], canBePurchased: true },
        ],
      }),
    );
    expect(p.shop.items.map((i) => i.name)).toEqual(['Heavenly cookies']);
    expect(p.shop.next?.name).toBe('Unholy bait');
    expect(p.shop.next!.etaSec).toBeLessThan(21600);
    expect(p.verdict).toBe('ascend');

    // a few chips short (within 10% of the gain): worth the wait
    const q = planAscension(
      input({
        prestige: 4317,
        heavenlyChips: 19000,
        totalCookies: atLevel(52143),
        income: 2e22,
        heavenly: [
          { id: 1, name: 'Heavenly cookies', price: 24700, bought: false, parents: [], canBePurchased: true },
          { id: 2, name: 'Unholy bait', price: 44444, bought: false, parents: [], canBePurchased: true },
        ],
      }),
    );
    expect(q.shop.waitFor).toBe('Unholy bait');
    expect(q.verdict).toBe('waiting');
  });

  it('has nothing to buy once every lucky upgrade is owned', () => {
    const p = planAscension(input({ heavenly: luckyTree([...ALL_BUT_LUCKY, 'Lucky digit', 'Lucky number', 'Lucky payout']) }));
    expect(p.shop.items).toEqual([]);
    expect(p.shop.skippedLucky).toEqual([]);
  });

  it('never waits without income', () => {
    const p = planAscension(input({ prestige: 1000, heavenlyChips: 1000, totalCookies: atLevel(1100), heavenly: luckyTree(ALL_BUT_LUCKY) }));
    expect(p.shop.skippedLucky.find((w) => w.name === 'Lucky digit')?.etaSec).toBe(Infinity);
  });
});

describe('noticeable impact gate (ASC-8)', () => {
  it('needs the prestige bonus to grow by the minimum boost', () => {
    expect(levelForBoost(0, 2)).toBe(100);
    expect(levelForBoost(1000, 2)).toBe(2100);
    expect(levelForBoost(1000, 1)).toBe(1001);
  });

  it('never ascends for 10 levels from 0, however stagnant the run', () => {
    const p = planAscension(input({ prestige: 0, totalCookies: atLevel(10), income: 1, runSec: 100 * 3600, minBoost: 2 }));
    expect(p.stagnating).toBe(true);
    expect(p.boost).toBeCloseTo(1.1);
    expect(p.verdict).toBe('too-small');
    expect(p.neededLevel).toBe(100);
    expect(verdictLines(p)).toEqual(['NOT YET: too few levels to be worth it', expect.stringMatching(/^CpS bonus would grow x1\.10, wanted x2\.00 \(level 100, ~/)]);
  });

  it('ascends once the boost is reached and the run stagnates', () => {
    const p = planAscension(input({ prestige: 1000, totalCookies: atLevel(2100), income: 1e14, runSec: 24 * 3600, minBoost: 2 }));
    expect(p.boost).toBeCloseTo(2);
    expect(p.verdict).toBe('ascend');
  });

  it('looks for lucky levels only from the needed level on', () => {
    // pending 17 has a 7, but the first level worth ascending at is 100 -> Lucky digit at 107
    const p = planAscension(input({ prestige: 0, heavenlyChips: 1000, totalCookies: atLevel(17), income: 1e12, minBoost: 2, heavenly: luckyTree(ALL_BUT_LUCKY) }));
    expect(p.verdict).toBe('too-small');
    expect(p.shop.skippedLucky.find((w) => w.name === 'Lucky digit')?.level).toBe(107);
  });
});

describe('AscensionPlanner', () => {
  let data: PersistedData;
  let game: FakeGameAdapter;
  let planner: AscensionPlanner;

  beforeEach(() => {
    localStorage.clear();
    data = new PersistedData();
    game = new FakeGameAdapter();
    planner = new AscensionPlanner(data, game);
  });

  it('measures income from all-time cookies once there is history', () => {
    game.unbuffedCps = 5;
    expect(planner.measuredIncome(0, 1000)).toBe(5);
    expect(planner.measuredIncome(60_000, 2000)).toBe(5); // < 2 min: still CpS
    expect(planner.measuredIncome(180_000, 19000)).toBeCloseTo(100);
  });

  it('forgets samples older than the window', () => {
    const W = ASC_INCOME_WINDOW_MS;
    // 10 cookies/ms for the first window, then 1 cookie/ms
    const total = (t: number) => (t < W ? 10 * t : 10 * W + (t - W));
    for (let t = 0; t < 2 * W + 20_000; t += 10_000) planner.measuredIncome(t, total(t));
    // the fast first window has dropped out: 1 cookie/ms = 1000/s
    expect(planner.measuredIncome(2 * W + 20_000, total(2 * W + 20_000))).toBeCloseTo(1000);
  });

  it('shows nothing on a fresh save', () => {
    expect(planner.statusText()).toBe('');
  });

  it('says an ascension is too small with the default 2x boost', () => {
    game.cookiesEarned = atLevel(10);
    game.unbuffedCps = 1;
    game.runStartDate = Date.now() - 100 * 3600 * 1000;
    expect(planner.statusText()).toMatch(/^NOT YET: too few levels to be worth it; CpS bonus would grow x1\.10, wanted x2\.00 \(level 100, .*\); Prestige: 0 -> 10; CpS bonus after ascending: x1\.10; Heavenly chips to spend: 10$/);
  });

  it('describes the pending level and plan', () => {
    game.prestige = 1000;
    game.cookiesReset = cookiesForLevel(1000, 3);
    game.cookiesEarned = atLevel(1100) - game.cookiesReset;
    game.unbuffedCps = 1e14;
    game.runStartDate = Date.now() - 24 * 3600 * 1000;
    data.config.ascendMinBoost = 1;
    expect(planner.statusText()).toMatch(/^ASCEND NOW; .*; Prestige: 1,000 -> 1,100; CpS bonus after ascending: x1\.09; Heavenly chips to spend: 100; Buy in heaven: nothing$/);
    expect(planner.statusText('Paw: ascending now')).toMatch(/; Paw: ascending now$/);
  });

  it('has no plan while ascending, but tells the chips on the ascension screen', () => {
    game.ascending = true;
    game.ascendScreen = true;
    game.heavenlyChips = 1234;
    expect(planner.plan()).toBeNull();
    expect(planner.statusText()).toBe('NOTHING TO BUY: click Reincarnate; you have 1.23K chips');
  });

  it('plans the purchases with the chips on the ascension screen, without waiting', () => {
    game.ascending = true;
    game.ascendScreen = true;
    game.prestige = 1107;
    game.heavenlyChips = 1000;
    game.heavenlyUpgrades = luckyTree(ALL_BUT_LUCKY);
    const shop = planner.shoppingNow()!;
    // 1107 has one 7: Lucky digit (777) fits, Lucky number needs two 7s and 77,777 chips
    expect(shop.items.map((i) => i.name)).toEqual(['Lucky digit']);
    expect(shop.level).toBe(1107);
  });
});

describe('ascension overlay (ASC-6/7)', () => {
  it('labels the Legacy button with current + new = total and the plan', () => {
    const p = planAscension(
      input({ prestige: 1000, heavenlyChips: 700, totalCookies: atLevel(1100), income: 1e16, heavenly: luckyTree(ALL_BUT_LUCKY) }),
    );
    const lines = legacyLabelLines(p);
    expect(lines[0]).toMatch(/^WAIT: ascend at level 1,107 \(~\d+m \d+s\)$/);
    expect(lines[1]).toBe('then the chips also pay for Lucky digit');
    expect(lines[2]).toBe('Prestige: 1,000 -> 1,100');
    expect(lines[3]).toBe('CpS bonus after ascending: x1.09');
    expect(lines[4]).toBe('Heavenly chips to spend: 800');
    expect(lines[5]).toBe('Buy in heaven: 1 upgrade (777 chips)');
    // collapsed: just the level after ascending and the answer
    expect(compactLine(p)).toBe('Lv 1,100 \u00b7 WAIT');
    expect(legacyLabelLines(p, 'Paw: will ascend by itself at level 1,107').at(-1)).toBe('Paw: will ascend by itself at level 1,107');
  });

  it('leaves the heaven lines out while ascending is not on the table', () => {
    const p = planAscension(input({ prestige: 1000, totalCookies: atLevel(1100), income: 1e16, runSec: 24 * 3600 }));
    expect(p.verdict).toBe('growing');
    expect(planLines(p)[0]).toBe('NOT YET: prestige still comes in fast');
    expect(planLines(p).some((l) => l.startsWith('Buy in heaven'))).toBe(false);
  });

  it('says plainly that the next wish comes later, and how much the leftovers cover', () => {
    const shop = { level: 100, etaSec: 0, items: [{ name: 'A', price: 30 }], cost: 30, chipsAt: 50, waitFor: null, skippedLucky: [], sevens: 0, next: { name: 'Unholy bait', cost: 80, level: 160, etaSec: 600 } };
    expect(savingProgress(shop)).toEqual({ have: 20, need: 80, share: 0.25 });
    expect(heavenLines(shop)).toEqual(['Buy in heaven: 1 upgrade (30 chips)', 'Later: Unholy bait (80 chips)', '  20 chips left over after buying = 25% of it']);
    expect(heavenScreenLines(shop, 50)).toEqual([
      'BUY THE PINK ONES, in order (1, 2, 3...)',
      '1 upgrade for 30 of your 50 chips',
      'then click Reincarnate',
      'Later: Unholy bait (80 chips)',
      '  20 chips left over after buying = 25% of it',
    ]);
  });

  it('styles heavenly upgrades by state', () => {
    const buyable = { ...up('Heavenly luck', 77, []), canBePurchased: true };
    expect(heavenlyStyle({ ...buyable, bought: true }, 0).width).toBe(1);
    expect(heavenlyStyle(buyable, 100).dash).toBeUndefined();
    expect(heavenlyStyle(buyable, 10).dash).toBeDefined();
    expect(heavenlyStyle({ ...buyable, canBePurchased: false }, 100).dash).toBeDefined();
    expect(heavenlyStyle({ ...up('Lucky digit', 777, []), canBePurchased: true }, 1000).width).toBe(3);
  });
});
