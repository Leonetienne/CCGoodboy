import type { RuntimeState } from '../core/runtime-state';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import { centeredScrollTop, getCenterArea, getMenuButton, getMinigameButton, type MenuButtonId } from '../game/buildings-view-dom';
import { visibleRect } from '../game/dom-geometry';
import { elementCenter } from '../game/grimoire-dom';
import { clampPawPoint } from '../input/paw-bounds';

const MENU_BUTTON_NAMES: Record<MenuButtonId, string> = {
  prefsButton: 'Options button',
  statsButton: 'Stats button',
};

/** One click on a menu panel button (Options / Stats), as one step of the "back to the
 * buildings view" recipe. Like FT-7, if the button is not on screen the click still fires on
 * the real control from wherever the paw already is. `onClicked` runs only once the click was
 * actually dispatched, so a preempted step is simply retried. */
export class MenuButtonAction implements CursorAction {
  readonly label: string;
  readonly hud: { action: string; target: string };

  constructor(
    private readonly runtime: RuntimeState,
    private readonly buttonId: MenuButtonId,
    private readonly shouldAbort: () => boolean,
    private readonly onClicked: () => void,
  ) {
    this.label = `click ${buttonId}`;
    this.hud = { action: 'buildings-view', target: MENU_BUTTON_NAMES[buttonId] };
  }

  target(): { x: number; y: number } {
    return elementCenter(getMenuButton(this.buttonId)) || { x: this.runtime.cursor.x, y: this.runtime.cursor.y };
  }

  abortIf(): boolean {
    const el = getMenuButton(this.buttonId);
    return !el || !el.isConnected || this.shouldAbort();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const el = getMenuButton(this.buttonId);
    if (!el || !el.isConnected) return;

    if (await ctx.clickTiming.humanClick(el, ctx.runtime.cursor.x, ctx.runtime.cursor.y)) {
      this.onClicked();
    }
  }
}

export interface ScrollIntoViewParams {
  label: string;
  /** The element to bring into view, re-resolved on every wheel tick. */
  element: () => Element | null;
  abortIf?: () => boolean;
  /** Called when scrolling ends (not when preempted), with whether the element is now on
   * screen. */
  onDone?: (inView: boolean) => void;
  hud?: { action: string; target: string };
}

/** Rests the paw over the #centerArea column and scrolls it like a mouse wheel (ticks of
 * ~70-120px with short pauses) until the element sits in the middle of the column, or the
 * column cannot scroll any further. No click is sent: scrolling only moves the view. */
export class ScrollIntoViewAction implements CursorAction {
  readonly label: string;
  readonly waitClickGap = false;
  readonly preClickPause = false;

  /** Fixed per job so re-resolving the target doesn't make the paw jitter around. */
  private readonly fx = 0.35 + Math.random() * 0.3;
  private readonly fy = 0.4 + Math.random() * 0.2;

  constructor(private readonly p: ScrollIntoViewParams) {
    this.label = p.label;
  }

  get hud(): ScrollIntoViewParams['hud'] {
    return this.p.hud;
  }

  target(): { x: number; y: number } | null {
    const r = visibleRect(getCenterArea());
    if (!r) return null;

    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, window.innerHeight);

    return clampPawPoint(r.left + r.width * this.fx, top + (bottom - top) * this.fy);
  }

  abortIf(): boolean {
    return !getCenterArea() || !this.p.element() || !!(this.p.abortIf && this.p.abortIf());
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const area = getCenterArea();
    if (!area) return;

    const aborted = () => ctx.abortRequested() || this.abortIf();

    // settle the "finger" on the wheel
    await ctx.clock.sleep(60 + Math.random() * 80);

    for (let tick = 0; tick < 200; tick++) {
      if (aborted()) return;

      const el = this.p.element();
      if (!el) return;

      const remaining = centeredScrollTop(area, el) - area.scrollTop;
      if (Math.abs(remaining) < 2) break;

      const step = Math.sign(remaining) * Math.min(Math.abs(remaining), 70 + Math.random() * 50);
      const from = area.scrollTop;

      // each wheel notch glides over a few frames, like smooth scrolling
      for (let f = 1; f <= 3; f++) {
        area.scrollTop = from + (step * f) / 3;
        await ctx.clock.sleep(16);
        if (aborted()) return;
      }

      if (Math.abs(area.scrollTop - from) < 1) break; // hit the end of the column

      await ctx.clock.sleep(20 + Math.random() * 50);
    }

    if (this.p.onDone) this.p.onDone(!!visibleRect(this.p.element()));
  }
}

/** Clicks a building's "View <minigame>" button (e.g. "View Grimoire") to open its minigame.
 * The button TOGGLES, so `alreadyOpen` is re-checked right before the click (via abortIf):
 * clicking it on an already open minigame would close it again. */
export class MinigameButtonAction implements CursorAction {
  readonly label: string;
  readonly hud: { action: string; target: string };

  constructor(
    private readonly buildingId: number,
    minigameName: string,
    private readonly alreadyOpen: () => boolean,
    private readonly shouldAbort: () => boolean,
  ) {
    this.label = `open ${minigameName}`;
    this.hud = { action: 'buildings-view', target: `View ${minigameName}` };
  }

  target(): { x: number; y: number } | null {
    return elementCenter(getMinigameButton(this.buildingId));
  }

  abortIf(): boolean {
    return !visibleRect(getMinigameButton(this.buildingId)) || this.alreadyOpen() || this.shouldAbort();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const el = getMinigameButton(this.buildingId);
    if (!el || !el.isConnected || this.alreadyOpen()) return;

    await ctx.clickTiming.humanClick(el, ctx.runtime.cursor.x, ctx.runtime.cursor.y);
  }
}
