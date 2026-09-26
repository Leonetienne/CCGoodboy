import { DRAGON_CURSOR_AURA, DRAGONFLIGHT_AURA } from '../game/dragon-dom';

/** Krumblor (KRUMB-*), the pure part: which ONE step comes next on the way from "A crumbly
 * egg" to a dragon wearing the Dragonflight aura. Mirrors Game.dragonLevels in main.js 2.058:
 * levels 0-4 are paid in cookies (1M, 2M, 4M, 8M, 16M: "Chip it" x3, "Hatch it", "Train
 * Breath of Milk"), each level 5-13 sacrifices 100 of one building (Game.ObjectsById[level -
 * 5]: cursors, grandmas, farms, mines, factories, banks, temples, wizard towers, shipments),
 * and level 14 knows Dragonflight (aura `id` is known from level `id + 4`). */

/** Dragon levels paid in cookies; level `l` costs 1M x 2^l. */
export const DRAGON_COOKIE_LEVELS = 5;
/** The first level whose training sacrifices buildings (Dragon Cursor: 100 cursors). */
export const DRAGON_SACRIFICE_FIRST = 5;
/** The level the dragon knows Dragonflight at; levels up to it are the ones trained. */
export const DRAGONFLIGHT_LEVEL = DRAGONFLIGHT_AURA + 4;
/** Buildings each sacrifice level takes. */
export const DRAGON_SACRIFICE = 100;
/** Game.ObjectsById order: the building level `DRAGON_SACRIFICE_FIRST + i` sacrifices. */
export const DRAGON_SACRIFICE_BUILDINGS = ['Cursor', 'Grandma', 'Farm', 'Mine', 'Factory', 'Bank', 'Temple', 'Wizard tower', 'Shipment'];

/** Cookie cost of training the dragon from `level` (levels 0-4 only). */
export function dragonCookieCost(level: number): number {
  return 1e6 * Math.pow(2, level);
}

/** The building training from `level` sacrifices (index into DRAGON_SACRIFICE_BUILDINGS), or
 * -1 for a level paid in cookies or past Dragonflight. */
export function dragonSacrificeIndex(level: number): number {
  const i = level - DRAGON_SACRIFICE_FIRST;
  return i >= 0 && i < DRAGON_SACRIFICE_BUILDINGS.length ? i : -1;
}

/** A building as the sacrifice / rebuy steps see it. */
export interface KrumblorBuilding {
  /** Index into DRAGON_SACRIFICE_BUILDINGS (= its Game.ObjectsById id). */
  id: number;
  owned: number;
  /** What buying the missing ones up to 100 costs right now (0 when >= 100 are owned). */
  buyUpCost: number;
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
  /** The building the current level sacrifices (null for a cookie level or past Dragonflight). */
  sacrifice: KrumblorBuilding | null;
  /** Buildings sold before a sacrifice that still have to be bought back (n = 0: none). */
  rebuy: { building: KrumblorBuilding; n: number } | null;
  /** Bank minus the auto play reserve (AUTO-6). */
  spendable: number;
  /** An "insignificant" cost right now (AUTO-4 A: autoInsignificantSec x CpS). */
  insignificant: number;
}

export type KrumblorStep =
  | { kind: 'buy-egg'; cost: number }
  | { kind: 'open-menu' }
  | { kind: 'train'; level: number }
  | { kind: 'sell-buildings'; id: number; n: number }
  | { kind: 'buy-buildings'; id: number; n: number; restore: boolean }
  | { kind: 'open-aura' }
  | { kind: 'pick-aura' }
  | { kind: 'confirm-aura' }
  | { kind: 'close-menu' }
  | { kind: 'wait'; why: string }
  | { kind: 'done'; why: string };

/** The next step. Cookie costs (the egg, the egg levels, buildings bought up to 100) are only
 * paid when they are insignificant (AUTO-4 A) and leave the reserve alone, so the dragon
 * never competes with real purchases. Before each building sacrifice every copy above 100 is
 * sold (you get 25% of the priciest ones back) and bought back afterwards (at the cheapest
 * prices): the sacrifice then costs the 100 cheapest copies instead of the 100 priciest. */
export function nextKrumblorStep(s: KrumblorState): KrumblorStep {
  const affordable = (cost: number) => cost <= s.spendable && cost <= s.insignificant;

  if (s.pickerOurs) {
    return s.selectingAura === DRAGONFLIGHT_AURA ? { kind: 'confirm-aura' } : { kind: 'pick-aura' };
  }

  // Idle or waiting: put the popup the paw opened away again.
  const settle = (step: KrumblorStep): KrumblorStep => (s.menuOpen && s.menuOurs ? { kind: 'close-menu' } : step);

  if (!s.eggBought) {
    if (!s.eggInStore) return settle({ kind: 'done', why: 'no crumbly egg in the store yet' });

    return affordable(s.eggCost) ? { kind: 'buy-egg', cost: s.eggCost } : settle({ kind: 'wait', why: 'saving for the crumbly egg' });
  }

  // Buildings sold for a sacrifice come back first, unless they are still to be sacrificed.
  const rb = s.rebuy;
  if (rb && rb.n > 0 && (s.dragonLevel > DRAGON_SACRIFICE_FIRST + rb.building.id || rb.building.owned < DRAGON_SACRIFICE)) {
    return { kind: 'buy-buildings', id: rb.building.id, n: rb.n, restore: true };
  }

  if (s.dragonLevel < DRAGON_COOKIE_LEVELS) {
    if (!affordable(dragonCookieCost(s.dragonLevel))) return settle({ kind: 'wait', why: `saving for dragon level ${s.dragonLevel + 1}` });

    return s.menuOpen ? { kind: 'train', level: s.dragonLevel } : { kind: 'open-menu' };
  }

  if (s.dragonLevel < DRAGONFLIGHT_LEVEL) {
    const b = s.sacrifice;
    if (!b) return settle({ kind: 'wait', why: `no building for dragon level ${s.dragonLevel + 1}` });

    const name = DRAGON_SACRIFICE_BUILDINGS[b.id];
    const missing = DRAGON_SACRIFICE - b.owned;

    if (missing > 0 && !affordable(b.buyUpCost)) return settle({ kind: 'wait', why: `saving for ${missing} more ${name}` });
    if (!s.menuOpen) return { kind: 'open-menu' };
    if (missing < 0) return { kind: 'sell-buildings', id: b.id, n: -missing };
    if (missing > 0) return { kind: 'buy-buildings', id: b.id, n: missing, restore: false };

    return { kind: 'train', level: s.dragonLevel };
  }

  if (s.auras[0] === DRAGONFLIGHT_AURA || s.auras[1] === DRAGONFLIGHT_AURA) return settle({ kind: 'done', why: 'Dragonflight is on' });
  // Never override an aura the player picked (Dragon Cursor is what earlier versions put on).
  if (s.auras[0] !== 0 && s.auras[0] !== DRAGON_CURSOR_AURA) return settle({ kind: 'done', why: 'the player picked an aura' });

  return s.menuOpen ? { kind: 'open-aura' } : { kind: 'open-menu' };
}
