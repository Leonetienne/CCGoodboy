import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragonPetter } from '../../src/autoplay/dragon-pet';
import { DRAGON_DROPS, dragonDropAt, nextDropWindowSec, nextPetStep, type DragonPetState } from '../../src/autoplay/dragon-pet-strategy';
import { autoUpgradeGain, type UpgradeClassifyCtx } from '../../src/autoplay/upgrade-classifier';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { GameUpgrade } from '../../src/game/types';
import { LogStore } from '../../src/stats/log';
import { StatsRecorder } from '../../src/stats/stats';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

const ORDER = ['Dragon fang', 'Dragon scale', 'Dragon teddy bear', 'Dragon claw'];

function at(min: number, sec = 0): Date {
  return new Date(2026, 8, 28, 12, min, sec);
}

function state(over: Partial<DragonPetState> = {}): DragonPetState {
  return { hasPet: true, dragonLevel: 14, order: ORDER, missing: [...DRAGON_DROPS], now: at(0), menuOpen: false, menuOurs: false, ...over };
}

describe('dragon drop windows (DRAGON-PET-1)', () => {
  it('picks the drop of the current quarter hour', () => {
    expect(dragonDropAt(ORDER, at(0))).toBe('Dragon fang');
    expect(dragonDropAt(ORDER, at(14, 59))).toBe('Dragon fang');
    expect(dragonDropAt(ORDER, at(15))).toBe('Dragon scale');
    expect(dragonDropAt(ORDER, at(59))).toBe('Dragon claw');
  });

  it('counts the seconds to the next window with a wanted drop, wrapping into the next hour', () => {
    expect(nextDropWindowSec(ORDER, at(3), ['Dragon fang'])).toBe(0);
    expect(nextDropWindowSec(ORDER, at(3), ['Dragon teddy bear'])).toBe(27 * 60);
    expect(nextDropWindowSec(ORDER, at(50), ['Dragon scale'])).toBe(25 * 60);
    expect(nextDropWindowSec(ORDER, at(50), [])).toBeNull();
  });
});

describe('nextPetStep (DRAGON-PET-1/2)', () => {
  it('opens the popup and pets while the window drop is missing', () => {
    expect(nextPetStep(state())).toEqual({ kind: 'open-menu', drop: 'Dragon fang' });
    expect(nextPetStep(state({ menuOpen: true }))).toEqual({ kind: 'pet', drop: 'Dragon fang' });
  });

  it('never pets for a drop already owned or in the store', () => {
    const s = nextPetStep(state({ missing: ['Dragon claw'], now: at(5) }));
    expect(s.kind).toBe('wait');
    expect((s as { inSec: number }).inSec).toBe(40 * 60);
  });

  it('stops for good once nothing is left to drop, closing its own popup first', () => {
    expect(nextPetStep(state({ missing: [] })).kind).toBe('done');
    expect(nextPetStep(state({ missing: [], menuOpen: true, menuOurs: true }))).toEqual({ kind: 'close-menu' });
    // a popup the player (or Krumblor's training) opened is left alone
    expect(nextPetStep(state({ missing: [], menuOpen: true, menuOurs: false })).kind).toBe('done');
  });

  it('needs "Pet the dragon" and dragon level 8', () => {
    expect(nextPetStep(state({ hasPet: false })).kind).toBe('done');
    expect(nextPetStep(state({ dragonLevel: 7 })).kind).toBe('done');
    expect(nextPetStep(state({ dragonLevel: 8 })).kind).toBe('open-menu');
  });
});

describe('DragonPetter (DRAGON-PET-*)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.useFakeTimers();
    vi.setSystemTime(at(20));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(unlocked: string[] = []) {
    const game = new FakeGameAdapter();
    game.upgradeNames.add('Pet the dragon');
    game.dragonLevel = 14;
    game.dragonDropOrder = ORDER;
    for (const name of DRAGON_DROPS) {
      game.upgradesByName[name] = { name, buy: () => {}, unlocked: unlocked.includes(name) } as GameUpgrade;
    }
    const data = new PersistedData();
    const runtime = new RuntimeState();
    const log = new LogStore(data);
    const petter = new DragonPetter(runtime, data, game, new StatsRecorder(data), log, () => false);
    return { game, data, runtime, petter };
  }

  it('wants to pet while the window drop (Dragon scale at :20) is missing', () => {
    const { petter } = setup();
    expect(petter.step()).toEqual({ kind: 'open-menu', drop: 'Dragon scale' });
  });

  it('does nothing while the window drop already sits in the store', () => {
    const { petter } = setup(['Dragon scale']);
    expect(petter.step()?.kind).toBe('wait');
    expect(petter.pending()).toBe(false);
  });

  it('is switched off by "Pet Krumblor for dragon drops"', () => {
    const { petter, data } = setup();
    data.config.petDragon = false;
    expect(petter.step()).toBeNull();
  });

  it('holds back while shopping would (golden cookie, frenzy, ...) and with a prompt open', () => {
    const game = new FakeGameAdapter();
    game.upgradeNames.add('Pet the dragon');
    game.dragonLevel = 14;
    const petter = new DragonPetter(new RuntimeState(), new PersistedData(), game, null as never, null as never, () => true);
    expect(petter.step()).toBeNull();
    const { petter: p2, game: g2 } = setup();
    g2.promptOpen = true;
    expect(p2.step()).toBeNull();
  });
});

describe('dragon drops in auto play (DRAGON-PET-4)', () => {
  const ctx = (o: Partial<UpgradeClassifyCtx> = {}): UpgradeClassifyCtx => ({ cps: 1000, mult: 1, biscuitBase: null, cursor: null, nonCursor: 0, clickUnit: 1, clicksPerSec: 10, ...o });
  const up = (name: string, desc = ''): GameUpgrade => ({ name, desc, buy: () => {} });

  it('values the claw by the clicks, the fang by golden cookies and the teddy bear nominally', () => {
    const game = new FakeGameAdapter();
    game.computedMouseCps = 500;
    expect(autoUpgradeGain(game, up('Dragon claw'), ctx())).toEqual({ gain: 500 * 10 * 0.03, type: 'dragon' });
    expect(autoUpgradeGain(game, up('Dragon fang'), ctx())!.gain).toBeCloseTo(1000 * 0.2 * 0.03);
    expect(autoUpgradeGain(game, up('Dragon teddy bear'), ctx())!.gain).toBeCloseTo(1);
  });

  it('keeps Dragon scale a +3% multiplier', () => {
    const g = autoUpgradeGain(new FakeGameAdapter(), up('Dragon scale', 'Cookie production multiplier <b>+3%</b>.<br>Cost scales with CpS.'), ctx());
    expect(g!.type).toBe('multiplier');
    expect(g!.gain).toBeCloseTo(30);
  });
});
