import { afterEach, describe, expect, it } from 'vitest';
import { enterStoreElement, storeScrollJob } from '../../src/actions/store-visit';
import { RuntimeState } from '../../src/core/runtime-state';
import type { CursorJobContext } from '../../src/cursor/types';
import {
  STORE_OPEN_CLASS,
  closeStoreSection,
  openStoreSection,
  storeApproachPoint,
  storeScrollTarget,
  storeSectionOf,
} from '../../src/game/store-dom';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

/** #upgrades (a collapsed .storeSection strip at y 100..160) with two crates: upgrade0 in the
 * visible first row, upgrade1 in the second row, clipped away until the section opens. */
function store(): { section: HTMLElement; first: HTMLElement; second: HTMLElement } {
  document.body.innerHTML = `
    <div id="products" class="storeSection"><div id="product0"></div></div>
    <div id="upgrades" class="storeSection"><div id="upgrade0" class="crate"></div><div id="upgrade1" class="crate"></div></div>`;

  const section = document.getElementById('upgrades')!;
  const first = document.getElementById('upgrade0')!;
  const second = document.getElementById('upgrade1')!;

  section.getBoundingClientRect = () => (section.classList.contains(STORE_OPEN_CLASS) ? rect(1000, 100, 300, 120) : rect(1000, 100, 300, 60));
  first.getBoundingClientRect = () => rect(1006, 106, 48, 48);
  second.getBoundingClientRect = () => rect(1006, 166, 48, 48);

  // jsdom's computed opacity is '' (read as hidden) unless pinned, see tests/unit/setup.ts
  document.body.querySelectorAll<HTMLElement>('div').forEach((el) => (el.style.opacity = '1'));
  section.style.overflowY = 'hidden';

  return { section, first, second };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('store sections (AUTO-9)', () => {
  it('finds the collapsible section around an upgrade crate, never the buildings list', () => {
    const { section, first } = store();
    expect(storeSectionOf(first)).toBe(section);
    expect(storeSectionOf(document.getElementById('product0'))).toBeNull();
  });

  it('opens and closes a section with the class', () => {
    const { section } = store();
    openStoreSection(section);
    expect(section.classList.contains(STORE_OPEN_CLASS)).toBe(true);
    closeStoreSection(section);
    expect(section.classList.contains(STORE_OPEN_CLASS)).toBe(false);
  });

  it('heads for a visible crate itself, and for the section strip when the crate is folded away', () => {
    const { second, first } = store();
    expect(storeApproachPoint(first)).toEqual({ x: 1030, y: 130 });
    expect(storeApproachPoint(second)).toEqual({ x: 1150, y: 130 });
  });

  it('opens the section on arrival and moves the paw onto the folded-away crate', async () => {
    const { section, second } = store();
    const moves: Array<[number, number]> = [];

    const ctx = {
      runtime: { cursor: { x: 1150, y: 130 } },
      clock: { sleep: async () => {} },
      cursor: {
        moveCursorTo: async (x: number, y: number) => {
          moves.push([x, y]);
          return true;
        },
      },
    } as unknown as CursorJobContext;

    expect(await enterStoreElement(ctx, second)).toBe(section);
    expect(section.classList.contains(STORE_OPEN_CLASS)).toBe(true);
    expect(moves).toEqual([[1030, 190]]);
  });

  it('does nothing for a building row', async () => {
    store();
    const ctx = { runtime: { cursor: { x: 0, y: 0 } }, clock: { sleep: async () => {} } } as unknown as CursorJobContext;
    expect(await enterStoreElement(ctx, document.getElementById('product0'))).toBeNull();
  });
});

describe('scrolling the store column to an item (AUTO-9)', () => {
  /** #sectionRight (on screen at y 0..800) holding the buildings list; product17 far below. */
  function column(): { col: HTMLElement; row: HTMLElement; near: HTMLElement } {
    document.body.innerHTML = `
      <div id="sectionRight"><div id="products" class="storeSection"><div id="product0"></div><div id="product17"></div></div></div>`;
    const col = document.getElementById('sectionRight')!;
    const near = document.getElementById('product0')!;
    const row = document.getElementById('product17')!;
    col.getBoundingClientRect = () => rect(1000, 0, 300, 800);
    near.getBoundingClientRect = () => rect(1000, 300, 300, 64);
    row.getBoundingClientRect = () => rect(1000, 1400 - col.scrollTop, 300, 64);
    document.body.querySelectorAll<HTMLElement>('div').forEach((el) => (el.style.opacity = '1'));
    col.style.overflowY = 'scroll';
    return { col, row, near };
  }

  it('wants a building row below the fold scrolled into view, not one on screen', () => {
    const { row, near } = column();
    expect(storeScrollTarget(row)).toBe(row);
    expect(storeScrollTarget(near)).toBeNull();
    expect(storeScrollTarget(null)).toBeNull();
  });

  it('hands out a scroll job over the store column, and stops trying after a failed scroll', () => {
    const { row } = column();
    const runtime = new RuntimeState();
    const job = storeScrollJob(runtime, () => row, { key: 'auto-shop:Javascript console', priority: 5, hud: { action: 'auto-shop', target: 'x' }, abortIf: () => false })!;
    expect(job.key).toBe('auto-shop:Javascript console:scroll');
    expect(job.action.label).toBe('scroll the store');

    (job.action as unknown as { p: { onDone: (inView: boolean) => void } }).p.onDone(false);
    expect(storeScrollJob(runtime, () => row, { key: 'k', priority: 5, hud: { action: 'auto-shop', target: 'x' }, abortIf: () => false })).toBeNull();
  });
});
