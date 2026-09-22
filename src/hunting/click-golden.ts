import type { StatsRecorder } from '../stats/stats';
import type { RuntimeState } from '../core/runtime-state';
import { shimmerCenter } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import type { GameShimmer } from '../game/types';
import type { CursorController } from '../input/cursor-controller';
import type { ClickTiming } from '../input/human-click';
import type { LogStore } from '../stats/log';

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

/** Catches one good golden cookie (task): reaction delay, move to it, pre-click pause,
 * re-acquire the centre (cookies pulse), click, then record stats/log and decide about the
 * happy dance. Aborts silently if the cookie disappears, turns wrath, or the bot is paused. */
export class ClickGoldenTask {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly clickTiming: ClickTiming,
    private readonly cursorController: CursorController,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly danceEligible: () => boolean,
  ) {}

  async run(shimmer: GameShimmer): Promise<void> {
    if (!shimmer || shimmer.popped || Number(shimmer.wrath) > 0 || !shimmer.l || !shimmer.l.isConnected) {
      return;
    }

    this.runtime.currentAction = 'golden-cookie';
    this.runtime.currentTarget = 'good golden cookie';

    // 1) Reaction delay, BEFORE moving: wait the click delay after this cookie became
    //    clickable AND after the previous click.
    const readyAt = this.runtime.goldenReadyAt.get(shimmer.id) || Date.now();

    if (!(await this.clickTiming.waitUntil(Math.max(this.runtime.lastClickAt, readyAt) + this.clickTiming.getClickDelayMs(), false))) {
      return;
    }

    const gone = () => shimmer.popped || Number(shimmer.wrath) > 0 || !shimmer.l || !shimmer.l.isConnected;

    if (gone()) return;

    let pos = shimmerCenter(shimmer);
    if (!pos) return;

    // 2) Move.
    const moved = await this.cursorController.moveCursorTo(pos.x, pos.y, false);
    if (!moved || gone()) {
      return;
    }

    // 3) Extra pause after arriving.
    if (!(await this.clickTiming.waitPreClick(false)) || gone()) {
      return;
    }

    // 4) Re-acquire after pulse animation.
    pos = shimmerCenter(shimmer) || pos;

    const settled = await this.cursorController.moveCursorTo(pos.x, pos.y, false);
    if (!settled || gone()) {
      return;
    }

    const preForce = shimmer.force || (shimmer.forceObj && shimmer.forceObj.type) || '';
    const beforeLast = this.game.getLastGoldenEffect();

    await this.clickTiming.humanClick(shimmer.l, pos.x, pos.y);

    if (shimmer.popped) {
      this.runtime.lastGoldenClickAt = Date.now();

      let internal = this.game.getLastGoldenEffect();

      if (!internal || internal === beforeLast) {
        internal = preForce || internal || 'unknown';
      }

      const kind = effectPrettyName(internal);

      this.stats.recordGolden(kind);
      this.log.log('click golden cookie', kind.toLowerCase(), { effect: internal, shimmerId: shimmer.id });

      // Happy dance only if this exact moment is otherwise idle.
      this.runtime.danceQueued = this.danceEligible();
    }
  }
}
