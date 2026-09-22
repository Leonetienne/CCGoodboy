import { clamp, clampInt } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import { dispatchMove } from '../input/dispatch';
import type { BackgroundClock } from '../input/background-clock';

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

/** Short hops with a sway and a little tilt of the paw, around where the cursor is. Eases in
 * and out (ends exactly where it started) and stops at once if a cookie appears, a chain
 * starts or real work becomes pending. */
export class HappyDance {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly clock: BackgroundClock,
    private readonly cookieChainActive: () => boolean,
    private readonly pendingPriorityWork: () => boolean,
  ) {}

  run(): Promise<boolean> {
    this.runtime.danceQueued = false;

    const ms = getDanceMs(this.data);

    if (ms <= 0 || this.cookieChainActive() || anyGoldenPresent(this.game) || this.pendingPriorityWork()) {
      return Promise.resolve(false);
    }

    this.runtime.currentAction = 'happy-dance';
    this.runtime.currentTarget = 'a happy dance';

    const TAU = Math.PI * 2;
    const cx0 = this.runtime.cursor.x;
    const cy0 = this.runtime.cursor.y;
    const swayP = randBetween(600, 740); // ms per sway
    const hopP = swayP / 2; // two hops per sway
    const sway = randBetween(9, 13); // px
    const hop = randBetween(12, 18); // px
    const startTs = performance.now();

    return new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        this.runtime.cursorTilt = 0;
        resolve(ok);
      };

      const frame = (ts: number) => {
        if (
          this.runtime.destroyed ||
          !this.runtime.running ||
          this.cookieChainActive() ||
          anyGoldenPresent(this.game) ||
          this.pendingPriorityWork()
        ) {
          finish(false);
          return;
        }

        const t = ts - startTs;

        if (t >= ms) {
          this.runtime.cursor.x = cx0;
          this.runtime.cursor.y = cy0;
          dispatchMove(this.runtime, cx0, cy0);
          finish(true);
          return;
        }

        // 0 at both ends, so it starts and ends exactly in place
        const env = Math.pow(Math.sin((Math.PI * t) / ms), 0.6);

        this.runtime.cursor.x = clamp(cx0 + env * sway * Math.sin((TAU * t) / swayP), 2, window.innerWidth - 2);
        this.runtime.cursor.y = clamp(cy0 - env * hop * Math.abs(Math.sin((Math.PI * t) / hopP)), 2, window.innerHeight - 2);
        this.runtime.cursorTilt = env * 0.32 * Math.sin((TAU * t) / swayP);

        dispatchMove(this.runtime, this.runtime.cursor.x, this.runtime.cursor.y);

        this.clock.nextFrame(frame);
      };

      this.clock.nextFrame(frame);
    });
  }
}
