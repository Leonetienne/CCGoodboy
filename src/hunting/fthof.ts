import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { getFthofCost, refillCanReachCost } from '../game/grimoire';
import { FthofAction, fthofCastBlocked, RefillAction } from '../actions/fthof';
import type { GrimoireView } from './grimoire-view';
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
    private readonly grimoireView: GrimoireView,
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

  /** Cast Force the Hand of Fate job. First, one step per tick, the paw gets the spell in
   * front of it (FT-8): back to the buildings view, scroll to the Wizard towers, "View
   * Grimoire", scroll to the spell. If that is blocked (or failed a moment ago) it casts
   * directly on the real control as before (FT-7). Preconditions are re-checked by every
   * job's abort predicate right before its click (FT-4). */
  castJob(): JobRequest {
    if (Date.now() >= this.runtime.fthofPrepBlockUntil) {
      const step = this.grimoireView.nextStep({
        goal: 'open',
        priority: JOB_PRIORITY.FTHOF,
        keyPrefix: 'fthof-prep',
        abortIf: () => fthofCastBlocked(this.game, this.hasGoodGolden),
        allowLevelUp: false,
        onFail: (why) => this.blockPrep(why),
      });

      if (step.kind === 'job') return step.job;
      if (step.kind === 'blocked') this.blockPrep(step.why);
    }

    return {
      action: new FthofAction(this.runtime, this.game, this.stats, this.log, this.hasGoodGolden),
      priority: JOB_PRIORITY.FTHOF,
      key: 'fthof',
    };
  }

  /** Preparing the Grimoire failed: cast directly (FT-7) for the next 10s instead of
   * retrying the same failing step every tick. */
  private blockPrep(why: string): void {
    this.runtime.fthofPrepBlockUntil = Date.now() + 10000;
    this.log.log('fthof prep', `skipped: ${why}`);
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
