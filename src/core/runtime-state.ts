import type { AutoPlan } from '../autoplay/shopping';
import type { Decision } from '../autoplay/strategy';
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
  autoHammerState: AutoHammerState = {
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
}
