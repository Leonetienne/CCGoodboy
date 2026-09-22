import { clamp } from '../core/constants';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { CursorPoint } from '../core/runtime-state';
import { clampPawPoint, PAW_CONTAIN_MARGIN_PX, pawSpriteCenterOffset } from '../input/paw-bounds';
import { DanceAction } from './dance';
import { pawMoodAt } from './paw-mood';

/** When the paw is shy and the real cursor gets this close to the paw centre, it moves away. */
const TOO_CLOSE_PX = 60;

/** New spot must be at least this far from the human cursor (and a decent hop from the paw)
 * so a shy relocation actually feels like "somewhere else entirely". */
const FLEE_CLEARANCE_PX = 320;
const FLEE_MIN_HOP_PX = 160;

/** After a shy flee, ignore the cursor for a moment so a stationary user doesn't trigger
 * another flee in a loop. */
const REACTION_COOLDOWN_MS = 2500;

/** A click on the paw counts if it is within this many px of the paw centre... */
const CLICK_DANCE_RADIUS_PX = 160;
/** ...and happened within this many ms. */
const CLICK_DANCE_WINDOW_MS = 800;
/** After a click dance, don't immediately dance (or flee) again. */
const DANCE_GRACE_MS = 3000;

/** The click-triggered dance is a smaller, shorter version of the normal happy dance. */
const CUDDLE_DANCE_MS = 2200;
const CUDDLE_DANCE_SCALE = 0.7;

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Very slow figure-eights (lemniscate) around the current position with a bit of hand
 * jitter and a slow drift of the centre, so the paw never sits perfectly still. Eases in so
 * it starts exactly where it is. Runs for holdMs or until real work is pending / the job is
 * preempted. Shy mood: relocates somewhere far away when the real cursor gets really close.
 * Non-shy mood: ignores the cursor entirely, but does a small happy dance in place when the
 * paw itself is clicked. The animation writes the cursor only through ctx.cursor primitives
 * and keeps the whole paw sprite inside the viewport. */
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
    let nextFleeAt = 0;
    let nextDanceAt = 0;
    let reacting = false;

    const idleSpeed = () => this.opts.fleeSpeed ?? clamp(Number(ctx.data.config.cursorSpeedPxPerSec) || 4200, 500, 20000);

    return new Promise<void>((resolve) => {
      const restartFigure = () => {
        const pos = clampPawPoint(runtime.cursor.x, runtime.cursor.y);

        cx0 = pos.x;
        cy0 = pos.y;
        amp = randBetween(11, 24);
        rot = Math.random() * Math.PI;
        period = randBetween(9000, 16000);
        ph = [0, 1, 2, 3, 4, 5].map(() => Math.random() * TAU);
        startTs = performance.now();
        endAt = startTs + this.holdMs;
      };

      const flee = async (human: CursorPoint): Promise<boolean> => {
        const from = { x: runtime.cursor.x, y: runtime.cursor.y };
        const target = pickFleePoint(from, human);

        try {
          return await ctx.cursor.moveCursorTo(target.x, target.y, true, {
            speed: idleSpeed(),
            maxMs: 6000,
            abortIf: () => ctx.abortRequested() || this.pendingWork(),
          });
        } catch {
          return false;
        }
      };

      const dance = async (): Promise<void> => {
        try {
          runtime.currentAction = 'happy-dance';
          runtime.currentTarget = 'a click dance';

          await new DanceAction(
            ctx.data,
            ctx.game,
            () => ctx.game.getGoldenChainCount() > 0,
            () => this.pendingWork(),
            { durationMs: CUDDLE_DANCE_MS, scale: CUDDLE_DANCE_SCALE },
          ).cursor_at_position(ctx);
        } finally {
          runtime.currentAction = 'idle-play';
          runtime.currentTarget = 'drawing eights';
        }
      };

      const frame = async (ts: number) => {
        if (runtime.destroyed || !runtime.running || ctx.abortRequested() || this.pendingWork()) {
          resolve();
          return;
        }

        if (reacting) {
          ctx.clock.nextFrame(frame);
          return;
        }

        const now = performance.now();
        const paw = runtime.cursor;
        const center = pawSpriteCenterOffset();
        const pawX = paw.x + center.x;
        const pawY = paw.y + center.y;
        const human = runtime.userMouse;
        const mood = pawMoodAt(now);

        // Shy: move away when the cursor gets really close.
        if (mood === 'shy' && human && now >= nextFleeAt && Math.hypot(human.x - pawX, human.y - pawY) < TOO_CLOSE_PX) {
          nextFleeAt = now + REACTION_COOLDOWN_MS;
          reacting = true;

          try {
            if (await flee(human)) {
              restartFigure();
              ctx.clock.nextFrame(frame);
              return;
            }
          } catch {
            // fall through and keep pondering
          } finally {
            reacting = false;
          }
        }

        // Non-shy: ignore the cursor, but dance when the paw itself is clicked.
        if (mood !== 'shy' && now >= nextDanceAt) {
          const clicked = runtime.userClicks.some(
            (c) => now - c.t <= CLICK_DANCE_WINDOW_MS && Math.hypot(c.x - pawX, c.y - pawY) <= CLICK_DANCE_RADIUS_PX,
          );

          if (clicked) {
            nextDanceAt = now + DANCE_GRACE_MS;
            nextFleeAt = now + DANCE_GRACE_MS;
            reacting = true;

            try {
              await dance();
              restartFigure();
              ctx.clock.nextFrame(frame);
              return;
            } catch {
              // fall through and keep pondering
            } finally {
              reacting = false;
            }
          }
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

        const pos = clampPawPoint(cx0 + k * (rx + drx + jx), cy0 + k * (ry + dry + jy));
        ctx.cursor.setPosition(pos.x, pos.y);

        ctx.clock.nextFrame(frame);
      };

      ctx.clock.nextFrame(frame);
    });
  }
}

/** A random point far from the human cursor (and a decent hop from the paw). Falls back to
 * the corner opposite the human cursor if the window is small. Always fully inside the
 * viewport. */
function pickFleePoint(from: CursorPoint, awayFrom: CursorPoint): CursorPoint {
  const m = PAW_CONTAIN_MARGIN_PX + 8;
  const w = Math.max(1, window.innerWidth - m * 2);
  const h = Math.max(1, window.innerHeight - m * 2);

  let best = clampPawPoint(
    awayFrom.x < window.innerWidth / 2 ? window.innerWidth - m : m,
    awayFrom.y < window.innerHeight / 2 ? window.innerHeight - m : m,
  );
  let bestScore = Math.hypot(best.x - awayFrom.x, best.y - awayFrom.y) + Math.hypot(best.x - from.x, best.y - from.y) * 0.5;

  for (let i = 0; i < 14; i++) {
    const x = m + Math.random() * w;
    const y = m + Math.random() * h;
    const dHuman = Math.hypot(x - awayFrom.x, y - awayFrom.y);
    const dFrom = Math.hypot(x - from.x, y - from.y);

    if (dHuman >= FLEE_CLEARANCE_PX && dFrom >= FLEE_MIN_HOP_PX) {
      return clampPawPoint(x, y);
    }

    const score = dHuman + dFrom * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = clampPawPoint(x, y);
    }
  }

  return best;
}
