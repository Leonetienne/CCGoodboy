import type { CursorAction, CursorJobContext } from '../cursor/types';

/** Frames the game needs to notice a click (its logic runs at 30 fps). */
const SETTLE_MS = 150;

export interface DragonClickParams {
  label: string;
  target: string;
  /** Where to click; null cancels the job (the element went away). */
  point: () => { x: number; y: number } | null;
  /** The element that receives the synthetic click (the canvas for the dragon's tab). */
  el: () => Element | null;
  stillWanted: () => boolean;
  /** Checked SETTLE_MS after the click: did the click do what it should? */
  onResult: (ok: boolean) => void;
  worked: () => boolean;
}

/** One real synthetic click in Krumblor's UI (KRUMB-3): the dragon's tab on the left canvas,
 * the popup's train button, its aura slot, the aura picker's crate / Confirm, the popup's
 * close "x". Conditions are re-checked right before the click (FT-4 pattern). */
export class DragonClickAction implements CursorAction {
  readonly label: string;
  readonly hud: { action: string; target: string };

  constructor(private readonly p: DragonClickParams) {
    this.label = p.label;
    this.hud = { action: 'krumblor', target: p.target };
  }

  target(): { x: number; y: number } | null {
    return this.p.point();
  }

  abortIf(): boolean {
    return !this.p.stillWanted() || !this.p.el();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const el = this.p.el();
    if (!el) return;

    await ctx.clickTiming.humanClick(el, ctx.runtime.cursor.x, ctx.runtime.cursor.y);
    await ctx.clock.sleep(SETTLE_MS);

    this.p.onResult(this.p.worked());
  }
}

export interface DragonStoreParams {
  label: string;
  target: string;
  /** The store element to visit (null: pulse where the paw is). */
  point: { x: number; y: number } | null;
  stillWanted: () => boolean;
  /** The game API call (buy/sell); runs right at the click pulse. */
  run: () => void;
}

/** A store action done through the game's own API (the egg upgrade, selling / buying
 * cursors): the paw visits the store item and does the click pulse the moment the call fires
 * (NFR-8 b, like AUTO-9), so the store's buy/sell and bulk modes can never cause a mistake. */
export class DragonStoreAction implements CursorAction {
  readonly label: string;
  readonly target: { x: number; y: number } | null;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly hud: { action: string; target: string };

  constructor(private readonly p: DragonStoreParams) {
    this.label = p.label;
    this.target = p.point;
    this.hud = { action: 'krumblor', target: p.target };
  }

  abortIf(): boolean {
    return !this.p.stillWanted();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    if (this.p.point) await ctx.clock.sleep(90);
    if (!this.p.stillWanted()) return;

    ctx.runtime.pulseAt = performance.now();
    this.p.run();

    await ctx.clock.sleep(70);
  }
}
