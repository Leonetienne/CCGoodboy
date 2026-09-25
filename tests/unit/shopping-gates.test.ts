import { beforeEach, describe, expect, it } from 'vitest';
import { IncomeTracker } from '../../src/autoplay/income-tracker';
import { AutoPlayEngine } from '../../src/autoplay/shopping';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { LogStore } from '../../src/stats/log';
import { StatsRecorder } from '../../src/stats/stats';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

describe('AutoPlayEngine.shoppingAllowed (AUTO-7)', () => {
  let game: FakeGameAdapter;
  let engine: AutoPlayEngine;

  beforeEach(() => {
    localStorage.clear();
    const runtime = new RuntimeState();
    const data = new PersistedData();
    data.config.autoPlay = true;
    game = new FakeGameAdapter();
    engine = new AutoPlayEngine(runtime, data, game, new LogStore(data), new StatsRecorder(data), new IncomeTracker(runtime, game), () => false, () => false, () => false, () => false);
  });

  it('never shops while a prompt is open (e.g. the ascension\'s own "Ascend")', () => {
    expect(engine.shoppingAllowed()).toBe(true);
    game.promptOpen = true;
    expect(engine.shoppingAllowed()).toBe(false);
  });
});
