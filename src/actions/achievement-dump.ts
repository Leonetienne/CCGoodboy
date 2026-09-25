import { AUTO_STREAK_JITTER_MS, AUTO_STREAK_JITTER_X, AUTO_STREAK_JITTER_Y, AUTO_STREAK_RATE } from '../autoplay/buy-streak';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import { visibleRect } from '../game/dom-geometry';
import { elementCenter } from '../game/grimoire-dom';

export interface AchievementDumpParams {
  name: string;
  target: number;
  /** Copies to buy on this visit. */
  count: number;
  /** The building's store row (#product{id}), looked up fresh. */
  row: () => Element | null;
  /** Buys ONE copy through the game (buy mode only); true when it was bought. */
  buyOne: () => boolean;
  /** Re-checked before travelling and before every copy. */
  stillWanted: () => boolean;
  onDone: (bought: number) => void;
}

/** ASC-13: the paw goes to a building's row and buys it one copy at a time, ~10 per second
 * with the press point wandering on the row (like AUTO-14's streak), a pulse for every copy the
 * moment it is bought (NFR-8 b), until the achievement's count is reached. */
export class AchievementDumpAction implements CursorAction {
  readonly label: string;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly hud: { action: string; target: string };

  constructor(private readonly p: AchievementDumpParams) {
    this.label = `buy ${p.name} for an achievement`;
    this.hud = { action: 'ascend', target: `${p.name} to ${p.target} (achievement)` };
  }

  target(): { x: number; y: number } | null {
    return elementCenter(this.p.row());
  }

  abortIf(): boolean {
    return !this.p.stillWanted();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const interval = 1000 / AUTO_STREAK_RATE;
    let bought = 0;
    let due = performance.now();

    try {
      while (bought < this.p.count) {
        if (ctx.abortRequested() || !this.p.stillWanted()) break;

        const r = visibleRect(this.p.row());

        if (r && bought > 0) {
          const jx = Math.min(AUTO_STREAK_JITTER_X, r.width / 4);
          const jy = Math.min(AUTO_STREAK_JITTER_Y, r.height / 4);
          await ctx.cursor.glideCursor(
            r.left + r.width / 2 + (Math.random() * 2 - 1) * jx,
            r.top + r.height / 2 + (Math.random() * 2 - 1) * jy,
            18 + Math.random() * 14,
            () => ctx.abortRequested(),
          );
        }

        // visual press, and the purchase at that very moment
        ctx.runtime.pulseAt = performance.now();
        if (!this.p.buyOne()) break;
        bought++;

        due += interval + (Math.random() * 2 - 1) * AUTO_STREAK_JITTER_MS;
        await ctx.clock.sleep(Math.max(0, due - performance.now()));
      }
    } finally {
      this.p.onDone(bought);
    }
  }
}
