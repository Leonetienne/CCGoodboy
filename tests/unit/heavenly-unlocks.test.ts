import { beforeEach, describe, expect, it } from 'vitest';
import { autoCollect } from '../../src/autoplay/collector';
import { IncomeTracker } from '../../src/autoplay/income-tracker';
import { autoDecide } from '../../src/autoplay/strategy';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { GameUpgrade } from '../../src/game/types';
import { AUTO_PREF_GOLDEN } from '../../src/autoplay/valuation-tables';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function heavenlyGame(prestige: number, bank: number): FakeGameAdapter {
  const game = new FakeGameAdapter();
  game.unbuffedCps = 1000;
  game.cookiesPs = 1000;
  game.cookies = bank;
  game.prestige = prestige;
  // store upgrades have pool '' in the game (unlike the 'prestige' pool of the ascension tree)
  game.upgradesInStore = [{ name: 'Heavenly chip secret', pool: '', desc: 'Unlocks <b>5%</b> of the potential of your prestige level.', getPrice: () => 11, buy: () => {} } as GameUpgrade];
  return game;
}

function collect(game: FakeGameAdapter) {
  const runtime = new RuntimeState();
  const r = autoCollect(game, new PersistedData(), runtime, new IncomeTracker(runtime, game));
  if ('skip' in r) throw new Error(r.skip);
  return r;
}

describe('autoCollect: heavenly potential unlocks', () => {
  beforeEach(() => localStorage.clear());

  it('offers a store heavenly unlock with prestige, and auto play buys it', () => {
    const r = collect(heavenlyGame(100, 1e6));
    const c = r.cands.find((x) => x.name === 'Heavenly chip secret');

    expect(c).toMatchObject({ kind: 'upgrade', type: 'heavenly', cost: 11 });
    expect(c!.dCps).toBeCloseTo(1000 * 1 * 0.05); // prestige 100 = +100%, 5% of it unlocked

    expect(autoDecide(r.cands, r.ctx).buy?.name).toBe('Heavenly chip secret');
  });

  it('skips it without prestige (worth nothing)', () => {
    const r = collect(heavenlyGame(0, 1e6));
    expect(r.cands.find((x) => x.name === 'Heavenly chip secret')).toBeUndefined();
  });

  it('never offers the ascension-tree (prestige pool) upgrades', () => {
    const game = heavenlyGame(100, 1e6);
    game.upgradesInStore[0]!.pool = 'prestige';
    expect(collect(game).cands.find((x) => x.name === 'Heavenly chip secret')).toBeUndefined();
  });
});

describe('autoCollect: cursor doublers (AUTO-4 B)', () => {
  beforeEach(() => localStorage.clear());

  it('prefers "mouse and cursors twice as efficient" upgrades over better-rated ones', () => {
    const game = heavenlyGame(0, 1e6);
    game.upgradesInStore = [
      { name: 'Carpal tunnel prevention cream', pool: '', desc: 'The mouse and cursors are <b>twice</b> as efficient.', getPrice: () => 500, buy: () => {} } as GameUpgrade,
      { name: 'Plain butter cookies', pool: 'cookie', power: 50, desc: 'Cookie production multiplier <b>+50%</b>.', getPrice: () => 400, buy: () => {} } as GameUpgrade,
    ];
    const r = collect(game);

    expect(r.cands.find((x) => x.name === 'Carpal tunnel prevention cream')).toMatchObject({ type: 'cursor', pref: AUTO_PREF_GOLDEN });
    expect(autoDecide(r.cands, r.ctx).buy?.name).toBe('Carpal tunnel prevention cream');
  });

  it('prefers the fingers series, the mouse series and the kittens too', () => {
    const game = heavenlyGame(0, 1e6);
    game.milkProgress = 1;
    // Thousand fingers needs non-cursor buildings; sell mode would skip buildings, so a locked one
    game.buildings = [{ name: 'Grandma', amount: 10, locked: 1, price: 100 } as never];
    game.upgradesInStore = [
      { name: 'Thousand fingers', pool: '', desc: 'The mouse and cursors gain <b>+0.1</b> cookies for each non-cursor building owned.', getPrice: () => 100, buy: () => {} } as GameUpgrade,
      { name: 'Plastic mouse', pool: '', desc: 'Clicking gains <b>+1% of your CpS</b>.', getPrice: () => 100, buy: () => {} } as GameUpgrade,
      { name: 'Kitten helpers', pool: '', desc: 'You gain <b>more CpS</b> the more milk you have.', getPrice: () => 100, buy: () => {} } as GameUpgrade,
    ];
    const r = collect(game);

    expect(r.cands.map((c) => [c.type, c.pref])).toEqual([
      ['fingers', AUTO_PREF_GOLDEN],
      ['click', AUTO_PREF_GOLDEN],
      ['kitten', AUTO_PREF_GOLDEN],
    ]);
  });
});
