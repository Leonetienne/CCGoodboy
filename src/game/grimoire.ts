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

/** Whether a full mana refill could ever pay for `cost` at all. Wizard towers cap max mana
 * (`magic M`); once FTHOF's cost outgrows it, a lump refill only ever tops off to that cap
 * and can never reach `cost`, so spending a lump on it would be pure waste. */
export function refillCanReachCost(M: GrimoireMinigame | null, cost: number): boolean {
  return !!M && (M.magicM ?? 0) >= cost;
}
