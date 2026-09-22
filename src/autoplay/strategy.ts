import type { AutoCollectCtx, PurchaseCandidate } from './collector';
import { AUTO_BANK_FRACTION, AUTO_PREF_WIZARD } from './valuation-tables';

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
 * "In reach" = affordable within reachSec and payback <= maxPaybackSec (or insignificant).
 * Decision:
 *   A) BUY at once when the cost is insignificant (<= insignificantSec of income, or
 *      <= 0.1% of the bank).
 *   B) BUY when it is a good deal (pp <= goodFactor x the best pp in reach).
 *   C) BUY preferred candidates even when they are not a good deal: golden cookie upgrades
 *      while affordable and payback <= maxPaybackSec, and Wizard towers below their target
 *      while affordable — Wizard towers are bought for mana, not CpS payback, so they ignore
 *      maxPaybackSec but still respect the in-reach window (wait <= reachSec). Preferred
 *      candidates sort before ordinary ones (Wizard towers first) and are exempt from
 *      postponement.
 *   Among everything that qualifies for A or B (or C) the best payback goes first within a
 *   preference tier. Both A and B are postponed when an option that is not affordable yet but
 *   in reach and good (or preferred with an acceptable payback / Wizard towers within reach)
 *   has at least biggerImpact x the impact of this one, and this one costs more than 10% of
 *   it: then it is better to save up for the big one (else a stream of small purchases keeps
 *   the bank too low). Otherwise: nothing to buy now; report what we are saving for (preferred
 *   first, then lowest pp). Wizard towers are never saved for beyond reachSec. */
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
      insignificant: c.cost <= Math.max(cfg.insignificantSec * Math.max(incEff, 0), AUTO_BANK_FRACTION * Math.max(avail, 0)),
    });
  }

  const prefOf = (r: DecisionRow) => r.c.pref ?? 0;
  const wizardPref = (r: DecisionRow) => prefOf(r) >= AUTO_PREF_WIZARD;

  // Wizard towers below their target are only considered when they are in reach (wait <=
  // reachSec). They are bought for mana, so their payback does NOT have to fit maxPaybackSec,
  // but the bot never saves for them beyond the normal in-reach window.
  const inReach = rows.filter((r) => r.wait <= cfg.reachSec && (r.payback <= cfg.maxPaybackSec || r.insignificant || wizardPref(r)));

  if (!inReach.length) {
    return { buy: null, save: null, note: 'nothing in reach', rows };
  }

  const bestPP = Math.min(...inReach.filter((r) => r.payback <= cfg.maxPaybackSec).map((r) => r.pp), Infinity);

  const good = (r: DecisionRow) => r.payback <= cfg.maxPaybackSec && r.pp <= cfg.goodFactor * bestPP;

  const affordable = inReach.filter((r) => r.affordable);

  // Saving up: an option that is not affordable yet, in reach and good — or preferred with an
  // acceptable payback (Wizard towers ignore payback) — with a much bigger impact, holds back
  // everything that is not cheap next to it (otherwise a stream of small purchases would keep
  // the bank too low to ever afford the big one).
  const targets = inReach.filter((r) => !r.affordable && (good(r) || wizardPref(r) || (prefOf(r) > 0 && r.payback <= cfg.maxPaybackSec)));

  const postponed = (p: DecisionRow) => targets.some((q) => q.impact >= cfg.biggerImpact * p.impact && p.c.cost > 0.1 * q.c.cost);

  // Buy now: everything affordable that is insignificant (A), a good deal (B) or preferred
  // (C). Preferred candidates are exempt from postponement; Wizard towers below their target
  // are bought whenever they are affordable (top tier), golden upgrades only while their
  // payback fits maxPaybackSec. Within the same preference tier the BEST payback goes first,
  // so cheap junk never jumps the queue of a better deal.
  const buyable = affordable
    .filter((r) => {
      if (prefOf(r) > 0) {
        return wizardPref(r) || r.insignificant || good(r) || r.payback <= cfg.maxPaybackSec;
      }

      return !postponed(r) && (r.insignificant || good(r));
    })
    .sort((a, b) => prefOf(b) - prefOf(a) || a.payback - b.payback);

  if (buyable.length) {
    const p = buyable[0]!;

    return {
      buy: p.c,
      why: !good(p) && !p.insignificant && prefOf(p) > 0 ? (wizardPref(p) ? 'wizard target' : 'preferred') : good(p) ? 'good payback' : 'insignificant cost',
      row: p,
      save: null,
      rows,
    };
  }

  const save = inReach
    .filter((r) => !r.affordable && (r.payback <= cfg.maxPaybackSec || wizardPref(r)))
    .sort((a, b) => prefOf(b) - prefOf(a) || a.pp - b.pp)[0] || null;

  return {
    buy: null,
    save: save ? save.c : null,
    saveRow: save,
    note: save ? 'saving' : 'waiting',
    rows,
  };
}
