import type { PersistedData } from '../core/persisted-data';
import type { CursorPoint, RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import type { HurryMode } from '../game/hurry-mode';
import type { BackgroundClock } from '../input/background-clock';
import type { MoveCursorOpts } from '../input/cursor-controller';

/** SCHED-1 priority order as numeric job priorities. Lower runs first. */
export const JOB_PRIORITY = {
  GOLDEN: 0,
  CLICK_FRENZY: 1,
  FTHOF: 2,
  REFILL: 3,
  LUMP_HARVEST: 4,
  AUTO_SHOP: 5,
  HAMMER: 6,
  HAPPY_DANCE: 7,
  IDLE: 8,
} as const;

/** The low-level cursor travel surface the CursorManager uses. CursorController satisfies
 * this structurally; tests can pass a fake. */
export interface CursorMover {
  setPosition(x: number, y: number): void;
  moveCursorTo(x: number, y: number, abortForGolden: boolean, opts?: MoveCursorOpts): Promise<boolean>;
  glideCursor(x: number, y: number, ms: number, abortIf?: () => boolean): Promise<boolean>;
}

/** The click-delay / pre-click-pause / humanClick surface the CursorManager uses.
 * ClickTiming satisfies this structurally; tests can pass a fake. */
export interface CursorClickTiming {
  getClickDelayMs(): number;
  getPreClickDelayMs(): number;
  waitUntil(ts: number, abortForGolden?: boolean, abortIf?: () => boolean): Promise<boolean>;
  waitForClickGap(abortForGolden?: boolean, abortIf?: () => boolean): Promise<boolean>;
  waitPreClick(abortForGolden?: boolean, abortIf?: () => boolean): Promise<boolean>;
  humanClick(el: Element | null, x: number, y: number, holdMs?: number): Promise<boolean>;
}

/** Everything an action can see while its job runs. */
export interface CursorJobContext {
  runtime: RuntimeState;
  data: PersistedData;
  game: IGameAdapter;
  hurry: HurryMode;
  clock: BackgroundClock;
  cursor: CursorMover;
  clickTiming: CursorClickTiming;
  enqueue: (action: CursorAction, opts?: EnqueueOpts) => CursorJob;
  /** True when a higher-priority job wants in (or this job was cancelled). Continuous
   * actions must poll this inside their loops so preemption stays within ~a frame. */
  abortRequested: () => boolean;
}

/** One unit of cursor work. One-shot actions click (or pulse) in `cursor_at_position` and
 * return; continuous actions (hammer/dance/ponder) run their whole loop there and only
 * return when finished or preempted. */
export interface CursorAction {
  /** Human/debug label, e.g. 'click golden cookie', 'buy Cursor'. */
  label: string;
  /** Where to move before calling cursor_at_position. A static point, or a getter that is
   * re-evaluated at travel time (and after the pre-click pause when `reacquire` is set).
   * null/undefined = no travel; call cursor_at_position at the current position. A getter
   * returning null cancels the job (the target vanished). */
  target?: CursorPoint | (() => CursorPoint | null) | null;
  /** Optional per-job travel speed (px/s). Undefined = the default from config /
   * hurry factor, exactly like CursorController.moveCursorTo does today. */
  moveSpeed?: number;
  /** Optional per-job travel duration clamp (ms). */
  moveMaxMs?: number;
  /** Wait 'Patience before moving' since the previous click before travelling.
   * Default true. Ignored when `beforeMove` is set. */
  waitClickGap?: boolean;
  /** Wait 'Shy pause before click' after arrival. Default true. */
  preClickPause?: boolean;
  /** Abort travel/pause when a good golden cookie becomes ready. Default true. Golden
   * cookie jobs themselves set this to false. */
  abortOnGolden?: boolean;
  /** Re-evaluate target() after the pre-click pause and settle again if it moved
   * (golden cookies pulse). Default false. */
  reacquire?: boolean;
  /** Optional pre-travel step (e.g. a reaction delay tied to a specific event). Returning
   * false cancels the job. When set, it replaces the generic click-gap wait. */
  beforeMove?: (ctx: CursorJobContext) => boolean | Promise<boolean>;
  /** Checked before and during wait/travel, and once more right before
   * cursor_at_position. Returning true aborts the job. */
  abortIf?: (ctx: CursorJobContext) => boolean;
  /** HUD state while the job runs. */
  hud?: { action: string; target: string };
  /** Called by the queue at the click-at position (or immediately when there is no
   * target). */
  cursor_at_position(ctx: CursorJobContext): Promise<void> | void;
}

export type CursorJobState = 'queued' | 'running' | 'done' | 'cancelled';

export type CursorJobOutcome = 'done' | 'cancelled';

/** An enqueued instance of an action. */
export interface CursorJob {
  id: number;
  action: CursorAction;
  priority: number;
  label: string;
  /** Optional dedup key, e.g. `golden:${shimmer.id}`. Only one active job per key. */
  key?: string;
  /** Earliest time (epoch ms) the job may start. 0 = ready now. */
  dueAt: number;
  state: CursorJobState;
  /** Resolves once the job settles (done or cancelled). Lets an interim task-based
   * module await its enqueued job; continuous actions resolve when their loop returns. */
  done: Promise<CursorJobOutcome>;
}

export interface EnqueueOpts {
  priority?: number;
  key?: string;
  dueAt?: number;
}

/** What a module hands to the scheduler/producer in later phases. */
export interface JobRequest {
  action: CursorAction;
  priority: number;
  key?: string;
  dueAt?: number;
}
