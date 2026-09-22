import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { LogStore } from '../stats/log';

/** The cursor starts heading for the next big-cookie click this long before it is due, so
 * travelling never eats into the click rhythm. */
export const BIG_CLICK_LEAD_MS = 150;

export interface BigCookiePoint {
  el: Element;
  x: number;
  y: number;
  rect: DOMRect;
}

/** A uniformly random point inside the clickable area (36% radius) of the big cookie. */
export function randomPointInBigCookie(): BigCookiePoint | null {
  const el = document.getElementById('bigCookie');
  const rect = visibleRect(el);

  if (!rect) return null;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxRadius = Math.min(rect.width, rect.height) * 0.36;

  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * maxRadius;

  return {
    el: el!,
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
    rect,
  };
}

export interface NextBigCookiePoint {
  el: Element;
  x: number;
  y: number;
  near: boolean;
}

/** Setting 'Click step max px' (default 3, 0..60). */
export function getHammerStepPx(data: PersistedData): number {
  const v = Number(data.config.hammerStepPx);
  return Number.isFinite(v) ? clamp(v, 0, 60) : 3;
}

/** Next big-cookie click spot: a small random step (0.3..1 x max step) from the previous
 * click, kept inside the cookie, so there is almost no travel. near=false means 'no usable
 * previous spot, travel there first'. */
export function nextBigCookiePoint(prev: { x: number; y: number } | null, data: PersistedData): NextBigCookiePoint | null {
  const el = document.getElementById('bigCookie');
  const rect = visibleRect(el);

  if (!rect) return null;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxR = Math.min(rect.width, rect.height) * 0.36;

  // small tolerance: a spot clamped onto the rim must still count as "on the cookie" on the
  // next click.
  if (prev && Math.hypot(prev.x - cx, prev.y - cy) <= maxR + 8) {
    const maxStep = getHammerStepPx(data);
    const ang = Math.random() * Math.PI * 2;
    const step = maxStep * (0.3 + Math.random() * 0.7);

    let x = prev.x + Math.cos(ang) * step;
    let y = prev.y + Math.sin(ang) * step;

    const d = Math.hypot(x - cx, y - cy);

    // never leave the cookie
    if (d > maxR * 0.98) {
      const k = (maxR * 0.98) / d;
      x = cx + (x - cx) * k;
      y = cy + (y - cy) * k;
    }

    return { el: el!, x, y, near: true };
  }

  const start = randomPointInBigCookie();
  return start ? { el: start.el, x: start.x, y: start.y, near: false } : null;
}

/** Hammers the big cookie for as long as it is wanted (real Click Frenzy or hammer mode) in
 * ONE continuous job, so the rate does not depend on scheduler ticks. Fixed timeline: the
 * next click is due one interval after the previous one was DUE (not after it happened);
 * resynced from the real click when > 60ms late; never closer than base-jitter to the
 * previous click. Each click lands a few px from the previous one. Stops when: no longer
 * wanted, a golden cookie is ready, or (hammer mode only) FTHOF/refill/auto-shop becomes
 * pending. Only real Click Frenzy clicks are logged. */
export class HammerAction implements CursorAction {
  readonly label = 'hammer big cookie';
  readonly target = null;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly hud = { action: 'hammer', target: 'big cookie' };

  constructor(
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly hammerActive: () => boolean,
    private readonly hasGoodGolden: () => boolean,
    private readonly fthofOrRefillPending: () => boolean,
    private readonly autoShopReady: () => boolean,
  ) {}

  private bigCookieWanted(): boolean {
    return this.game.clickFrenzyActive() || this.hammerActive();
  }

  private stop(ctx: CursorJobContext): boolean {
    return (
      !this.bigCookieWanted() ||
      this.hasGoodGolden() ||
      (!this.game.clickFrenzyActive() && (this.fthofOrRefillPending() || this.autoShopReady())) ||
      ctx.abortRequested()
    );
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const runtime = ctx.runtime;

    if (this.stop(ctx)) return;

    runtime.currentTarget = 'big cookie';

    let prev = { x: runtime.cursor.x, y: runtime.cursor.y };

    for (;;) {
      if (runtime.destroyed || !runtime.running || this.stop(ctx)) {
        return;
      }

      const frenzy = this.game.clickFrenzyActive();
      runtime.currentAction = frenzy ? 'click-frenzy' : 'hammer';

      const point = nextBigCookiePoint(prev, this.data);
      if (!point) return;

      // first click, or far from the last one: normal travel
      if (!point.near && !(await ctx.cursor.moveCursorTo(point.x, point.y, true, { abortIf: () => this.stop(ctx) }))) {
        return;
      }

      const due = runtime.nextBigClickAt || Date.now();

      // The press-to-click delay is known up front, so press early enough that the click
      // event itself lands on the due time.
      const hold = 8 + Math.random() * 13;
      const pressAt = due - hold;

      if (point.near) {
        const glideMs = clamp(pressAt - Date.now() - 3, 0, 40);

        if (!(await ctx.cursor.glideCursor(point.x, point.y, glideMs, () => this.stop(ctx)))) {
          return;
        }
      }

      if (!(await ctx.clickTiming.waitUntil(pressAt, true, () => this.stop(ctx))) || this.stop(ctx)) {
        return;
      }

      await ctx.clickTiming.humanClick(point.el, point.x, point.y, hold);

      const clickedAt = Date.now();
      prev = { x: point.x, y: point.y };

      // Only real Click Frenzy clicks are logged; hammer mode would otherwise flood the log
      // with entries.
      if (frenzy) {
        this.log.log('click cookie', 'click frenzy');
      }

      const cps = clamp(Number(this.data.config.clickFrenzyCps) || 8, 0.2, 50);
      const base = 1000 / cps;

      // at high rates the jitter must not exceed the interval itself
      const jit = Math.min(clamp(Number(this.data.config.clickFrenzyJitterMs) || 30, 0, 250), base * 0.6);
      const interval = Math.max(20, base + (Math.random() * 2 - 1) * jit);

      // Fixed timeline: the next click is due one interval after this one was DUE (not
      // after it happened), so click overhead never slows the rate down. If we ended up
      // more than 60ms late (lag, first click of a burst), restart the timeline from the
      // actual click. Never closer than base - jitter to the click just made.
      const ref = clickedAt - due > 60 ? clickedAt : due;

      runtime.nextBigClickAt = Math.max(ref + interval, clickedAt + Math.max(20, base - jit));
    }
  }
}
