import type { IGameAdapter } from '../game/game-adapter';
import type { GameBuilding, GameUpgrade } from '../game/types';
import { autoFingerGain } from './building-valuation';
import { AUTO_CURSOR_DOUBLERS, AUTO_FINGER_STEPS, AUTO_KITTEN_POWER, autoStripHtml } from './valuation-tables';
import { AUTO_GOLDEN_UPGRADES } from './valuation-tables';

export interface UpgradeClassifyCtx {
  cps: number;
  mult: number;
  biscuitBase: number | null;
  cursor: GameBuilding | null;
  nonCursor: number;
  clickUnit: number;
  clicksPerSec: number;
}

/** Current price of an upgrade. */
export function autoPrice(up: GameUpgrade): number {
  return typeof up.getPrice === 'function' ? Number(up.getPrice()) : Number(up.basePrice);
}

/** Classifies a store upgrade and estimates the CpS it adds. Only these are considered:
 *   golden   golden cookie upgrades (AUTO_GOLDEN_UPGRADES)
 *   grandma  grandma "cofactor" upgrades: grandmas twice as efficient + 1% CpS of a building
 *            per N grandmas (recognised by the game's own list OR by the description text)
 *   kitten   "Kitten helpers/workers/..." (CpS multiplier growing with the milk)
 *   biscuit  all cookie upgrades (pool 'cookie', +power% CpS)
 *   tier     building upgrades that make a building "twice as efficient"
 *   cursor   "The mouse and cursors are twice as efficient": cursor CpS AND click power
 *   fingers  Thousand/Million/... fingers (bonus per non-cursor building for cursors/clicks)
 *   click    mouse upgrades ("Clicking gains +1% of your CpS")
 * Clicking gains are valued at ctx.clicksPerSec (the hammer rate) clicks per second. Anything
 * else returns null and is never bought. `ctx.biscuitBase` is filled in lazily (mutated) so it
 * is computed at most once per autoCollect() pass. */
export function autoUpgradeGain(game: IGameAdapter, up: GameUpgrade, ctx: UpgradeClassifyCtx): { gain: number; type: string } | null {
  const name = up.name;

  if (Object.prototype.hasOwnProperty.call(AUTO_GOLDEN_UPGRADES, name)) {
    return { gain: ctx.cps * AUTO_GOLDEN_UPGRADES[name]!, type: 'golden' };
  }

  const gdesc = autoStripHtml(up.desc);

  // "Grandmas are twice as efficient. Farms gain +1% CpS per grandma."  /  "... per 2 grandmas."
  const gm = gdesc.match(/grandmas are twice as efficient\.?\s*(.+?)\s+gain\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*cps per\s*(?:(\d+)\s*)?grandma/);

  const isGrandma = !!gm || game.getGrandmaSynergyNames().includes(name) || !!(up.buildingTie1 && up.buildingTie2);

  if (isGrandma) {
    const g = up.buildingTie2 || game.getBuildingByName('Grandma');

    let b = up.buildingTie1 || null;

    if (!b && gm) {
      // find the building by the plural name used in the description ("farms", "wizard towers")
      const plural = gm[1]!.trim();
      const all = game.getBuildings();

      b = all.find((o) => o && (String(o.plural || '').toLowerCase() === plural || String(o.name || '').toLowerCase() + 's' === plural)) || null;
    }

    if (!b || !g) return null;

    const pct = gm ? Number(gm[2]) : 1;
    const N = gm ? Math.max(1, Number(gm[3]) || 1) : Math.max(1, Number(b.id) - 1);

    return {
      gain: ctx.mult * ((Number(g.storedTotalCps) || 0) + ((Number(b.storedTotalCps) || 0) * (pct / 100) * (Number(g.amount) || 0)) / N),
      type: 'grandma',
    };
  }

  // kittens: a multiplier on ALL production that grows with the milk (achievements)
  if (/^kitten /i.test(String(name))) {
    const f = AUTO_KITTEN_POWER[String(name).toLowerCase()] || 0.1;
    const milk = game.getMilkProgress() ?? game.getAchievementsOwned() / 25;

    return { gain: ctx.cps * f * Math.max(0, milk), type: 'kitten' };
  }

  if (up.pool === 'cookie') {
    const p = Number(up.power);
    if (!(p > 0)) return null;

    if (ctx.biscuitBase == null) {
      let a = 1;

      for (const u of game.getUpgrades()) {
        if (u && u.pool === 'cookie' && u.bought) {
          a += (Number(u.power) || 0) / 100;
        }
      }

      ctx.biscuitBase = a;
    }

    return { gain: (ctx.cps * (p / 100)) / ctx.biscuitBase, type: 'biscuit' };
  }

  const desc = autoStripHtml(up.desc);

  // mouse upgrades: every click gives +N% of the CpS
  const mm = desc.match(/clicking gains\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*of your cps/);

  if (mm) {
    return { gain: ctx.cps * (Number(mm[1]) / 100) * ctx.clicksPerSec, type: 'click' };
  }

  // "fingers" series
  const fi = AUTO_FINGER_STEPS.findIndex((x) => x[0] === name);

  if (fi >= 0 || /gain from thousand fingers|for each non-cursor/.test(desc)) {
    return autoFingerGain(game, fi, desc, ctx);
  }

  // cursor doubling: the cursors' CpS and the click power
  if (
    /mouse and cursors are twice as efficient/.test(desc) ||
    (up.buildingTie && up.buildingTie === ctx.cursor && desc.includes('twice as efficient'))
  ) {
    const cur = up.buildingTie || ctx.cursor;

    let n = 0;
    for (const nm of AUTO_CURSOR_DOUBLERS) {
      const doubler = game.getUpgradeByName(nm);
      if (doubler && doubler.bought) n++;
    }

    return {
      gain: (Number(cur && cur.storedTotalCps) || 0) * ctx.mult + Math.pow(2, n) * ctx.clickUnit * ctx.clicksPerSec,
      type: 'cursor',
    };
  }

  if (up.buildingTie && desc.includes('twice as efficient')) {
    return { gain: (Number(up.buildingTie.storedTotalCps) || 0) * ctx.mult, type: 'tier' };
  }

  return null;
}
