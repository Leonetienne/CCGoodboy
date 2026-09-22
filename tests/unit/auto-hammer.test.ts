import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { AutoHammer } from '../../src/autoplay/auto-hammer';
import { LogStore } from '../../src/stats/log';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

describe('AutoHammer', () => {
  let data: PersistedData;
  let runtime: RuntimeState;
  let game: FakeGameAdapter;
  let hammer: AutoHammer;

  beforeEach(() => {
    localStorage.clear();
    data = new PersistedData();
    runtime = new RuntimeState();
    game = new FakeGameAdapter();
    game.computedMouseCps = 1; // autoPerClick base
    game.cookiesPs = 100;
    game.unbuffedCps = 100;
    const log = new LogStore(data);
    hammer = new AutoHammer(runtime, data, game, log);
  });

  it('is inactive when auto play is off', () => {
    data.config.autoPlay = false;
    expect(hammer.isActive()).toBe(false);
  });

  it('is inactive when the auto-hammer setting is off', () => {
    data.config.autoPlay = true;
    data.config.autoHammer = false;
    expect(hammer.isActive()).toBe(false);
  });

  it('turns on when clicking would add at least the configured CpS share', () => {
    data.config.autoPlay = true;
    data.config.autoHammer = true;
    data.config.autoHammerMinShare = 0.01; // very low bar
    data.config.clickFrenzyCps = 8;

    // click rate = perClick(1) * clickFrenzyCps(8) * cal(1) = 8; share = 8/100 = 0.08 >= 0.01
    expect(hammer.isActive()).toBe(true);
  });

  it('stays off when clicking would not add enough share', () => {
    data.config.autoPlay = true;
    data.config.autoHammer = true;
    data.config.autoHammerMinShare = 0.5; // high bar
    data.config.clickFrenzyCps = 8;
    data.config.autoProbeIntervalSec = 0; // disable probing so it stays cleanly off

    expect(hammer.isActive()).toBe(false);
  });

  it('hammerActive is true for the manual hammer toggle regardless of auto hammer', () => {
    data.config.autoPlay = false;
    runtime.hammer = true;
    expect(hammer.hammerActive()).toBe(true);
  });

  it('clickEstimate reports rate and share from perClick x clickFrenzyCps x calibration', () => {
    data.config.clickFrenzyCps = 8;
    runtime.autoHammerState.cal = 2;

    const est = hammer.clickEstimate();
    expect(est.rate).toBeCloseTo(1 * 8 * 2, 9);
    expect(est.share).toBeCloseTo((1 * 8 * 2) / 100, 9);
  });
});
