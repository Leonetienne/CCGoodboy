import type { IGameAdapter } from '../game/game-adapter';
import type { GameBuilding } from '../game/types';
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
}

/** Approximate CpS gained by buying ONE more of a building: its per-building production times
 * the global multiplier. For Grandmas the synergy of already bought grandma upgrades is added
 * (each extra grandma boosts the linked buildings by 1% per N grandmas). Returns 0 if it
 * cannot be estimated. */
export function autoBuildingGain(game: IGameAdapter, me: GameBuilding, ctx: BuildingGainCtx): number {
  const per = Number(me.storedCps);
  if (!(per > 0)) return 0;

  let gain = per * ctx.mult;

  if (me.name === 'Grandma') {
    for (const n of game.getGrandmaSynergyNames()) {
      const up = game.getUpgradeByName(n);
      const b = up && up.bought ? up.buildingTie1 : null;

      if (b) {
        const N = Math.max(1, Number(b.id) - 1);
        gain += ((Number(b.storedTotalCps) || 0) * ctx.mult * 0.01) / N;
      }
    }
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
 * x the share of time a Click Frenzy runs, at least AUTO_CLICK_VALUE_MIN. */
export function clickFrenzyFactor(game: IGameAdapter): number {
  let interval = AUTO_GOLDEN_INTERVAL_SEC;
  if (game.hasUpgrade('Lucky day')) interval /= 2;
  if (game.hasUpgrade('Serendipity')) interval /= 2;

  const share = (AUTO_CLICK_FRENZY_CHANCE * (Number(game.estimateClickFrenzySec()) || 13)) / interval;
  return Math.max(AUTO_CLICK_VALUE_MIN, 1 + 776 * share);
}
