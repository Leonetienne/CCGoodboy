import type { IGameAdapter } from '../game/game-adapter';
import type { GameUpgrade } from '../game/types';
import { autoPerClick } from './building-valuation';
import { AUTO_GOLDEN_CPS_SHARE } from './grandmapocalypse-valuation';
import { autoPrice, type UpgradeClassifyCtx } from './upgrade-classifier';
import { AUTO_PREF_GOLDEN } from './valuation-tables';

/** THE EASTER EGGS (EGG-*). During Easter season golden cookies (drawn as bunnies) and popped
 * wrinklers drop egg upgrades into the store; once dropped they stay there. Every egg makes
 * every other egg pricier (common 999 x 2^owned, rare 999 x 3^owned), so they are cheap early
 * and all of them are worth having. Each egg is valued in CpS so autoDecide() ranks it like any
 * other purchase; an egg whose effect is not (yet) worth CpS gets a small nominal value, so it
 * is still bought once its cost is insignificant (AUTO-4 A).
 *
 * Order matters far more than value: each egg bought triples every rare egg's price but only
 * doubles a common one's, so all 8 rare eggs bought first cost ~3k x 999 together, and bought
 * after the 12 commons ~1.7 billion x 999. So the rare eggs are preferred (bought whenever
 * affordable, AUTO-4 B), and a common egg is held back while a rare one waits in the store and
 * is in reach. The Chocolate egg is the exception: it comes last (see easterEggGain()). */

/** The 12 common eggs: cookie production multiplier +1% each. */
export const EASTER_COMMON_EGGS = [
  'Chicken egg',
  'Duck egg',
  'Turkey egg',
  'Quail egg',
  'Robin egg',
  'Ostrich egg',
  'Cassowary egg',
  'Salmon roe',
  'Frogspawn',
  'Shark egg',
  'Turtle egg',
  'Ant larva',
];

/** The 8 rare eggs, each with its own effect. */
export const EASTER_RARE_EGGS = [
  'Golden goose egg',
  'Faberge egg',
  'Wrinklerspawn',
  'Cookie egg',
  'Omelette',
  'Chocolate egg',
  'Century egg',
  '"egg"',
];

export const EASTER_EGGS = new Set([...EASTER_COMMON_EGGS, ...EASTER_RARE_EGGS]);

/** Share of CpS given to an egg whose effect isn't worth CpS right now (Omelette, Wrinklerspawn
 * without wrinklers, a fresh Century egg). */
export const EGG_NOMINAL_SHARE = 0.001;

/** Chocolate egg: bought only when its burst (5% of the bank) returns at least this many times
 * its price. */
export const CHOCOLATE_EGG_MIN_RETURN = 2;

/** Century egg's CpS boost `day` days into the current ascension (the game's own formula:
 * +10% on day 100, with diminishing returns). */
export function centuryEggBoost(day: number): number {
  const d = Math.max(0, Math.min(day, 100));
  return (1 - Math.pow(1 - d / 100, 3)) * 0.1;
}

/** Cookies the Chocolate egg bursts into when bought: 5% of the bank. */
export function chocolateEggPayout(bank: number): number {
  return Math.max(0, bank) * 0.05;
}

export interface EggClassifyCtx extends UpgradeClassifyCtx {
  /** Cookies in the bank (the Chocolate egg pays 5% of it). */
  bank: number;
  /** Income while saving up (cookies/s), and the "in reach" window (AUTO-5). */
  income: number;
  reachSec: number;
  /** autoWrinklerMaturity (Wrinklerspawn: how much of the time a slot digests). */
  maturity: number;
}

/** Classifies an Easter egg and estimates the CpS it adds (null for anything that is not an egg,
 * or an egg not to buy right now):
 *   common           +1% CpS
 *   Golden goose egg golden cookies 5% more often: a golden upgrade (the game lists it as one)
 *   Faberge egg      everything 1% cheaper: about 1% faster growth, valued as +1% CpS
 *   Wrinklerspawn    wrinklers pop into 5% more cookies: 5% of what the wrinklers pay out
 *   Cookie egg       clicks 10% stronger: 10% of the clicking income at the hammer rate
 *   Omelette         other eggs drop 10% more often: nominal
 *   Chocolate egg    one-off burst of 5% of the bank, see below
 *   Century egg      its boost one day from now (it keeps growing up to +10% CpS on day 100)
 *   "egg"            +9 base CpS
 * Rare eggs are preferred and commons wait for them (see the top of this file). The Chocolate
 * egg is only offered once its burst returns >= CHOCOLATE_EGG_MIN_RETURN x its
 * price AND no other egg is waiting in the store (buying it first would triple their prices,
 * and waiting lets the bank grow); its dCps is the burst per second, so it always ranks first. */
export function easterEggGain(game: IGameAdapter, up: GameUpgrade, ctx: EggClassifyCtx): { gain: number; type: string; pref?: number } | null {
  const name = up.name;
  if (!EASTER_EGGS.has(name)) return null;

  if (EASTER_COMMON_EGGS.includes(name)) {
    return rareEggInReach(game, ctx) ? null : { gain: ctx.cps * 0.01, type: 'egg' };
  }

  const g = rareEggGain(game, up, ctx);
  return g && name !== 'Chocolate egg' ? { ...g, pref: AUTO_PREF_GOLDEN } : g;
}

/** True while a rare egg (not the Chocolate egg) waits in the store and is affordable within
 * the reach window: buying a common egg first would triple its price. */
function rareEggInReach(game: IGameAdapter, ctx: EggClassifyCtx): boolean {
  const budget = ctx.bank + Math.max(0, ctx.income) * ctx.reachSec;

  return game
    .getUpgradesInStore()
    .some((u) => u && !u.bought && u.name !== 'Chocolate egg' && EASTER_RARE_EGGS.includes(u.name) && autoPrice(u) <= budget);
}

function rareEggGain(game: IGameAdapter, up: GameUpgrade, ctx: EggClassifyCtx): { gain: number; type: string } | null {
  const name = up.name;
  const nominal = ctx.cps * EGG_NOMINAL_SHARE;

  switch (name) {
    case 'Golden goose egg':
      return { gain: ctx.cps * AUTO_GOLDEN_CPS_SHARE * 0.05, type: 'golden' };

    case 'Faberge egg':
      return { gain: ctx.cps * 0.01, type: 'egg' };

    case 'Wrinklerspawn': {
      // n attached wrinklers return popMult x 0.05n² of the CpS while digesting (WRINK-1)
      if (!(game.getElderWrath() > 0)) return { gain: nominal, type: 'egg' };

      const n = Math.max(0, game.getWrinklersMax());
      const m = Math.max(0, ctx.maturity);
      const payout = ctx.cps * game.getWrinklerPopMult(false) * 0.05 * n * n * (m / (m + 1));

      return { gain: Math.max(nominal, payout * 0.05), type: 'egg' };
    }

    case 'Cookie egg':
      return { gain: Math.max(nominal, autoPerClick(game) * ctx.clicksPerSec * 0.1), type: 'egg' };

    case 'Omelette':
      return { gain: nominal, type: 'egg' };

    case 'Chocolate egg': {
      const payout = chocolateEggPayout(ctx.bank);
      if (payout < CHOCOLATE_EGG_MIN_RETURN * autoPrice(up)) return null;

      const othersWaiting = game.getUpgradesInStore().some((u) => u && !u.bought && u.name !== name && EASTER_EGGS.has(u.name));
      if (othersWaiting) return null;

      return { gain: payout, type: 'egg' };
    }

    case 'Century egg': {
      const day = (Date.now() - game.getRunStartDate()) / 86400000;
      return { gain: Math.max(nominal, ctx.cps * centuryEggBoost(day + 1)), type: 'egg' };
    }

    case '"egg"':
      return { gain: Math.max(nominal, 9 * ctx.mult), type: 'egg' };

    default:
      return null;
  }
}
