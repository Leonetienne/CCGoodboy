import type { AutoCollectCtx, PurchaseCandidate } from './collector';
import type { Decision } from './strategy';
import { AUTO_PREF_WIZARD, AUTO_TRIVIAL_BANK_SHARE } from './valuation-tables';

/** At most this many copies of one building in one shopping visit (AUTO-14). */
export const AUTO_STREAK_MAX = 100;

/** Copies per press when a streak buys a whole stack at once (AUTO-14). */
export const AUTO_STACK = 10;

/** At most this many purchases in one shopping visit, all streaks and junk hops together
 * (AUTO-18). */
export const AUTO_SPREE_MAX = 300;

/** Buys per second while the paw streaks on one building row, and the ± time jitter (ms). */
export const AUTO_STREAK_RATE = 10;
export const AUTO_STREAK_JITTER_MS = 30;

/** ± px the paw's press point wanders around the row's centre between streak buys (capped to
 * a quarter of the row's size). */
export const AUTO_STREAK_JITTER_X = 8;
export const AUTO_STREAK_JITTER_Y = 5;

/** What the paw, having just bought `last`, buys next in the same visit, or null (the visit
 * ends). (1) AUTO-14: the same building again while it is still this tick's pick. (2)
 * AUTO-18: otherwise the first of this tick's purchases (`d.buyable`, buy order) that is
 * insignificant (<= autoInsignificantSec of CpS) and that the paw can reach (`reachable`:
 * its store element or section on screen), as long as it is the pick itself or leaving it
 * out of the bank still pays for the pick (AUTO-9's `shopPickAt()` rule). So the junk that
 * floods the store after an ascension goes out in one spree instead of one trip each. Pure. */
export function autoSpreeNext(
  d: Decision,
  last: PurchaseCandidate,
  bank: number,
  reachable: (c: PurchaseCandidate) => boolean,
): PurchaseCandidate | null {
  if (last.kind === 'building' && d.buy && d.buy.kind === 'building' && d.buy.name === last.name) return d.buy;

  for (const r of d.buyable || []) {
    if (!r.insignificant) continue;
    if (d.buy && r.c !== d.buy && bank - r.c.cost < d.buy.cost) continue;
    if (!reachable(r.c)) continue;

    return r.c;
  }

  return null;
}

/** How many copies of building `c` one press of the streak buys (AUTO-14): a stack of
 * AUTO_STACK while the whole stack (`stackCost`, the game's sum price) is still pocket money,
 * i.e. insignificant (<= autoInsignificantSec of CpS) or at most AUTO_TRIVIAL_BANK_SHARE of
 * the spendable bank, and buying it still leaves enough for the tick's pick; else 1. Never
 * for Wizard towers (their target caps them). Pure. */
export function autoStackSize(d: Decision, c: PurchaseCandidate, stackCost: number, ctx: AutoCollectCtx): number {
  if (c.kind !== 'building' || c.pref === AUTO_PREF_WIZARD || !(stackCost > 0)) return 1;

  const avail = ctx.bank - ctx.reserve;
  const pocket = Math.max(ctx.cfg.insignificantSec * Math.max(ctx.cps, 0.1), AUTO_TRIVIAL_BANK_SHARE * avail);
  const pick = d.buy && d.buy !== c ? d.buy.cost : 0;

  return stackCost <= pocket && avail - stackCost >= pick ? AUTO_STACK : 1;
}
