import { clamp, clampInt } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { IGameAdapter } from '../game/game-adapter';
import type { CursorAction, CursorJobContext } from '../cursor/types';

/** Any golden/wrath cookie still around (fading in, waiting or wrath)? */
export function anyGoldenPresent(game: IGameAdapter): boolean {
  return game.getShimmers().some((s) => s && s.type === 'golden' && !s.popped && s.l && s.l.isConnected);
}

/** Setting 'Happy dance length' (default 2200ms, 0 = off). */
export function getDanceMs(data: PersistedData): number {
  return clampInt(data.config.happyDanceMs, 0, 10000, 2200);
}

/** Decided right at the catch: dance length > 0, no cookie chain, no other cookie present and
 * no real work pending. */
export function danceEligible(
  data: PersistedData,
  game: IGameAdapter,
  cookieChainActive: () => boolean,
  pendingPriorityWork: () => boolean,
): boolean {
  return getDanceMs(data) > 0 && !cookieChainActive() && !anyGoldenPresent(game) && !pendingPriorityWork();
}

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** The happy dance as a continuous, no-target job. Short hops with a sway and a little tilt
 * of the paw, around where the cursor is. Eases in and out (ends exactly where it started)
 * and stops at once if a cookie appears, a chain starts, real work becomes pending, or a
 * higher-priority job preempts it. */
export class DanceAction implements CursorAction {
  readonly label = 'happy dance';
  readonly target = null;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly hud = { action: 'happy-dance', target: 'a happy dance' };

  constructor(
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly cookieChainActive: () => boolean,
    private readonly pendingPriorityWork: () => boolean,
  ) {}

  cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const runtime = ctx.runtime;
    runtime.danceQueued = false;

    const ms = getDanceMs(this.data);

    if (ms <= 0 || this.cookieChainActive() || anyGoldenPresent(this.game) || this.pendingPriorityWork()) {
      return Promise.resolve();
    }

    const TAU = Math.PI * 2;
    const cx0 = runtime.cursor.x;
    const cy0 = runtime.cursor.y;
    const swayP = randBetween(600, 740); // ms per sway
    const hopP = swayP / 2; // two hops per sway
    const sway = randBetween(9, 13); // px
    const hop = randBetween(12, 18); // px
    const startTs = performance.now();

    return new Promise<void>((resolve) => {
      const frame = (ts: number) => {
        if (
          runtime.destroyed ||
          !runtime.running ||
          ctx.abortRequested() ||
          this.cookieChainActive() ||
          anyGoldenPresent(this.game) ||
          this.pendingPriorityWork()
        ) {
          runtime.cursorTilt = 0;
          resolve();
          return;
        }

        const t = ts - startTs;

        if (t >= ms) {
          ctx.cursor.setPosition(cx0, cy0);
          runtime.cursorTilt = 0;
          resolve();
          return;
        }

        // 0 at both ends, so it starts and ends exactly in place
        const env = Math.pow(Math.sin((Math.PI * t) / ms), 0.6);

        ctx.cursor.setPosition(
          clamp(cx0 + env * sway * Math.sin((TAU * t) / swayP), 2, window.innerWidth - 2),
          clamp(cy0 - env * hop * Math.abs(Math.sin((Math.PI * t) / hopP)), 2, window.innerHeight - 2),
        );
        runtime.cursorTilt = env * 0.32 * Math.sin((TAU * t) / swayP);

        ctx.clock.nextFrame(frame);
      };

      ctx.clock.nextFrame(frame);
    });
  }
}
