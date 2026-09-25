import { describe, expect, it } from 'vitest';
import { copiesCost, dumpCopies, planAchievementDump, type DumpBuilding } from '../../src/autoplay/achievement-dump';

function b(name: string, id: number, amount: number, price: number, unwon: number[]): DumpBuilding {
  return { name, id, amount, price, unwon };
}

describe('copiesCost (the game\'s 1.15x per copy)', () => {
  it('sums the geometric prices', () => {
    expect(copiesCost(100, 0, 1)).toBeCloseTo(100);
    expect(copiesCost(100, 0, 2)).toBeCloseTo(100 + 115);
    expect(copiesCost(100, 1, 1)).toBeCloseTo(115);
    expect(copiesCost(100, 0, 0)).toBe(0);
  });
});

describe('planAchievementDump (ASC-13)', () => {
  it('buys the cheapest achievements first until the bank runs out', () => {
    const plan = planAchievementDump(
      [
        b('Cursor', 0, 98, 1000, [100, 150]), // 2 copies: 2,150
        b('Farm', 2, 49, 5000, [50, 100]), // 1 copy: 5,000
        b('Mine', 3, 0, 20000, [1, 50]), // 1 copy: 20,000
      ],
      10000,
    );
    expect(plan.map((s) => `${s.name}->${s.target}`)).toEqual(['Cursor->100', 'Farm->50']);
    expect(plan[0]!.count).toBe(2);
    expect(dumpCopies(plan)).toBe(3);
  });

  it("prices a building's next achievement from where the plan left it", () => {
    // 1 copy to 1 (100), then 49 more to 50 from 1 owned
    const plan = planAchievementDump([b('Mine', 3, 0, 100, [1, 50])], 1e9);
    expect(plan.map((s) => s.target)).toEqual([1, 50]);
    expect(plan[1]!.cost).toBeCloseTo(copiesCost(100, 1, 49));
  });

  it('skips a building with nothing left to win', () => {
    expect(planAchievementDump([b('Cursor', 0, 700, 1, [])], 1e30)).toEqual([]);
  });
});
