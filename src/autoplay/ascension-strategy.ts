import type { HeavenlyUpgradeInfo } from '../game/types';
import { countSevens, planHeavenlyShopping, type HeavenlyShopPlan } from './heavenly-shopping';

// Pure ascension planning (ASC-*): what ascending now would give, when a run stagnates, and
// which level to ascend at so the heavenly shopping list (ASC-9) is paid for. No DOM, no game: everything comes
// in through AscensionInput.

/** Cookies per prestige level unit: level = (cookies / 1e12)^(1/HCfactor) (Game.HowMuchPrestige). */
export const PRESTIGE_COOKIE_UNIT = 1e12;

/** Prestige level that `cookies` (all-time: reset + this run) give, like Game.HowMuchPrestige +
 * the floor the game applies when ascending. */
export function levelForCookies(cookies: number, hcFactor: number): number {
  return Math.max(0, Math.floor(Math.pow(Math.max(0, cookies) / PRESTIGE_COOKIE_UNIT, 1 / hcFactor)));
}

/** All-time cookies needed for a prestige level (Game.HowManyCookiesReset). */
export function cookiesForLevel(level: number, hcFactor: number): number {
  return Math.pow(level, hcFactor) * PRESTIGE_COOKIE_UNIT;
}

/** CpS multiplier of a prestige level at full heavenly potential: +1% per level. */
export function prestigeMult(level: number): number {
  return 1 + level / 100;
}

/** Lowest level whose prestige bonus is at least `minBoost` times the bonus of `prestige`
 * (always at least one level above it). */
export function levelForBoost(prestige: number, minBoost: number): number {
  const needed = Math.ceil((prestigeMult(prestige) * minBoost - 1) * 100 - 1e-9);
  return Math.max(prestige + 1, needed);
}

export interface AscensionInput {
  /** Game.prestige: the level owned now. */
  prestige: number;
  /** Game.heavenlyChips: unspent chips. */
  heavenlyChips: number;
  /** Game.cookiesReset + Game.cookiesEarned: all-time cookies that count for prestige. */
  totalCookies: number;
  hcFactor: number;
  /** Cookies per second the run is making now (measured, see AscensionPlanner). */
  income: number;
  /** Seconds since this run started (Game.startDate). */
  runSec: number;
  heavenly: HeavenlyUpgradeInfo[];
  /** How long the bot may keep a stagnating run going to reach a lucky level (setting). */
  luckyWaitSec: number;
  /** How long it may keep it going to afford an ordinary heavenly wish (setting). */
  shopWaitSec: number;
  /** An ordinary heavenly wish is only waited for while the extra levels stay within this share
   * of the levels the ascension gains anyway (setting, ASC-9). */
  shopWaitShare: number;
  /** The prestige CpS bonus must grow at least this many times for an ascension (setting). */
  minBoost: number;
}

export type AscensionVerdict = 'no-gain' | 'too-small' | 'growing' | 'waiting' | 'ascend';

export interface AscensionPlan {
  prestige: number;
  /** The level owned right after ascending now. */
  pendingLevel: number;
  /** Levels (= chips) ascending now would add. */
  gain: number;
  /** Chips to spend if ascending now. */
  chipsAfter: number;
  /** Cookies still missing for pendingLevel + 1. */
  cookiesToNextLevel: number;
  /** Prestige CpS bonus after ascending now / the bonus now (full heavenly potential). */
  boost: number;
  /** The first level with the minimum boost (ASC-8). */
  neededLevel: number;
  /** Seconds until the run reaches neededLevel (0 once there). */
  neededEtaSec: number;
  /** Prestige levels per hour at the current income (the marginal rate). */
  rateNow: number;
  /** Prestige levels per hour averaged over the whole run. */
  rateAvg: number;
  /** The marginal rate fell below the run's average: ascending now maximises levels per hour. */
  stagnating: boolean;
  /** The heavenly shopping list and the level it needs (ASC-9), planned from the first level
   * worth ascending at (the pending one, or the one ASC-8 needs). */
  shop: HeavenlyShopPlan;
  /** While the list needs 7s (ASC-12): seconds until the run passes the last level from the
   * pending one on that still has them (0 if the pending level has too few; Infinity when no
   * 7s are needed or there is no income). */
  luckySafeSec: number;
  verdict: AscensionVerdict;
}

/** ASC-2..4/8/9: what ascending now gives, whether it would make a noticeable difference,
 * whether the run stagnates, and up to which level to go on for the heavenly shopping list. */
export function planAscension(input: AscensionInput): AscensionPlan {
  const { prestige, heavenlyChips, totalCookies, hcFactor } = input;
  const income = Number.isFinite(input.income) && input.income > 0 ? input.income : 0;

  const pendingLevel = Math.max(prestige, levelForCookies(totalCookies, hcFactor));
  const gain = pendingLevel - prestige;
  const chipsAfter = heavenlyChips + gain;
  const cookiesToNextLevel = Math.max(0, cookiesForLevel(pendingLevel + 1, hcFactor) - totalCookies);

  // Marginal: levels per hour at the current income, from the cost of the next level.
  const levelCost = cookiesForLevel(pendingLevel + 1, hcFactor) - cookiesForLevel(pendingLevel, hcFactor);
  const rateNow = levelCost > 0 ? (income * 3600) / levelCost : 0;
  const rateAvg = input.runSec > 0 ? gain / (input.runSec / 3600) : 0;
  const stagnating = gain >= 1 && rateNow < rateAvg;

  const etaTo = (level: number) => {
    const missing = cookiesForLevel(level, hcFactor) - totalCookies;
    if (level <= pendingLevel || missing <= 0) return 0;
    return income > 0 ? missing / income : Infinity;
  };

  // ASC-8: an ascension must make a noticeable difference, not just break even.
  const boost = prestigeMult(pendingLevel) / prestigeMult(prestige);
  const neededLevel = levelForBoost(prestige, input.minBoost);
  const neededEtaSec = etaTo(neededLevel);
  const earliest = Math.max(pendingLevel, neededLevel);

  const shop = planHeavenlyShopping({
    heavenly: input.heavenly,
    prestige,
    heavenlyChips,
    fromLevel: earliest,
    etaTo,
    shopWaitSec: input.shopWaitSec,
    maxExtraLevels: Math.max(0, input.shopWaitShare) * (earliest - prestige),
    luckyWaitSec: input.luckyWaitSec,
  });

  // ASC-12: how long the pending level keeps the 7s the list needs, at the current income.
  let luckySafeSec = Infinity;
  if (shop.sevens > 0) {
    if (countSevens(pendingLevel) < shop.sevens) {
      luckySafeSec = 0;
    } else {
      let last = pendingLevel;
      while (last < pendingLevel + 1000 && countSevens(last + 1) >= shop.sevens) last++;
      const missing = cookiesForLevel(last + 1, hcFactor) - totalCookies;
      luckySafeSec = income > 0 ? Math.max(0, missing / income) : Infinity;
    }
  }

  let verdict: AscensionVerdict;
  if (gain < 1) verdict = 'no-gain';
  else if (pendingLevel < neededLevel) verdict = 'too-small';
  else if (!stagnating) verdict = 'growing';
  else if (shop.level > pendingLevel) verdict = 'waiting';
  else verdict = 'ascend';

  return {
    prestige,
    pendingLevel,
    gain,
    chipsAfter,
    cookiesToNextLevel,
    boost,
    neededLevel,
    neededEtaSec,
    rateNow,
    rateAvg,
    stagnating,
    shop,
    luckySafeSec,
    verdict,
  };
}
