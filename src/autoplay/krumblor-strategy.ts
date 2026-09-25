import { DRAGON_CURSOR_AURA } from '../game/dragon-dom';

/** Krumblor (KRUMB-*), the pure part: which ONE step comes next on the way from "A crumbly
 * egg" to a dragon wearing the Dragon Cursor aura. Mirrors Game.dragonLevels in main.js 2.058:
 * levels 0-4 are paid in cookies (1M, 2M, 4M, 8M, 16M: "Chip it" x3, "Hatch it", "Train
 * Breath of Milk"), level 5 -> 6 ("Train Dragon Cursor") sacrifices 100 cursors. */

/** Dragon levels paid in cookies; level `l` costs 1M x 2^l. */
export const DRAGON_COOKIE_LEVELS = 5;
/** The level whose training sacrifices 100 cursors (and teaches Dragon Cursor). */
export const DRAGON_CURSOR_LEVEL = 5;
/** Cursors the Dragon Cursor training sacrifices. */
export const DRAGON_CURSOR_SACRIFICE = 100;

/** Cookie cost of training the dragon from `level` (levels 0-4 only). */
export function dragonCookieCost(level: number): number {
  return 1e6 * Math.pow(2, level);
}

export interface KrumblorState {
  eggBought: boolean;
  /** "A crumbly egg" is unlocked and sits in the store. */
  eggInStore: boolean;
  eggCost: number;
  dragonLevel: number;
  /** Aura ids in slot 0 / slot 1 (0 = No aura). */
  auras: [number, number];
  /** The aura highlighted in the open picker (Game.SelectingDragonAura). */
  selectingAura: number;
  /** The dragon's popup is open (Game.specialTab === 'dragon'). */
  menuOpen: boolean;
  /** ... and the paw opened it (so the paw closes it again). */
  menuOurs: boolean;
  /** The "Set your dragon's aura" prompt the PAW opened is up. */
  pickerOurs: boolean;
  cursors: number;
  /** What buying the missing cursors (up to 100) costs right now. */
  cursorBuyUpCost: number;
  /** Cursors sold before the sacrifice that still have to be bought back. */
  rebuy: number;
  /** Bank minus the auto play reserve (AUTO-6). */
  spendable: number;
  /** An "insignificant" cost right now (AUTO-4 A: autoInsignificantSec x CpS). */
  insignificant: number;
}

export type KrumblorStep =
  | { kind: 'buy-egg'; cost: number }
  | { kind: 'open-menu' }
  | { kind: 'train'; level: number }
  | { kind: 'sell-cursors'; n: number }
  | { kind: 'buy-cursors'; n: number; restore: boolean }
  | { kind: 'open-aura' }
  | { kind: 'pick-aura' }
  | { kind: 'confirm-aura' }
  | { kind: 'close-menu' }
  | { kind: 'wait'; why: string }
  | { kind: 'done'; why: string };

/** The next step. Cookie costs (the egg, the egg levels, cursors bought up to 100) are only
 * paid when they are insignificant (AUTO-4 A) and leave the reserve alone, so the dragon
 * never competes with real purchases. Before the cursor sacrifice every cursor above 100 is
 * sold (you get 25% of the priciest ones back) and bought back afterwards (at the cheapest
 * prices): the sacrifice then costs the 100 cheapest cursors instead of the 100 priciest. */
export function nextKrumblorStep(s: KrumblorState): KrumblorStep {
  const affordable = (cost: number) => cost <= s.spendable && cost <= s.insignificant;

  if (s.pickerOurs) {
    return s.selectingAura === DRAGON_CURSOR_AURA ? { kind: 'confirm-aura' } : { kind: 'pick-aura' };
  }

  // Idle or waiting: put the popup the paw opened away again.
  const settle = (step: KrumblorStep): KrumblorStep => (s.menuOpen && s.menuOurs ? { kind: 'close-menu' } : step);

  if (!s.eggBought) {
    if (!s.eggInStore) return settle({ kind: 'done', why: 'no crumbly egg in the store yet' });

    return affordable(s.eggCost) ? { kind: 'buy-egg', cost: s.eggCost } : settle({ kind: 'wait', why: 'saving for the crumbly egg' });
  }

  // Cursors sold for the sacrifice come back first, unless they are still to be sacrificed.
  if (s.rebuy > 0 && (s.dragonLevel > DRAGON_CURSOR_LEVEL || s.cursors < DRAGON_CURSOR_SACRIFICE)) {
    return { kind: 'buy-cursors', n: s.rebuy, restore: true };
  }

  if (s.dragonLevel < DRAGON_COOKIE_LEVELS) {
    if (!affordable(dragonCookieCost(s.dragonLevel))) return settle({ kind: 'wait', why: `saving for dragon level ${s.dragonLevel + 1}` });

    return s.menuOpen ? { kind: 'train', level: s.dragonLevel } : { kind: 'open-menu' };
  }

  if (s.dragonLevel === DRAGON_CURSOR_LEVEL) {
    const missing = DRAGON_CURSOR_SACRIFICE - s.cursors;

    if (missing > 0 && !affordable(s.cursorBuyUpCost)) return settle({ kind: 'wait', why: `saving for ${missing} more cursors` });
    if (!s.menuOpen) return { kind: 'open-menu' };
    if (missing < 0) return { kind: 'sell-cursors', n: -missing };
    if (missing > 0) return { kind: 'buy-cursors', n: missing, restore: false };

    return { kind: 'train', level: s.dragonLevel };
  }

  if (s.auras[0] === DRAGON_CURSOR_AURA || s.auras[1] === DRAGON_CURSOR_AURA) return settle({ kind: 'done', why: 'Dragon Cursor is on' });
  // Never override an aura the player picked.
  if (s.auras[0] !== 0) return settle({ kind: 'done', why: 'the player picked an aura' });

  return s.menuOpen ? { kind: 'open-aura' } : { kind: 'open-menu' };
}
