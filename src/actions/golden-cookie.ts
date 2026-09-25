import { sayCant, sayYay } from '../core/console-voice';
import type { RuntimeState } from '../core/runtime-state';
import { shimmerCenter } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import { isReindeer } from '../game/golden-cookie-model';
import { reindeerCenterAhead, reindeerIntercept, type ReindeerMotion } from '../game/reindeer';
import { expectedTravelMs, pawTravelSpeed } from '../input/cursor-controller';
import type { GameShimmer } from '../game/types';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';

/** Display name of a golden cookie's internal effect key (e.g. 'multiply cookies' -> 'Lucky'). */
export function effectPrettyName(internal: string): string {
  const map: Record<string, string> = {
    frenzy: 'Frenzy',
    'multiply cookies': 'Lucky',
    'ruin cookies': 'Ruin',
    'blood frenzy': 'Elder Frenzy',
    clot: 'Clot',
    'click frenzy': 'Click Frenzy',
    'cursed finger': 'Cursed Finger',
    'chain cookie': 'Cookie Chain',
    'cookie storm': 'Cookie Storm',
    'cookie storm drop': 'Cookie Storm Drop',
    'building special': 'Building Special',
    'dragon harvest': 'Dragon Harvest',
    dragonflight: 'Dragonflight',
    'free sugar lump': 'Sweet',
    blab: 'Blab',
    'everything must go': 'Everything Must Go',
    reindeer: 'Reindeer',
  };

  return map[internal] || (internal ? internal.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown');
}

/** From the press to the click event that pops a shimmer (humanClick holds 8-21ms). */
const PRESS_MS = 15;

/** A golden cookie that is gone (popped, turned wrath or disconnected) can no longer be
 * clicked. */
export function goldenGone(shimmer: GameShimmer | null | undefined): boolean {
  return !shimmer || shimmer.popped || Number(shimmer.wrath) > 0 || !shimmer.l || !shimmer.l.isConnected;
}

/** The one-shot golden-cookie job: reaction delay before moving, move to the pulsing
 * shimmer, pre-click pause, re-acquire the centre, click, then record stats/log and decide
 * about the happy dance. Replaces the travel/click choreography that used to live in
 * ClickGoldenTask. A reindeer (XMAS-6) is caught the same way; it only differs in what gets
 * recorded and said. */
export class GoldenCookieAction implements CursorAction {
  readonly label: string;
  readonly abortOnGolden = false;
  readonly reacquire = true;
  readonly hud: { action: string; target: string };
  /** Reindeer only: the job's context (for the paw's speed and pause) and when the paw plans
   * to click, fixed when the trip is planned. */
  private ctx: CursorJobContext | null = null;
  private clickAt = 0;

  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly danceEligible: () => boolean,
    private readonly shimmer: GameShimmer,
  ) {
    const reindeer = isReindeer(shimmer);
    this.label = reindeer ? 'click reindeer' : 'click golden cookie';
    this.hud = { action: 'golden-cookie', target: reindeer ? 'a reindeer' : 'good golden cookie' };
  }

  /** The shimmer centre right now; the manager re-evaluates it after the pre-click pause
   * (reacquire) so the paw follows the pulse. A running reindeer is met where it WILL be. */
  target(): { x: number; y: number } | null {
    return isReindeer(this.shimmer) ? this.reindeerTarget() : shimmerCenter(this.shimmer);
  }

  private reindeerMotion(): ReindeerMotion {
    return { life: Number(this.shimmer.life), dur: Number(this.shimmer.dur), fps: this.game.getFps(), fieldWidth: this.game.getShimmerFieldWidth() };
  }

  /** XMAS-6: a reindeer runs left to right, so the paw leads it like a human would. The first
   * call (before the trip) plans where the reindeer will be when the paw clicks: after the
   * trip, the pre-click pause and the press; the paw then waits in its path. The second call
   * (after the pause) re-aims at where it will be at that planned moment, or later if the
   * trip took longer. null (job cancelled) when it leaves the screen before the paw gets
   * there. */
  private reindeerTarget(): { x: number; y: number } | null {
    const now = shimmerCenter(this.shimmer);
    const ctx = this.ctx;
    if (!now || !ctx) return now;

    const motion = this.reindeerMotion();
    const speed = pawTravelSpeed(ctx.data, ctx.hurry);
    const paw = { x: ctx.runtime.cursor.x, y: ctx.runtime.cursor.y };
    const planned = !this.clickAt;

    const r = reindeerIntercept(paw, now, motion, (d) => expectedTravelMs(d, speed), PRESS_MS + (planned ? ctx.clickTiming.getPreClickDelayMs() : 0));
    if (!r) return null;

    let point = r.point;

    if (planned) {
      this.clickAt = Date.now() + r.inMs;
    } else if (this.clickAt - Date.now() > r.inMs) {
      point = reindeerCenterAhead(now, motion, this.clickAt - Date.now()) || point;
    }

    return point.x < window.innerWidth - 8 ? point : null;
  }

  /** GC-4a: wait the click delay after both the previous click and the moment this cookie
   * became ready. */
  async beforeMove(ctx: CursorJobContext): Promise<boolean> {
    this.ctx = ctx;
    this.clickAt = 0;
    const readyAt = this.runtime.goldenReadyAt.get(this.shimmer.id) || Date.now();
    const deadline = Math.max(this.runtime.lastClickAt, readyAt) + ctx.clickTiming.getClickDelayMs();

    return ctx.clickTiming.waitUntil(deadline, false);
  }

  abortIf(): boolean {
    return goldenGone(this.shimmer);
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    // A reindeer runs into the waiting paw: click right where the paw is.
    const pos = (!isReindeer(this.shimmer) && shimmerCenter(this.shimmer)) || { x: ctx.runtime.cursor.x, y: ctx.runtime.cursor.y };

    const preForce = this.shimmer.force || (this.shimmer.forceObj && this.shimmer.forceObj.type) || '';
    const beforeLast = this.game.getLastGoldenEffect();

    await ctx.clickTiming.humanClick(this.shimmer.l, pos.x, pos.y);

    if (isReindeer(this.shimmer)) {
      this.afterReindeerClick();
      return;
    }

    if (this.shimmer.popped) {
      this.runtime.lastGoldenClickAt = Date.now();

      let internal = this.game.getLastGoldenEffect();

      if (!internal || internal === beforeLast) {
        internal = preForce || internal || 'unknown';
      }

      const kind = effectPrettyName(internal);

      this.stats.recordGolden(kind);
      this.log.log('click golden cookie', kind.toLowerCase(), { effect: internal, shimmerId: this.shimmer.id });

      // GC-8: brag in the console, but not for every storm drop (spam).
      if (internal !== 'cookie storm' && internal !== 'cookie storm drop') {
        sayYay('Caught a cookie!! I am such a gewd boy :3');
      }

      // Happy dance only if this exact moment is otherwise idle.
      this.runtime.danceQueued = this.danceEligible();
    } else if (preForce !== 'cookie storm drop') {
      sayCant('Wanted to catch a cookie, but it got away :c');
    }
  }

  /** XMAS-6: record and brag about a caught reindeer (one stats series, "Reindeer"). */
  private afterReindeerClick(): void {
    if (!this.shimmer.popped) {
      sayCant('Wanted to catch a reindeer, but it ran away :c');
      return;
    }

    this.runtime.lastGoldenClickAt = Date.now();
    this.stats.recordGolden('Reindeer');
    this.log.log('click reindeer', 'reindeer', { shimmerId: this.shimmer.id });
    sayYay('Caught a reindeer!! Ho ho ho, gewd boy :3');
    this.runtime.danceQueued = this.danceEligible();
  }
}
