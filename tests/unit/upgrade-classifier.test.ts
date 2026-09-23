import { describe, expect, it } from 'vitest';
import { autoPrice, autoUpgradeGain, type UpgradeClassifyCtx } from '../../src/autoplay/upgrade-classifier';
import type { GameUpgrade } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function baseCtx(overrides: Partial<UpgradeClassifyCtx> = {}): UpgradeClassifyCtx {
  return {
    cps: 100,
    mult: 1,
    biscuitBase: null,
    cursor: null,
    nonCursor: 0,
    clickUnit: 1,
    clicksPerSec: 0,
    ...overrides,
  };
}

function upgrade(name: string, extra: Partial<GameUpgrade> = {}): GameUpgrade {
  return { name, buy: () => {}, ...extra };
}

describe('autoPrice', () => {
  it('prefers getPrice() over basePrice', () => {
    expect(autoPrice(upgrade('x', { getPrice: () => 42 }))).toBe(42);
    expect(autoPrice(upgrade('x', { basePrice: 10 }))).toBe(10);
  });
});

describe('autoUpgradeGain', () => {
  it('values a heavenly potential unlock by the prestige CpS it unlocks', () => {
    const game = new FakeGameAdapter();
    game.prestige = 100; // +100% CpS at full potential
    game.upgradeNames.add('Heavenly chip secret'); // 5% unlocked: CpS already x1.05
    const g = autoUpgradeGain(game, upgrade('Heavenly cookie stand'), baseCtx({ cps: 105 }));
    expect(g!.type).toBe('heavenly');
    expect(g!.gain).toBeCloseTo(20); // 105 / 1.05 x 0.2
  });

  it('ignores a heavenly unlock without prestige', () => {
    const game = new FakeGameAdapter();
    expect(autoUpgradeGain(game, upgrade('Heavenly chip secret'), baseCtx())).toBeNull();
  });

  it('values a known golden-cookie upgrade as a fraction of current CpS', () => {
    const game = new FakeGameAdapter();
    const g = autoUpgradeGain(game, upgrade('Lucky day'), baseCtx({ cps: 100 }));
    expect(g).toEqual({ gain: 20, type: 'golden' }); // 0.2 * 100
  });

  it('values a biscuit (cookie pool) upgrade against the current bought biscuit base', () => {
    const game = new FakeGameAdapter();
    const g = autoUpgradeGain(game, upgrade('Plain biscuit', { pool: 'cookie', power: 10 }), baseCtx({ cps: 100 }));
    // biscuitBase defaults to 1 (no other cookie upgrades bought), gain = cps * (power/100) / base
    expect(g).toEqual({ gain: 10, type: 'biscuit' });
  });

  it('values a mouse "clicking gains" upgrade using the hammer click rate', () => {
    const game = new FakeGameAdapter();
    const up = upgrade('Fingertips', { desc: 'Clicking gains +5% of your CpS.' });
    const g = autoUpgradeGain(game, up, baseCtx({ cps: 100, clicksPerSec: 8 }));

    expect(g).toEqual({ gain: 100 * 0.05 * 8, type: 'click' });
  });

  it('values a kitten upgrade by milk progress', () => {
    const game = new FakeGameAdapter();
    game.milkProgress = 0.5;
    const g = autoUpgradeGain(game, upgrade('Kitten helpers'), baseCtx({ cps: 100 }));

    expect(g).toEqual({ gain: 100 * 0.1 * 0.5, type: 'kitten' });
  });

  it('returns null for an upgrade it cannot classify', () => {
    const game = new FakeGameAdapter();
    const g = autoUpgradeGain(game, upgrade('Some mystery upgrade', { desc: 'Does something unrelated.' }), baseCtx());
    expect(g).toBeNull();
  });

  it('recognizes a grandma cofactor upgrade from its description text', () => {
    const game = new FakeGameAdapter();
    const farm = { name: 'Farm', plural: 'farms', amount: 2, storedTotalCps: 50, buy: () => {} };
    const grandma = { name: 'Grandma', amount: 4, storedTotalCps: 40, buy: () => {} };
    game.buildingsByName['Grandma'] = grandma;
    game.buildings = [farm, grandma];

    const up = upgrade('Farmer grandmas', {
      desc: 'Grandmas are twice as efficient. Farms gain +1% CpS per grandma.',
    });

    const g = autoUpgradeGain(game, up, baseCtx({ cps: 100, mult: 1 }));

    // gain = mult * (grandma.storedTotalCps + farm.storedTotalCps * (pct/100) * grandma.amount / N)
    // pct=1 (from "+1%"), N=1 (the description names no explicit "per N grandmas" group).
    expect(g?.type).toBe('grandma');
    expect(g?.gain).toBeCloseTo(40 + (50 * 0.01 * 4) / 1, 9);
  });
});
