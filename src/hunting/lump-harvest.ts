import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { LumpHarvestAction } from '../actions/lump-harvest';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';

/** Sugar lump harvest module: clicks the growing sugar lump icon the moment it turns ripe, like
 * a human popping over to grab it, instead of leaving it to the game's own slower overripe
 * auto-harvest roughly an hour later. */
export class LumpHarvestActions {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  /** A ripe sugar lump is waiting to be harvested (the same condition the scheduler uses). */
  pending(): boolean {
    // The lump isn't on the ascension screen (nor during its intro): nothing to click there.
    return this.game.isLumpRipe() && !this.game.isAscending();
  }

  /** Harvest job. Preconditions are re-checked by the action's abort predicate right before the
   * click. */
  harvestJob(): JobRequest {
    return {
      action: new LumpHarvestAction(this.runtime, this.game, this.stats, this.log, this.hasGoodGolden),
      priority: JOB_PRIORITY.LUMP_HARVEST,
      key: 'lump-harvest',
    };
  }
}
