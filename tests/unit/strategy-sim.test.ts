import { describe, expect, it } from 'vitest';
import type { AutoCollectCtx, PurchaseCandidate } from '../../src/autoplay/collector';
import { autoDecide } from '../../src/autoplay/strategy';
import { AUTO_CLICK_VALUE_MIN, AUTO_PREF_GOLDEN } from '../../src/autoplay/valuation-tables';

/* A small, deterministic Cookie Clicker: the game's buildings (base price, base CpS, price x1.15
 * per copy), their "twice as efficient" tier upgrades at 1/5/25/50/100 owned (10x/50x/500x/
 * 50,000x/5,000,000x the base price), the cursor/click doublers and the bot hammering at 8
 * clicks/s. Good enough to check the goal of AUTO-4: the highest CpS in the shortest time. */

const BUILDINGS: [string, number, number][] = [
  ['Cursor', 15, 0.1],
  ['Grandma', 100, 1],
  ['Farm', 1100, 8],
  ['Mine', 12000, 47],
  ['Factory', 130000, 260],
  ['Bank', 1.4e6, 1400],
  ['Temple', 2e7, 7800],
  ['Wizard tower', 3.3e8, 44000],
  ['Shipment', 5.1e9, 260000],
  ['Alchemy lab', 7.5e10, 1.6e6],
  ['Portal', 1e12, 1e7],
];
const TIERS: [number, number][] = [
  [1, 10],
  [5, 50],
  [25, 500],
  [50, 50000],
  [100, 5e6],
];
const CURSOR_UPS: [string, number, number][] = [
  ['Reinforced index finger', 100, 1],
  ['Carpal tunnel prevention cream', 500, 1],
  ['Ambidextrous', 10000, 10],
];
const CLICKS_PER_SEC = 8;
/** "Clicking gains +1% of your CpS", valued like the bot does: x AUTO_CLICK_VALUE_MIN for the Click Frenzies. */
const MICE: [string, number][] = [
  ['Plastic mouse', 50000],
  ['Iron mouse', 5e6],
  ['Titanium mouse', 5e8],
];

interface Sim {
  t: number;
  bank: number;
  owned: number[];
  tiers: number[]; // doublers bought per building
  cursorUps: number;
  mice: number;
}

function perBuilding(s: Sim, i: number): number {
  return BUILDINGS[i]![2] * 2 ** (s.tiers[i]! + (i === 0 ? s.cursorUps : 0));
}
function cps(s: Sim): number {
  return BUILDINGS.reduce((sum, _b, i) => sum + s.owned[i]! * perBuilding(s, i), 0);
}
function clickIncome(s: Sim): number {
  return CLICKS_PER_SEC * (2 ** s.cursorUps + 0.01 * s.mice * cps(s));
}
function price(s: Sim, i: number): number {
  return Math.ceil(BUILDINGS[i]![1] * 1.15 ** s.owned[i]!);
}

type Buy = { c: PurchaseCandidate; apply: () => void };

function options(s: Sim): Buy[] {
  const out: Buy[] = [];
  const obj = (name: string) => ({ name, buy: () => {} }) as never;

  BUILDINGS.forEach(([name], i) => {
    out.push({
      c: { kind: 'building', type: 'building', name, obj: obj(name), cost: price(s, i), dCps: perBuilding(s, i) },
      apply: () => s.owned[i]!++,
    });

    const tier = TIERS[s.tiers[i]!];
    if (i > 0 && tier && s.owned[i]! >= tier[0]) {
      const up = `${name} tier ${s.tiers[i]! + 1}`;
      out.push({
        c: { kind: 'upgrade', type: 'tier', name: up, obj: obj(up), cost: BUILDINGS[i]![1] * tier[1], dCps: s.owned[i]! * perBuilding(s, i) },
        apply: () => s.tiers[i]!++,
      });
    }
  });

  const mo = MICE[s.mice];
  if (mo) {
    out.push({
      c: { kind: 'upgrade', type: 'click', name: mo[0], obj: obj(mo[0]), cost: mo[1], dCps: cps(s) * 0.01 * CLICKS_PER_SEC * AUTO_CLICK_VALUE_MIN, pref: AUTO_PREF_GOLDEN },
      apply: () => s.mice++,
    });
  }

  const cu = CURSOR_UPS[s.cursorUps];
  if (cu && s.owned[0]! >= cu[2]) {
    // the mouse and cursors twice as efficient: preferred (AUTO-4 B)
    out.push({
      c: { kind: 'upgrade', type: 'cursor', name: cu[0], obj: obj(cu[0]), cost: cu[1], dCps: s.owned[0]! * perBuilding(s, 0) + clickIncome(s), pref: AUTO_PREF_GOLDEN },
      apply: () => s.cursorUps++,
    });
  }

  return out;
}

function ctx(s: Sim): AutoCollectCtx {
  const c = cps(s);
  return {
    cps: c,
    mult: 1,
    income: c + clickIncome(s),
    bank: s.bank,
    reserve: 0,
    cfg: { insignificantShare: 0.001, reachSec: 1800 },
    biscuitBase: null,
    cursor: null,
    nonCursor: 0,
    clicksPerSec: CLICKS_PER_SEC,
    clickUnit: 1,
  };
}

type Strategy = (opts: Buy[], s: Sim) => Buy | null;

const pawStrategy: Strategy = (opts, s) => {
  const d = autoDecide(
    opts.map((o) => o.c),
    ctx(s),
  );
  return d.buy ? opts.find((o) => o.c === d.buy)! : null;
};
/** Buys the affordable option with the best payback at once, never saves. */
const greedyPayback: Strategy = (opts, s) =>
  opts.filter((o) => o.c.cost <= s.bank).sort((a, b) => a.c.cost / a.c.dCps - b.c.cost / b.c.dCps)[0] || null;
/** Buys the cheapest option whenever it can. */
const cheapest: Strategy = (opts, s) => opts.filter((o) => o.c.cost <= s.bank).sort((a, b) => a.c.cost - b.c.cost)[0] || null;

/** Runs from 0 cookies until every CpS goal is reached (or maxT), one second per step, as many
 * purchases per second as the strategy makes. Returns the second each goal was reached. */
function run(strategy: Strategy, goals: number[], maxT = 30 * 3600, log?: string[], times?: number[]): number[] {
  const s: Sim = { t: 0, bank: 0, owned: BUILDINGS.map(() => 0), tiers: BUILDINGS.map(() => 0), cursorUps: 0, mice: 0 };
  const reached: number[] = goals.map(() => Infinity);

  while (s.t < maxT && reached.some((r) => r === Infinity)) {
    for (let n = 0; n < 200; n++) {
      const b = strategy(options(s), s);
      if (!b || b.c.cost > s.bank) break;
      s.bank -= b.c.cost;
      b.apply();
      log?.push(b.c.name);
      times?.push(s.t);
    }

    s.bank += cps(s) + clickIncome(s);
    s.t++;

    goals.forEach((g, i) => {
      if (reached[i] === Infinity && cps(s) >= g) reached[i] = s.t;
    });
  }

  return reached;
}

describe('autoDecide in a simulated run (AUTO-4: the highest CpS in the shortest time)', () => {
  // early game, mid game, late game
  const GOALS = [10, 100, 1000, 1e4, 1e5, 1e6, 1e7];

  it('reaches every CpS goal at least as fast as buying the best payback at once or the cheapest thing', () => {
    const paw = run(pawStrategy, GOALS);
    const greedy = run(greedyPayback, GOALS);
    const cheap = run(cheapest, GOALS);

    GOALS.forEach((_g, i) => {
      expect(paw[i]).toBeLessThan(Infinity);
      expect(paw[i]).toBeLessThanOrEqual(greedy[i]! * 1.02);
      expect(paw[i]).toBeLessThanOrEqual(cheap[i]!);
    });
  });

  it('does not fill up on cursors before the first grandma', () => {
    const log: string[] = [];
    run(pawStrategy, [5], 3600, log);
    const firstGrandma = log.indexOf('Grandma');

    expect(firstGrandma).toBeGreaterThan(-1);
    expect(log.slice(0, firstGrandma).filter((n) => n === 'Cursor').length).toBeLessThanOrEqual(3);
  });

  it('stops buying cursors once the next grandma pays back sooner', () => {
    // with both cursor doublers a cursor makes 0.4 CpS: the 11th (~70 cookies, payback ~175s) is
    // about even with the 4th grandma (152 cookies for 1 CpS); the ones after it are worse
    const log: string[] = [];
    run(pawStrategy, [100], 3600, log);
    const fourthGrandma = log.findIndex((_n, i) => log.slice(0, i + 1).filter((x) => x === 'Grandma').length === 4);

    expect(fourthGrandma).toBeGreaterThan(-1);
    expect(log.slice(0, fourthGrandma).filter((n) => n === 'Cursor').length).toBeLessThanOrEqual(11);
  });

  it('never stops buying for long while saving for a click upgrade', () => {
    // the gap before Iron mouse (5M) was ~14 min of nothing while a Factory paid back almost as
    // fast as the mouse would arrive; it now keeps buying what beats the mouse's pp
    const times: number[] = [];
    const log: string[] = [];
    run(pawStrategy, [1e5], 30 * 3600, log, times);
    const i = log.indexOf('Iron mouse');

    expect(i).toBeGreaterThan(0);
    expect(times[i]! - times[i - 1]!).toBeLessThanOrEqual(420);
  });

  it('buys the cursor upgrade as soon as it can pay for it', () => {
    const log: string[] = [];
    run(pawStrategy, [50], 3600, log);
    const i = log.indexOf('Reinforced index finger');

    expect(i).toBeGreaterThan(-1);
    // the first purchase after the cursor that unlocked it and the 100 cookies it costs
    expect(log.slice(0, i).length).toBeLessThanOrEqual(4);
  });
});
