import { getWrinklerCanvas } from './wrinkler-dom';

/** Krumblor's DOM (KRUMB-*). The dragon's tab is not an element: the game draws it on
 * #backgroundLeftCanvas and hit-tests clicks on that canvas itself (Game.UpdateSpecial). The
 * dragon's popup, its aura slot and the aura picker are real elements. */

/** Aura id of "Dragon Cursor" (Game.dragonAuras[2]); the dragon knows aura `id` from
 * dragonLevel `id + 4` on. */
export const DRAGON_CURSOR_AURA = 2;

/** Canvas point of a special tab: Game.UpdateSpecial stacks the tabs at x 24, from
 * y = canvas height - 24 - 48 x tab count, 48px apart, and hit-tests +-24px around that
 * point (the open tab is drawn at x 48 and hit-tested +-48px, so x 24 hits it either way). */
export function specialTabCanvasPoint(tabs: string[], tab: string, canvasHeight: number): { x: number; y: number } | null {
  const i = tabs.indexOf(tab);
  if (i < 0 || !(canvasHeight > 0)) return null;

  return { x: 24, y: canvasHeight - 24 - 48 * tabs.length + 48 * i };
}

/** Viewport point of a special tab ('dragon'), or null if the canvas or the point is not on
 * screen. */
export function specialTabPoint(tabs: string[], tab: string): { x: number; y: number } | null {
  const canvas = getWrinklerCanvas();
  if (!canvas || !canvas.isConnected) return null;

  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;

  const p = specialTabCanvasPoint(tabs, tab, canvas.height);
  if (!p) return null;

  const x = rect.left + p.x * (canvas.width > 0 ? rect.width / canvas.width : 1);
  const y = rect.top + p.y * (canvas.height > 0 ? rect.height / canvas.height : 1);

  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;

  return { x, y };
}

/** The first element under `root` whose click handler (onclick, or ontouchend on touch
 * builds) contains `code`. */
function withHandler(root: Element | null, selector: string, code: string): Element | null {
  if (!root) return null;

  for (const el of Array.from(root.querySelectorAll(selector))) {
    const h = el.getAttribute('onclick') || el.getAttribute('ontouchend') || '';
    if (h.includes(code)) return el;
  }

  return null;
}

/** The dragon's popup, only while it is shown (className 'onScreen'). */
export function getSpecialPopup(): Element | null {
  const el = document.getElementById('specialPopup');
  return el && el.classList.contains('onScreen') ? el : null;
}

/** The popup's big blue "Chip it / Hatch it / Train X | sacrifice ..." button. */
export function getDragonTrainButton(): Element | null {
  return withHandler(getSpecialPopup(), 'a.option', 'Game.UpgradeDragon(');
}

/** The popup's aura slot crate (slot 0 = the primary aura, top right of the popup). */
export function getDragonAuraSlot(slot: 0 | 1): Element | null {
  return withHandler(getSpecialPopup(), '.crate', `Game.SelectDragonAura(${slot})`);
}

/** The popup's close "x". */
export function getSpecialPopupClose(): Element | null {
  const popup = getSpecialPopup();
  return popup ? popup.querySelector('.close') : null;
}

/** The "Set your dragon's aura" prompt's content, while it is open. */
export function getAuraPicker(): Element | null {
  return document.getElementById('promptContentPickDragonAura');
}

/** The picker's crate for aura `id`. */
export function getAuraPickerCrate(id: number): Element | null {
  return withHandler(getAuraPicker(), '.crate', `Game.SetDragonAura(${id},`);
}

/** The picker's "Confirm" button (the prompt's first option). */
export function getAuraPickerConfirm(): Element | null {
  return getAuraPicker() ? document.getElementById('promptOption0') : null;
}

