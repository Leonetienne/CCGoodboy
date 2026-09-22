import type { IGameAdapter } from '../game/game-adapter';
import type { CursorManager } from '../cursor/cursor-manager';

/** True when real work is waiting (hammer mode, a ready golden cookie, Click Frenzy, FTHOF,
 * refill, a ripe sugar lump, a due auto purchase, or a higher-priority job already in the
 * cursor queue), so idle play / the dance must stop at once. Mirrors the scheduler's
 * priorities: this is the ONE place that logic lives, injected into the scheduler and
 * idle/happy-dance so they can never drift out of sync. */
export class PendingWork {
  constructor(
    private readonly game: IGameAdapter,
    private readonly hasGoodGolden: () => boolean,
    private readonly hammerActive: () => boolean,
    private readonly fthofOrRefillPending: () => boolean,
    private readonly lumpHarvestPending: () => boolean,
    private readonly autoShopReady: () => boolean,
    private readonly cursorManager: CursorManager,
  ) {}

  /** Conditions that mean real work is waiting regardless of the queue. */
  isPending(): boolean {
    if (!this.game.isPresent() || !this.game.isReady()) {
      return false;
    }

    if (this.hammerActive()) {
      return true;
    }

    if (this.hasGoodGolden() || this.game.clickFrenzyActive()) {
      return true;
    }

    return this.fthofOrRefillPending() || this.lumpHarvestPending() || this.autoShopReady();
  }

  /** Same conditions, plus any queued/running job more important than `priority`. Callers
   * pass their own priority tier so a job never aborts itself. */
  isPendingAbove(priority: number): boolean {
    return this.isPending() || this.cursorManager.hasJobsAbove(priority);
  }
}
