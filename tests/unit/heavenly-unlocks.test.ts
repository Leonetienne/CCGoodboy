import { beforeEach, describe, expect, it } from 'vitest';
import { clickFrenzyFactor } from '../../src/autoplay/building-valuation';
import { autoCollect } from '../../src/autoplay/collector';
import { IncomeTracker } from '../../src/autoplay/income-tracker';
import { autoDecide } from '../../src/autoplay/strategy';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { GameUpgrade } from '../../src/game/types';
import { AUTO_CLICK_VALUE_MIN, AUTO_PREF_GOLDEN } from '../../src/autoplay/valuation-tables';
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

function collect(game: FakeGameAdapter, clickBoost?: number) {
  const runtime = new RuntimeState();
  const data = new PersistedData();
  if (clickBoost != null) data.config.autoClickBoost = clickBoost;
  const r = autoCollect(game, data, runtime, new IncomeTracker(runtime, game));
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

describe('Click Frenzy value of clicking upgrades (AUTO-3)', () => {
  beforeEach(() => localStorage.clear());

  it('values a click at least the boost (default 2x), more with the golden upgrades', () => {
    const game = heavenlyGame(0, 1e6);
    expect(clickFrenzyFactor(game)).toBe(2);
    expect(clickFrenzyFactor(game, 7)).toBe(7);

    // all golden upgrades: 1 + 776 x 0.04 x 29s / 150s = ~7
    for (const n of ['Lucky day', 'Serendipity', 'Get lucky', 'Lasting fortune']) game.upgradeNames.add(n);
    expect(clickFrenzyFactor(game)).toBeCloseTo(1 + 776 * 0.04 * 29 / 150);

    // longer frenzies (Epoch Manipulator, ...): 1 + 776 x 0.04 x 60s / 150s
    game.estimateClickFrenzySec = () => 60;
    expect(clickFrenzyFactor(game)).toBeCloseTo(1 + 776 * 0.04 * 60 / 150);
  });

  it('boosts the mouse upgrades by it, and the kittens through the mouse upgrades', () => {
    const plastic = { name: 'Plastic mouse', pool: '', desc: 'Clicking gains <b>+1% of your CpS</b>.', getPrice: () => 100, buy: () => {} } as GameUpgrade;
    const kitten = { name: 'Kitten helpers', pool: '', desc: 'You gain <b>more CpS</b> the more milk you have.', getPrice: () => 100, buy: () => {} } as GameUpgrade;
    const game = heavenlyGame(0, 1e6);
    game.milkProgress = 1;
    game.upgradesInStore = [plastic, kitten];

    const before = collect(game).cands;
    // 1000 CpS x 1% x 8 clicks/s x the boost (default 2)
    expect(before.find((c) => c.name === 'Plastic mouse')!.dCps).toBeCloseTo(1000 * 0.01 * 8 * AUTO_CLICK_VALUE_MIN);
    const kittenPlain = before.find((c) => c.name === 'Kitten helpers')!.dCps;

    // with 10% of the CpS on every click, the kitten's extra CpS also lands on every click
    game.upgrades = [{ name: 'Mouse x10', bought: 1, desc: 'Clicking gains <b>+10% of your CpS</b>.' } as GameUpgrade];
    const kittenMouse = collect(game).cands.find((c) => c.name === 'Kitten helpers')!.dCps;
    expect(kittenMouse).toBeCloseTo(kittenPlain * (1 + 0.1 * 8 * AUTO_CLICK_VALUE_MIN));

    // the setting "Auto: priority boost clicking/kitty upgrades (x)" sets the boost
    const boosted = collect(game, 7).cands;
    expect(boosted.find((c) => c.name === 'Plastic mouse')!.dCps).toBeCloseTo(1000 * 0.01 * 8 * 7);
    expect(boosted.find((c) => c.name === 'Kitten helpers')!.dCps).toBeCloseTo(kittenPlain * (1 + 0.1 * 8 * 7));
  });
});
