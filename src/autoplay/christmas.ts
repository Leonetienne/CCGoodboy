import type { IGameAdapter } from '../game/game-adapter';
import type { GameUpgrade } from '../game/types';
import { autoPerClick } from './building-valuation';
import type { UpgradeClassifyCtx } from './upgrade-classifier';
import { AUTO_PREF_GOLDEN } from './valuation-tables';

/** CHRISTMAS (XMAS-*). During Christmas season "A festive hat" (25 cookies) unlocks; bought, it
 * adds Santa's tab to the left canvas and one random Santa gift. Every time Santa evolves
 * (santa.ts) another gift lands in the store, and at the final level ("Final Claus") Santa's
 * dominion. Reindeer drop the 7 reindeer biscuits; those are ordinary cookie upgrades (+2% CpS)
 * and bought as biscuits (AUTO-2), so they don't appear here.
 *
 * A Santa gift costs 2525 x 3^santaLevel: every evolution triples the price of the gifts still
 * in the store. So the gifts are preferred (bought whenever affordable, AUTO-4 B), and Santa
 * only evolves once no gift waits in the store (santa-strategy.ts). */

/** Game.santaDrops (main.js 2.058), in the game's order. */
export const SANTA_DROPS = [
  'Increased merriness',
  'Improved jolliness',
  'A lump of coal',
  'An itchy sweater',
  'Reindeer baking grounds',
  'Weighted sleighs',
  'Ho ho ho-flavored frosting',
  'Season savings',
  'Toy workshop',
  'Naughty list',
  "Santa's bottomless bag",
  "Santa's helpers",
  "Santa's legacy",
  "Santa's milk and cookies",
];

/** Game.reindeerDrops: random drops from clicked reindeer (biscuits, +2% CpS each). */
export const REINDEER_DROPS = [
  'Christmas tree biscuits',
  'Snowflake biscuits',
  'Snowman biscuits',
  'Holly biscuits',
  'Candy cane biscuits',
  'Bell biscuits',
  'Present biscuits',
];

export const FESTIVE_HAT = 'A festive hat';
export const SANTAS_DOMINION = "Santa's dominion";

/** The Christmas upgrades valued here (the reindeer biscuits are plain biscuits). */
export const CHRISTMAS_UPGRADES = new Set([FESTIVE_HAT, ...SANTA_DROPS, SANTAS_DOMINION]);

/** Share of CpS given to a Christmas upgrade whose effect isn't worth CpS to the bot (the hat,
 * the reindeer upgrades: the bot never clicks reindeer, drop rates, milk). */
export const XMAS_NOMINAL_SHARE = 0.001;

/** Flat CpS shares: the "+N%" gifts, and the "N% cheaper" ones valued like Faberge egg
 * (1% cheaper buildings is about 1% faster growth). */
const XMAS_CPS_SHARE: Record<string, number> = {
  'Increased merriness': 0.15,
  'Improved jolliness': 0.15,
  'A lump of coal': 0.01,
  'An itchy sweater': 0.01,
  'Season savings': 0.01,
  // +20% CpS, buildings 1% and upgrades 2% cheaper
  [SANTAS_DOMINION]: 0.21,
};

export interface XmasClassifyCtx extends UpgradeClassifyCtx {
  /** Game.santaLevel (Santa's legacy: +3% CpS per level). */
  santaLevel: number;
}

/** Classifies a Christmas upgrade and estimates the CpS it adds (null for anything else):
 *   Increased merriness / Improved jolliness  +15% CpS
 *   A lump of coal / An itchy sweater         +1% CpS
 *   Season savings                            buildings 1% cheaper: +1% CpS
 *   Naughty list                              grandmas twice as efficient: the grandmas' CpS
 *   Santa's helpers                           clicks 10% stronger: 10% of the clicking income
 *   Santa's legacy                            +3% CpS per Santa level (levels start at 1)
 *   Santa's dominion                          +20% CpS and cheaper everything: +21% CpS
 *   the rest (hat, reindeer, drop rate, toy workshop, milk)  nominal
 * The hat and the gifts are preferred (their price rises with Santa's level); Santa's dominion
 * (2.5 quadrillion) competes on payback like anything else. */
export function christmasUpgradeGain(game: IGameAdapter, up: GameUpgrade, ctx: XmasClassifyCtx): { gain: number; type: string; pref?: number } | null {
  const name = up.name;
  if (!CHRISTMAS_UPGRADES.has(name)) return null;

  const nominal = ctx.cps * XMAS_NOMINAL_SHARE;
  let gain = nominal;

  if (Object.prototype.hasOwnProperty.call(XMAS_CPS_SHARE, name)) {
    gain = ctx.cps * XMAS_CPS_SHARE[name]!;
  } else if (name === 'Naughty list') {
    const g = game.getBuildingByName('Grandma');
    gain = (Number(g && g.storedTotalCps) || 0) * ctx.mult;
  } else if (name === "Santa's helpers") {
    gain = autoPerClick(game) * ctx.clicksPerSec * 0.1;
  } else if (name === "Santa's legacy") {
    gain = ctx.cps * 0.03 * (Math.max(0, ctx.santaLevel) + 1);
  }

  return { gain: Math.max(nominal, gain), type: 'christmas', ...(name === SANTAS_DOMINION ? {} : { pref: AUTO_PREF_GOLDEN }) };
}
