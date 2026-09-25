import type { RuntimeState } from '../core/runtime-state';
import type { CursorJobContext, JobRequest } from '../cursor/types';
import { visibleRect } from '../game/dom-geometry';
import { getStoreColumn, openStoreSection, storeScrollTarget, storeSectionOf } from '../game/store-dom';
import { ScrollIntoViewAction } from './buildings-view';

/** A store scroll that didn't bring its element into view isn't tried again for this long
 * (the paw then visits as before: from where it is). */
const STORE_SCROLL_GIVE_UP_MS = 10000;

export interface StoreScrollParams {
  /** Job key of the visit that follows; the scroll gets `${key}:scroll`. */
  key: string;
  priority: number;
  hud: { action: string; target: string };
  abortIf: () => boolean;
}

/** AUTO-9: when the store item `el()` is scrolled out of the store column (#sectionRight: a
 * building far down the list, the upgrades above a scrolled-down list), a job that rests the
 * paw over the column and wheel-scrolls it until the item (or its collapsed section) is in
 * the middle; null when nothing needs scrolling. The visit itself comes on a later tick. */
export function storeScrollJob(runtime: RuntimeState, el: () => Element | null, p: StoreScrollParams): JobRequest | null {
  const first = el();
  if (!storeScrollTarget(first)) return null;

  const giveUpKey = first!.id || p.key;
  if (Date.now() < (runtime.storeScrollGiveUp.get(giveUpKey) || 0)) return null;

  return {
    action: new ScrollIntoViewAction({
      label: 'scroll the store',
      element: () => {
        const now = el();
        return now ? storeSectionOf(now) || now : null;
      },
      container: getStoreColumn,
      abortIf: p.abortIf,
      onDone: (inView) => {
        if (!inView) runtime.storeScrollGiveUp.set(giveUpKey, Date.now() + STORE_SCROLL_GIVE_UP_MS);
      },
      hud: p.hud,
    }),
    priority: p.priority,
    key: `${p.key}:scroll`,
  };
}

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
