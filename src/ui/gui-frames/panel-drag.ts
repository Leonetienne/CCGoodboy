import { clamp } from '../../core/constants';
import type { PersistedData } from '../../core/persisted-data';

/** UI position fields that can be dragged (one per frame). */
export type UiPosKey = 'panelPos' | 'graphsPos' | 'logsPos' | 'debugPos';

export interface FrameOptions {
  posKey: UiPosKey;
  header: HTMLElement | null;
  /** Only the main HUD panel adjusts its body height to the available screen space. */
  body?: HTMLElement | null;
}

/** Applies a saved (dragged) position, keeping the frame fully on screen. For the main panel
 * the expanded body scrolls instead of running off the bottom. */
export function applyFramePosition(panel: HTMLElement | null, data: PersistedData, opts: FrameOptions): void {
  if (!panel) return;

  const pos = data.ui[opts.posKey];
  const headerH = (opts.header && opts.header.getBoundingClientRect().height) || 32;

  if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.transform = '';

    if (opts.body) {
      opts.body.style.maxHeight = '';
    }

    return;
  }

  const rect = panel.getBoundingClientRect();
  const left = clamp(pos.left, 0, Math.max(0, window.innerWidth - (rect.width || 360)));
  const top = clamp(pos.top, 0, Math.max(0, window.innerHeight - headerH));

  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
  panel.style.right = 'auto';
  panel.style.transform = 'none';

  // Let the expanded body scroll instead of running off the bottom of the screen.
  if (opts.body) {
    opts.body.style.maxHeight = Math.max(120, window.innerHeight - top - headerH - 12) + 'px';
  }
}

interface DragState {
  id: number;
  dx: number;
  dy: number;
}

/** Makes a frame's header a drag handle (pointer events; interactive elements excluded).
 * Saves the final position under `opts.posKey`. */
export function setupFrameDrag(panel: HTMLElement, data: PersistedData, opts: FrameOptions, onDragEnd: () => void): void {
  const header = opts.header;
  if (!header) return;

  let drag: DragState | null = null;

  header.addEventListener('pointerdown', (e) => {
    const me = e as PointerEvent;
    const target = me.target as HTMLElement | null;

    if (me.button !== 0 || (target && target.closest && target.closest('button,input,textarea,select,a'))) {
      return;
    }

    const r = panel.getBoundingClientRect();

    // If the frame is still centred by its CSS transform, pin it at its current on-screen
    // spot first so it does not jump when we clear the transform.
    panel.style.left = r.left + 'px';
    panel.style.top = r.top + 'px';
    panel.style.right = 'auto';
    panel.style.transform = 'none';

    drag = { id: me.pointerId, dx: me.clientX - r.left, dy: me.clientY - r.top };

    try {
      header.setPointerCapture(me.pointerId);
    } catch (_e) {
      /* ignore */
    }

    panel.classList.add('dragging');
    me.preventDefault();
  });

  header.addEventListener('pointermove', (e) => {
    const me = e as PointerEvent;
    if (!drag || me.pointerId !== drag.id) return;

    data.ui[opts.posKey] = { left: me.clientX - drag.dx, top: me.clientY - drag.dy };
    applyFramePosition(panel, data, opts);
  });

  const end = (e: Event) => {
    const me = e as PointerEvent;
    if (!drag || me.pointerId !== drag.id) return;

    drag = null;

    try {
      header.releasePointerCapture(me.pointerId);
    } catch (_e) {
      /* ignore */
    }

    panel.classList.remove('dragging');

    // Store the clamped, final position.
    const r = panel.getBoundingClientRect();
    data.ui[opts.posKey] = { left: Math.round(r.left), top: Math.round(r.top) };
    applyFramePosition(panel, data, opts);

    onDragEnd();
  };

  header.addEventListener('pointerup', end);
  header.addEventListener('pointercancel', end);
}

/** Main HUD panel wrapper (kept as the public name used by UiRoot). */
export function applyPanelPosition(panel: HTMLElement | null, data: PersistedData): void {
  applyFramePosition(panel, data, {
    posKey: 'panelPos',
    header: document.getElementById('ccsb-header'),
    body: document.getElementById('ccsb-body'),
  });
}

/** Main HUD panel wrapper (kept as the public name used by UiRoot). */
export function setupPanelDrag(panel: HTMLElement, data: PersistedData, onDragEnd: () => void): void {
  setupFrameDrag(
    panel,
    data,
    {
      posKey: 'panelPos',
      header: document.getElementById('ccsb-header'),
      body: document.getElementById('ccsb-body'),
    },
    onDragEnd,
  );
}
