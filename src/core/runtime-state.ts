import type { AutoPlan } from '../autoplay/shopping';
import type { Decision } from '../autoplay/strategy';
import type { WrinklerPopPlan } from '../autoplay/wrinkler-strategy';
import type { IntervalHandle } from '../input/background-clock';

export interface CursorPoint {
  x: number;
  y: number;
}

export interface KeepAliveState {
  ctx: AudioContext | null;
  state: string;
  listening: boolean;
}

export interface AutoHammerState {
  on: boolean;
  wanted: boolean | null;
  nextEvalAt: number;
  nextProbeAt: number;
  probeUntil: number;
  probeT0: number;
  probeH0: number;
  cal: number;
  share: number;
}

export interface AutoHandSample {
  t: number;
  v: number;
  rate: number;
}

export interface RoutePlan {
  key: string;
  from: CursorPoint;
  ids: Array<number | string>;
}

/** In-memory session state; NOT persisted. One instance so every part of the bot (and the
 * console API) sees the same truth. */
export class RuntimeState {
  // ---- scheduling ----
  running = true;
  currentAction = 'idle';
  currentTarget = 'none';

  // ---- FTHOF / refill bookkeeping ----
  lockA = false;
  lastCpsBuffCount = 0;
  lastCpsSignature = '';
  lastClickFrenzy = false;
  refillInFlight = false;

  // ---- click bookkeeping ----
  lastGoldenClickAt = 0;
  lastClickAt = 0;
  nextBigClickAt = 0;
  goldenReadyAt = new Map<number, number>();
  route: RoutePlan | null = null;
  seenWrath = new Set<number>();

  // ---- idle / dance / hammer ----
  nextIdleAt = 0;
  idleStay = false;
  hammer = false;
  danceQueued = false;

  // ---- auto play (shopping) ----
  autoPlan: AutoPlan | null = null;
  autoNextEvalAt = 0;
  autoBlockUntil = 0;
  lastAutoBuyAt = 0;
  autoHand: AutoHandSample | null = null;
  autoWouldLog = new Map<string, number>();
  buyValueCache: { decision: Decision } | null = null;
  buyValueAt = 0;
  /** Remaining clicks of the Options, Stats, Stats "back to the buildings view" recipe. */
  buildingsViewSteps: Array<'prefsButton' | 'statsButton'> = [];
  buildingsViewStartedAt = 0;
  grimoireUnlockBlockUntil = 0;
  /** FT-8 preparation failed: cast FTHOF directly until then. */
  fthofPrepBlockUntil = 0;
  /** "Show grimoire" debug goal is active until then (0 = off). */
  showGrimoireGoalUntil = 0;
  /** Wrinkler popping (WRINK-*): the last plan, when to re-plan, and a pause after a failure. */
  wrinklerPlan: WrinklerPopPlan | null = null;
  wrinklerNextEvalAt = 0;
  wrinklerBlockUntil = 0;
  /** Debug tool "Pop a wrinkler": force one pop through the normal pipeline until then. */
  wrinklerForcePopUntil = 0;
  /** Krumblor (KRUMB-*): a pause after a failure, cursors sold before the sacrifice that are
   * still to be bought back, whether the paw opened the dragon's popup / aura picker (it only
   * closes / answers its own), and since when a step's element can't be found. */
  krumblorBlockUntil = 0;
  krumblorRebuy = 0;
  krumblorMenuOurs = false;
  krumblorPickerAt = 0;
  krumblorStuckSince = 0;
  /** Santa (XMAS-*): a pause after a failure, whether the paw opened Santa's popup (it only
   * closes its own), and since when a step's element can't be found. */
  santaBlockUntil = 0;
  santaMenuOurs = false;
  santaStuckSince = 0;
  /** Automatic ascension (ASC-10): whether the bot started the ascension on screen (it only
   * ever finishes its own) and when, a pause after a failure, since when a step's element
   * can't be found, heavenly upgrades it gave up on, failed purchases and tree drags per
   * crate. */
  ascendOurs = false;
  ascendOursAt = 0;
  ascendBlockUntil = 0;
  ascendStuckSince = 0;
  ascendSkip = new Set<string>();
  ascendFails = new Map<number, number>();
  ascendPans = new Map<number, number>();
  autoHammerState: AutoHammerState = freshAutoHammerState();

  // ---- paw animation ----
  cursorTilt = 0;
  lean = 0;
  leanState: { x: number; t: number } | null = null;
  pulseAt = 0;
  cursor: CursorPoint;
  /** Last trusted (real human) mouse position, or null until one has been seen. */
  userMouse: CursorPoint | null = null;
  /** Recent trusted (real human) clicks, used for the click-triggered paw dance. */
  userClicks: Array<{ x: number; y: number; t: number }> = [];

  // ---- timers / lifecycle ----
  panelTimer = 0;
  /** Delays the scheduler's start until the page settled (LIFE-1). */
  settleTimer = 0;
  /** The scheduler does nothing until then: the game settling after a reincarnation (ASC-10). */
  settleUntil = 0;
  schedulerTimer: IntervalHandle | 0 = 0;
  keepAlive: KeepAliveState = { ctx: null, state: 'off', listening: false };
  drawRaf = 0;
  graphTimer = 0;
  destroyed = false;

  constructor() {
    this.cursor = {
      x: Math.max(40, window.innerWidth * 0.55),
      y: Math.max(80, window.innerHeight * 0.45),
    };
  }

  /** A new run after reincarnating (ASC-10): forgets everything that belonged to the old run
   * (buff lock, plans, the Krumblor/Santa/wrinkler bookkeeping, the hammer calibration) and
   * holds the scheduler for `settleMs` while the game rebuilds its minigames. */
  resetForNewRun(settleMs: number, now = Date.now()): void {
    this.lockA = false;
    this.lastCpsBuffCount = 0;
    this.lastCpsSignature = '';
    this.refillInFlight = false;
    this.goldenReadyAt.clear();
    this.route = null;
    this.seenWrath.clear();

    this.autoPlan = null;
    this.autoNextEvalAt = 0;
    this.autoHand = null;
    this.buyValueCache = null;
    this.buyValueAt = 0;
    this.buildingsViewSteps = [];
    this.wrinklerPlan = null;
    this.wrinklerNextEvalAt = 0;
    this.krumblorRebuy = 0;
    this.krumblorMenuOurs = false;
    this.krumblorPickerAt = 0;
    this.krumblorStuckSince = 0;
    this.santaMenuOurs = false;
    this.santaStuckSince = 0;
    this.autoHammerState = freshAutoHammerState();

    this.ascendOurs = false;
    this.ascendOursAt = 0;
    this.ascendStuckSince = 0;
    this.ascendSkip.clear();
    this.ascendFails.clear();
    this.ascendPans.clear();

    this.settleUntil = now + settleMs;
  }
}

function freshAutoHammerState(): AutoHammerState {
  return {
    on: false,
    wanted: null,
    nextEvalAt: 0,
    nextProbeAt: 0,
    probeUntil: 0,
    probeT0: 0,
    probeH0: 0,
    cal: 1,
    share: 0,
  };
}
