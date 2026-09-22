import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { HurryMode } from '../../src/game/hurry-mode';
import type { GameShimmer } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

describe('HurryMode', () => {
  let game: FakeGameAdapter;
  let data: PersistedData;
  let hurryMode: HurryMode;

  beforeEach(() => {
    localStorage.clear();
    game = new FakeGameAdapter();
    data = new PersistedData();
    hurryMode = new HurryMode(game, data);
  });

  it('getPanicFactor clamps to 0.01..1 and defaults to 0.2 when unset', () => {
    data.config.panicFactor = 5;
    expect(hurryMode.getPanicFactor()).toBe(1);

    data.config.panicFactor = -1;
    expect(hurryMode.getPanicFactor()).toBe(0.01);

    data.config.panicFactor = NaN;
    expect(hurryMode.getPanicFactor()).toBe(0.2);
  });

  it('cookieChainActive reflects the golden chain count', () => {
    game.goldenChainCount = 0;
    expect(hurryMode.cookieChainActive()).toBe(false);

    game.goldenChainCount = 2;
    expect(hurryMode.cookieChainActive()).toBe(true);
  });

  it('cookieStormActive is true when a buff name contains "cookie storm"', () => {
    game.rawBuffs = { x: { name: 'Cookie Storm Drop', multCpS: 1 } };
    expect(hurryMode.cookieStormActive()).toBe(true);
  });

  it('cookieStormActive is true when a forced "cookie storm drop" shimmer exists', () => {
    game.shimmers = [{ id: 1, type: 'golden', popped: false, force: 'cookie storm drop', l: null } as GameShimmer];
    expect(hurryMode.cookieStormActive()).toBe(true);
  });

  it('cookieStormActive is false otherwise', () => {
    expect(hurryMode.cookieStormActive()).toBe(false);
  });

  it('urgencyFactor is 1 when nothing is active, the panic factor otherwise', () => {
    data.config.panicFactor = 0.3;
    expect(hurryMode.urgencyFactor()).toBe(1);

    // A fresh instance, not the 30ms-cached one above, so the chain-active state is re-read.
    game.goldenChainCount = 1;
    const duringChain = new HurryMode(game, data);
    expect(duringChain.urgencyFactor()).toBe(0.3);
  });
});
