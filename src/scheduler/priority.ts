import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import { getFthofCost, refillCanReachCost } from '../game/grimoire';
import type { CpsBuff } from '../game/types';
import type { AscensionRunner } from '../autoplay/ascension-runner';
import type { GrimoireUnlocker } from '../autoplay/grimoire-unlock';
import type { KrumblorTrainer } from '../autoplay/krumblor';
import type { SantaTrainer } from '../autoplay/santa';
import type { ButterBiscuitHunter } from '../autoplay/butter-biscuit';
import type { BankUnlocker } from '../autoplay/bank-unlock';
import type { FarmUnlocker } from '../autoplay/farm-unlock';
import type { AutoPlayEngine } from '../autoplay/shopping';
import type { WrinklerPopper } from '../autoplay/wrinkler-popper';
import type { JobRequest } from '../cursor/types';
import { BIG_CLICK_LEAD_MS, buffComboActive, type ClickBigCookieTask } from '../hunting/click-big-cookie';
import type { ClickGoldenTask } from '../hunting/click-golden';
import { fthofEnabled, refillEnabled, type FthofActions } from '../hunting/fthof';
import type { GoldenQueueItem } from '../hunting/golden-queue';
import type { GrimoireView } from '../hunting/grimoire-view';
import type { HappyDance } from '../hunting/happy-dance';
import type { LumpHarvestActions } from '../hunting/lump-harvest';
import type { IdleBehavior } from '../idle/idle-behavior';
import type { StockTrader } from '../market/stock-trader';
import type { Gardener } from '../garden/gardener';

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
  grimoireView: GrimoireView;
  ascension: AscensionRunner;
  grimoireUnlock: GrimoireUnlocker;
  bankUnlock: BankUnlocker;
  farmUnlock: FarmUnlocker;
  krumblor: KrumblorTrainer;
  santa: SantaTrainer;
  butterBiscuit: ButterBiscuitHunter;
  stockTrader: StockTrader;
  gardener: Gardener;
  autoPlay: AutoPlayEngine;
  wrinklerPopper: WrinklerPopper;
  happyDance: HappyDance;
  idleBehavior: IdleBehavior;
  hammerActive: () => boolean;
  /** The auto hammer's kick-off after the Heavenly key is running (AUTO-19). */
  hammerKick?: () => boolean;
}

/** Picks ONE job request by priority (SCHED-1):
 *   0 a committed ascension  -> its step (ASC-12: pops, sales, achievements, the hold at
 *                               Legacy, Legacy/"Ascend"); nothing else runs meanwhile
 *   1 ready golden cookies   -> GoldenCookieAction (first cookie of the planned route)
 *   2 real Click Frenzy      -> HammerAction (only once within BIG_CLICK_LEAD_MS of due)
 *   3 FTHOF, else refill     -> FthofAction / RefillAction (only outside Click Frenzy); FTHOF
 *                               first gets the Grimoire on screen (FT-8, GrimoireView steps)
 *     then a buff combo      -> HammerAction (CF-7: >= 2 positive buffs; nothing below runs)
 *   4 ripe sugar lump        -> LumpHarvestAction (harvest before the game auto-harvests it)
 *   5 a started buildings-view recipe / "Show grimoire" debug goal, then the auto hammer's
 *     kick-off after the Heavenly key (AUTO-19: HammerAction), then auto play: ascend
 *     (ASC-10), unlock the Grimoire, unlock the stock market, unlock the garden, train
 *     Krumblor, evolve Santa, top Wizard towers up for a butter biscuit (BUTTER-*); then a stock market trade (STOCK-*) and a garden step
 *     (GARDEN-*), both not tied to auto play; then auto play again: pop
 *     a wrinkler for a purchase, then shopping
 *                            -> MenuButtonAction / ScrollIntoViewAction / MinigameButtonAction /
 *                               GrimoireUnlockAction / MinigameUnlockAction /
 *                               DragonClickAction / DragonStoreAction / MarketClickAction /
 *                               GardenClickAction /
 *                               WrinklerPopAction, else the auto-shop
 *                               action (only when a purchase is due)
 *   6 hammer mode            -> HammerAction
 *   7 queued happy dance     -> DanceAction
 *   8 idle behaviour         -> IdleWanderAction
 * Priorities 2 and 3 are mutually exclusive (an active Click Frenzy suppresses FTHOF/refill for
 * that tick, matching the original's if/else), but a Click Frenzy that isn't yet due to move
 * still falls through to lump harvest/auto-shop/hammer/dance/idle below it, exactly as the
 * original did. */
export function selectJobRequest(deps: PriorityDeps): JobRequest | null {
  const { queue, buffs, runtime, data, game, clickGolden, clickBigCookie, fthof, lumpHarvest, grimoireView, ascension, grimoireUnlock, bankUnlock, farmUnlock, krumblor, santa, butterBiscuit, stockTrader, gardener, autoPlay, wrinklerPopper, happyDance, idleBehavior, hammerActive, hammerKick } = deps;

  let job: JobRequest | null = null;

  // A committed ascension (ASC-12) outranks everything, golden cookies included: they would
  // push the prestige level past its target. Nothing else runs until it is done or called off.
  if (ascension.committed()) {
    return ascension.job();
  }

  // Absolute priority otherwise: good golden cookies. If the first cookie of the planned route has
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
  } else if (fthofEnabled(data.config)) {
    const M = game.getGrimoire();
    const cost = getFthofCost(M);

    if (M && buffs.length >= 1 && game.cpsBuffOutlastsClickFrenzy(buffs) && (M.magic ?? 0) >= cost) {
      job = fthof.castJob();
    } else if (
      refillEnabled(data.config) &&
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

  // A combo of >= 2 positive buffs: hammer through it, below the Grimoire, above everything
  // else (CF-7). Between two clicks nothing below it gets the paw.
  if (!job && !game.clickFrenzyActive() && buffComboActive(game)) {
    if (Date.now() < runtime.nextBigClickAt - BIG_CLICK_LEAD_MS) return null;
    return clickBigCookie.job();
  }

  // A ripe sugar lump, below FTHOF/refill, above auto-shop.
  if (!job && lumpHarvest.pending()) {
    job = lumpHarvest.harvestJob();
  }

  // A buildings-view recipe that is already under way (resumed after preemption) and the
  // debug tools' "Show grimoire" goal.
  if (!job && grimoireView.pending()) {
    job = grimoireView.job();
  }

  // Auto play just bought the Heavenly key: hammer for a moment before anything else at this
  // tier, so the handmade cookies unlock the clicking upgrades (AUTO-19).
  const kick = !job && !!hammerKick && hammerKick();

  if (kick && !game.clickFrenzyActive() && Date.now() >= runtime.nextBigClickAt - BIG_CLICK_LEAD_MS) {
    job = clickBigCookie.job();
  }

  // Auto play: an ascension that is due or under way (ASC-10): nothing else in this tier
  // makes sense during it.
  if (!job && !kick && ascension.pending()) {
    job = ascension.job();
  }

  // Auto play: unlock the Grimoire with a sugar lump as soon as possible (AUTO-13).
  if (!job && !kick && grimoireUnlock.pending()) {
    job = grimoireUnlock.job();
  }

  // Auto play: unlock the stock market with a sugar lump when it is to be played (AUTO-16).
  if (!job && !kick && bankUnlock.pending()) {
    job = bankUnlock.job();
  }

  // Auto play: unlock the garden with a sugar lump when it is to be tended (AUTO-17).
  if (!job && !kick && farmUnlock.pending()) {
    job = farmUnlock.job();
  }

  // Auto play: train Krumblor up to the Dragonflight aura (KRUMB-*).
  if (!job && !kick && krumblor.pending()) {
    job = krumblor.job();
  }

  // Auto play: evolve Santa up to Final Claus (XMAS-*).
  if (!job && !kick && santa.pending()) {
    job = santa.job();
  }

  // Auto play: Wizard towers up to the next "N of everything" milestone and back down, for
  // its butter biscuit (BUTTER-*).
  if (!job && !kick && butterBiscuit.pending()) {
    job = butterBiscuit.job();
  }

  // The stock market: sell what peaked, hire a broker, buy what is low (STOCK-*). Its own
  // setting, with or without auto play.
  if (!job && !kick && stockTrader.pending()) {
    job = stockTrader.job();
  }

  // The garden: harvest, weed, soil, plant (GARDEN-*). Its own setting, with or without auto
  // play.
  if (!job && !kick && gardener.pending()) {
    job = gardener.job();
  }

  // Auto play: pop mature wrinklers whose cookies the next purchase needs (WRINK-2..6).
  if (!job && !kick && wrinklerPopper.pending()) {
    job = wrinklerPopper.job();
  }

  // Auto play: buy something when the plan says so (below FTHOF/refill, above hammer mode).
  if (!job && !kick && autoPlay.shopReady()) {
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
