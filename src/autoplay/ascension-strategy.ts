import type { HeavenlyUpgradeInfo } from '../game/types';
import { luckyWindowEnd, planHeavenlyShopping, type HeavenlyShopPlan } from './heavenly-shopping';

/** ASC-12/15: the level the 7s sit in must hold at least this long: the last two clicks
 * (Legacy, "Ascend") with the paw already waiting at Legacy, plus slack for a CpS that rose
 * during the routine (the buildings and achievements it buys). Once "Ascend" is clicked the
 * level is frozen: the game earns nothing during the animation. */
export const ASC_FINAL_SEC = 60;

/** ASC-15: the lowest digit position whose value holds at least `holdSec` at `secPerLevel`
 * (position p changes every 10^p levels). Aiming the 7s there wins the nearest lucky level the
 * paw can still catch: the last digits flip too fast late in a run, the first ones are safest
 * but take longest to reach. */
export function luckyMinDigit(secPerLevel: number, holdSec: number): number {
  if (!(secPerLevel > 0) || !Number.isFinite(secPerLevel)) return 0;

  let p = 0;
  while (p < 15 && Math.pow(10, p) * secPerLevel < holdSec) p++;
  return p;
}

/** ASC-12: how many levels the lucky window must hold from the target on: ASC_FINAL_SEC at
 * `secPerLevel` (1 without income). */
export function luckyWindowLevels(secPerLevel: number): number {
  return secPerLevel > 0 && Number.isFinite(secPerLevel) ? Math.max(1, Math.ceil(ASC_FINAL_SEC / secPerLevel)) : 1;
}

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
  /** ASC-12: how long the routine before an ascension (pops, sales, achievements, safety
   * buffer) takes: a lucky level is only looked for from the level the run reaches by then.
   * Default 0. */
  leadSec?: number;
  /** ASC-12: cookies per second while the routine runs: no wrinklers left, nothing clicked, no
   * buffs (the game's unbuffed CpS). The measured income counts what attached wrinklers digest
   * and can be several times higher. Default: income. */
  routineIncome?: number;
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
  /** ASC-15: the lowest digit position the lucky 7s are aimed at (0 = the last digit). */
  luckyDigit: number;
  /** ASC-12: seconds until the run reaches shop.level at the routine's income (0 once there;
   * Infinity without income): what the routine is timed with. */
  routineEtaSec: number;
  /** ASC-12: the last level from shop.level on that still has the 7s the list needs: the
   * ascension must happen within [shop.level, luckyEnd]. Infinity when no 7s are needed. */
  luckyEnd: number;
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

  // ASC-15: the 7s go no lower than the digit that holds still long enough for the last steps.
  // ASC-12: the routine runs at its own (lower) income: the digit, the level the 7s are looked
  // for from and the routine's ETA go by that.
  const routineIncome = Number.isFinite(input.routineIncome) && input.routineIncome! > 0 ? input.routineIncome! : input.routineIncome === undefined ? income : 0;
  const secPerLevel = routineIncome > 0 ? levelCost / routineIncome : Infinity;
  const luckyDigit = luckyMinDigit(secPerLevel, ASC_FINAL_SEC);
  // ...and the window left from the target on must hold that long too, not just the block
  const luckyMinLevels = luckyWindowLevels(secPerLevel);
  // the 7s must still be ahead once the routine before the ascension is done
  const leadSec = Math.max(0, input.leadSec ?? 0);
  const luckyFromLevel =
    routineIncome > 0 && leadSec > 0 ? Math.max(pendingLevel, levelForCookies(totalCookies + routineIncome * leadSec, hcFactor)) : pendingLevel;

  const shop = planHeavenlyShopping({
    heavenly: input.heavenly,
    prestige,
    heavenlyChips,
    fromLevel: earliest,
    etaTo,
    shopWaitSec: input.shopWaitSec,
    maxExtraLevels: Math.max(0, input.shopWaitShare) * (earliest - prestige),
    luckyWaitSec: input.luckyWaitSec,
    luckyMinDigit: luckyDigit,
    luckyFromLevel,
    luckyMinLevels,
  });

  // ASC-12: the window the ascension must land in.
  const luckyEnd = luckyWindowEnd(shop.level, shop.sevens, luckyDigit);

  const routineMissing = cookiesForLevel(shop.level, hcFactor) - totalCookies;
  const routineEtaSec = shop.level <= pendingLevel || routineMissing <= 0 ? 0 : routineIncome > 0 ? routineMissing / routineIncome : Infinity;

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
    luckyDigit,
    routineEtaSec,
    luckyEnd,
    verdict,
  };
}
