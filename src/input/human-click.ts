import { clampInt } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { GoldenCookieModel } from '../game/golden-cookie-model';
import type { HurryMode } from '../game/hurry-mode';
import type { BackgroundClock } from './background-clock';
import { dispatchMouse } from './dispatch';

/** Is at least one good, READY golden cookie on screen? The standard abort predicate for
 * waits and travel. */
export function hasGoodGolden(goldenCookieModel: GoldenCookieModel): boolean {
  return goldenCookieModel.getGoldenShimmers().good.length > 0;
}

/** Click delay/pre-click pause math, the generic wait-until-a-deadline helper, and the
 * synthetic human click sequence. All timing here is x the hurry factor. */
export class ClickTiming {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly hurryMode: HurryMode,
    private readonly clock: BackgroundClock,
    private readonly hasGoodGoldenNow: () => boolean,
  ) {}

  /** Click delay in ms: setting 'Patience before moving' (default 200) x hurry factor.
   * Applied BEFORE the paw starts moving, to every click except Click Frenzy/hammer clicks. */
  getClickDelayMs(): number {
    return Math.round(clampInt(this.data.config.goldenMinIntervalMs, 0, 5000, 200) * this.hurryMode.urgencyFactor());
  }

  /** Pre-click pause in ms: setting 'Shy pause before click' (default 100) x hurry factor.
   * Applied AFTER the paw arrived and before it clicks. */
  getPreClickDelayMs(): number {
    return Math.round(clampInt(this.data.config.preClickDelayMs, 0, 2000, 100) * this.hurryMode.urgencyFactor());
  }

  /** Waits (polling every <= 8ms) until the timestamp ts. */
  async waitUntil(ts: number, abortForGolden = false, abortIf?: () => boolean): Promise<boolean> {
    while (Date.now() < ts) {
      if (this.runtime.destroyed || !this.runtime.running) {
        return false;
      }

      if (abortForGolden && this.hasGoodGoldenNow()) {
        return false;
      }

      if (abortIf && abortIf()) {
        return false;
      }

      await this.clock.sleep(Math.min(8, Math.max(1, ts - Date.now())));
    }

    return true;
  }

  /** Waits until click delay ms have passed since the previous click of ANY kind. Enforced
   * BEFORE the cursor starts moving. */
  waitForClickGap(abortForGolden = false, abortIf?: () => boolean): Promise<boolean> {
    return this.waitUntil(this.runtime.lastClickAt + this.getClickDelayMs(), abortForGolden, abortIf);
  }

  /** Extra pause AFTER the cursor arrived, before clicking. */
  waitPreClick(abortForGolden = false, abortIf?: () => boolean): Promise<boolean> {
    return this.waitUntil(Date.now() + this.getPreClickDelayMs(), abortForGolden, abortIf);
  }

  /** Synthesizes a click on an element like a person: mouseover, mousemove (which also puts
   * the game's mouse position, and therefore the floating '+N' number, at the paw), mousedown,
   * a short hold, mouseup, click. Also starts the click pulse and records the time. */
  async humanClick(el: Element | null, x: number, y: number, holdMs?: number): Promise<boolean> {
    if (!el || !el.isConnected) {
      return false;
    }

    dispatchMouse(el, 'mouseover', x, y, 0);
    dispatchMouse(el, 'mousemove', x, y, 0);
    dispatchMouse(el, 'mousedown', x, y, 1);

    this.runtime.pulseAt = performance.now();

    await this.clock.sleep(holdMs != null ? holdMs : 8 + Math.random() * 13);

    dispatchMouse(el, 'mouseup', x, y, 0);
    dispatchMouse(el, 'click', x, y, 0);

    this.runtime.lastClickAt = Date.now();

    return true;
  }
}
