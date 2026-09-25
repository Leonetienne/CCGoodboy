import type { CursorPoint } from '../core/runtime-state';
import { laidOut } from './buildings-view-dom';
import { visibleRect } from './dom-geometry';

/** The game's store column (overflow-y: scroll): the upgrades and the buildings list scroll
 * inside it, independently of the page. */
export const STORE_COLUMN_ID = 'sectionRight';

export function getStoreColumn(): HTMLElement | null {
  return document.getElementById(STORE_COLUMN_ID);
}

/** The game's store sections (Upgrades, Switches, Research, Vault: `.storeSection`) are one
 * 60px row tall and only open on a real `:hover`, which synthetic mouse events never trigger.
 * This class (styled in `src/ui/styles.ts`) opens a section the same way while the paw is
 * there (AUTO-9). */
export const STORE_OPEN_CLASS = 'ccsb-store-open';

/** The collapsible store section a store element sits in, or null (the buildings list,
 * `#products`, is never collapsed). */
export function storeSectionOf(el: Element | null | undefined): HTMLElement | null {
  const s = el && el.closest ? el.closest('.storeSection') : null;
  return s instanceof HTMLElement && s.id !== 'products' ? s : null;
}

export function openStoreSection(section: HTMLElement | null): void {
  if (section) section.classList.add(STORE_OPEN_CLASS);
}

export function closeStoreSection(section: HTMLElement | null): void {
  if (section) section.classList.remove(STORE_OPEN_CLASS);
}

function centre(r: DOMRect): CursorPoint {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Where the paw heads for a store element: the element itself when it is on screen,
 * otherwise the visible strip of its collapsed section (the paw opens it on arrival), or
 * null (nothing to visit: the paw stays where it is). */
export function storeApproachPoint(el: Element | null | undefined): CursorPoint | null {
  const r = visibleRect(el);
  if (r) return centre(r);

  const s = visibleRect(storeSectionOf(el));
  return s ? centre(s) : null;
}

/** AUTO-9: what the store column has to be scrolled to before the paw can reach `el`: the
 * element itself, or the section a collapsed crate sits in; null when nothing needs scrolling
 * (the paw already reaches it) or scrolling can't help (not laid out, not in the column). */
export function storeScrollTarget(el: Element | null | undefined): Element | null {
  if (!el || storeApproachPoint(el)) return null;

  const column = getStoreColumn();
  const target = storeSectionOf(el) || el;
  if (!column || !column.contains(target) || !laidOut(target)) return null;

  return target;
}
