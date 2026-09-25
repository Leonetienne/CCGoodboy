import type { AutoCollectCtx, PurchaseCandidate } from './collector';
import type { Decision } from './strategy';

/** At most this many copies of one building in one shopping visit (AUTO-14). */
export const AUTO_STREAK_MAX = 100;

/** Buys per second while the paw streaks on one building row, and the ± time jitter (ms). */
export const AUTO_STREAK_RATE = 10;
export const AUTO_STREAK_JITTER_MS = 30;

/** ± px the paw's press point wanders around the row's centre between streak buys (capped to
 * a quarter of the row's size). */
export const AUTO_STREAK_JITTER_X = 8;
export const AUTO_STREAK_JITTER_Y = 5;

/** The building `name` among this tick's candidates, or null (bought up to its cap, locked,
 * sell mode, ...). */
export function streakCandidate(cands: PurchaseCandidate[], name: string): PurchaseCandidate | null {
  return cands.find((c) => c.kind === 'building' && c.name === name) || null;
}

/** Should the paw, standing at building `c`'s row, buy one more of it right away (AUTO-14)?
 * Yes while `c` is something this tick would buy at all (in `d.buyable`: affordable after the
 * reserve and not held back for a save target) AND buying it still leaves the tick's best
 * pick (`d.buy`) affordable, so the streak never starves a better purchase; it only saves the
 * trips the one-per-task order (AUTO-7) would spend walking back and forth. Pure. */
export function autoStreakContinues(d: Decision, c: PurchaseCandidate, ctx: AutoCollectCtx): boolean {
  if (!d.buy || !d.buyable.some((r) => r.c === c)) return false;
  if (d.buy === c) return true;

  return ctx.bank - ctx.reserve - c.cost >= d.buy.cost;
}
