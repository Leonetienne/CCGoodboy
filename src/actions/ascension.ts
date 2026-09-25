import type { CursorAction, CursorJobContext } from '../cursor/types';

/** Longest the paw sits out one wait (the ascend animation is ~5s at 30 fps). */
const MAX_WAIT_MS = 15000;
/** How long the paw's drag across the tree takes, and how long the tree then needs to ease
 * into place (the game moves it half the way per frame). */
const DRAG_MS = 380;
const SETTLE_MS = 350;

/** Keeps the paw still (and everything below its priority out) while `waiting()` holds: the
 * ascend animation (ASC-10), or the wait for a committed ascension's level at `point` (the
 * Legacy button, ASC-12). No click. */
export class WaitWhileAction implements CursorAction {
  readonly target: (() => { x: number; y: number } | null) | null;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly abortOnGolden = false;
  readonly hud: { action: string; target: string };

  constructor(
    readonly label: string,
    target: string,
    private readonly waiting: () => boolean,
    point: (() => { x: number; y: number } | null) | null = null,
  ) {
    this.hud = { action: 'ascend', target };
    this.target = point;
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const until = Date.now() + MAX_WAIT_MS;

    while (this.waiting() && !ctx.abortRequested() && Date.now() < until) {
      await ctx.clock.sleep(100);
    }
  }
}

export interface DragTreeParams {
  label: string;
  target: string;
  /** How far to drag, looked up when the paw is there (null: nothing to drag to). */
  delta: () => { dx: number; dy: number } | null;
  /** The game call that pans the tree (like the game's own mouse drag). */
  pan: (dx: number, dy: number) => void;
  stillWanted: () => boolean;
}

/** Drags the heavenly tree so a crate comes into view (ASC-10): the paw presses in the middle
 * of the screen, the tree is panned through the game (NFR-8 b) and the paw slides along the
 * drag, then waits for the tree to ease into place. */
export class DragTreeAction implements CursorAction {
  readonly label: string;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly hud: { action: string; target: string };

  constructor(private readonly p: DragTreeParams) {
    this.label = p.label;
    this.hud = { action: 'ascend', target: p.target };
  }

  target(): { x: number; y: number } {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  abortIf(): boolean {
    return !this.p.stillWanted();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const d = this.p.delta();
    if (!d) return;

    // The paw's slide shows the direction; the tree itself may move much further.
    const len = Math.hypot(d.dx, d.dy) || 1;
    const show = Math.min(len, Math.min(window.innerWidth, window.innerHeight) * 0.3) / len;
    const { x, y } = ctx.runtime.cursor;

    ctx.runtime.pulseAt = performance.now();
    this.p.pan(d.dx, d.dy);

    await ctx.cursor.glideCursor(x + d.dx * show, y + d.dy * show, DRAG_MS, () => ctx.abortRequested());
    await ctx.clock.sleep(SETTLE_MS);
  }
}
