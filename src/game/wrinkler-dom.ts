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

/** Viewport point in the middle of a wrinkler's body, or null if the canvas isn't there or
 * the point is off screen. */
export function wrinklerPoint(w: GameWrinkler): { x: number; y: number } | null {
  const canvas = getWrinklerCanvas();
  if (!canvas || !canvas.isConnected) return null;

  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;

  const sx = canvas.width > 0 ? rect.width / canvas.width : 1;
  const sy = canvas.height > 0 ? rect.height / canvas.height : 1;
  const a = ((Number(w.r) || 0) * Math.PI) / 180;

  const x = rect.left + ((Number(w.x) || 0) + Math.sin(a) * WRINKLER_BODY_OFFSET) * sx;
  const y = rect.top + ((Number(w.y) || 0) + Math.cos(a) * WRINKLER_BODY_OFFSET) * sy;

  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;

  return { x, y };
}
