import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import { getFthofCost, refillCanReachCost } from '../game/grimoire';
import type { CpsBuff } from '../game/types';
import type { AutoPlayEngine } from '../autoplay/shopping';
import type { JobRequest } from '../cursor/types';
import { BIG_CLICK_LEAD_MS, type ClickBigCookieTask } from '../hunting/click-big-cookie';
import type { ClickGoldenTask } from '../hunting/click-golden';
import type { FthofActions } from '../hunting/fthof';
import type { GoldenQueueItem } from '../hunting/golden-queue';
import type { HappyDance } from '../hunting/happy-dance';
import type { LumpHarvestActions } from '../hunting/lump-harvest';
import type { IdleBehavior } from '../idle/idle-behavior';

export interface PriorityDeps {
  queue: GoldenQueueItem[];
  buffs: CpsBuff[];
  runtime: RuntimeState;
  data: PersistedData;
  game: IGameAdapter;
  clickGolden: ClickGoldenTask;
  clickBigCookie: ClickBigCookieTask;
  fthof: FthofActions;
  lumpHarvest: LumpHarvestActions;
  autoPlay: AutoPlayEngine;
  happyDance: HappyDance;
  idleBehavior: IdleBehavior;
  hammerActive: () => boolean;
}

/** Picks ONE job request by priority (SCHED-1):
 *   1 ready golden cookies   -> GoldenCookieAction (first cookie of the planned route)
 *   2 real Click Frenzy      -> HammerAction (only once within BIG_CLICK_LEAD_MS of due)
 *   3 FTHOF, else refill     -> FthofAction / RefillAction (only outside Click Frenzy)
 *   4 ripe sugar lump        -> LumpHarvestAction (harvest before the game auto-harvests it)
 *   5 auto play shopping     -> auto-shop action (only when a purchase is due)
 *   6 hammer mode            -> HammerAction
 *   7 queued happy dance     -> DanceAction
 *   8 idle behaviour         -> IdleWanderAction
 * Priorities 2 and 3 are mutually exclusive (an active Click Frenzy suppresses FTHOF/refill for
 * that tick, matching the original's if/else), but a Click Frenzy that isn't yet due to move
 * still falls through to lump harvest/auto-shop/hammer/dance/idle below it, exactly as the
 * original did. */
export function selectJobRequest(deps: PriorityDeps): JobRequest | null {
  const { queue, buffs, runtime, data, game, clickGolden, clickBigCookie, fthof, lumpHarvest, autoPlay, happyDance, idleBehavior, hammerActive } = deps;

  let job: JobRequest | null = null;

  // Absolute priority: good golden cookies. If the first cookie of the planned route has
  // already vanished, do nothing this tick rather than fall through to lower-priority work.
  if (queue.length) {
    const first = queue[0]!;
    return clickGolden.jobFor(first.shimmer);
  }

  if (game.clickFrenzyActive()) {
    // Start moving shortly before the desired event time.
    if (Date.now() >= runtime.nextBigClickAt - BIG_CLICK_LEAD_MS) {
      job = clickBigCookie.job();
    }
  } else {
    const M = game.getGrimoire();
    const cost = getFthofCost(M);

    if (M && buffs.length >= 1 && game.cpsBuffOutlastsClickFrenzy(buffs) && (M.magic ?? 0) >= cost) {
      job = fthof.castJob();
    } else if (
      M &&
      buffs.length >= 2 &&
      game.cpsBuffOutlastsClickFrenzy(buffs) &&
      (M.magic ?? 0) < cost &&
      !runtime.lockA &&
      !runtime.refillInFlight &&
      refillCanReachCost(M, cost) &&
      game.canRefillLump() &&
      game.getLumps() >= 1
    ) {
      job = fthof.refillJob();
    }
  }

  // A ripe sugar lump, below FTHOF/refill, above auto-shop.
  if (!job && lumpHarvest.pending()) {
    job = lumpHarvest.harvestJob();
  }

  // Auto play: buy something when the plan says so (below FTHOF/refill, above hammer mode).
  if (!job && autoPlay.shopReady()) {
    job = autoPlay.shopJob();
  }

  // Lowest real priority: keep hammering the big cookie (as if Click Frenzy were active)
  // while hammer mode is switched on.
  if (!job && hammerActive() && !game.clickFrenzyActive() && Date.now() >= runtime.nextBigClickAt - BIG_CLICK_LEAD_MS) {
    job = clickBigCookie.job();
  }

  // A queued happy dance goes before idling around.
  if (!job && runtime.danceQueued) {
    job = happyDance.job();
  }

  if (!job && data.config.idleWander !== false && !hammerActive() && !game.clickFrenzyActive() && Date.now() >= runtime.nextIdleAt) {
    job = idleBehavior.idleJob();
  }

  return job;
}
