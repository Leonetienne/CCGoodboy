import { visibleRect } from './dom-geometry';

/** The real DOM control for the growing/ripe sugar lump: `#lumps`, in the right sidebar under
 * the Stats button. Unlike the Grimoire controls there is no HUD dock fallback — the lump icon
 * is part of the game's permanent chrome once unlocked, not something that can fold away. */
export function getLumpControl(): Element | null {
  return document.getElementById('lumps');
}

/** Centre of the sugar lump control, or null if it isn't on screen (not unlocked yet, or
 * hidden/clipped). */
export function lumpCenter(): { x: number; y: number } | null {
  const rect = visibleRect(getLumpControl());
  if (!rect) return null;

  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
