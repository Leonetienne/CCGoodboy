import type { GameWrinkler } from './types';

/** How far out from its anchor (canvas pixels) the middle of a wrinkler's body is: the game
 * hit-tests a 100x200 box rotated with the wrinkler whose centre sits 90px outward from
 * (me.x, me.y) — the same spot it bursts its particles from. */
const WRINKLER_BODY_OFFSET = 90;

/** The canvas the game draws the big cookie and the wrinklers on. A click only hits a
 * wrinkler when it lands on this element (Game.lastClickedEl) while the game's mouse position
 * is over the wrinkler's body. */
export function getWrinklerCanvas(): HTMLCanvasElement | null {
  return document.getElementById('backgroundLeftCanvas') as HTMLCanvasElement | null;
}

/** The game's own hit test for a wrinkler's body (a port of `inRect()` in main.js with the
 * rect `{w: 100, h: 200, r: -me.r in rad, o: 10}`), in canvas coordinates. */
export function wrinklerHit(w: GameWrinkler, px: number, py: number): boolean {
  const r = (-(Number(w.r) || 0) * Math.PI) / 180;
  const half = 200 / 2 - 10;
  const dx = px - (Number(w.x) || 0) + Math.sin(-r) * -half;
  const dy = py - (Number(w.y) || 0) + Math.cos(-r) * -half;
  const h1 = Math.hypot(dx, dy);
  const a = Math.atan2(dy, dx) - r;
  const x2 = Math.cos(a) * h1;
  const y2 = Math.sin(a) * h1;

  return x2 > -50 && x2 < 50 && y2 > -100 && y2 < 100;
}

/** Offsets (along the body, across it) tried for a poke, centre first. */
const POKE_OFFSETS: Array<[number, number]> = [];
for (const along of [0, 30, -30, 60, -60, 85, -85]) {
  for (const across of [0, 25, -25, 42, -42]) POKE_OFFSETS.push([along, across]);
}

/** Canvas point on `w`'s body where a click really reaches `w`: the game hands a click to the
 * FIRST wrinkler in Game.wrinklers whose body is under the mouse, so with overlapping
 * wrinklers the middle of the body may belong to a neighbour. Tries points from the body
 * centre outward and skips any that an earlier wrinkler also covers; null if none is free. */
export function wrinklerPokeCanvasPoint(w: GameWrinkler, all: GameWrinkler[] = []): { x: number; y: number } | null {
  const a = ((Number(w.r) || 0) * Math.PI) / 180;
  const ax = Math.sin(a);
  const ay = Math.cos(a);
  const cx = (Number(w.x) || 0) + ax * WRINKLER_BODY_OFFSET;
  const cy = (Number(w.y) || 0) + ay * WRINKLER_BODY_OFFSET;
  const idx = all.indexOf(w);
  const earlier = (idx >= 0 ? all.slice(0, idx) : all.filter((o) => o && o.id < w.id)).filter((o) => o && o.phase > 0);

  for (const [along, across] of POKE_OFFSETS) {
    const x = cx + ax * along + ay * across;
    const y = cy + ay * along - ax * across;

    if (wrinklerHit(w, x, y) && !earlier.some((o) => wrinklerHit(o, x, y))) return { x, y };
  }

  return null;
}

/** Viewport point to poke a wrinkler at (the middle of its body, or the nearest spot not
 * covered by an earlier wrinkler in `all`, see wrinklerPokeCanvasPoint), or null if the
 * canvas isn't there, the body is fully covered, or the point is off screen. */
export function wrinklerPoint(w: GameWrinkler, all: GameWrinkler[] = []): { x: number; y: number } | null {
  const canvas = getWrinklerCanvas();
  if (!canvas || !canvas.isConnected) return null;

  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;

  const p = wrinklerPokeCanvasPoint(w, all);
  if (!p) return null;

  const sx = canvas.width > 0 ? rect.width / canvas.width : 1;
  const sy = canvas.height > 0 ? rect.height / canvas.height : 1;

  const x = rect.left + p.x * sx;
  const y = rect.top + p.y * sy;

  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;

  return { x, y };
}
