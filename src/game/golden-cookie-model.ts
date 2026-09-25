import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from './game-adapter';
import type { HurryMode } from './hurry-mode';
import type { GameShimmer } from './types';

/** Shimmer types the bot catches like a golden cookie: golden cookies and reindeer (XMAS-6).
 * The game pops a reindeer on a click on its element, just like a golden cookie. */
export const CATCHABLE_SHIMMER_TYPES = new Set(['golden', 'reindeer']);

/** True for a reindeer shimmer (Christmas; never wrath). */
export function isReindeer(shimmer: { type?: string } | null | undefined): boolean {
  return !!shimmer && shimmer.type === 'reindeer';
}

export interface GoldenVisibility {
  curve: number;
  progress: number;
  ready: boolean;
}

export interface GoldenShimmers {
  good: GameShimmer[];
  wrath: GameShimmer[];
  pending: Array<{ shimmer: GameShimmer; curve: number }>;
}

/** Classifies live golden shimmers and tracks when each one became clickable, mirroring the
 * game's own fade/opacity curve. */
export class GoldenCookieModel {
  constructor(
    private readonly game: IGameAdapter,
    private readonly data: PersistedData,
    private readonly hurryMode: HurryMode,
    private readonly runtime: RuntimeState,
  ) {}

  /** Fade-curve threshold above which a cookie counts as visible/clickable, times the hurry
   * factor. */
  getGoldenFadeThreshold(): number {
    const n = Number(this.data.config.goldenMinFadeCurve);
    return (Number.isFinite(n) ? clamp(n, 0, 1) : 0.55) * this.hurryMode.urgencyFactor();
  }

  /** Fade state of a golden shimmer. Mirrors the game's own opacity/scale formula
   * `curve = 1 - (2*life/(fps*dur) - 1)^4`: 0 at spawn, 1 at mid-life, 0 again at despawn
   * (a reindeer's opacity uses the power 12: visible for most of its run).
   * 'ready' means curve >= threshold, or already past the peak (so it never turns
   * un-clickable while fading out). Unknown state never blocks a click. */
  goldenVisibility(shimmer: GameShimmer): GoldenVisibility {
    const fps = this.game.getFps();

    if (
      !shimmer ||
      !fps ||
      !Number.isFinite(shimmer.life as number) ||
      !Number.isFinite(shimmer.dur as number) ||
      (shimmer.dur as number) <= 0
    ) {
      return { curve: 1, progress: 0.5, ready: true };
    }

    const lifeRatio = clamp((shimmer.life as number) / (fps * (shimmer.dur as number)), 0, 1);
    const progress = 1 - lifeRatio;
    const curve = 1 - Math.pow(lifeRatio * 2 - 1, isReindeer(shimmer) ? 12 : 4);
    const ready = progress >= 0.5 || curve >= this.getGoldenFadeThreshold();

    return { curve, progress, ready };
  }

  /** Classifies all live golden shimmers (and reindeer, which count as good ones): good
   * (clickable), pending (still fading in, good type), wrath (never clicked). Also remembers when each good cookie first became ready
   * (runtime.goldenReadyAt), which starts the reaction delay, and forgets cookies that are
   * gone. */
  getGoldenShimmers(): GoldenShimmers {
    if (!this.game.isPresent()) {
      return { good: [], wrath: [], pending: [] };
    }

    const good: GameShimmer[] = [];
    const wrath: GameShimmer[] = [];
    const pending: Array<{ shimmer: GameShimmer; curve: number }> = [];
    const alive = new Set<number>();

    for (const shimmer of this.game.getShimmers()) {
      if (!shimmer || !CATCHABLE_SHIMMER_TYPES.has(shimmer.type) || shimmer.popped || !shimmer.l || !shimmer.l.isConnected) {
        continue;
      }

      alive.add(shimmer.id);

      if (Number(shimmer.wrath) > 0) {
        wrath.push(shimmer);
        continue;
      }

      const vis = this.goldenVisibility(shimmer);

      if (vis.ready) {
        good.push(shimmer);

        if (!this.runtime.goldenReadyAt.has(shimmer.id)) {
          this.runtime.goldenReadyAt.set(shimmer.id, Date.now());
        }
      } else {
        pending.push({ shimmer, curve: vis.curve });
      }
    }

    for (const id of Array.from(this.runtime.goldenReadyAt.keys())) {
      if (!alive.has(id)) {
        this.runtime.goldenReadyAt.delete(id);
      }
    }

    return { good, wrath, pending };
  }
}
