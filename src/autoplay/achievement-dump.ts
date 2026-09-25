// Pure: spending the bank on building count achievements right before an ascension (ASC-13).
// The ascension throws the bank away, but achievements stay won for good (every one is +4% milk
// for the kittens in every later run), and spending never lowers the prestige gained (it
// comes from the cookies EARNED). So the whole bank goes into the cheapest achievements first:
// that wins the most of them for what is there.

/** A building's price grows by this factor per copy owned (the game's Game.priceIncrease). */
export const BUILDING_PRICE_GROWTH = 1.15;

export interface DumpBuilding {
  name: string;
  id: number;
  amount: number;
  /** What the next copy costs right now (discounts included). */
  price: number;
  /** Counts with a count achievement still to win, ascending (1, 50, 100, ...). */
  unwon: number[];
}

export interface DumpStep {
  name: string;
  id: number;
  /** The count that wins the achievement. */
  target: number;
  /** Copies to buy from where the building stands at this step. */
  count: number;
  cost: number;
}

/** What `count` more copies cost, starting `offset` copies above the current amount. */
export function copiesCost(price: number, offset: number, count: number): number {
  if (count <= 0) return 0;
  const g = BUILDING_PRICE_GROWTH;
  return price * Math.pow(g, offset) * ((Math.pow(g, count) - 1) / (g - 1));
}

/** ASC-13: the whole greedy plan for `bank` cookies, cheapest achievement first: every step is
 * the cheapest next count achievement of any building the rest of the bank still pays for. */
export function planAchievementDump(buildings: DumpBuilding[], bank: number): DumpStep[] {
  const sim = buildings.map((b) => ({ b, at: b.amount }));
  const steps: DumpStep[] = [];
  let left = bank;

  for (;;) {
    let best: DumpStep | null = null;
    let bestSim: (typeof sim)[number] | null = null;

    for (const s of sim) {
      const target = s.b.unwon.find((n) => n > s.at);
      if (target == null) continue;

      const count = target - s.at;
      const cost = copiesCost(s.b.price, s.at - s.b.amount, count);
      if (!(cost <= left)) continue;

      if (!best || cost < best.cost) {
        best = { name: s.b.name, id: s.b.id, target, count, cost };
        bestSim = s;
      }
    }

    if (!best || !bestSim) return steps;

    steps.push(best);
    left -= best.cost;
    bestSim.at = best.target;
  }
}

/** Copies the whole plan buys (the paw buys ~10 per second, ASC-12's time margin). */
export function dumpCopies(steps: DumpStep[]): number {
  return steps.reduce((sum, s) => sum + s.count, 0);
}
