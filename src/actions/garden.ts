import type { CursorAction, CursorJobContext } from '../cursor/types';
import { visibleRect } from '../game/dom-geometry';
import { elementCenter } from '../game/grimoire-dom';
import { dispatchMouse } from '../input/dispatch';

export interface GardenClickParams {
  label: string;
  /** The garden control (a plot tile, a seed, a soil), re-resolved at click time. */
  element: () => Element | null;
  /** What the click should change (the tile's plant, the selected seed, the soil), read right
   * before and after the click. */
  read: () => string;
  /** Re-checked before travelling and right before the click (FT-4 pattern): a tile click on
   * the wrong plant would unearth it. */
  stillWanted: () => boolean;
  /** Called right before the click (e.g. to note the bank for a payout). */
  beforeClick?: () => void;
  onResult: (changed: boolean, before: string, after: string) => void;
  hudTarget: string;
}

/** One click on a real garden control (GARDEN-*): the paw travels onto it and clicks it
 * (NFR-8 a), so the game's own handler plants, harvests, selects the seed or changes the
 * soil. The control must be on screen: the gardener scrolls it into view first. Afterwards
 * its tooltip is let go again and the result is reported by what changed. */
export class GardenClickAction implements CursorAction {
  readonly label: string;
  readonly hud: { action: string; target: string };

  constructor(private readonly p: GardenClickParams) {
    this.label = p.label;
    this.hud = { action: 'garden', target: p.hudTarget };
  }

  target(): { x: number; y: number } | null {
    return elementCenter(this.p.element());
  }

  abortIf(): boolean {
    return !visibleRect(this.p.element()) || !this.p.stillWanted();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const el = this.p.element();
    if (!el || !el.isConnected) return;

    const before = this.p.read();
    const { x, y } = ctx.runtime.cursor;

    if (this.p.beforeClick) this.p.beforeClick();
    await ctx.clickTiming.humanClick(el, x, y);

    // garden controls show a tooltip on mouseover; let it go again (cosmetic only)
    try {
      dispatchMouse(el, 'mouseout', x, y, 0);
    } catch (_e) {
      /* ignore */
    }

    const after = this.p.read();
    this.p.onResult(after !== before, before, after);
  }
}
