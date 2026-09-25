import type { CursorJobContext } from '../cursor/types';
import { visibleRect } from '../game/dom-geometry';
import { openStoreSection, storeSectionOf } from '../game/store-dom';

/** How long the opened section is "hovered" before the paw moves on to the crate (ms). */
const STORE_OPEN_MS = 60;

/** The paw arriving at a store element (AUTO-9): opens the element's collapsed store section
 * (Upgrades & co. show one row unless hovered), then moves onto the element if it isn't
 * already under the paw. Returns the section to close (`closeStoreSection`) once the paw is
 * done, or null when the element sits in no collapsible section or the section is off
 * screen. */
export async function enterStoreElement(ctx: CursorJobContext, el: Element | null): Promise<HTMLElement | null> {
  const section = storeSectionOf(el);
  if (!section || !visibleRect(section)) return null;

  openStoreSection(section);
  await ctx.clock.sleep(STORE_OPEN_MS);

  const r = visibleRect(el);
  const { x, y } = ctx.runtime.cursor;

  if (r && !(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) {
    await ctx.cursor.moveCursorTo(r.left + r.width / 2, r.top + r.height / 2, true);
  }

  return section;
}
