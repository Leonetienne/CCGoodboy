import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { IGameAdapter } from './game-adapter';

/** During a cookie storm or a cookie chain every cookie is short-lived, so the bot has to act
 * fast: delays and the visibility threshold are multiplied by the hurry factor (default 0.2)
 * and the paw speed is divided by it. urgencyFactor() is read very often, so its result is
 * cached for 30ms. */
export class HurryMode {
  private cache = { t: -1e9, v: 1 };

  constructor(
    private readonly game: IGameAdapter,
    private readonly data: PersistedData,
  ) {}

  /** The configured hurry factor, clamped to 0.01..1 (default 0.2). */
  getPanicFactor(): number {
    const v = Number(this.data.config.panicFactor);
    return Number.isFinite(v) ? clamp(v, 0.01, 1) : 0.2;
  }

  /** Is a cookie chain running? */
  cookieChainActive(): boolean {
    return this.game.getGoldenChainCount() > 0;
  }

  /** Is a cookie storm running? True when a buff whose name contains 'cookie storm' is
   * active, or a golden shimmer forced to 'cookie storm drop' exists. */
  cookieStormActive(): boolean {
    const buffs = this.game.getRawBuffs();

    for (const k of Object.keys(buffs)) {
      const b = buffs[k];
      const name = String((b && (b.name || b.dname)) || k).toLowerCase();

      if (name.includes('cookie storm')) {
        return true;
      }
    }

    return this.game.getShimmers().some((s) => s && s.type === 'golden' && !s.popped && s.force === 'cookie storm drop');
  }

  /** The factor currently in effect: 1 normally, the hurry factor during a storm or chain.
   * Multiplies click delay / pre-click pause / fade threshold and divides the paw speed. */
  urgencyFactor(): number {
    const now = performance.now();

    if (now - this.cache.t < 30) {
      return this.cache.v;
    }

    this.cache = {
      t: now,
      v: this.cookieChainActive() || this.cookieStormActive() ? this.getPanicFactor() : 1,
    };

    return this.cache.v;
  }
}
