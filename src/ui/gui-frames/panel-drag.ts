import { clamp } from '../../core/constants';
import type { PersistedData } from '../../core/persisted-data';

/** Applies the saved (dragged) position, keeping the panel fully on screen and letting the
 * expanded body scroll instead of running off the bottom. */
export function applyPanelPosition(panel: HTMLElement | null, data: PersistedData): void {
  if (!panel) return;

  const body = document.getElementById('ccsb-body');
  const pos = data.ui.panelPos;

  if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';

    if (body) {
      body.style.maxHeight = '';
    }

    return;
  }

  const rect = panel.getBoundingClientRect();
  const header = document.getElementById('ccsb-header');
  const headerH = (header && header.getBoundingClientRect().height) || 32;

  const left = clamp(pos.left, 0, Math.max(0, window.innerWidth - (rect.width || 360)));
  const top = clamp(pos.top, 0, Math.max(0, window.innerHeight - headerH));

  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
  panel.style.right = 'auto';

  // Let the expanded body scroll instead of running off the bottom of the screen.
  if (body) {
    body.style.maxHeight = Math.max(120, window.innerHeight - top - headerH - 12) + 'px';
  }
}

interface DragState {
  id: number;
  dx: number;
  dy: number;
}

/** Makes the panel's title bar a drag handle (pointer events; buttons excluded). Saves the
 * final position. */
export function setupPanelDrag(panel: HTMLElement, data: PersistedData, onDragEnd: () => void): void {
  const header = document.getElementById('ccsb-header');
  if (!header) return;

  let drag: DragState | null = null;

  header.addEventListener('pointerdown', (e) => {
    const me = e as PointerEvent;
    const target = me.target as HTMLElement | null;

    if (me.button !== 0 || (target && target.closest && target.closest('button'))) {
      return;
    }

    const r = panel.getBoundingClientRect();

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

    data.ui.panelPos = { left: me.clientX - drag.dx, top: me.clientY - drag.dy };
    applyPanelPosition(panel, data);
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
    data.ui.panelPos = { left: Math.round(r.left), top: Math.round(r.top) };

    onDragEnd();
  };

  header.addEventListener('pointerup', end);
  header.addEventListener('pointercancel', end);
}
