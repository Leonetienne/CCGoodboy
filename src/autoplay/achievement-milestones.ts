/** Building count achievements (AUTO-15): every building has achievements for owning 1, 50,
 * 100, 150, ... of it. Each achievement is +1/25 milk, and every owned kitten upgrade
 * multiplies ALL production by 1 + milk x its factor, so topping 98 buildings off to 100 can
 * be worth far more than the two buildings themselves. Pure. */

/** Milk per achievement (Game.milkProgress = achievements / 25). */
const MILK_PER_ACHIEVEMENT = 1 / 25;

/** An achievement's value while no kitten is owned yet (the milk still counts once kittens
 * are bought): a nominal 0.1% of CpS, like the eggs' floor (EGG-2). */
export const AUTO_ACHIEVEMENT_NOMINAL_SHARE = 0.001;

/** A top-off must pay back this much better than its copies alone, and it competes with
 * everything else at its payback x this: in the same ballpark as a real upgrade, the upgrade
 * wins (AUTO-15). */
export const AUTO_MILESTONE_MARGIN = 1.5;

/** Share of CpS one more achievement adds through the milk: d(prod of (1 + milk x f)) /
 * product, for the owned kittens' factors `kittens`. At least the nominal share. */
export function achievementCpsShare(milk: number, kittens: number[]): number {
  let share = 0;

  for (const f of kittens) {
    if (f > 0) share += (f * MILK_PER_ACHIEVEMENT) / (1 + Math.max(0, milk) * f);
  }

  return Math.max(share, AUTO_ACHIEVEMENT_NOMINAL_SHARE);
}

/** The next count at which the building still has an achievement to win, if the building cap
 * (the Wizard tower target) lets it get there. */
export function nextAchievementCount(amount: number, unwon: number[], cap?: number): number | null {
  const next = unwon.find((n) => n > amount);
  return next != null && (cap == null || next <= cap) ? next : null;
}

export interface MilestoneValue {
  /** CpS gain credited to buying ONE more copy now. */
  dCps: number;
  /** The achievement count it is heading for, when that decided the value. */
  milestone: number | null;
}

/** Value of one more copy of a building on its way to the achievement at `next`: the `n` copies
 * still missing are ONE project (like WRINK-1's research chain), paying back
 * `sumPrice / (n x gain + achievementGain)`, handicapped by AUTO_MILESTONE_MARGIN; this copy
 * is credited `cost / that payback` when it beats the copy's own gain. So a cheap top-off
 * (98 -> 100) is bought even though the copies alone would rank low, while a far-off
 * milestone (a costly 50 more) changes nothing.
 * @param sumPrice what the n missing copies cost together */
export function autoMilestoneValue(
  cost: number,
  gain: number,
  amount: number,
  next: number | null,
  sumPrice: number,
  achievementGain: number,
): MilestoneValue {
  if (next == null || !(next > amount) || !(sumPrice > 0) || !(achievementGain > 0)) {
    return { dCps: gain, milestone: null };
  }

  const n = next - amount;
  const payback = (AUTO_MILESTONE_MARGIN * sumPrice) / (n * Math.max(0, gain) + achievementGain);
  const project = cost / payback;

  return project > gain ? { dCps: project, milestone: next } : { dCps: gain, milestone: null };
}
