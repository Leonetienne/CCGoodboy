import type { AutoCollectCtx, PurchaseCandidate } from './collector';
import { AUTO_PREF_WIZARD, AUTO_TRIVIAL_BANK_SHARE } from './valuation-tables';

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

/** THE STRATEGY (pure function, no game access). For every option:
 *   payback = cost / dCps    seconds until it has paid for itself ("rentability")
 *   impact  = dCps / CpS     how much it changes production, regardless of cost
 *   wait    = time to afford it at the current income (CpS + clicking), after the reserve
 *   pp      = wait + payback  payback including the time spent saving up
 * Every candidate reaching here already passed AUTO-2/AUTO-3's classification (never the
 * research center, never something unclassifiable, always a positive dCps), so there is no
 * absolute payback ceiling: a slow payback still beats 0% return from letting cookies sit idle,
 * and how "good" a payback is only matters for ORDERING purchases and for deciding what is
 * worth deliberately saving up for — never for refusing an otherwise-affordable one outright.
 * "In reach" = affordable within reachSec (AUTO-5); a candidate outside that window is simply
 * too far off to reason about yet, not "too slow a payback" (there is no such thing here).
 * Decision, each tick:
 *   1) Insignificant cost (<= insignificantSec x CpS, "worthless junk" — always worth it) and
 *      preferred candidates (golden cookie upgrades, Wizard towers below their target) are
 *      bought outright whenever affordable, no other condition.
 *   2) Otherwise: if nothing is not-yet-affordable and worth deliberately saving up for, buy
 *      every other affordable candidate too — highest score (lowest payback) first. "Worth
 *      saving up for" means in reach, not affordable yet, and a good deal (pp <= goodFactor x
 *      the best pp of ALL options, in reach or not) or preferred. Measuring "good" against
 *      everything matters: a clearly better option just past reachSec must not leave a terrible
 *      one that happens to be in reach looking like "the best deal in reach".
 *   3) A save target holds back an ordinary (non-insignificant, non-preferred) affordable
 *      purchase when the target's pp (wait included) beats that purchase's payback, or when the
 *      target has >= biggerImpact x its impact AND it costs more than 10% of the target's cost
 *      (otherwise a stream of worse purchases would keep the bank too low to ever afford the
 *      better one). Insignificant and preferred purchases are exempt.
 *   Among everything bought this tick, the single best one goes out (lowest payback, with every
 *   cost below 1% of the spendable bank counted as that 1%, so on a flush bank the biggest CpS
 *   gain goes first); on an
 *   idle-game timescale of one purchase per tick (AUTO-7), the rest follow on later ticks in the
 *   same order, so the store empties out highest score first whenever nothing is being saved
 *   for. The save target is the best of those "worth saving up for" (preferred first, then
 *   lowest pp); a bad deal is never reported as one, even when it is the only thing in reach. */
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
      insignificant: whole <= cfg.insignificantSec * cpsEff,
    });
  }

  const prefOf = (r: DecisionRow) => r.c.pref ?? 0;
  const wizardPref = (r: DecisionRow) => prefOf(r) >= AUTO_PREF_WIZARD;

  const inReach = rows.filter((r) => r.wait <= cfg.reachSec);

  if (!inReach.length) {
    return { buy: null, save: null, note: 'nothing in reach', rows };
  }

  // Best pp over EVERY option, not just those in reach: pp already charges the waiting time, so
  // an option past reachSec only lowers the bar when it is genuinely the better deal.
  const bestPP = Math.min(...rows.map((r) => r.pp));
  const good = (r: DecisionRow) => r.pp <= cfg.goodFactor * bestPP;

  const affordable = inReach.filter((r) => r.affordable);

  // Worth deliberately saving up for: not affordable yet, in reach, and either a good deal
  // relative to everything else on offer or preferred (golden upgrades, Wizard towers).
  // An achievement top-off (AUTO-15) is never saved for: it is only bought when affordable
  // and nothing better holds it back, so the bot never locks in on one.
  const targets = inReach.filter((r) => !r.affordable && r.c.milestone == null && (good(r) || prefOf(r) > 0));

  // Held back for a target when (a) the target, even counting the wait for it, is the better
  // deal: buying the worse one first only pushes the better one further away (and a stream of
  // them never lets the bank reach it) — this is what protects a research chain step, whose
  // impact is diluted by hours of delay (WRINK-1) and so never passes (b); or (b) the target has
  // much more impact and this one would eat a real share of its price.
  const postponed = (p: DecisionRow) =>
    targets.some(
      (q) => q.pp < p.payback || (q.impact >= cfg.biggerImpact * p.impact && (p.c.projectCost ?? p.c.cost) > 0.1 * q.c.cost),
    );

  // Buy now: every affordable candidate that isn't held back in favor of a save target.
  // Insignificant and preferred purchases are always exempt from postponement. Nothing else is
  // gated on payback quality at all — it already passed AUTO-2/AUTO-3's classification, so
  // spending idle cash on it beats hoarding. Within a preference tier the best `order` goes
  // first: payback, except that everything costing <= 1% of the spendable bank counts as
  // costing that 1%. Cookies are no constraint for those, the paw's time is, so they go out
  // biggest CpS gain first (a flush bank buys the big buildings before 100 cursors), while a
  // tight bank still buys the most CpS per cookie first.
  const buyable = affordable
    .filter((r) => r.insignificant || prefOf(r) > 0 || !postponed(r))
    .sort((a, b) => prefOf(b) - prefOf(a) || a.order - b.order);

  // What's next to save for, computed independently of whether something is ALSO buyable this
  // tick: an affordable insignificant/preferred purchase (e.g. a Wizard tower) can go out this
  // very tick while the bot is still accumulating for something bigger it isn't affording yet
  // (that's exactly what `postponed()` above is protecting) — both should be reported, not just
  // whichever one `autoDecide` happens to act on this call. Only a real target qualifies: a
  // merely-in-reach option with a terrible payback is not "saved for" (it would still be bought
  // once affordable if nothing better holds it back, like any other purchase).
  const save = [...targets].sort((a, b) => prefOf(b) - prefOf(a) || a.pp - b.pp)[0] || null;

  if (buyable.length) {
    const p = buyable[0]!;

    return {
      buy: p.c,
      why: prefOf(p) > 0 ? (wizardPref(p) ? 'wizard target' : 'preferred') : p.insignificant ? 'insignificant cost' : 'best available',
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
    note: save ? 'saving' : 'nothing worth saving for in reach',
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
