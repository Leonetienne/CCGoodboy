import { clamp } from '../core/constants';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { CursorPoint } from '../core/runtime-state';

/** When the real human cursor is within this many px of the paw the paw decides it is too
 * close for comfort and moves somewhere else entirely (one relocation, not a continuous
 * repulsion). */
const TOO_CLOSE_PX = 60;

/** New spot must be at least this far from the human cursor (and a decent hop from the paw)
 * so the relocation actually feels like "somewhere else entirely". */
const FLEE_CLEARANCE_PX = 320;
const FLEE_MIN_HOP_PX = 160;

/** After a relocation, ignore the human cursor for a moment so a stationary user doesn't
 * make the paw flee in a loop while it is already moving away. */
const FLEE_COOLDOWN_MS = 2500;

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Very slow figure-eights (lemniscate) around the current position with a bit of hand
 * jitter and a slow drift of the centre, so the paw never sits perfectly still. Eases in so
 * it starts exactly where it is. Runs for holdMs or until real work is pending / the job is
 * preempted. If the real human cursor gets really close, the paw relocates to a random far
 * spot and keeps pondering there. The animation writes the cursor only through
 * ctx.cursor.setPosition. */
export class PonderAction implements CursorAction {
  readonly label = 'ponder';
  readonly target = null;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly hud = { action: 'idle-play', target: 'drawing eights' };

  constructor(
    private readonly holdMs: number,
    private readonly pendingWork: () => boolean,
    private readonly opts: { fleeSpeed?: number } = {},
  ) {}

  cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const runtime = ctx.runtime;
    const TAU = Math.PI * 2;
    let cx0 = runtime.cursor.x;
    let cy0 = runtime.cursor.y;
    let amp = randBetween(11, 24);
    let rot = Math.random() * Math.PI;
    let period = randBetween(9000, 16000); // ms per eight
    let ph = [0, 1, 2, 3, 4, 5].map(() => Math.random() * TAU);
    let startTs = performance.now();
    let endAt = startTs + this.holdMs;
    let lastFleeAt = 0;
    let fleeing = false;

    return new Promise<void>((resolve) => {
      const restartFigure = () => {
        const pos = runtime.cursor;

        cx0 = pos.x;
        cy0 = pos.y;
        amp = randBetween(11, 24);
        rot = Math.random() * Math.PI;
        period = randBetween(9000, 16000);
        ph = [0, 1, 2, 3, 4, 5].map(() => Math.random() * TAU);
        startTs = performance.now();
        endAt = startTs + this.holdMs;
      };

      const flee = async (): Promise<boolean> => {
        const human = runtime.userMouse;
        const from = { x: runtime.cursor.x, y: runtime.cursor.y };
        if (!human) return false;

        const now = performance.now();
        if (now - lastFleeAt < FLEE_COOLDOWN_MS) return false;
        if (Math.hypot(human.x - from.x, human.y - from.y) >= TOO_CLOSE_PX) return false;

        const target = pickFleePoint(from, human);
        const speed = this.opts.fleeSpeed ?? clamp(Number(ctx.data.config.cursorSpeedPxPerSec) || 4200, 500, 20000);

        fleeing = true;
        lastFleeAt = now;

        try {
          return await ctx.cursor.moveCursorTo(target.x, target.y, true, {
            speed,
            maxMs: 6000,
            abortIf: () => ctx.abortRequested() || this.pendingWork(),
          });
        } catch {
          return false;
        } finally {
          fleeing = false;
        }
      };

      const frame = async (ts: number) => {
        if (runtime.destroyed || !runtime.running || ctx.abortRequested() || this.pendingWork()) {
          resolve();
          return;
        }

        if (fleeing) {
          ctx.clock.nextFrame(frame);
          return;
        }

        if (await flee()) {
          restartFigure();
          ctx.clock.nextFrame(frame);
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

        const rx = ex * Math.cos(rot) - ey * Math.sin(rot);
        const ry = ex * Math.sin(rot) + ey * Math.cos(rot);

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

/** A random point far from the human cursor (and a decent hop from the paw). Falls back to
 * the corner opposite the human cursor if the window is small. */
function pickFleePoint(from: CursorPoint, awayFrom: CursorPoint): CursorPoint {
  const m = 40;
  const w = Math.max(1, window.innerWidth - m * 2);
  const h = Math.max(1, window.innerHeight - m * 2);

  let best = {
    x: awayFrom.x < window.innerWidth / 2 ? window.innerWidth - m : m,
    y: awayFrom.y < window.innerHeight / 2 ? window.innerHeight - m : m,
  };
  let bestScore = Math.hypot(best.x - awayFrom.x, best.y - awayFrom.y) + Math.hypot(best.x - from.x, best.y - from.y) * 0.5;

  for (let i = 0; i < 14; i++) {
    const x = m + Math.random() * w;
    const y = m + Math.random() * h;
    const dHuman = Math.hypot(x - awayFrom.x, y - awayFrom.y);
    const dFrom = Math.hypot(x - from.x, y - from.y);

    if (dHuman >= FLEE_CLEARANCE_PX && dFrom >= FLEE_MIN_HOP_PX) {
      return { x, y };
    }

    const score = dHuman + dFrom * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }

  return best;
}
