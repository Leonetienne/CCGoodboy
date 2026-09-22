import { describe, expect, it } from 'vitest';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY } from '../../src/cursor/types';
import { LumpHarvestActions } from '../../src/hunting/lump-harvest';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function makeLumpHarvest(game: FakeGameAdapter, hasGoodGolden = () => false): LumpHarvestActions {
  return new LumpHarvestActions(new RuntimeState(), game, null as never, null as never, hasGoodGolden);
}

describe('LumpHarvestActions.pending', () => {
  it('is false while the lump is not ripe', () => {
    const game = new FakeGameAdapter();
    expect(makeLumpHarvest(game).pending()).toBe(false);
  });

  it('is true once the lump is ripe', () => {
    const game = new FakeGameAdapter();
    game.lumpRipe = true;
    expect(makeLumpHarvest(game).pending()).toBe(true);
  });
});

describe('LumpHarvestActions.harvestJob', () => {
  it('returns a job at the LUMP_HARVEST priority with a dedup key', () => {
    const game = new FakeGameAdapter();
    game.lumpRipe = true;

    const job = makeLumpHarvest(game).harvestJob();
    expect(job.priority).toBe(JOB_PRIORITY.LUMP_HARVEST);
    expect(job.key).toBe('lump-harvest');
  });
});
