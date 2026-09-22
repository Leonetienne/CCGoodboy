import type { CursorAction, CursorJobContext } from '../cursor/types';
import { getBuildingLevelButton } from '../game/buildings-view-dom';
import { visibleRect } from '../game/dom-geometry';
import { elementCenter } from '../game/grimoire-dom';
import { dispatchMouse } from '../input/dispatch';

/** One-shot job that clicks the Wizard tower's "lvl" button to spend a sugar lump on level 1,
 * which unlocks the Grimoire minigame. The button must be on screen (the unlocker scrolls it
 * into view first); the preconditions are re-checked right before the click (FT-4 pattern).
 * The game's "ask before spending lumps" confirmation is suppressed for the click, the same
 * way RefillAction does it. */
export class GrimoireUnlockAction implements CursorAction {
  readonly label = 'unlock grimoire';
  readonly hud = { action: 'grimoire-unlock', target: 'Wizard tower level 1 (Grimoire)' };

  constructor(
    private readonly buildingId: number,
    private readonly stillWanted: () => boolean,
    private readonly readLevel: () => number,
    private readonly onResult: (leveled: boolean, level: number) => void,
  ) {}

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
