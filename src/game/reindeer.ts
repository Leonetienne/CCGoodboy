import type { Point } from './dom-geometry';

/** Reindeer motion (XMAS-6), mirrored from the game's `shimmerTypes.reindeer.updateFunc`
 * (main.js 2.058). Each game frame it draws the reindeer at
 *   x = me.x + fieldWidth × (1 − life / (fps × dur))            (left to right, linear)
 *   y = me.y − |sin(life × 0.1)| × 128                           (bouncing)
 * rotated/scaled around its own centre, then counts `life` down by 1. So the centre of its
 * box moves exactly like that too, and where it will be `ms` from now follows from where it
 * is now. `fieldWidth` is `Game.bounds.right − Game.bounds.left`. */

/** Height of the reindeer's bounce (px). */
export const REINDEER_BOUNCE_PX = 128;

export interface ReindeerMotion {
  /** Frames left (Game.shimmers[i].life; already counted down past the drawn frame). */
  life: number;
  /** Lifespan in seconds. */
  dur: number;
  fps: number;
  fieldWidth: number;
}

/** The reindeer's centre `aheadMs` from now, given its centre `now` as drawn; null when it will
 * be gone by then (or the motion is unknown). */
export function reindeerCenterAhead(now: Point, m: ReindeerMotion, aheadMs: number): Point | null {
  if (!(m.fps > 0) || !(m.dur > 0) || !Number.isFinite(m.life) || !Number.isFinite(m.fieldWidth)) return null;

  // The drawn frame used the value before its countdown.
  const drawnLife = m.life + 1;
  const frames = (Math.max(0, aheadMs) / 1000) * m.fps;
  const futureLife = drawnLife - frames;

  if (futureLife <= 1) return null;

  return {
    x: now.x + (m.fieldWidth * frames) / (m.fps * m.dur),
    y: now.y + REINDEER_BOUNCE_PX * (Math.abs(Math.sin(drawnLife * 0.1)) - Math.abs(Math.sin(futureLife * 0.1))),
  };
}

/** Where the paw should go to meet the reindeer: the point it reaches at the moment the paw
 * would click there, when the paw starts from `paw`, needs `travelMs(distance)` to get
 * anywhere and then `afterMs` more (pre-click pause, press). A few fixed-point rounds are
 * plenty: the paw is far faster than the reindeer. Also returns how long from now that is.
 * null when the reindeer is gone before the paw could get there. */
export function reindeerIntercept(
  paw: Point,
  now: Point,
  m: ReindeerMotion,
  travelMs: (dist: number) => number,
  afterMs: number,
): { point: Point; inMs: number } | null {
  let inMs = afterMs;
  let point = reindeerCenterAhead(now, m, inMs);

  for (let i = 0; i < 5 && point; i++) {
    inMs = travelMs(Math.hypot(point.x - paw.x, point.y - paw.y)) + afterMs;
    point = reindeerCenterAhead(now, m, inMs);
  }

  return point ? { point, inMs } : null;
}
