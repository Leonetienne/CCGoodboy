import { clamp } from '../core/constants';
import type { CursorAction, CursorJobContext } from '../cursor/types';

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Very slow figure-eights (lemniscate) around the current position with a bit of hand
 * jitter and a slow drift of the centre, so the paw never sits perfectly still. Eases in so
 * it starts exactly where it is. Runs for holdMs or until real work is pending / the job is
 * preempted. The animation writes the cursor only through ctx.cursor.setPosition. */
export class PonderAction implements CursorAction {
  readonly label = 'ponder';
  readonly target = null;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly hud = { action: 'idle-play', target: 'drawing eights' };

  constructor(
    private readonly holdMs: number,
    private readonly pendingWork: () => boolean,
  ) {}

  cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const runtime = ctx.runtime;
    const TAU = Math.PI * 2;
    const cx0 = runtime.cursor.x;
    const cy0 = runtime.cursor.y;

    const amp = randBetween(11, 24);
    const rot = Math.random() * Math.PI;
    const period = randBetween(9000, 16000); // ms per eight

    const ph = [0, 1, 2, 3, 4, 5].map(() => Math.random() * TAU);

    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const startTs = performance.now();
    const endAt = startTs + this.holdMs;

    return new Promise<void>((resolve) => {
      const frame = (ts: number) => {
        if (runtime.destroyed || !runtime.running || ctx.abortRequested() || this.pendingWork()) {
          resolve();
          return;
        }

        if (ts >= endAt) {
          resolve();
          return;
        }

        const t = ts - startTs;

        // ease everything in so it starts exactly where it is
        const k = Math.min(1, t / 1500);

        // slightly uneven pace, so the eights look hand-drawn
        const theta = (TAU * t) / period + 0.35 * (Math.sin((TAU * t) / (period * 1.7) + ph[0]!) - Math.sin(ph[0]!));
        const a = amp * (1 + 0.18 * Math.sin((TAU * t) / (period * 2.3) + ph[1]!));

        // figure eight (lemniscate of Gerono)
        const ex = a * Math.sin(theta);
        const ey = a * 0.9 * Math.sin(theta) * Math.cos(theta);

        const rx = ex * cosR - ey * sinR;
        const ry = ex * sinR + ey * cosR;

        // slow drift of the centre + fine jitter
        const drx = 3 * (Math.sin((TAU * t) / (period * 3.1) + ph[2]!) - Math.sin(ph[2]!));
        const dry = 3 * (Math.sin((TAU * t) / (period * 2.7) + ph[3]!) - Math.sin(ph[3]!));

        const jx = 0.6 * Math.sin(t / 173 + ph[4]!) + 0.4 * Math.sin(t / 61 + ph[5]!);
        const jy = 0.6 * Math.sin(t / 149 + ph[5]!) + 0.4 * Math.sin(t / 53 + ph[4]!);

        ctx.cursor.setPosition(
          clamp(cx0 + k * (rx + drx + jx), 2, window.innerWidth - 2),
          clamp(cy0 + k * (ry + dry + jy), 2, window.innerHeight - 2),
        );

        ctx.clock.nextFrame(frame);
      };

      ctx.clock.nextFrame(frame);
    });
  }
}
