import { sayCant, sayYay } from '../core/console-voice';
import type { RuntimeState } from '../core/runtime-state';
import { shimmerCenter } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
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
  };

  return map[internal] || (internal ? internal.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown');
}

/** A golden cookie that is gone (popped, turned wrath or disconnected) can no longer be
 * clicked. */
export function goldenGone(shimmer: GameShimmer | null | undefined): boolean {
  return !shimmer || shimmer.popped || Number(shimmer.wrath) > 0 || !shimmer.l || !shimmer.l.isConnected;
}

/** The one-shot golden-cookie job: reaction delay before moving, move to the pulsing
 * shimmer, pre-click pause, re-acquire the centre, click, then record stats/log and decide
 * about the happy dance. Replaces the travel/click choreography that used to live in
 * ClickGoldenTask. */
export class GoldenCookieAction implements CursorAction {
  readonly label = 'click golden cookie';
  readonly abortOnGolden = false;
  readonly reacquire = true;
  readonly hud = { action: 'golden-cookie', target: 'good golden cookie' };

  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly danceEligible: () => boolean,
    private readonly shimmer: GameShimmer,
  ) {}

  /** The shimmer centre right now; the manager re-evaluates it after the pre-click pause
   * (reacquire) so the paw follows the pulse. */
  target(): { x: number; y: number } | null {
    return shimmerCenter(this.shimmer);
  }

  /** GC-4a: wait the click delay after both the previous click and the moment this cookie
   * became ready. */
  async beforeMove(ctx: CursorJobContext): Promise<boolean> {
    const readyAt = this.runtime.goldenReadyAt.get(this.shimmer.id) || Date.now();
    const deadline = Math.max(this.runtime.lastClickAt, readyAt) + ctx.clickTiming.getClickDelayMs();

    return ctx.clickTiming.waitUntil(deadline, false);
  }

  abortIf(): boolean {
    return goldenGone(this.shimmer);
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const pos = shimmerCenter(this.shimmer) || { x: ctx.runtime.cursor.x, y: ctx.runtime.cursor.y };

    const preForce = this.shimmer.force || (this.shimmer.forceObj && this.shimmer.forceObj.type) || '';
    const beforeLast = this.game.getLastGoldenEffect();

    await ctx.clickTiming.humanClick(this.shimmer.l, pos.x, pos.y);

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
}
