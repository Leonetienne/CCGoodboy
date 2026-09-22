import type { PersistedData } from '../core/persisted-data';
import type { IGameAdapter } from '../game/game-adapter';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { DanceAction } from '../actions/dance';

export { anyGoldenPresent, danceEligible, getDanceMs } from '../actions/dance';

/** Happy-dance module: produces the continuous DanceAction job. The action owns the
 * animation and its DANCE-1..4 abort/end-exactly-where-it-started rules. */
export class HappyDance {
  constructor(
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly cookieChainActive: () => boolean,
    private readonly pendingPriorityWork: () => boolean,
  ) {}

  job(): JobRequest {
    return {
      action: new DanceAction(this.data, this.game, this.cookieChainActive, this.pendingPriorityWork),
      priority: JOB_PRIORITY.HAPPY_DANCE,
      key: 'happy-dance',
    };
  }
}
