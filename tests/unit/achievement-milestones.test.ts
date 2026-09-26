import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_ACHIEVEMENT_NOMINAL_SHARE,
  AUTO_MILESTONE_MARGIN,
  achievementCpsShare,
  autoMilestoneValue,
  nextAchievementCount,
} from '../../src/autoplay/achievement-milestones';
import { autoCollect } from '../../src/autoplay/collector';
import { IncomeTracker } from '../../src/autoplay/income-tracker';
import { autoDecide } from '../../src/autoplay/strategy';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { AutoCollectCtx, PurchaseCandidate } from '../../src/autoplay/collector';
import type { GameBuilding, GameUpgrade } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

describe('achievementCpsShare (AUTO-15)', () => {
  it('is the nominal share without kittens', () => {
    expect(achievementCpsShare(2, [])).toBe(AUTO_ACHIEVEMENT_NOMINAL_SHARE);
  });

  it('adds each kitten: f x 1/25 / (1 + milk x f)', () => {
    // helpers 0.1 and workers 0.125 at milk 2
    const want = (0.1 * 0.04) / 1.2 + (0.125 * 0.04) / 1.25;
    expect(achievementCpsShare(2, [0.1, 0.125])).toBeCloseTo(want);
  });
});

describe('nextAchievementCount', () => {
  it('finds the next unwon count above the amount', () => {
    expect(nextAchievementCount(98, [1, 50, 100, 150])).toBe(100);
    expect(nextAchievementCount(100, [150])).toBe(150);
    expect(nextAchievementCount(10, [])).toBeNull();
  });

  it('never heads past the building cap', () => {
    expect(nextAchievementCount(55, [100], 57)).toBeNull();
  });
});

describe('autoMilestoneValue', () => {
  it('values a cheap top-off by the achievement it completes', () => {
    // 2 copies (cost 100 + 115) away from an achievement worth 10 CpS; each copy alone +0.1
    const v = autoMilestoneValue(100, 0.1, 98, 100, 215, 10);
    expect(v.milestone).toBe(100);
    expect(v.dCps).toBeCloseTo(100 / ((AUTO_MILESTONE_MARGIN * 215) / (0.2 + 10)));
    expect(v.dCps).toBeGreaterThan(0.1);
  });

  it('changes nothing when the milestone is far and costly', () => {
    const v = autoMilestoneValue(100, 1, 50, 100, 1e12, 10);
    expect(v).toEqual({ dCps: 1, milestone: null });
  });

  it('changes nothing without a milestone', () => {
    expect(autoMilestoneValue(100, 1, 50, null, 0, 10)).toEqual({ dCps: 1, milestone: null });
  });
});

describe('auto play tops buildings off to an achievement (AUTO-15)', () => {
  beforeEach(() => localStorage.clear());

  function building(name: string, amount: number, price: number, storedCps: number, id: number): GameBuilding {
    return {
      name,
      id,
      amount,
      price,
      storedCps,
      storedTotalCps: storedCps * amount,
      buy: () => {},
      getSumPrice: (n: number) => (price * (Math.pow(1.15, n) - 1)) / 0.15,
    };
  }

  /** 98 cursors (+0.1 CpS each, payback 100000s) next to a Farm (payback 10000s); CpS 1000
   * with total building CpS 1000, so the global multiplier is 1. Two kittens at milk 4 make an
   * achievement worth ~6.2 CpS: the two cursors to 100 then pay back in ~3400s together. */
  function setup(withAchievement: boolean) {
    const game = new FakeGameAdapter();
    game.buildings = [building('Cursor', 98, 10000, 0.1, 0), building('Farm', 10, 990000, 99.02, 2)];
    game.unbuffedCps = 1000;
    game.cookiesPs = 1000;
    game.cookies = 2e6;
    game.milkProgress = 4;
    game.upgrades = [{ name: 'Kitten helpers', bought: 1 } as GameUpgrade, { name: 'Kitten workers', bought: 1 } as GameUpgrade];
    if (withAchievement) game.unwonBuildingAchievementCounts = { Cursor: [100, 150] };

    const runtime = new RuntimeState();
    const g = autoCollect(game, new PersistedData(), runtime, new IncomeTracker(runtime, game));
    if ('skip' in g) throw new Error(g.skip);
    return g;
  }

  it('buys the Farm without an achievement in sight', () => {
    const g = setup(false);
    expect(autoDecide(g.cands, g.ctx).buy?.name).toBe('Farm');
  });

  it('tops the cursors off to 100 first when the achievement is two copies away', () => {
    const g = setup(true);
    const d = autoDecide(g.cands, g.ctx);
    expect(d.buy?.name).toBe('Cursor');
    expect(d.buy?.milestone).toBe(100);
  });
});

describe('an achievement top-off never locks in (AUTO-15)', () => {
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

  function cand(name: string, cost: number, dCps: number, extra: Partial<PurchaseCandidate> = {}): PurchaseCandidate {
    return { kind: 'building', type: 'building', name, obj: { name, buy: () => {} }, cost, dCps, pref: 0, ...extra };
  }

  it('judges a cheap copy by the whole top-off: held back for a better upgrade being saved for', () => {
    // one copy (50) is insignificant (<= 60s x 10 CpS), the 50 copies to the milestone (5000) are not
    const copy = cand('Cursor', 50, 0.05, { milestone: 150, projectCost: 5000 }); // payback 1000s
    const upgrade = cand('Upgrade', 2000, 20); // pp: 100s wait + 100s payback
    const d = autoDecide([copy, upgrade], ctx());

    expect(d.buy).toBeNull();
    expect(d.save?.name).toBe('Upgrade');
  });

  it('is never saved for', () => {
    const copy = cand('Cursor', 5000, 50, { milestone: 100, projectCost: 11000 });
    const d = autoDecide([copy], ctx());

    expect(d.buy).toBeNull();
    expect(d.save).toBeNull();
  });

  it('loses to an upgrade with a similar cost and a slightly worse raw payback', () => {
    // top-off: 2 copies for 2150 bringing 20 CpS (payback 107.5s) -> x1.5 margin = 161s;
    // the upgrade: 2000 for 15 CpS, payback 133s
    const v = autoMilestoneValue(1000, 0.1, 98, 100, 2150, 19.8);
    const copy = cand('Cursor', 1000, v.dCps, { milestone: 100, projectCost: 2150 });
    const upgrade = cand('Upgrade', 2000, 15);

    expect(v.milestone).toBe(100);
    expect(autoDecide([copy, upgrade], ctx({ bank: 1e5, cps: 1, income: 1 })).buy?.name).toBe('Upgrade');
  });
});
