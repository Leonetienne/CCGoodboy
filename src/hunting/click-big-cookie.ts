import type { PersistedData } from '../core/persisted-data';
import type { IGameAdapter } from '../game/game-adapter';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { BIG_CLICK_LEAD_MS, HammerAction } from '../actions/hammer';
import type { LogStore } from '../stats/log';

export { BIG_CLICK_LEAD_MS } from '../actions/hammer';

/** Big-cookie hammer module: decides whether hammering is wanted (real Click Frenzy or the
 * hammer button / auto hammer) and produces the continuous HammerAction job. The action owns
 * the fixed-timeline click loop exactly as ClickBigCookieTask did before. */
export class ClickBigCookieTask {
  constructor(
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly hammerActive: () => boolean,
    private readonly hasGoodGolden: () => boolean,
    private readonly fthofOrRefillPending: () => boolean,
    private readonly autoShopReady: () => boolean,
  ) {}

  bigCookieWanted(): boolean {
    return this.game.clickFrenzyActive() || this.hammerActive();
  }

  job(): JobRequest {
    const frenzy = this.game.clickFrenzyActive();

    return {
      action: new HammerAction(this.data, this.game, this.log, this.hammerActive, this.hasGoodGolden, this.fthofOrRefillPending, this.autoShopReady),
      priority: frenzy ? JOB_PRIORITY.CLICK_FRENZY : JOB_PRIORITY.HAMMER,
      key: 'hammer',
    };
  }
}
