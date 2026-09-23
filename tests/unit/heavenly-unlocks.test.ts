import { beforeEach, describe, expect, it } from 'vitest';
import { autoCollect } from '../../src/autoplay/collector';
import { IncomeTracker } from '../../src/autoplay/income-tracker';
import { autoDecide } from '../../src/autoplay/strategy';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { GameUpgrade } from '../../src/game/types';
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
