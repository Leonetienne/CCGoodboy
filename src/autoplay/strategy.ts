import type { AutoCollectCtx, PurchaseCandidate } from './collector';
import { AUTO_IMPACT_REF, AUTO_PREF_BINGO, AUTO_PREF_WIZARD } from './valuation-tables';

export interface DecisionRow {
  c: PurchaseCandidate;
  payback: number;
  /** The payback the decision goes by: × AUTO_IMPACT_REF / impact for an ordinary purchase
   * adding less than that share of the CpS (AUTO-4), else the payback. */
  score: number;
  pp: number;
  impact: number;
  wait: number;
  affordable: boolean;
  insignificant: boolean;
  /** How preferred it is this tick (AUTO-4 B): the candidate's `pref`, except Wizard towers,
   * which are only preferred near their target or while insignificant. */
  pref: number;
}

export interface Decision {
  buy: PurchaseCandidate | null;
  why?: string;
  row?: DecisionRow;
  save: PurchaseCandidate | null;
  saveRow?: DecisionRow | null;
  note?: string;
  rows: DecisionRow[];
  /** Everything this tick would buy (affordable and not held back), best first; `buy` is its
   * head. */
  buyable?: DecisionRow[];
}

/** THE STRATEGY (pure function, no game access). Goal: the highest CpS in the shortest time.
 * For every option:
 *   payback = cost / dCps      seconds until it has paid for itself
 *   wait    = time to afford it at the current income (CpS + clicking), after the reserve
 *   pp      = wait + payback   seconds from NOW until it has paid for itself
 * except that a purchase (preferred or not, but not insignificant) adding less than
 * AUTO_IMPACT_REF (0.5%) of the CpS counts its payback × (0.5% / its impact) everywhere below
 * (`score`): every purchase costs a trip of the paw and a pause in hammering, so the big
 * purchases win over a flood of tiny ones (no slower CpS growth in the simulation, 37% fewer
 * purchases).
 * Saving for the lowest pp is the greedy rule for growing CpS as fast as possible: a big
 * building or upgrade waits until the income it needs is there (its wait shrinks as smaller,
 * quicker purchases raise the income), and anything that pays for itself before the target
 * would even be affordable is bought on the way, since it gets the bank there sooner: with the
 * bank covering it, the target is reached after (T - bank + cost)/(income + dCps) instead of
 * (T - bank)/income, sooner exactly when payback < the target's wait. Anything else that pays
 * for itself before the target would (payback < the target's pp) is a better deal than the
 * target and goes first too.
 * Decision, each tick:
 *   1) Preferred candidates (golden, cursor/click and kitten upgrades, the Bingo center,
 *      Wizard towers below their target once >= 93% of it is owned or while insignificant;
 *      AUTO-4 B) are bought the moment they are affordable.
 *   2) The target to save for: the not-yet-affordable option with the lowest pp. The click
 *      upgrades get there on their value, which counts the Click Frenzies (AUTO-3, x2 and
 *      more) and grows with the CpS, so the buildings bought meanwhile make them the target
 *      soon enough. An achievement top-off (AUTO-15) is never a target.
 *   3) An ordinary affordable purchase is bought on the way when it pays for itself before
 *      the target would (score < the target's pp); with nothing to save for, everything
 *      affordable is. Everything else waits.
 *   Among everything bought this tick: preferred first, then the biggest CpS gain first.
 *   One purchase per task (AUTO-7), so later ticks work down the same ranking. */
export function autoDecide(cands: PurchaseCandidate[], ctx: AutoCollectCtx): Decision {
  const cfg = ctx.cfg;
  const cpsEff = Math.max(ctx.cps, 0.1);
  const incEff = Math.max(ctx.income != null ? ctx.income : ctx.cps, 0.1);
  const avail = ctx.bank - ctx.reserve;
  const rows: DecisionRow[] = [];

  for (const c of cands) {
    if (!(c.cost > 0) || !(c.dCps > 0)) continue;

    const payback = c.cost / c.dCps;
    const wait = c.cost <= avail ? 0 : (c.cost - avail) / incEff;
    // an achievement top-off is judged as the whole top-off, not one cheap copy (AUTO-15)
    const whole = c.projectCost != null && c.projectCost > c.cost ? c.projectCost : c.cost;

    const insignificant = whole <= cfg.insignificantShare * Math.max(0, avail);
    const pref = c.pref === AUTO_PREF_WIZARD && !c.nearTarget && !insignificant ? 0 : c.pref ?? 0;
    const impact = c.dCps / cpsEff;
    const score = insignificant ? payback : payback * Math.max(1, AUTO_IMPACT_REF / impact);

    rows.push({
      c,
      payback,
      score,
      pp: wait + score,
      impact,
      wait,
      affordable: wait === 0,
      insignificant,
      pref,
    });
  }

  if (!rows.length) return { buy: null, save: null, note: 'nothing in reach', rows };

  const prefOf = (r: DecisionRow) => r.pref;
  const prefWhy = (r: DecisionRow) => (prefOf(r) === AUTO_PREF_BINGO ? 'starts the research' : prefOf(r) === AUTO_PREF_WIZARD ? 'wizard target' : 'preferred');

  // 2) the target: the lowest pp among what isn't affordable yet
  const later = rows.filter((r) => !r.affordable && r.c.milestone == null);
  const target = [...later].sort((a, b) => a.pp - b.pp || prefOf(b) - prefOf(a))[0] || null;
  // 3) on the way, whatever pays for itself before the target would (its pp: its wait + its
  // payback). Only the target's wait would block the best deal overall whenever it happens to
  // be affordable already (the target is picked among what isn't): 2.6x slower to 1M CpS in the
  // simulation. A cheap, slower one (the next cursor) still can't eat the bank while the better
  // one a few seconds off (the next grandma) waits.
  const bar = target ? target.pp : Infinity;
  // It is only reported as saved for (the HUD, the stock trader's smaller budget, STOCK-4)
  // while it is in reach; a far-off one still sets the bar.
  const save = target && target.wait <= cfg.reachSec ? target : null;

  // 1) + 3) what goes out now
  const buyable = rows
    .filter((r) => r.affordable && (prefOf(r) > 0 || r.score < bar))
    .sort((a, b) => prefOf(b) - prefOf(a) || b.c.dCps - a.c.dCps);

  if (buyable.length) {
    const p = buyable[0]!;

    return {
      buy: p.c,
      why: prefOf(p) > 0 ? prefWhy(p) : p.insignificant ? 'insignificant cost' : 'best available',
      row: p,
      save: save ? save.c : null,
      saveRow: save,
      rows,
      buyable,
    };
  }

  return {
    buy: null,
    save: save ? save.c : null,
    saveRow: save,
    note: save ? 'saving' : rows.some((r) => r.wait <= cfg.reachSec) ? 'nothing worth saving for in reach' : 'nothing in reach',
    rows,
  };
}

/** AUTO-9: the paw has walked to `name` in the store and the plan was just made again (things
 * change on the way: hammering stopped, the bank moved). Buy what it stands on when that is
 * still the tick's pick, or still one of this tick's purchases (affordable, not held back) and
 * buying it first leaves enough for the pick. Null = the plan changed its mind: no purchase,
 * so no click pulse either. */
export function shopPickAt(d: Pick<Decision, 'buy' | 'row' | 'why' | 'buyable'>, name: string, bank: number): { c: PurchaseCandidate; row?: DecisionRow; why?: string } | null {
  if (d.buy && d.buy.name === name) return { c: d.buy, row: d.row, why: d.why };

  const r = (d.buyable || []).find((x) => x.c.name === name);
  if (!r) return null;
  if (d.buy && bank - r.c.cost < d.buy.cost) return null;

  return { c: r.c, row: r, why: 'still worth buying' };
}
