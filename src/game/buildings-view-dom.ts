import { clamp } from '../core/constants';
import { elementHiddenByCss } from './dom-geometry';

/** The game's scrolling middle column (overflow-y: scroll) that holds the building rows
 * (`#rows`) and, when a menu is open, the Options/Stats/Info screens. */
export const CENTER_AREA_ID = 'centerArea';

/** The two panel buttons above the middle column used to get back to the buildings view. */
export type MenuButtonId = 'prefsButton' | 'statsButton';

/** Clicking Options once, then Stats twice, always ends on the buildings view, whatever menu
 * (none, Options, Stats, Info) was open before: each button toggles its own menu, so the
 * sequence is idempotent. */
export const BUILDINGS_VIEW_RECIPE: readonly MenuButtonId[] = ['prefsButton', 'statsButton', 'statsButton'];

export function getCenterArea(): HTMLElement | null {
  return document.getElementById(CENTER_AREA_ID);
}

export function getMenuButton(id: MenuButtonId): Element | null {
  return document.getElementById(id);
}

/** A building's row in the middle column (`#row{id}`). */
export function getBuildingRow(buildingId: number): Element | null {
  return document.getElementById(`row${buildingId}`);
}

/** A building's "lvl N" button inside its row (`#productLevel{id}`, spends sugar lumps). */
export function getBuildingLevelButton(buildingId: number): Element | null {
  return document.getElementById(`productLevel${buildingId}`);
}

/** Is the element laid out at all (connected, has a size, not CSS-hidden)? Unlike
 * visibleRect() this ignores scroll clipping, so it answers "can scrolling bring it into
 * view?". */
export function laidOut(el: Element | null): boolean {
  if (!el || !el.isConnected) return false;

  const r = el.getBoundingClientRect();
  if (!r || r.width <= 0 || r.height <= 0) return false;

  return !elementHiddenByCss(el);
}

/** The #centerArea scrollTop that puts the element's vertical centre in the middle of the
 * column's on-screen part, clamped to the scrollable range. */
export function centeredScrollTop(container: HTMLElement, el: Element): number {
  const cr = container.getBoundingClientRect();
  const er = el.getBoundingClientRect();

  const top = Math.max(cr.top, 0);
  const bottom = Math.min(cr.bottom, window.innerHeight);
  const max = Math.max(0, container.scrollHeight - container.clientHeight);

  return clamp(container.scrollTop + (er.top + er.height / 2) - (top + bottom) / 2, 0, max);
}
