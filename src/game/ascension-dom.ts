import { visibleRect } from './dom-geometry';

// The real controls of an ascension (ASC-10): the Legacy button, the "Ascend" and
// "Reincarnate" prompts, the heavenly tree's crates and the Reincarnate button. Ids from the
// game's main.js 2.058.

/** Space kept free around a crate before the paw clicks it (the tree's edges and the
 * ascension screen's boxes). */
const CRATE_MARGIN_PX = 60;

/** The Legacy button (click: Game.Ascend(), which opens the "Ascend" prompt). */
export function getLegacyButton(): Element | null {
  return document.getElementById('legacyButton');
}

/** The `<id X>` of the open prompt ('Ascend', 'Reincarnate', 'PickDragonAura', ...), '' if
 * none or it has no id. */
export function openPromptId(): string {
  const box = document.querySelector('#promptContent [id^="promptContent"]');
  return box ? box.id.slice('promptContent'.length) : '';
}

/** The visible "Ascend" button inside the "Ascend" prompt. Its "Yes" option is hidden and
 * shares the id promptOption0, so it is looked up inside the prompt's content. */
export function getAscendConfirmButton(): Element | null {
  const box = document.getElementById('promptContentAscend');
  return box ? box.querySelector('#promptOption0') : null;
}

/** "Cancel" in the "Ascend" prompt. */
export function getAscendCancelButton(): Element | null {
  return document.getElementById('promptContentAscend') ? document.getElementById('promptOption1') : null;
}

/** "Yes" in the "Reincarnate" prompt. */
export function getReincarnateConfirmButton(): Element | null {
  return document.getElementById('promptContentReincarnate') ? document.getElementById('promptOption0') : null;
}

/** A heavenly upgrade's crate on the ascension screen (rebuilt after every purchase, so always
 * looked up fresh). */
export function getHeavenlyCrate(id: number): Element | null {
  return document.getElementById(`heavenlyUpgrade${id}`);
}

/** The Reincarnate button on the ascension screen (click: Game.Reincarnate(), which opens
 * its prompt). */
export function getReincarnateButton(): Element | null {
  return document.getElementById('ascendButton');
}

/** True when the crate is on screen with some room around it, so the paw can click it. */
export function crateClickable(el: Element | null): boolean {
  const r = visibleRect(el);
  if (!r) return false;

  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  return cx >= CRATE_MARGIN_PX && cy >= CRATE_MARGIN_PX && cx <= window.innerWidth - CRATE_MARGIN_PX && cy <= window.innerHeight - CRATE_MARGIN_PX;
}

/** How far to drag the tree so the crate lands in the middle of the window (null: no crate). */
export function panToCrate(el: Element | null): { dx: number; dy: number } | null {
  if (!el || !el.isConnected) return null;

  const r = el.getBoundingClientRect();
  if (!r || (r.width <= 0 && r.height <= 0)) return null;

  return {
    dx: window.innerWidth / 2 - (r.left + r.width / 2),
    dy: window.innerHeight / 2 - (r.top + r.height / 2),
  };
}
