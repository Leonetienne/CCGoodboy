/** Santa (XMAS-*), the pure part: which ONE step comes next on the way from "A festive hat" to
 * "Final Claus". Mirrors Game.UpgradeSanta in main.js 2.058: level `l` evolves to `l + 1` for
 * (l + 1)^(l + 1) cookies (the bank must hold MORE than that), up to level 14, Final Claus,
 * which also unlocks Santa's dominion. Each evolution unlocks one Santa gift not yet
 * unlocked. */

/** Game.santaLevels.length - 1: "Final Claus". */
export const SANTA_FINAL_LEVEL = 14;

/** An evolution whose cost isn't insignificant is still paid when it pays back within this
 * (its gain: Santa's legacy's +3% and, for Final Claus, Santa's dominion). */
export const SANTA_MAX_PAYBACK_SEC = 3600;

/** Santa's dominion's base price (it unlocks at Final Claus and has to be bought on top). */
export const SANTAS_DOMINION_PRICE = 2525252525252525;

/** Cookie cost of evolving Santa from `level`. */
export function santaEvolveCost(level: number): number {
  return Math.pow(level + 1, level + 1);
}

export interface SantaState {
  /** "A festive hat" is owned: Santa's tab exists. */
  hatBought: boolean;
  santaLevel: number;
  /** A Santa gift sits unbought in the store (evolving would triple its price). */
  giftWaiting: boolean;
  /** "Santa's legacy" is owned (+3% CpS per level). */
  hasLegacy: boolean;
  /** Santa's popup is open (Game.specialTab === 'santa'). */
  menuOpen: boolean;
  /** ... and the paw opened it (so the paw closes it again). */
  menuOurs: boolean;
  /** Unbuffed CpS. */
  cps: number;
  /** Bank minus the auto play reserve (AUTO-6). */
  spendable: number;
  /** An "insignificant" cost right now (AUTO-4 A: autoInsignificantShare x the spendable bank). */
  insignificant: number;
}

export type SantaStep =
  | { kind: 'open-menu' }
  | { kind: 'evolve'; level: number; cost: number }
  | { kind: 'close-menu' }
  | { kind: 'wait'; why: string }
  | { kind: 'done'; why: string };

/** Payback (s) of evolving from `level`: the cost (plus Santa's dominion's for Final Claus)
 * against what the evolution adds right away. Infinity when it adds nothing yet. */
export function santaEvolvePaybackSec(s: Pick<SantaState, 'santaLevel' | 'hasLegacy' | 'cps'>): number {
  let cost = santaEvolveCost(s.santaLevel);
  let gain = s.hasLegacy ? s.cps * 0.03 : 0;

  if (s.santaLevel + 1 === SANTA_FINAL_LEVEL) {
    cost += SANTAS_DOMINION_PRICE;
    gain += s.cps * 0.2;
  }

  return gain > 0 ? cost / gain : Infinity;
}

/** The next step. Santa evolves when the bank holds more than the cost (reserve kept), the cost
 * is insignificant (AUTO-4 A) or pays back within SANTA_MAX_PAYBACK_SEC, and no gift waits in
 * the store (buy the gifts first: each evolution triples their price). */
export function nextSantaStep(s: SantaState): SantaStep {
  // Idle or waiting: put the popup the paw opened away again.
  const settle = (step: SantaStep): SantaStep => (s.menuOpen && s.menuOurs ? { kind: 'close-menu' } : step);

  if (!s.hatBought) return settle({ kind: 'done', why: 'no festive hat yet' });
  if (s.santaLevel >= SANTA_FINAL_LEVEL) return settle({ kind: 'done', why: 'Santa is Final Claus' });
  if (s.giftWaiting) return settle({ kind: 'wait', why: "buying Santa's gifts first" });

  const cost = santaEvolveCost(s.santaLevel);
  const worth = cost <= s.insignificant || santaEvolvePaybackSec(s) <= SANTA_MAX_PAYBACK_SEC;

  if (!(cost < s.spendable) || !worth) return settle({ kind: 'wait', why: `saving for Santa level ${s.santaLevel + 1}` });

  return s.menuOpen ? { kind: 'evolve', level: s.santaLevel, cost } : { kind: 'open-menu' };
}
