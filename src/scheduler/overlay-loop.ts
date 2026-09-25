import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { AscensionPlanner } from '../autoplay/ascension';
import type { AscensionRunner } from '../autoplay/ascension-runner';
import { drawAscensionOverlay } from '../autoplay/ascension-overlay';
import type { AutoPlayEngine } from '../autoplay/shopping';
import { drawBuyValueOverlay } from '../autoplay/buy-value-overlay';
import type { IGameAdapter } from '../game/game-adapter';
import { looseRect, visibleRect } from '../game/dom-geometry';
import type { HurryMode } from '../game/hurry-mode';
import { isReindeer } from '../game/golden-cookie-model';
import type { GameShimmer } from '../game/types';
import { clampInt } from '../core/constants';
import { collectHunt, drawHitboxes, type HitboxOverlayDeps, type HuntSnapshot } from '../hunting/hitbox-overlay';
import { HuntFx, buffMultiplier, type HuntFxFrame, type HuntFxTarget } from '../rendering/hunt-fx';
import type { PawCursor } from '../rendering/paw-cursor';

/** A trip's rough length for the approach circle's timing (FX-2). */
const APPROACH_TRIP_MS = 250;

/** Per-frame overlay drawing (requestAnimationFrame): the hunting show's back layer (FX-*),
 * planned route, cookie hitboxes, the "how good is a buy" overlay, the ascension overlay
 * (ASC-6/7), the hunting show's front layer, and finally the paw. Does nothing but clear when
 * 'Pretty overlays' is off (the paw itself is not drawn either in that case, matching the
 * original). */
export class OverlayLoop {
  private readonly huntFx = new HuntFx();
  private readonly reducedMotion =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

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
    private readonly hurryMode: HurryMode,
  ) {}

  private tick = (): void => {
    this.runtime.drawRaf = requestAnimationFrame(this.tick);

    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    if (!this.data.config.visuals) {
      this.runtime.huntFxEvents.length = 0;
      return;
    }

    this.ctx.globalAlpha = this.data.config.overlayOpacity ?? 1;

    const hunt = collectHunt(this.hitboxDeps);
    const fx = this.huntFrame(hunt);

    if (fx) {
      this.huntFx.drawBack(this.ctx, fx);
    }

    drawHitboxes(this.ctx, this.hitboxDeps, hunt);

    if (this.data.config.showBuyValue !== false) {
      drawBuyValueOverlay(this.ctx, this.game, this.autoPlay);
    }

    if (this.data.config.showAscendOverlay !== false) {
      drawAscensionOverlay(this.ctx, this.game, this.ascension, this.ascensionRunner.botLine(), this.runtime.userMouse);
    }

    if (fx) {
      this.huntFx.drawFront(this.ctx, fx);
    }

    this.pawCursor.updateLean();
    this.pawCursor.draw(this.ctx, this.runtime.cursor.x, this.runtime.cursor.y);
  };

  /** FX-1: advances the hunting show and returns what it draws this frame, or null while it
   * is switched off or has nothing to show. */
  private huntFrame(hunt: HuntSnapshot): HuntFxFrame | null {
    const now = performance.now();

    if (this.data.config.huntFx === false) {
      this.runtime.huntFxEvents.length = 0;
      return null;
    }

    this.huntFx.consume(this.runtime.huntFxEvents, now);

    const storm = this.hurryMode.cookieStormActive();
    const chain = this.game.getGoldenChainCount();
    const active = hunt.queue.length > 0 || hunt.shimmers.pending.length > 0 || storm || chain > 0;

    this.huntFx.step(now, active, storm || chain > 0);

    const multiplier = buffMultiplier(this.game.getRawBuffs());

    // The multiplier counter (FX-4) can pop up on a buff change without the light show.
    if (!this.huntFx.busy(now) && !active && Math.abs(multiplier - 1) < 1e-9) {
      return null;
    }

    const queue: HuntFxTarget[] = [];

    for (const item of hunt.queue) {
      const t = target(item.shimmer, visibleRect(item.shimmer.l));
      if (t) queue.push(t);
    }

    const pending: HuntFxFrame['pending'] = [];

    for (const p of hunt.shimmers.pending) {
      const t = target(p.shimmer, looseRect(p.shimmer.l, 34));
      if (t) pending.push({ ...t, curve: p.curve });
    }

    const urgency = this.hurryMode.urgencyFactor();
    const leadMs =
      (clampInt(this.data.config.goldenMinIntervalMs, 0, 5000, 200) + clampInt(this.data.config.preClickDelayMs, 0, 2000, 100) + APPROACH_TRIP_MS) * urgency;

    return {
      now,
      queue,
      pending,
      readyAt: this.runtime.goldenReadyAt,
      leadMs,
      cursor: this.runtime.cursor,
      storm,
      chain,
      reducedMotion: !!this.reducedMotion?.matches,
      multiplier,
    };
  }

  start(): void {
    this.tick();
  }
}

function target(shimmer: GameShimmer, r: { left: number; top: number; width: number; height: number } | null): HuntFxTarget | null {
  if (!r) return null;

  return {
    id: shimmer.id,
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    r: Math.max(r.width, r.height) / 2,
    reindeer: isReindeer(shimmer),
  };
}
