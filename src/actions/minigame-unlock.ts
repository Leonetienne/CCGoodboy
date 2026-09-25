import type { CursorAction, CursorJobContext } from '../cursor/types';
import { getBuildingLevelButton } from '../game/buildings-view-dom';
import { visibleRect } from '../game/dom-geometry';
import { elementCenter } from '../game/grimoire-dom';
import { dispatchMouse } from '../input/dispatch';

/** One-shot job that clicks a building's "lvl" button to spend a sugar lump on level 1, which
 * unlocks its minigame (the Wizard tower's Grimoire, AUTO-13; the Bank's stock market,
 * AUTO-16). The button must be on screen (the caller scrolls it into view first); the
 * preconditions are re-checked right before the click (FT-4 pattern). The game's "ask before
 * spending lumps" confirmation is suppressed for the click, the same way RefillAction does
 * it. */
export class MinigameUnlockAction implements CursorAction {
  readonly label: string;
  readonly hud: { action: string; target: string };

  constructor(
    private readonly buildingId: number,
    info: { label: string; hud: { action: string; target: string } },
    private readonly stillWanted: () => boolean,
    private readonly readLevel: () => number,
    private readonly onResult: (leveled: boolean, level: number) => void,
  ) {
    this.label = info.label;
    this.hud = info.hud;
  }

  target(): { x: number; y: number } | null {
    return elementCenter(getBuildingLevelButton(this.buildingId));
  }

  abortIf(): boolean {
    return !visibleRect(getBuildingLevelButton(this.buildingId)) || !this.stillWanted();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const btn = getBuildingLevelButton(this.buildingId);
    if (!btn || !btn.isConnected) return;

    const before = this.readLevel();
    const oldAskLumps = ctx.game.getAskLumpsPref();
    const { x, y } = ctx.runtime.cursor;

    try {
      ctx.game.setAskLumpsPref(0);
      await ctx.clickTiming.humanClick(btn, x, y);
    } finally {
      ctx.game.setAskLumpsPref(oldAskLumps);
    }

    // the level button shows a tooltip on mouseover; let it go again (cosmetic only)
    try {
      dispatchMouse(btn, 'mouseout', x, y, 0);
    } catch (_e) {
      /* ignore */
    }

    const after = this.readLevel();
    this.onResult(after > before, after);
  }
}
