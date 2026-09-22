import { sayCant, sayCantWhile } from '../core/console-voice';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import type { CpsBuff } from '../game/types';
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

  /** CON-2: says in the console why a FTHOF cast or refill the buffs call for can't happen
   * (no Wizard tower, Grimoire locked, too little mana, refill on cooldown, no lumps, ...).
   * Called every scheduler tick; each reason is said once until it changes or goes away. */
  reportBlockers(buffs: CpsBuff[]): void {
    const wantsFthof = buffs.length >= 1 && !this.game.clickFrenzyActive() && this.game.cpsBuffOutlastsClickFrenzy(buffs);
    const M = wantsFthof ? this.game.getGrimoire() : null;
    const cost = getFthofCost(M);
    const mana = M ? M.magic ?? 0 : 0;

    let fthof: [string, string] | null = null;
    let refill: [string, string] | null = null;

    if (wantsFthof && !M) {
      const wt = this.grimoireView.wizardTower();

      // Level >= 1 without a minigame object: the Grimoire script is still loading, not a
      // reason to complain.
      if (!wt || !((Number(wt.amount) || 0) >= 1)) {
        fthof = ['no-towers', 'Wanted to cast Force the Hand of Fate, but there are no wizard towers yet :c'];
      } else if (!((Number(wt.level) || 0) >= 1)) {
        fthof = ['locked', 'Wanted to cast Force the Hand of Fate, but my Grimoire is still locked (Wizard tower level 0) :c'];
      }
    } else if (wantsFthof && !Number.isFinite(cost)) {
      fthof = ['no-spell', 'Wanted to cast Force the Hand of Fate, but I can\'t find the spell anywhere owo'];
    } else if (wantsFthof && mana < cost) {
      fthof = ['mana', `Wanted to cast Force the Hand of Fate, but not enough mana (${Math.floor(mana)}/${Math.ceil(cost)}) :c`];

      if (buffs.length >= 2 && !this.runtime.refillInFlight) {
        if (!refillCanReachCost(M, cost)) {
          refill = ['max-mana', `Wanted to refill mana, but even full mana (${Math.floor(M!.magicM ?? 0)}) can't pay for Force the Hand of Fate, need more wizard towers :c`];
        } else if (this.runtime.lockA) {
          refill = ['lock-a', 'Wanted to refill mana, but I already had my refill for this combo (LOCK_A) :3'];
        } else if (!this.game.canRefillLump()) {
          refill = ['cooldown', 'Wanted to refill mana, but refilling is still on cooldown :c'];
        } else if (this.game.getLumps() < 1) {
          refill = ['no-lumps', 'Wanted to refill mana, but I have no sugar popsies :c'];
        }
      }
    }

    sayCantWhile('fthof', fthof && fthof[0], fthof ? fthof[1] : '');
    sayCantWhile('refill', refill && refill[0], refill ? refill[1] : '');
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
    sayCant(`Wanted to open my Grimoire nicely, but ${why}, so I'll cast from here :3`);
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
