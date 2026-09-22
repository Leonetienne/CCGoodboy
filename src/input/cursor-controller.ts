import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { CursorPoint, RuntimeState } from '../core/runtime-state';
import type { HurryMode } from '../game/hurry-mode';
import type { BackgroundClock } from './background-clock';
import { dispatchMove } from './dispatch';

export interface CursorPath {
  pts: CursorPoint[];
  dips: number[];
}

/** Human-like path between two points: 2-6 waypoints (one per ~170px) bowed sideways so the
 * route is an arc with small irregularities, plus 'dips' (0..1 fractions) where the cursor
 * hesitates slightly. */
export function buildCursorPath(start: CursorPoint, end: CursorPoint): CursorPath {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 2) {
    return { pts: [start, end], dips: [] };
  }

  const nx = -dy / dist;
  const ny = dx / dist;

  const segs = dist < 40 ? 2 : clamp(Math.round(dist / 170), 2, 6);

  const bowSign = Math.random() < 0.5 ? -1 : 1;
  const bow = dist * (0.05 + Math.random() * 0.1) * bowSign;

  const pts: CursorPoint[] = [start];
  const dips: number[] = [];

  for (let k = 1; k < segs; k++) {
    const f = clamp(k / segs + (Math.random() - 0.5) * (0.5 / segs), 0.05, 0.95);
    const lateral = bow * 4 * f * (1 - f) + (Math.random() - 0.5) * dist * 0.04;

    pts.push({
      x: start.x + dx * f + nx * lateral,
      y: start.y + dy * f + ny * lateral,
    });

    dips.push(f);
  }

  pts.push(end);

  return { pts, dips };
}

/** Catmull-Rom spline through pts evaluated at u in [0,1]. */
export function splinePoint(pts: CursorPoint[], u: number): CursorPoint {
  const n = pts.length - 1;
  const f = clamp(u, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const t = f - i;

  const p0 = pts[Math.max(0, i - 1)]!;
  const p1 = pts[i]!;
  const p2 = pts[i + 1]!;
  const p3 = pts[Math.min(n, i + 2)]!;

  const t2 = t * t;
  const t3 = t2 * t;

  const c = (a: number, b: number, c2: number, d: number) =>
    0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);

  return {
    x: c(p0.x, p1.x, p2.x, p3.x),
    y: c(p0.y, p1.y, p2.y, p3.y),
  };
}

/** Time -> path progress mapping. Bell-shaped speed (min-jerk like) with random wobble and
 * slight slow-downs where the path bends, so the cursor never moves at constant speed. */
export function buildSpeedWarp(dips: number[]): (tau: number) => number {
  const N = 96;
  const TAU = Math.PI * 2;

  const p1 = Math.random() * TAU;
  const p2 = Math.random() * TAU;
  const k1 = 1.5 + Math.random() * 1.5;
  const k2 = 3.5 + Math.random() * 2.5;
  const a1 = 0.1 + Math.random() * 0.12;
  const a2 = 0.05 + Math.random() * 0.08;

  const cum = new Float64Array(N + 1);

  for (let i = 0; i < N; i++) {
    const tau = (i + 0.5) / N;

    let v = 30 * tau * tau * (1 - tau) * (1 - tau);
    v = Math.max(v, 0.03);

    v *= 1 + a1 * Math.sin(TAU * k1 * tau + p1) + a2 * Math.sin(TAU * k2 * tau + p2);

    for (const f of dips) {
      v *= 1 - 0.3 * Math.exp(-Math.pow((tau - f) / 0.04, 2));
    }

    cum[i + 1] = cum[i]! + v;
  }

  const total = cum[N]!;

  for (let i = 1; i <= N; i++) {
    cum[i] = cum[i]! / total;
  }

  return (tau: number) => {
    const x = clamp(tau, 0, 1) * N;
    const i = Math.min(N - 1, Math.floor(x));

    return cum[i]! + (cum[i + 1]! - cum[i]!) * (x - i);
  };
}

export interface MoveCursorOpts {
  speed?: number;
  maxMs?: number;
  abortIf?: () => boolean;
}

/** The SOLE owner of runtime.cursor mutation, so cursor motion never has more than one writer.
 * Animates the paw to a target along an arced, speed-varying path with a fading hand tremor. */
export class CursorController {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly hurryMode: HurryMode,
    private readonly clock: BackgroundClock,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  get position(): CursorPoint {
    return this.runtime.cursor;
  }

  /** Sets the cursor position directly, with no travel animation (used by short hops like the
   * hammer's glideCursor). */
  setPosition(x: number, y: number): void {
    this.runtime.cursor.x = x;
    this.runtime.cursor.y = y;
  }

  /** Speed = setting 'Paw zoomies' / hurry factor (or opts.speed); duration = distance/speed x
   * 0.85..1.2, clamped to 22ms..opts.maxMs (420). Ends exactly on the target. */
  async moveCursorTo(x: number, y: number, abortForGolden: boolean, opts: MoveCursorOpts = {}): Promise<boolean> {
    x = clamp(x, 2, window.innerWidth - 2);
    y = clamp(y, 2, window.innerHeight - 2);

    const start = { x: this.runtime.cursor.x, y: this.runtime.cursor.y };
    const end = { x, y };

    const dist = Math.hypot(end.x - start.x, end.y - start.y);

    const speed = opts.speed
      ? clamp(opts.speed, 20, 20000)
      : clamp((Number(this.data.config.cursorSpeedPxPerSec) || 4200) / this.hurryMode.urgencyFactor(), 500, 200000);

    // Every trip is a little faster or slower than the last.
    const duration = clamp((dist / speed) * 1000 * (0.85 + Math.random() * 0.35), 22, opts.maxMs || 420);

    const path = buildCursorPath(start, end);
    const warp = buildSpeedWarp(path.dips);

    // Hand tremor: small, fades out towards the target.
    const TAU = Math.PI * 2;
    const tremor = Math.min(1.3, dist * 0.03);

    const fq: [number, number, number, number] = [7 + Math.random() * 6, 17 + Math.random() * 6, 6 + Math.random() * 6, 16 + Math.random() * 6];
    const ph: [number, number, number, number] = [Math.random() * TAU, Math.random() * TAU, Math.random() * TAU, Math.random() * TAU];

    const startTs = performance.now();

    return new Promise<boolean>((resolve) => {
      const frame = (ts: number) => {
        if (this.runtime.destroyed || !this.runtime.running) {
          resolve(false);
          return;
        }

        if (abortForGolden && this.hasGoodGolden()) {
          resolve(false);
          return;
        }

        if (opts.abortIf && opts.abortIf()) {
          resolve(false);
          return;
        }

        const t = clamp((ts - startTs) / duration, 0, 1);

        if (t >= 1) {
          this.runtime.cursor.x = x;
          this.runtime.cursor.y = y;
          dispatchMove(this.runtime, x, y);
          resolve(true);
          return;
        }

        const p = splinePoint(path.pts, warp(t));
        const el = (ts - startTs) / 1000;
        const env = Math.sin(Math.PI * t) * tremor;

        this.runtime.cursor.x = p.x + env * (0.7 * Math.sin(TAU * fq[0] * el + ph[0]) + 0.3 * Math.sin(TAU * fq[1] * el + ph[1]));
        this.runtime.cursor.y = p.y + env * (0.7 * Math.sin(TAU * fq[2] * el + ph[2]) + 0.3 * Math.sin(TAU * fq[3] * el + ph[3]));

        dispatchMove(this.runtime, this.runtime.cursor.x, this.runtime.cursor.y);

        this.clock.nextFrame(frame);
      };

      this.clock.nextFrame(frame);
    });
  }

  /** Short smooth hop (timer based, so it also works in a background tab). With no time to
   * spare (< 14ms) or almost no distance it just snaps. */
  async glideCursor(x: number, y: number, ms: number, abortIf?: () => boolean): Promise<boolean> {
    const sx = this.runtime.cursor.x;
    const sy = this.runtime.cursor.y;

    if (ms < 14 || Math.hypot(x - sx, y - sy) < 0.5) {
      this.setPosition(x, y);
      dispatchMove(this.runtime, x, y);
      return true;
    }

    const t0 = performance.now();

    for (;;) {
      if (this.runtime.destroyed || !this.runtime.running || (abortIf && abortIf())) {
        return false;
      }

      const t = clamp((performance.now() - t0) / ms, 0, 1);
      const e = t * t * (3 - 2 * t);

      this.setPosition(sx + (x - sx) * e, sy + (y - sy) * e);
      dispatchMove(this.runtime, this.runtime.cursor.x, this.runtime.cursor.y);

      if (t >= 1) return true;

      await this.clock.sleep(6);
    }
  }
}
