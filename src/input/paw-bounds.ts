import { clamp } from '../core/constants';

/** On-screen sprite geometry, kept in one place so containment and centre math match the
 * renderer. The sprite is mirrored (paw faces left) and drawn at 60px tall. */
export const PAW_SPRITE_W = 892;
export const PAW_SPRITE_H = 1247;
export const PAW_SPRITE_HX = 257; // click point (middle claw tip), after mirroring
export const PAW_SPRITE_HY = 4;
export const PAW_SPRITE_DRAW_H = 60;

/** Keeps the whole paw sprite inside the viewport, not just its click point. The sprite is
 * drawn around the click point and can tilt while dancing/leaning, so this margin is the
 * largest distance from the click point to a sprite corner (~68px for the 60px-tall sprite).
 * Idle/ponder/dance motion uses this; real game clicks still use the normal game targets so
 * a golden cookie near the screen edge stays clickable. */
export const PAW_CONTAIN_MARGIN_PX = 68;

/** Offset from the paw's click point to the centre of the sprite bounding box. */
export function pawSpriteCenterOffset(): { x: number; y: number } {
  const w = (PAW_SPRITE_DRAW_H * PAW_SPRITE_W) / PAW_SPRITE_H;
  const h = PAW_SPRITE_DRAW_H;
  const dx = -(PAW_SPRITE_HX / PAW_SPRITE_W) * w;
  const dy = -(PAW_SPRITE_HY / PAW_SPRITE_H) * h;

  return { x: dx + w / 2, y: dy + h / 2 };
}

/** Clamps a paw click point so the entire paw sprite stays within the viewport. */
export function clampPawPoint(x: number, y: number): { x: number; y: number } {
  const m = Math.min(PAW_CONTAIN_MARGIN_PX, Math.floor(Math.min(window.innerWidth, window.innerHeight) / 2));

  return {
    x: clamp(x, m, Math.max(m, window.innerWidth - m)),
    y: clamp(y, m, Math.max(m, window.innerHeight - m)),
  };
}
