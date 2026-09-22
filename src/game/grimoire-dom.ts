import { getFthofSpell } from './grimoire';
import type { GrimoireMinigame } from './types';
import { visibleRect } from './dom-geometry';

export type GrimoireActionKind = 'fthof' | 'refill';

/** The real Grimoire DOM control for an action. */
export function getGrimoireControl(kind: GrimoireActionKind, M: GrimoireMinigame | null): Element | null {
  if (kind === 'fthof') {
    const spell = getFthofSpell(M) as { id?: number } | null;
    return spell && spell.id != null ? document.getElementById(`grimoireSpell${spell.id}`) : null;
  }

  if (kind === 'refill') {
    return document.getElementById('grimoireLumpRefill');
  }

  return null;
}

/** Element used as the paw's movement target: the real control, if visible. */
export function getActionVisualElement(kind: GrimoireActionKind, M: GrimoireMinigame | null): Element | null {
  const real = getGrimoireControl(kind, M);
  return visibleRect(real) ? real : null;
}

/** Centre of a visible element. */
export function elementCenter(el: Element | null): { x: number; y: number; rect: DOMRect } | null {
  const rect = visibleRect(el);
  if (!rect) return null;

  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect };
}
