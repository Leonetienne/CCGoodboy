import type { GrimoireMinigame } from './types';

/** The 'hand of fate' spell definition of the Grimoire, or null. */
export function getFthofSpell(M: GrimoireMinigame | null): unknown {
  return M && M.spells ? M.spells['hand of fate'] : null;
}

/** Current mana cost of FTHOF. Infinity when the cost cannot be determined, so nothing gets
 * cast. */
export function getFthofCost(M: GrimoireMinigame | null): number {
  const spell = getFthofSpell(M);

  if (!M || !spell || typeof M.getSpellCost !== 'function') {
    return Infinity;
  }

  return M.getSpellCost(spell);
}
