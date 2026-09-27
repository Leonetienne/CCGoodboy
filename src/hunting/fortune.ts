import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { FortuneClickAction } from '../actions/fortune';
import { fortuneCenter } from '../game/ticker-dom';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';

/** Fortune module (FORTUNE-*): with the heavenly upgrade "Fortune cookies" the news ticker
 * sometimes shows a fortune for ~10s; clicked, it unlocks a Fortune upgrade (bought by auto
 * play like any other, AUTO-2), spawns a golden cookie or gives an hour of CpS. The paw clicks
 * every one it sees, with or without auto play, unless "Click fortune cookies in the news"
 * (`fortunes`, on by default) is off. */
export class FortuneCatcher {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  /** A fortune is in the ticker and on screen, and clicking it isn't switched off. */
  pending(): boolean {
    if (this.data.config.fortunes === false) return false;
    if (this.game.isAscending() || this.game.isPromptOpen()) return false;
    return !!this.game.getTickerFortune() && !!fortuneCenter();
  }

  job(): JobRequest {
    return {
      action: new FortuneClickAction(this.runtime, this.game, this.stats, this.log, this.hasGoodGolden),
      priority: JOB_PRIORITY.FORTUNE,
      key: 'fortune',
    };
  }
}
