import type { CursorAction, CursorJobContext } from '../cursor/types';

export interface ClickElementParams {
  label: string;
  el: Element | null;
  x: number;
  y: number;
  holdMs?: number;
  moveSpeed?: number;
  waitClickGap?: boolean;
  preClickPause?: boolean;
  abortOnGolden?: boolean;
  reacquire?: boolean;
  beforeMove?: (ctx: CursorJobContext) => boolean | Promise<boolean>;
  abortIf?: (ctx: CursorJobContext) => boolean;
  hud?: { action: string; target: string };
}

/** Move to (x, y) and dispatch a real synthetic click on `el` via ClickTiming.humanClick.
 * The generic one-shot action behind FTHOF/refill/golden/bored clicks. */
export class ClickElementAction implements CursorAction {
  readonly label: string;
  readonly target: { x: number; y: number };

  constructor(private readonly p: ClickElementParams) {
    this.label = p.label;
    this.target = { x: p.x, y: p.y };
  }

  get moveSpeed(): number | undefined {
    return this.p.moveSpeed;
  }

  get waitClickGap(): boolean | undefined {
    return this.p.waitClickGap;
  }

  get preClickPause(): boolean | undefined {
    return this.p.preClickPause;
  }

  get abortOnGolden(): boolean | undefined {
    return this.p.abortOnGolden;
  }

  get reacquire(): boolean | undefined {
    return this.p.reacquire;
  }

  get beforeMove(): ClickElementParams['beforeMove'] {
    return this.p.beforeMove;
  }

  get abortIf(): ClickElementParams['abortIf'] {
    return this.p.abortIf;
  }

  get hud(): ClickElementParams['hud'] {
    return this.p.hud;
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    await ctx.clickTiming.humanClick(this.p.el, this.p.x, this.p.y, this.p.holdMs);
  }
}

export interface MoveParams {
  label: string;
  x: number;
  y: number;
  moveSpeed?: number;
  moveMaxMs?: number;
  abortOnGolden?: boolean;
  abortIf?: (ctx: CursorJobContext) => boolean;
  hud?: { action: string; target: string };
}

/** Move somewhere and do nothing (look-only visits, idle drift). */
export class MoveAction implements CursorAction {
  readonly label: string;
  readonly target: { x: number; y: number };

  constructor(private readonly p: MoveParams) {
    this.label = p.label;
    this.target = { x: p.x, y: p.y };
  }

  get moveSpeed(): number | undefined {
    return this.p.moveSpeed;
  }

  get moveMaxMs(): number | undefined {
    return this.p.moveMaxMs;
  }

  get waitClickGap(): boolean {
    return false;
  }

  get preClickPause(): boolean {
    return false;
  }

  get abortOnGolden(): boolean | undefined {
    return this.p.abortOnGolden;
  }

  get abortIf(): MoveParams['abortIf'] {
    return this.p.abortIf;
  }

  get hud(): MoveParams['hud'] {
    return this.p.hud;
  }

  cursor_at_position(): void {
    /* look only */
  }
}

export interface VisualPressParams {
  label: string;
  x: number;
  y: number;
  /** Optional pause before the pulse (auto-shop currently waits ~90ms after arriving). */
  pulseBeforeMs?: number;
  /** Pause after the pulse (auto-shop currently waits ~70ms before re-checking). */
  pulseAfterMs?: number;
  moveSpeed?: number;
  abortOnGolden?: boolean;
  abortIf?: (ctx: CursorJobContext) => boolean;
  hud?: { action: string; target: string };
}

/** Move somewhere and only fire the paw's click pulse — NO click is dispatched. Used by
 * auto-shop, which buys through the game API but must still look like it pressed the item
 * (NFR-8/AUTO-9). */
export class VisualPressAction implements CursorAction {
  readonly label: string;
  readonly target: { x: number; y: number };

  constructor(private readonly p: VisualPressParams) {
    this.label = p.label;
    this.target = { x: p.x, y: p.y };
  }

  get moveSpeed(): number | undefined {
    return this.p.moveSpeed;
  }

  get waitClickGap(): boolean {
    return false;
  }

  get preClickPause(): boolean {
    return false;
  }

  get abortOnGolden(): boolean | undefined {
    return this.p.abortOnGolden;
  }

  get abortIf(): VisualPressParams['abortIf'] {
    return this.p.abortIf;
  }

  get hud(): VisualPressParams['hud'] {
    return this.p.hud;
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    if (this.p.pulseBeforeMs) {
      await ctx.clock.sleep(this.p.pulseBeforeMs);
    }

    ctx.runtime.pulseAt = performance.now();

    await ctx.clock.sleep(this.p.pulseAfterMs ?? 70);
  }
}
