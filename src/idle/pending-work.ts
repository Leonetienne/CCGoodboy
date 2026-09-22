import type { IGameAdapter } from '../game/game-adapter';

/** True when real work is waiting (hammer mode, a ready golden cookie, Click Frenzy, FTHOF,
 * refill, a due auto purchase), so idle play / the dance must stop at once. Mirrors the
 * scheduler's priorities: this is the ONE place that logic lives, injected into both the
 * scheduler and idle/happy-dance so they can never drift out of sync. */
export class PendingWork {
  constructor(
    private readonly game: IGameAdapter,
    private readonly hasGoodGolden: () => boolean,
    private readonly hammerActive: () => boolean,
    private readonly fthofOrRefillPending: () => boolean,
    private readonly autoShopReady: () => boolean,
  ) {}

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

    return this.fthofOrRefillPending() || this.autoShopReady();
  }
}
