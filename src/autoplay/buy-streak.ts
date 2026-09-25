import type { PurchaseCandidate } from './collector';
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
 * Only while it is still the very purchase this tick would make (`d.buy`), so the streak
 * buys exactly what the one-per-task order (AUTO-7) would, minus the walking. Cheap
 * buildings (<= 1% of the bank, AUTO-4's buy order) stay on top until they aren't cheap any
 * more, which is what makes long streaks. Pure. */
export function autoStreakContinues(d: Decision, c: PurchaseCandidate): boolean {
  return d.buy === c;
}
