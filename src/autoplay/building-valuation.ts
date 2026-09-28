import type { IGameAdapter } from '../game/game-adapter';
import type { GameBuilding, GameUpgrade } from '../game/types';
import { AUTO_CLICK_FRENZY_CHANCE, AUTO_CLICK_VALUE_MIN, AUTO_FINGER_STEPS, AUTO_GOLDEN_INTERVAL_SEC } from './valuation-tables';

/** Product of all active CpS buff multipliers (Frenzy x7, Clot x0.5, ...); 1 without buffs. */
export function autoBuffMult(game: IGameAdapter): number {
  let m = 1;

  for (const buff of Object.values(game.getRawBuffs())) {
    const v = Number(buff && buff.multCpS);
    if (Number.isFinite(v) && v > 0) m *= v;
  }

  return m;
}

/** Current cookies per second WITHOUT temporary buffs, so a Frenzy does not distort the value
 * of a purchase. Uses Game.unbuffedCps when the game has it, else CpS divided by the buff
 * product. Returns NaN if unknown. */
export function autoUnbuffedCps(game: IGameAdapter): number {
  const u = game.getUnbuffedCps();
  if (Number.isFinite(u) && u > 0) return u;

  const c = game.getCookiesPs();
  if (!(c >= 0)) return NaN;

  const m = autoBuffMult(game);
  return m > 0 ? c / m : c;
}

export interface BuildingGainCtx {
  mult: number;
  /** The bought synergy upgrades (Synergies Vol. I/II), filled on first use per collect. */
  synergies?: GameUpgrade[];
}

/** The bought synergy upgrades (Game.SynergyUpgrade: both buildingTie1 and buildingTie2 set;
 * buildingTie1 is the cheaper building). */
function boughtSynergies(game: IGameAdapter, ctx: BuildingGainCtx): GameUpgrade[] {
  if (!ctx.synergies) {
    ctx.synergies = game.getUpgrades().filter((u) => !!(u && u.bought && u.buildingTie1 && u.buildingTie2));
  }

  return ctx.synergies;
}

/** Approximate CpS gained by buying ONE more of a building: its per-building production times
 * the global multiplier, plus what the extra copy adds to other buildings through bought
 * upgrades (the game's Game.GetTieredCpsMult): for Grandmas the grandma upgrades (each linked
 * building x(1 + 1% x grandmas / (its id - 1))), and for either side of a bought synergy
 * upgrade the partner (the cheaper building x(1 + 5% x the pricier one's count), the pricier
 * one x(1 + 0.1% x the cheaper one's count)). Each boost is the partner's total CpS x the step
 * of its factor / the factor now, since storedTotalCps already includes it. Returns 0 if it
 * cannot be estimated. */
export function autoBuildingGain(game: IGameAdapter, me: GameBuilding, ctx: BuildingGainCtx): number {
  const per = Number(me.storedCps);
  if (!(per > 0)) return 0;

  let gain = per * ctx.mult;
  const partnerBoost = (b: GameBuilding | null | undefined, step: number, count: number): number =>
    ((Number(b && b.storedTotalCps) || 0) * ctx.mult * step) / (1 + step * count);

  if (me.name === 'Grandma') {
    const grandmas = Number(me.amount) || 0;

    for (const n of game.getGrandmaSynergyNames()) {
      const up = game.getUpgradeByName(n);
      // Game.GrandmaSynergy ties the upgrade to its building through buildingTie
      const b = up && up.bought ? up.buildingTie || up.buildingTie1 : null;

      if (b) {
        const N = Math.max(1, Number(b.id) - 1);
        gain += partnerBoost(b, 0.01 / N, grandmas);
      }
    }
  }

  for (const syn of boughtSynergies(game, ctx)) {
    const b1 = syn.buildingTie1!;
    const b2 = syn.buildingTie2!;

    if (b2.name === me.name) gain += partnerBoost(b1, 0.05, Number(b2.amount) || 0);
    else if (b1.name === me.name) gain += partnerBoost(b2, 0.001, Number(b1.amount) || 0);
  }

  return gain;
}

/** Product of all active click multiplier buffs (Click frenzy x777, Dragonflight x1111, ...). */
export function autoClickBuffMult(game: IGameAdapter): number {
  let m = 1;

  for (const buff of Object.values(game.getRawBuffs())) {
    const v = Number(buff && buff.multClick);
    if (Number.isFinite(v) && v > 0) m *= v;
  }

  return m;
}

/** Cookies per click WITHOUT temporary click buffs (the game's computedMouseCps divided by
 * them). Returns 1 if unknown. */
export function autoPerClick(game: IGameAdapter): number {
  const p = game.getComputedMouseCps();
  if (!(p > 0)) return 1;

  const m = autoClickBuffMult(game);
  return m > 0 ? p / m : p;
}

/** Current bonus per non-cursor building given by the bought "fingers" upgrades (0 without
 * Thousand fingers). */
export function autoFingerBonus(game: IGameAdapter): number {
  let A = 0;

  for (const [n, v, k] of AUTO_FINGER_STEPS) {
    const u = game.getUpgradeByName(n);

    if (u && u.bought) {
      if (k === 'add') A += v;
      else A *= v;
    }
  }

  return A;
}

export interface FingerGainCtx {
  cursor: GameBuilding | null;
  nonCursor: number;
  mult: number;
  clickUnit: number;
  clicksPerSec: number;
}

/** Estimated gain of a "fingers" upgrade (Thousand fingers, Million fingers, ...): the extra
 * bonus per non-cursor building goes to EVERY cursor (CpS) and to every click (clicks/s x
 * bonus).
 * @param idx index in AUTO_FINGER_STEPS or -1 for an unknown member
 * @param desc plain lowercase description
 */
export function autoFingerGain(
  game: IGameAdapter,
  idx: number,
  desc: string,
  ctx: FingerGainCtx,
): { gain: number; type: string } | null {
  const A = autoFingerBonus(game);

  let val: number;
  let kind: 'add' | 'mul';

  if (idx >= 0) {
    const step = AUTO_FINGER_STEPS[idx]!;
    val = step[1];
    kind = step[2];
  } else {
    const add = desc.match(/\+\s*(\d+(?:\.\d+)?)\s*cookies for each non-cursor/);
    const mul = desc.match(/by\s+(\d+(?:\.\d+)?)/);

    if (add) {
      kind = 'add';
      val = Number(add[1]);
    } else if (mul) {
      kind = 'mul';
      val = Number(mul[1]);
    } else {
      return null;
    }
  }

  const dAdd = (kind === 'add' ? A + val : A * val) - A;
  if (!(dAdd > 0)) return null;

  const cur = ctx.cursor;
  const cursors = Number(cur && cur.amount) || 0;
  const denom = 0.1 + A * ctx.nonCursor;

  // the cursors' own tier multiplier, backed out of their current production
  const tierMult = cur && Number(cur.storedCps) > 0 && denom > 0 ? Number(cur.storedCps) / denom : 1;

  return {
    gain: cursors * dAdd * ctx.nonCursor * tierMult * ctx.mult + dAdd * ctx.nonCursor * ctx.clickUnit * ctx.clicksPerSec,
    type: 'fingers',
  };
}

/** How many normal clicks one click is worth once Click Frenzies are counted (AUTO-3): 1 + 776
 * x the share of time a Click Frenzy runs, at least `min` (the setting `autoClickBoost`). */
export function clickFrenzyFactor(game: IGameAdapter, min = AUTO_CLICK_VALUE_MIN): number {
  let interval = AUTO_GOLDEN_INTERVAL_SEC;
  if (game.hasUpgrade('Lucky day')) interval /= 2;
  if (game.hasUpgrade('Serendipity')) interval /= 2;

  const share = (AUTO_CLICK_FRENZY_CHANCE * (Number(game.estimateClickFrenzySec()) || 13)) / interval;
  return Math.max(min, 1 + 776 * share);
}
