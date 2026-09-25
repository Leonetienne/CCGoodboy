import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { AscensionPlanner } from '../autoplay/ascension';
import type { AscensionRunner } from '../autoplay/ascension-runner';
import { drawAscensionOverlay } from '../autoplay/ascension-overlay';
import type { AutoPlayEngine } from '../autoplay/shopping';
import { drawBuyValueOverlay } from '../autoplay/buy-value-overlay';
import type { IGameAdapter } from '../game/game-adapter';
import { drawHitboxes, type HitboxOverlayDeps } from '../hunting/hitbox-overlay';
import type { PawCursor } from '../rendering/paw-cursor';

/** Per-frame overlay drawing (requestAnimationFrame): planned route, cookie hitboxes, the
 * "how good is a buy" overlay, the ascension overlay (ASC-6/7), and finally the paw. Does nothing but clear when 'Pretty
 * overlays' is off (the paw itself is not drawn either in that case, matching the original). */
export class OverlayLoop {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly game: IGameAdapter,
    private readonly autoPlay: AutoPlayEngine,
    private readonly ascension: AscensionPlanner,
    private readonly ascensionRunner: AscensionRunner,
    private readonly pawCursor: PawCursor,
    private readonly hitboxDeps: HitboxOverlayDeps,
  ) {}

  private tick = (): void => {
    this.runtime.drawRaf = requestAnimationFrame(this.tick);

    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    if (!this.data.config.visuals) {
      return;
    }

    this.ctx.globalAlpha = this.data.config.overlayOpacity ?? 1;

    drawHitboxes(this.ctx, this.hitboxDeps);

    if (this.data.config.showBuyValue !== false) {
      drawBuyValueOverlay(this.ctx, this.game, this.autoPlay);
    }

    if (this.data.config.showAscendOverlay !== false) {
      drawAscensionOverlay(this.ctx, this.game, this.ascension, this.ascensionRunner.botLine(), this.runtime.userMouse);
    }

    this.pawCursor.updateLean();
    this.pawCursor.draw(this.ctx, this.runtime.cursor.x, this.runtime.cursor.y);
  };

  start(): void {
    this.tick();
  }
}
