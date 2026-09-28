import type { IGameAdapter } from '../game/game-adapter';
import type { GameBuilding, GameUpgrade } from '../game/types';
import { autoFingerGain } from './building-valuation';
import { wrinklerRespawnSec } from './wrinkler-strategy';
import { chainStepGain } from './grandmapocalypse-valuation';
import { AUTO_CURSOR_DOUBLERS, AUTO_FINGER_STEPS, AUTO_FORTUNE_NOMINAL, AUTO_FORTUNE_NOMINAL_SHARE, AUTO_RESEARCH, autoKittenFactor, AUTO_STAGE1_CHAIN, autoStripHtml } from './valuation-tables';
import { AUTO_GOLDEN_UPGRADES, AUTO_HEAVENLY_UNLOCKS } from './valuation-tables';

export interface UpgradeClassifyCtx {
  cps: number;
  mult: number;
  biscuitBase: number | null;
  cursor: GameBuilding | null;
  nonCursor: number;
  clickUnit: number;
  clicksPerSec: number;
  mouseShare?: number;
}

/** Current price of an upgrade. */
export function autoPrice(up: GameUpgrade): number {
  return typeof up.getPrice === 'function' ? Number(up.getPrice()) : Number(up.basePrice);
}

/** +N% CpS of a cookie (biscuit) upgrade: `power` is a number, or a function the game
 * evaluates the same way (the heart biscuits' `heartPower`). 0 if unknown. */
export function biscuitPower(up: GameUpgrade): number {
  try {
    const p = Number(typeof up.power === 'function' ? up.power(up) : up.power);
    return p > 0 ? p : 0;
  } catch {
    return 0;
  }
}

/** Classifies a store upgrade and estimates the CpS it adds. Only these are considered:
 *   golden   golden cookie upgrades (AUTO_GOLDEN_UPGRADES)
 *   grandma  grandma "cofactor" upgrades: grandmas twice as efficient + 1% CpS of a building
 *            per N grandmas (recognised by the game's own list OR by the description text)
 *   synergy  synergy upgrades (Synergies Vol. I/II): two buildings boosting each other by
 *            +5% / +0.1% CpS per copy of the other
 *   kitten   "Kitten helpers/workers/..." and Fortune #103 (CpS multiplier growing with the milk)
 *   fortune  Fortune #001-#017 (a building 7% more efficient and 7% cheaper) and Fortune #102
 *            (nominal); #100/#101 are multipliers, #104 a mouse upgrade (FORTUNE-3)
 *   biscuit  all cookie upgrades (pool 'cookie', +power% CpS)
 *   multiplier  other flat "Cookie production multiplier +N%." upgrades (Wrinkler ambergris,
 *            Dragon scale, Arcane sugar, eggs, ...)
 *   tier     building upgrades that make a building "twice as efficient"
 *   cursor   "The mouse and cursors are twice as efficient": cursor CpS AND click power
 *   fingers  Thousand/Million/... fingers (bonus per non-cursor building for cursors/clicks)
 *   click    mouse upgrades ("Clicking gains +1% of your CpS")
 *   heavenly the prestige potential unlocks (Heavenly chip secret ... Heavenly key)
 * Clicking gains are valued at ctx.clicksPerSec (the hammer rate x the Click Frenzy factor). Anything
 * else returns null and is never bought. `ctx.biscuitBase` is filled in lazily (mutated) so it
 * is computed at most once per autoCollect() pass. */
export function autoUpgradeGain(game: IGameAdapter, up: GameUpgrade, ctx: UpgradeClassifyCtx): { gain: number; type: string } | null {
  const name = up.name;

  if (Object.prototype.hasOwnProperty.call(AUTO_GOLDEN_UPGRADES, name)) {
    return { gain: ctx.cps * AUTO_GOLDEN_UPGRADES[name]!, type: 'golden' };
  }

  // prestige potential unlocks: CpS x (1 + prestige% x unlocked share), so this step adds
  // prestige% x its share on top of the current (1 + prestige% x owned shares)
  if (Object.prototype.hasOwnProperty.call(AUTO_HEAVENLY_UNLOCKS, name)) {
    const p = game.getPrestige() / 100;
    if (!(p > 0)) return null;

    let owned = 0;
    for (const [nm, share] of Object.entries(AUTO_HEAVENLY_UNLOCKS)) {
      if (game.hasUpgrade(nm)) owned += share;
    }

    return { gain: (ctx.cps * p * AUTO_HEAVENLY_UNLOCKS[name]!) / (1 + p * owned), type: 'heavenly' };
  }

  const gdesc = autoStripHtml(up.desc);

  // Fortune #001-#017: "Cursors are 7% more efficient and 7% cheaper." The building's CpS x 7%,
  // and its 7% discount valued like Faberge egg's (1% cheaper ~ +1%) on that building's CpS.
  const fm = gdesc.match(/are\s*(\d+(?:\.\d+)?)\s*%\s*more efficient and\s*(\d+(?:\.\d+)?)\s*%\s*cheaper/);

  if (fm && up.buildingTie) {
    const pct = Number(fm[1]) + Number(fm[2]);
    return { gain: (Number(up.buildingTie.storedTotalCps) || 0) * ctx.mult * (pct / 100), type: 'fortune' };
  }

  if (AUTO_FORTUNE_NOMINAL.has(name)) {
    return { gain: ctx.cps * AUTO_FORTUNE_NOMINAL_SHARE, type: 'fortune' };
  }

  // "Grandmas are twice as efficient. Farms gain +1% CpS per grandma."  /  "... per 2 grandmas."
  const gm = gdesc.match(/grandmas are twice as efficient\.?\s*(.+?)\s+gain\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*cps per\s*(?:(\d+)\s*)?grandma/);

  // synergy upgrades (Synergies Vol. I/II, Game.SynergyUpgrade): the cheaper building
  // (buildingTie1) gains +5% CpS per copy of the pricier one (buildingTie2), which gains +0.1%
  // per copy of the cheaper one; both multiply the building's CpS (Game.GetTieredCpsMult)
  if (!gm && up.buildingTie1 && up.buildingTie2) {
    const b1 = up.buildingTie1;
    const b2 = up.buildingTie2;

    return {
      gain:
        ctx.mult *
        ((Number(b1.storedTotalCps) || 0) * 0.05 * (Number(b2.amount) || 0) +
          (Number(b2.storedTotalCps) || 0) * 0.001 * (Number(b1.amount) || 0)),
      type: 'synergy',
    };
  }

  const isGrandma = !!gm || game.getGrandmaSynergyNames().includes(name);

  if (isGrandma) {
    const g = game.getBuildingByName('Grandma');

    let b = up.buildingTie || up.buildingTie1 || null;

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
  const f = autoKittenFactor(name);

  if (f != null) {
    const milk = game.getMilkProgress() ?? game.getAchievementsOwned() / 25;

    // and every click gains the mouse upgrades' share of that extra CpS (Click Frenzies included)
    const more = ctx.cps * f * Math.max(0, milk);

    return { gain: more * (1 + (ctx.mouseShare ?? 0) * ctx.clicksPerSec), type: 'kitten' };
  }

  if (up.pool === 'cookie') {
    const p = biscuitPower(up);
    if (!(p > 0)) return null;

    if (ctx.biscuitBase == null) {
      let a = 1;

      for (const u of game.getUpgrades()) {
        if (u && u.pool === 'cookie' && u.bought) {
          a += biscuitPower(u) / 100;
        }
      }

      ctx.biscuitBase = a;
    }

    return { gain: (ctx.cps * (p / 100)) / ctx.biscuitBase, type: 'biscuit' };
  }

  const desc = autoStripHtml(up.desc);

  // flat production multipliers outside the cookie pool (Wrinkler ambergris, Dragon scale,
  // Arcane sugar, the eggs, ...): the game applies them as mult *= 1 + N%. Not "+N% per
  // Santa's levels" or the like: only a plain "+N%." counts.
  const pm = desc.match(/cookie production multiplier\s*\+\s*(\d+(?:\.\d+)?)\s*%\s*\./);

  if (pm) {
    return { gain: ctx.cps * (Number(pm[1]) / 100), type: 'multiplier' };
  }

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

/** A research upgrade's OWN CpS gain (null for anything not in AUTO_RESEARCH). Grandma
 * multipliers scale the Grandmas' current total; One mind adds 0.02 x grandmas to each
 * grandma's base CpS of 1 (Communal brainsweep/Elder Pact, the only other "add" terms, are
 * never owned here), i.e. the Grandmas' total grows by that factor. Not included: the
 * wrinklers stage 1 brings — see autoResearchCandidateGain(). */
export function autoResearchGain(game: IGameAdapter, name: string, ctx: Pick<UpgradeClassifyCtx, 'cps' | 'mult'>): number | null {
  const r = Object.prototype.hasOwnProperty.call(AUTO_RESEARCH, name) ? AUTO_RESEARCH[name]! : null;
  if (!r) return null;

  if (r.kind === 'cps') {
    return ctx.cps * (r.pct / 100);
  }

  const g = game.getBuildingByName('Grandma');
  const total = (Number(g && g.storedTotalCps) || 0) * ctx.mult;

  if (r.kind === 'grandma') {
    return total * (r.x - 1);
  }

  return total * 0.02 * (Number(g && g.amount) || 0);
}

/** Game seconds of one research (30 min, a tenth with Persistent memory, 5s with Ultrascience). */
export function autoResearchSec(game: IGameAdapter): number {
  if (game.hasUpgrade('Ultrascience')) return 5;
  return game.hasUpgrade('Persistent memory') ? 180 : 1800;
}

/** dCps the auto player gives a research candidate: its own gain, or, up to One mind (while
 * stage 1 isn't reached and `stage1` is wanted), the payback of finishing the whole chain from
 * this step if that is better — every step still to buy, against the wrinklers of stage 1 plus
 * their own gains, delayed until the wrinklers pay out (grandmapocalypse-valuation.ts). */
export function autoResearchCandidateGain(game: IGameAdapter, up: GameUpgrade, ctx: Pick<UpgradeClassifyCtx, 'cps' | 'mult'>, maturity: number, stage1 = true): number | null {
  const name = up.name;
  const own = autoResearchGain(game, name, ctx);
  if (own == null) return null;

  const at = AUTO_STAGE1_CHAIN.indexOf(name);
  if (!stage1 || at < 0 || game.hasUpgrade('One mind')) return own;

  let remainingCost = 0;
  let ownGain = 0;
  let steps = 0;

  for (const step of AUTO_STAGE1_CHAIN.slice(at)) {
    const u = step === name ? up : game.getUpgradeByName(step);
    if (u && u.bought) continue;

    remainingCost += u ? autoPrice(u) : 0;
    ownGain += autoResearchGain(game, step, ctx) || 0;
    steps++;
  }

  const chain = chainStepGain({
    cps: ctx.cps,
    wrinklersMax: game.getWrinklersMax(),
    popMult: game.getWrinklerPopMult(false),
    maturity,
    respawnSec: wrinklerRespawnSec(game.getWrinklerSpawnChance(1), game.getFps() || 30),
    cost: autoPrice(up),
    remainingCost,
    ownGain,
    researchesLeft: Math.max(0, steps - 1),
    researchSec: autoResearchSec(game),
  });

  // a step is worth at least its own effect (Designer cocoa beans' +2% pays even without the wrinklers)
  return Math.max(own, chain);
}
