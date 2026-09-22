import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import { getFthofCost } from '../game/grimoire';
import type { CpsBuff } from '../game/types';
import type { AutoPlayEngine } from '../autoplay/shopping';
import { BIG_CLICK_LEAD_MS, type ClickBigCookieTask } from '../hunting/click-big-cookie';
import type { ClickGoldenTask } from '../hunting/click-golden';
import type { FthofActions } from '../hunting/fthof';
import type { GoldenQueueItem } from '../hunting/golden-queue';
import type { HappyDance } from '../hunting/happy-dance';
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
  autoPlay: AutoPlayEngine;
  happyDance: HappyDance;
  idleBehavior: IdleBehavior;
  hammerActive: () => boolean;
}

/** The priority names the scheduler can hand back, in the order they are considered. Two
 * different priority slots ('click-frenzy' and 'hammer') both run ClickBigCookieTask — the
 * game state decides which applies, the task itself does not distinguish them. */
export type PriorityName = 'golden' | 'click-frenzy' | 'fthof' | 'refill' | 'auto-shop' | 'hammer' | 'happy-dance' | 'idle-wander';

export interface SelectedTask {
  name: PriorityName;
  run: () => Promise<unknown>;
}

/** Picks ONE task by priority (SCHED-1):
 *   1 ready golden cookies   -> clickGolden(first cookie of the planned route)
 *   2 real Click Frenzy      -> clickBigCookie (only once within BIG_CLICK_LEAD_MS of due)
 *   3 FTHOF, else refill     -> castFthof / refillGrimoire (only outside Click Frenzy)
 *   4 auto play shopping     -> autoShop (only when a purchase is due)
 *   5 hammer mode            -> clickBigCookie
 *   6 queued happy dance     -> happyDance
 *   7 idle behaviour         -> idleWander
 * Priorities 2 and 3 are mutually exclusive (an active Click Frenzy suppresses FTHOF/refill for
 * that tick, matching the original's if/else), but a Click Frenzy that isn't yet due to move
 * still falls through to auto-shop/hammer/dance/idle below it, exactly as the original did. */
export function selectTask(deps: PriorityDeps): SelectedTask | null {
  const { queue, buffs, runtime, data, game, clickGolden, clickBigCookie, fthof, autoPlay, happyDance, idleBehavior, hammerActive } = deps;

  let task: SelectedTask | null = null;

  // Absolute priority: good golden cookies.
  if (queue.length) {
    const first = queue[0]!;
    task = { name: 'golden', run: () => clickGolden.run(first.shimmer) };
  } else if (game.clickFrenzyActive()) {
    // Start moving shortly before the desired event time.
    if (Date.now() >= runtime.nextBigClickAt - BIG_CLICK_LEAD_MS) {
      task = { name: 'click-frenzy', run: () => clickBigCookie.run() };
    }
  } else {
    const M = game.getGrimoire();
    const cost = getFthofCost(M);

    if (M && buffs.length >= 1 && game.cpsBuffOutlastsClickFrenzy(buffs) && (M.magic ?? 0) >= cost) {
      task = { name: 'fthof', run: () => fthof.castFthof() };
    } else if (
      M &&
      buffs.length >= 2 &&
      game.cpsBuffOutlastsClickFrenzy(buffs) &&
      (M.magic ?? 0) < cost &&
      !runtime.lockA &&
      !runtime.refillInFlight
    ) {
      task = { name: 'refill', run: () => fthof.refillGrimoire() };
    }
  }

  // Auto play: buy something when the plan says so (below FTHOF/refill, above hammer mode).
  if (!task && autoPlay.shopReady()) {
    task = { name: 'auto-shop', run: () => autoPlay.shop() };
  }

  // Lowest real priority: keep hammering the big cookie (as if Click Frenzy were active)
  // while hammer mode is switched on.
  if (!task && hammerActive() && !game.clickFrenzyActive() && Date.now() >= runtime.nextBigClickAt - BIG_CLICK_LEAD_MS) {
    task = { name: 'hammer', run: () => clickBigCookie.run() };
  }

  // A queued happy dance goes before idling around.
  if (!task && runtime.danceQueued) {
    task = { name: 'happy-dance', run: () => happyDance.run() };
  }

  if (!task && data.config.idleWander !== false && !hammerActive() && !game.clickFrenzyActive() && Date.now() >= runtime.nextIdleAt) {
    task = { name: 'idle-wander', run: () => idleBehavior.idleWander() };
  }

  return task;
}
