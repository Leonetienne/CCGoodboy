import type { AutoCollectCtx, PurchaseCandidate } from './collector';
import { AUTO_PREF_BINGO, AUTO_PREF_WIZARD, AUTO_TRIVIAL_BANK_SHARE } from './valuation-tables';

export interface DecisionRow {
  c: PurchaseCandidate;
  payback: number;
  /** Buy order among affordable options, lower first (AUTO-4): the payback with the cost
   * floored at AUTO_TRIVIAL_BANK_SHARE of the spendable bank. */
  order: number;
  pp: number;
  impact: number;
  wait: number;
  affordable: boolean;
  insignificant: boolean;
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
 * Always going for the lowest pp is the greedy rule for growing CpS as fast as possible: a big
 * building or upgrade waits until the income it needs is there (its wait shrinks as smaller,
 * quicker purchases raise the income), and anything that pays for itself before the target
 * would even be affordable has the lower pp, so it is bought on the way (it gets the bank
 * there sooner: with the bank covering it, the target is reached after
 * (T - bank + cost)/(income + dCps) instead of (T - bank)/income, sooner exactly when
 * payback < the target's wait).
 * Decision, each tick:
 *   1) Preferred candidates (golden, cursor/click and kitten upgrades, the Bingo center,
 *      Wizard towers below their target; AUTO-4 B) are bought the moment they are affordable.
 *   2) The target to save for: the preferred candidate in reach (highest tier, then soonest
 *      affordable), else the not-yet-affordable option with the lowest pp. An achievement
 *      top-off (AUTO-15) is never a target.
 *   3) An ordinary affordable purchase is bought when nothing not yet affordable pays back
 *      sooner, counting its wait (payback < the lowest pp among them), and, while saving for
 *      a preferred target (worth having as soon as possible, whatever its own payback), when
 *      it pays back before that target arrives (payback < its wait). Everything else waits.
 *   Among everything bought this tick: preferred first, then by payback, except that every
 *   cost at or below 1% of the spendable bank counts as that 1%: cookies are no constraint
 *   for such pocket money, the paw's time is, so a flush bank buys the biggest CpS gain first.
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

    rows.push({
      c,
      payback,
      order: (Math.max(whole, AUTO_TRIVIAL_BANK_SHARE * avail) * payback) / whole,
      pp: wait + payback,
      impact: c.dCps / cpsEff,
      wait,
      affordable: wait === 0,
      insignificant: whole <= cfg.insignificantShare * Math.max(0, avail),
    });
  }

  if (!rows.length) return { buy: null, save: null, note: 'nothing in reach', rows };

  const prefOf = (r: DecisionRow) => r.c.pref ?? 0;
  const prefWhy = (r: DecisionRow) => (prefOf(r) === AUTO_PREF_BINGO ? 'starts the research' : prefOf(r) === AUTO_PREF_WIZARD ? 'wizard target' : 'preferred');

  // 2) the target
  const later = rows.filter((r) => !r.affordable && r.c.milestone == null);
  const prefTarget = later.filter((r) => prefOf(r) > 0 && r.wait <= cfg.reachSec).sort((a, b) => prefOf(b) - prefOf(a) || a.wait - b.wait)[0];
  const bestLater = [...later].sort((a, b) => a.pp - b.pp)[0] || null;
  const target = prefTarget || bestLater;
  // An affordable purchase must beat everything not affordable yet (counting its wait): else a
  // stream of cheap, slower ones (the next cursor, every few seconds) eats the bank before the
  // better one a few seconds off (the next grandma) is ever affordable. For a preferred target
  // it must also pay back before that target arrives.
  const bar = Math.min(prefTarget ? prefTarget.wait : Infinity, bestLater ? bestLater.pp : Infinity);
  // It is only reported as saved for (the HUD, the stock trader's smaller budget, STOCK-4)
  // while it is in reach; a far-off one still sets the bar.
  const save = target && target.wait <= cfg.reachSec ? target : null;

  // 1) + 3) what goes out now
  const buyable = rows
    .filter((r) => r.affordable && (prefOf(r) > 0 || r.payback < bar))
    .sort((a, b) => prefOf(b) - prefOf(a) || a.order - b.order);

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
