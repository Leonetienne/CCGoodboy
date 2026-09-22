import type { StatsRecorder } from '../stats/stats';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import type { GameShimmer } from '../game/types';
import { GoldenCookieAction } from '../actions/golden-cookie';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { LogStore } from '../stats/log';

/** Golden-cookie hunter module: decides to catch a specific shimmer and hands the HOW
 * (reaction delay, travel, re-acquire, click, stats/log, dance) to GoldenCookieAction. */
export class ClickGoldenTask {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly danceEligible: () => boolean,
  ) {}

  jobFor(shimmer: GameShimmer): JobRequest | null {
    if (!shimmer || shimmer.popped || Number(shimmer.wrath) > 0 || !shimmer.l || !shimmer.l.isConnected) {
      return null;
    }

    return {
      action: new GoldenCookieAction(this.runtime, this.game, this.stats, this.log, this.danceEligible, shimmer),
      priority: JOB_PRIORITY.GOLDEN,
      key: `golden:${shimmer.id}`,
    };
  }
}
