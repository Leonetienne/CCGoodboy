import type { CursorAction, CursorJobContext } from '../cursor/types';
import { visibleRect } from '../game/dom-geometry';
import { elementCenter } from '../game/grimoire-dom';
import { dispatchMouse } from '../input/dispatch';

export interface MarketClickParams {
  label: string;
  /** The stock market button (a trade button, or "Hire"), re-resolved at click time. */
  element: () => Element | null;
  /** The number the click should change (a good's stock, the broker count), read right
   * before and after the click. */
  read: () => number;
  /** Re-checked before travelling and right before the click (FT-4 pattern). */
  stillWanted: () => boolean;
  onResult: (changed: boolean, before: number, after: number) => void;
  hudTarget: string;
}

/** One click on a real stock market button (STOCK-*): the paw travels onto it and clicks it
 * (NFR-8 a), so the game's own handler (M.buyGood / M.sellGood / hiring) does the trade.
 * The button must be on screen: the trader scrolls it into view first. Afterwards the
 * button's tooltip is let go again and the result is reported by what changed. */
export class MarketClickAction implements CursorAction {
  readonly label: string;
  readonly hud: { action: string; target: string };

  constructor(private readonly p: MarketClickParams) {
    this.label = p.label;
    this.hud = { action: 'stock-market', target: p.hudTarget };
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

    await ctx.clickTiming.humanClick(el, x, y);

    // the button shows a trade tooltip on mouseover; let it go again (cosmetic only)
    try {
      dispatchMouse(el, 'mouseout', x, y, 0);
    } catch (_e) {
      /* ignore */
    }

    const after = this.p.read();
    this.p.onResult(after !== before, before, after);
  }
}
