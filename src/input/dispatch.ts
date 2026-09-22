import type { RuntimeState } from '../core/runtime-state';

/** Actions whose paw movement is purely cosmetic (pondering, dancing, idle wandering, bored
 * clicks). dispatchMove() stays silent during them: the game puts click numbers, popups and
 * tooltips at Game.mouseX/Y, so a wandering paw would hijack them from the real mouse. */
export const SILENT_MOVE_ACTIONS = new Set(['idle', 'idle-play', 'happy-dance', 'bored-click', 'auto-shop']);

/** Sends a synthetic mousemove to the document (keeps the game's mouse position in step with
 * the paw during real actions). Silent while a cosmetic action runs. */
export function dispatchMove(runtime: RuntimeState, x: number, y: number): void {
  if (SILENT_MOVE_ACTIONS.has(runtime.currentAction)) {
    return;
  }

  try {
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: false,
        view: window,
        clientX: Math.round(x),
        clientY: Math.round(y),
        screenX: Math.round(x),
        screenY: Math.round(y),
        detail: 0,
      }),
    );
  } catch (_e) {
    /* ignore */
  }
}

/** Dispatches a synthetic MouseEvent (bubbling) on an element. */
export function dispatchMouse(el: Element | null, type: string, x: number, y: number, buttons?: number): boolean {
  if (!el) return false;

  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: Math.round(x),
    clientY: Math.round(y),
    screenX: Math.round(x),
    screenY: Math.round(y),
    button: 0,
    buttons: buttons || 0,
    detail: 1,
  });

  return el.dispatchEvent(ev);
}
