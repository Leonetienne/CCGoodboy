import { beforeEach, describe, expect, it } from 'vitest';
import { autoCollect } from '../../src/autoplay/collector';
import { centuryEggBoost, easterEggGain, type EggClassifyCtx } from '../../src/autoplay/easter-eggs';
import { IncomeTracker } from '../../src/autoplay/income-tracker';
import { autoDecide } from '../../src/autoplay/strategy';
import { AUTO_PREF_GOLDEN } from '../../src/autoplay/valuation-tables';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { GameUpgrade } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function egg(name: string, price: number): GameUpgrade {
  return { name, pool: '', desc: 'Cost scales with how many eggs you own.', getPrice: () => price, buy: () => {} } as GameUpgrade;
}

function ctx(overrides: Partial<EggClassifyCtx> = {}): EggClassifyCtx {
  return { cps: 1000, mult: 2, biscuitBase: null, cursor: null, nonCursor: 0, clickUnit: 1, clicksPerSec: 8, bank: 0, income: 1000, reachSec: 1800, maturity: 5, ...overrides };
}

function eggGame(eggs: GameUpgrade[], bank = 1e9): FakeGameAdapter {
  const game = new FakeGameAdapter();
  game.unbuffedCps = 1000;
  game.cookiesPs = 1000;
  game.cookies = bank;
  game.upgradesInStore = eggs;
  return game;
}

function collect(game: FakeGameAdapter) {
  const runtime = new RuntimeState();
  const r = autoCollect(game, new PersistedData(), runtime, new IncomeTracker(runtime, game));
  if ('skip' in r) throw new Error(r.skip);
  return r;
}

describe('easterEggGain', () => {
  it('ignores anything that is not an egg', () => {
    expect(easterEggGain(new FakeGameAdapter(), egg('A crumbly egg', 1), ctx())).toBeNull();
  });

  it('values a common egg as +1% CpS', () => {
    expect(easterEggGain(new FakeGameAdapter(), egg('Chicken egg', 1), ctx())).toEqual({ gain: 10, type: 'egg' });
  });

  it('holds a common egg back while a rare egg in reach waits (each egg triples rare prices)', () => {
    const game = new FakeGameAdapter();
    const common = egg('Chicken egg', 1);
    game.upgradesInStore = [common, egg('Omelette', 5000)];
    expect(easterEggGain(game, common, ctx())).toBeNull(); // 5000 <= bank 0 + 1000/s x 1800s

    game.upgradesInStore = [common, egg('Omelette', 1e7)]; // out of reach: don't stall the commons
    expect(easterEggGain(game, common, ctx())).toEqual({ gain: 10, type: 'egg' });

    game.upgradesInStore = [common, egg('Chocolate egg', 5000)]; // the Chocolate egg comes last
    expect(easterEggGain(game, common, ctx())).toEqual({ gain: 10, type: 'egg' });
  });

  it('prefers every rare egg except the Chocolate egg', () => {
    const game = new FakeGameAdapter();
    expect(easterEggGain(game, egg('Omelette', 1), ctx())!.pref).toBe(AUTO_PREF_GOLDEN);
    expect(easterEggGain(game, egg('Faberge egg', 1), ctx())!.pref).toBe(AUTO_PREF_GOLDEN);
  });

  it('treats the Golden goose egg as a golden cookie upgrade (5% more golden cookies)', () => {
    const g = easterEggGain(new FakeGameAdapter(), egg('Golden goose egg', 1), ctx());
    expect(g!.type).toBe('golden');
    expect(g!.gain).toBeCloseTo(1000 * 0.2 * 0.05);
  });

  it('values Wrinklerspawn nominally without wrinklers, and as 5% of their payout at stage 1', () => {
    const game = new FakeGameAdapter();
    expect(easterEggGain(game, egg('Wrinklerspawn', 1), ctx())!.gain).toBeCloseTo(1);

    game.elderWrath = 1;
    // 1000 x 1.1 x 0.05 x 100 x 5/6 x 5%
    expect(easterEggGain(game, egg('Wrinklerspawn', 1), ctx())!.gain).toBeCloseTo(1000 * 1.1 * 5 * (5 / 6) * 0.05);
  });

  it('values the Cookie egg as 10% of the clicking income at the hammer rate', () => {
    const game = new FakeGameAdapter();
    game.computedMouseCps = 500;
    expect(easterEggGain(game, egg('Cookie egg', 1), ctx())!.gain).toBeCloseTo(500 * 8 * 0.1);
  });

  it('values "egg" as +9 base CpS and a fresh Century egg by its boost a day from now', () => {
    const game = new FakeGameAdapter();
    expect(easterEggGain(game, egg('"egg"', 1), ctx())!.gain).toBe(18);

    game.runStartDate = Date.now();
    expect(easterEggGain(game, egg('Century egg', 1), ctx())!.gain).toBeCloseTo(1000 * centuryEggBoost(1), 3);
    expect(centuryEggBoost(100)).toBeCloseTo(0.1);
    expect(centuryEggBoost(500)).toBeCloseTo(0.1);
  });

  it('offers the Chocolate egg only when its burst is worth it and no other egg waits in the store', () => {
    const choc = egg('Chocolate egg', 1000);
    const game = new FakeGameAdapter();
    game.upgradesInStore = [choc];

    expect(easterEggGain(game, choc, ctx({ bank: 30000 }))).toBeNull(); // burst 1500 < 2 x 1000
    expect(easterEggGain(game, choc, ctx({ bank: 40000 }))).toEqual({ gain: 2000, type: 'egg' });
    expect(easterEggGain(game, choc, ctx({ bank: 40000 }))!.pref).toBeUndefined();

    game.upgradesInStore = [choc, egg('Duck egg', 10)];
    expect(easterEggGain(game, choc, ctx({ bank: 40000 }))).toBeNull();
  });
});

describe('autoCollect: Easter eggs', () => {
  beforeEach(() => localStorage.clear());

  it('offers the rare eggs, all preferred, and auto play buys them', () => {
    const r = collect(eggGame([egg('Faberge egg', 999), egg('Golden goose egg', 999), egg('Omelette', 999)]));

    expect(r.cands.map((c) => c.name).sort()).toEqual(['Faberge egg', 'Golden goose egg', 'Omelette']);
    expect(r.cands.every((c) => c.pref === AUTO_PREF_GOLDEN)).toBe(true);
    expect(autoDecide(r.cands, r.ctx).why).toBe('preferred');
  });

  it('buys the rare eggs before the common ones', () => {
    const r = collect(eggGame([egg('Chicken egg', 999), egg('Faberge egg', 999), egg('Omelette', 999)]));

    expect(r.cands.map((c) => c.name).sort()).toEqual(['Faberge egg', 'Omelette']);
    expect(autoDecide(r.cands, r.ctx).buy?.name).toBe('Faberge egg'); // same tier: best payback first
  });
});
