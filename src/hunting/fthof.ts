import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { getFthofCost, refillCanReachCost } from '../game/grimoire';
import { FthofAction, RefillAction } from '../actions/fthof';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';

/** Grimoire/mana management module: decides WHEN to cast Force the Hand of Fate or refill
 * mana with a sugar lump (fthofOrRefillPending), and hands the HOW to FthofAction /
 * RefillAction jobs. */
export class FthofActions {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  /** A FTHOF cast or lump refill is waiting for its turn (the same conditions the scheduler
   * uses). */
  fthofOrRefillPending(): boolean {
    const M = this.game.getGrimoire();
    if (!M) return false;

    const buffs = this.game.positiveCpsBuffs();

    if (!this.game.cpsBuffOutlastsClickFrenzy(buffs)) {
      return false;
    }

    const cost = getFthofCost(M);

    if (buffs.length >= 1 && (M.magic ?? 0) >= cost) {
      return true;
    }

    return (
      buffs.length >= 2 &&
      (M.magic ?? 0) < cost &&
      !this.runtime.lockA &&
      !this.runtime.refillInFlight &&
      refillCanReachCost(M, cost) &&
      this.game.canRefillLump() &&
      this.game.getLumps() >= 1
    );
  }

  /** Cast Force the Hand of Fate job. Preconditions are re-checked by the action's abort
   * predicate right before the click (FT-4). */
  castJob(): JobRequest {
    return {
      action: new FthofAction(this.runtime, this.game, this.stats, this.log, this.hasGoodGolden),
      priority: JOB_PRIORITY.FTHOF,
      key: 'fthof',
    };
  }

  /** Refill mana with a sugar lump job. Same FT-4/FT-5 abort semantics; sets LOCK_A on
   * success. */
  refillJob(): JobRequest {
    return {
      action: new RefillAction(this.runtime, this.game, this.stats, this.log, this.hasGoodGolden),
      priority: JOB_PRIORITY.REFILL,
      key: 'refill',
    };
  }
}
