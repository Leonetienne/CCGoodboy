/** Butter biscuits (BUTTER-*), the pure part. Each butter biscuit (+10% CpS) unlocks once
 * EVERY building is owned at least N times at once (main.js 2.058, the achievement check every
 * 5s: `minAmount>=100` -> Centennial + Milk chocolate butter biscuit, ... 650). Auto play caps
 * Wizard towers (autoWizardTowerTarget, 57), so they are the one building short: once every
 * other building reaches the next milestone, the paw buys Wizard towers up to it, waits for the
 * game to unlock the biscuit, and sells them back down. The unlock stays; the biscuit itself
 * is then bought by the normal shopping. */

/** The butter biscuits by the count of everything that unlocks them (main.js 2.058). */
export const BUTTER_BISCUITS: ReadonlyArray<{ level: number; name: string }> = [
  { level: 100, name: 'Milk chocolate butter biscuit' },
  { level: 150, name: 'Dark chocolate butter biscuit' },
  { level: 200, name: 'White chocolate butter biscuit' },
  { level: 250, name: 'Ruby chocolate butter biscuit' },
  { level: 300, name: 'Lavender chocolate butter biscuit' },
  { level: 350, name: 'Synthetic chocolate green honey butter biscuit' },
  { level: 400, name: 'Royal raspberry chocolate butter biscuit' },
  { level: 450, name: 'Ultra-concentrated high-energy chocolate butter biscuit' },
  { level: 500, name: 'Pure pitch-black chocolate butter biscuit' },
  { level: 550, name: 'Cosmic chocolate butter biscuit' },
  { level: 600, name: 'Butter biscuit (with butter)' },
  { level: 650, name: 'Everybutter biscuit' },
];

/** The extra Wizard towers must cost less than this share of the bank. */
export const BUTTER_MAX_BANK_SHARE = 0.01;
/** After the top-up, how long to wait for the game's unlock (it checks every 5s) before
 * selling back anyway. */
export const BUTTER_UNLOCK_WAIT_MS = 12000;

/** A top-up the paw did and still has to sell back. */
export interface ButterTopUp {
  /** The milestone the towers were bought up to. */
  level: number;
  /** Sell back down to this many (the count before, at least the target). */
  sellTo: number;
  /** When the towers were bought. */
  at: number;
}

export interface ButterState {
  towers: number;
  /** autoWizardTowerTarget. */
  cap: number;
  /** The lowest count of every OTHER building (Infinity without other buildings). */
  minOther: number;
  /** Milestones whose biscuit is already unlocked (or bought). */
  unlocked: ReadonlySet<number>;
  /** What buying `n` more Wizard towers costs right now. */
  buyCost: (n: number) => number;
  /** Bank minus the auto play reserve (AUTO-6). */
  spendable: number;
  /** BUTTER_MAX_BANK_SHARE x the bank: the towers must cost less. */
  maxCost: number;
  /** Krumblor wants the Wizard towers itself right now (its level-12 sacrifice, KRUMB-2). */
  krumblorBusy: boolean;
  topUp: ButterTopUp | null;
  now: number;
}

export type ButterStep =
  | { kind: 'buy-towers'; n: number; level: number; cost: number }
  | { kind: 'sell-towers'; n: number; level: number }
  | { kind: 'wait'; why: string }
  | { kind: 'done'; why: string };

/** The milestones a Wizard tower top-up could unlock right now: biscuit still locked, every
 * other building there, and the tower target below it (else shopping gets there itself). */
export function butterTargets(s: Pick<ButterState, 'towers' | 'cap' | 'minOther' | 'unlocked'>): number[] {
  return BUTTER_BISCUITS.map((b) => b.level).filter((l) => !s.unlocked.has(l) && l <= s.minOther && l > s.cap && l > s.towers);
}

/** The next step. A top-up in progress is finished first: wait for the unlock, then sell the
 * extra towers. Otherwise the HIGHEST reachable milestone whose towers cost less than
 * BUTTER_MAX_BANK_SHARE of the bank (and leave the reserve alone) is bought up to (one top-up
 * to 200 also unlocks the 100 and 150 biscuits). */
export function nextButterStep(s: ButterState): ButterStep {
  const t = s.topUp;

  if (t) {
    const extra = s.towers - t.sellTo;
    if (extra <= 0) return { kind: 'done', why: 'sold back' };
    if (!s.unlocked.has(t.level) && s.now - t.at < BUTTER_UNLOCK_WAIT_MS) return { kind: 'wait', why: `waiting for the ${t.level} butter biscuit to unlock` };

    return { kind: 'sell-towers', n: extra, level: t.level };
  }

  if (s.krumblorBusy) return { kind: 'done', why: 'Krumblor needs the Wizard towers' };

  const targets = butterTargets(s);
  if (!targets.length) return { kind: 'done', why: 'no butter biscuit within reach' };

  for (let i = targets.length - 1; i >= 0; i--) {
    const level = targets[i]!;
    const n = level - s.towers;
    const cost = s.buyCost(n);

    if (Number.isFinite(cost) && cost < s.maxCost && cost <= s.spendable) return { kind: 'buy-towers', n, level, cost };
  }

  return { kind: 'wait', why: `Wizard towers for the ${targets[0]} butter biscuit cost too much yet` };
}
