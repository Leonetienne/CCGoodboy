import { describe, expect, it } from 'vitest';
import { autoBuildingGain } from '../../src/autoplay/building-valuation';
import { autoUpgradeGain, type UpgradeClassifyCtx } from '../../src/autoplay/upgrade-classifier';
import type { GameBuilding, GameUpgrade } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function building(game: FakeGameAdapter, name: string, id: number, amount: number, storedCps: number): GameBuilding {
  const b: GameBuilding = { name, id, amount, storedCps, storedTotalCps: storedCps * amount, buy: () => {} };
  game.buildings.push(b);
  game.buildingsByName[name] = b;
  return b;
}

function upgrade(game: FakeGameAdapter, name: string, extra: Partial<GameUpgrade> = {}): GameUpgrade {
  const up: GameUpgrade = { name, buy: () => {}, ...extra };
  game.upgrades.push(up);
  game.upgradesByName[name] = up;
  return up;
}

function ctx(overrides: Partial<UpgradeClassifyCtx> = {}): UpgradeClassifyCtx {
  return { cps: 1000, mult: 2, biscuitBase: null, cursor: null, nonCursor: 0, clickUnit: 1, clicksPerSec: 0, ...overrides };
}

describe('synergy upgrades (Synergies Vol. I/II)', () => {
  it('values a synergy upgrade by both buildings boosting each other', () => {
    const game = new FakeGameAdapter();
    const mine = building(game, 'Mine', 3, 100, 10); // total 1000
    const wiz = building(game, 'Wizard tower', 7, 57, 100); // total 5700
    const up = upgrade(game, 'Seismic magic', {
      desc: 'Mines gain <b>+5%</b> CpS per wizard tower.<br>Wizard towers gain <b>+0.1%</b> CpS per mine.',
      buildingTie1: mine,
      buildingTie2: wiz,
    });

    const g = autoUpgradeGain(game, up, ctx());
    expect(g!.type).toBe('synergy');
    // x2 mult: mines 1000 x 5% x 57 = 2850, towers 5700 x 0.1% x 100 = 570
    expect(g!.gain).toBeCloseTo(2 * (2850 + 570));
  });

  it('adds the partner boost to a building on either side of a bought synergy', () => {
    const game = new FakeGameAdapter();
    const mine = building(game, 'Mine', 3, 100, 10);
    const wiz = building(game, 'Wizard tower', 7, 57, 100);
    upgrade(game, 'Seismic magic', { bought: 1, buildingTie1: mine, buildingTie2: wiz });

    // one more tower: mines' factor 1 + 5% x 57 grows by 5%
    expect(autoBuildingGain(game, wiz, { mult: 1 })).toBeCloseTo(100 + (1000 * 0.05) / (1 + 0.05 * 57));
    // one more mine: towers' factor 1 + 0.1% x 100 grows by 0.1%
    expect(autoBuildingGain(game, mine, { mult: 1 })).toBeCloseTo(10 + (5700 * 0.001) / (1 + 0.001 * 100));
  });

  it('ignores synergies that are not bought', () => {
    const game = new FakeGameAdapter();
    const mine = building(game, 'Mine', 3, 100, 10);
    const wiz = building(game, 'Wizard tower', 7, 57, 100);
    upgrade(game, 'Seismic magic', { buildingTie1: mine, buildingTie2: wiz });

    expect(autoBuildingGain(game, wiz, { mult: 1 })).toBeCloseTo(100);
  });
});

describe('grandma upgrades when buying a grandma', () => {
  it('adds the linked building boost through buildingTie (how the game ties them)', () => {
    const game = new FakeGameAdapter();
    const grandma = building(game, 'Grandma', 1, 50, 4);
    const farm = building(game, 'Farm', 2, 40, 20); // total 800
    game.grandmaSynergyNames = ['Farmer grandmas'];
    upgrade(game, 'Farmer grandmas', { bought: 1, buildingTie: farm });

    // farms x(1 + 1% x 50 grandmas / 1): one more grandma adds 800 x 1% / 1.5
    expect(autoBuildingGain(game, grandma, { mult: 1 })).toBeCloseTo(4 + (800 * 0.01) / 1.5);
  });

  it('still values a grandma upgrade itself by its description', () => {
    const game = new FakeGameAdapter();
    building(game, 'Grandma', 1, 50, 4); // total 200
    const farm = building(game, 'Farm', 2, 40, 20);
    game.grandmaSynergyNames = ['Farmer grandmas'];
    const up = upgrade(game, 'Farmer grandmas', {
      desc: 'Grandmas are <b>twice</b> as efficient. Farms gain <b>+1%</b> CpS per grandma.',
      buildingTie: farm,
    });

    const g = autoUpgradeGain(game, up, ctx({ mult: 1 }));
    expect(g!.type).toBe('grandma');
    expect(g!.gain).toBeCloseTo(200 + 800 * 0.01 * 50);
  });
});
