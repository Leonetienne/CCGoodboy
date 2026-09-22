import type { AutoCollectCtx, PurchaseCandidate } from './collector';
import { AUTO_PREF_WIZARD } from './valuation-tables';

export interface DecisionRow {
  c: PurchaseCandidate;
  payback: number;
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
 *      the best pp in reach) or preferred.
 *   3) A save target holds back an ordinary (non-insignificant, non-preferred) affordable
 *      purchase specifically when the target has >= biggerImpact x its impact AND it costs more
 *      than 10% of the target's cost (otherwise a stream of small purchases would keep the bank
 *      too low to ever afford the big one). Insignificant and preferred purchases are exempt.
 *   Among everything bought this tick, the single best (lowest payback) one goes out; on an
 *   idle-game timescale of one purchase per tick (AUTO-7), the rest follow on later ticks in the
 *   same order, so the store empties out highest score first whenever nothing is being saved
 *   for. Report what we are saving for otherwise (preferred first, then lowest pp). */
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

    rows.push({
      c,
      payback,
      pp: wait + payback,
      impact: c.dCps / cpsEff,
      wait,
      affordable: wait === 0,
      insignificant: c.cost <= cfg.insignificantSec * cpsEff,
    });
  }

  const prefOf = (r: DecisionRow) => r.c.pref ?? 0;
  const wizardPref = (r: DecisionRow) => prefOf(r) >= AUTO_PREF_WIZARD;

  const inReach = rows.filter((r) => r.wait <= cfg.reachSec);

  if (!inReach.length) {
    return { buy: null, save: null, note: 'nothing in reach', rows };
  }

  const bestPP = Math.min(...inReach.map((r) => r.pp));
  const good = (r: DecisionRow) => r.pp <= cfg.goodFactor * bestPP;

  const affordable = inReach.filter((r) => r.affordable);

  // Worth deliberately saving up for: not affordable yet, in reach, and either a good deal
  // relative to everything else on offer or preferred (golden upgrades, Wizard towers).
  const targets = inReach.filter((r) => !r.affordable && (good(r) || prefOf(r) > 0));

  const postponed = (p: DecisionRow) => targets.some((q) => q.impact >= cfg.biggerImpact * p.impact && p.c.cost > 0.1 * q.c.cost);

  // Buy now: every affordable candidate that isn't held back in favor of a save target.
  // Insignificant and preferred purchases are always exempt from postponement. Nothing else is
  // gated on payback quality at all — it already passed AUTO-2/AUTO-3's classification, so
  // spending idle cash on it beats hoarding. Best payback goes first within a preference tier.
  const buyable = affordable
    .filter((r) => r.insignificant || prefOf(r) > 0 || !postponed(r))
    .sort((a, b) => prefOf(b) - prefOf(a) || a.payback - b.payback);

  // What's next to save for, computed independently of whether something is ALSO buyable this
  // tick: an affordable insignificant/preferred purchase (e.g. a Wizard tower) can go out this
  // very tick while the bot is still accumulating for something bigger it isn't affording yet
  // (that's exactly what `postponed()` above is protecting) — both should be reported, not just
  // whichever one `autoDecide` happens to act on this call. Deliberately broader than `targets`
  // (no `good()` bar): this is just "what would be bought next," not a postponement trigger, so
  // it still names something even when nothing is currently good enough to hold other buys back.
  const save = inReach
    .filter((r) => !r.affordable)
    .sort((a, b) => prefOf(b) - prefOf(a) || a.pp - b.pp)[0] || null;

  if (buyable.length) {
    const p = buyable[0]!;

    return {
      buy: p.c,
      why: prefOf(p) > 0 ? (wizardPref(p) ? 'wizard target' : 'preferred') : p.insignificant ? 'insignificant cost' : 'best available',
      row: p,
      save: save ? save.c : null,
      saveRow: save,
      rows,
    };
  }

  return {
    buy: null,
    save: save ? save.c : null,
    saveRow: save,
    note: save ? 'saving' : 'waiting',
    rows,
  };
}
