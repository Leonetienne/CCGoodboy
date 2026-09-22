/** WHAT THE RESEARCH CHAIN IS WORTH (pure functions, no game access; WRINK-1).
 *
 * Nobody buys the Bingo center for "grandmas x4": the chain up to One mind is ONE project
 * whose payoff is the wrinklers of stage 1. So a chain step is not valued by its own effect
 * but by the payback of finishing the chain from there:
 *
 *   payback = (cost of every step still to buy) / (stage 1 gain + the steps' own gains)
 *             + delay until that gain arrives
 *   dCps    = this step's cost / payback      (so autoDecide() sees exactly that payback)
 *
 * Stage 1 gain, in CpS: with n wrinklers the bank gets (1 - 0.05n) of the CpS and the pops
 * return popMult x 0.05n² of it; a slot only digests maturity/(maturity+1) of the time (it is
 * popped after maturity x the respawn time, then empty for one respawn time). Minus the golden
 * cookies stage 1 turns into (ignored) wrath cookies: 1 in 3. With 10 wrinklers, x1.1 and
 * maturity 5 that is about +400% CpS.
 *
 * Delay: the research still to wait for (one research time between steps), then a slot
 * filling (one respawn time), then digesting until mature (maturity x respawn time) before
 * the first cookies can be spent. */

/** Share of CpS golden cookies are assumed to be worth to this bot (consistent with valuing
 * Lucky day, which doubles their frequency, at +20% CpS in AUTO_GOLDEN_UPGRADES). */
export const AUTO_GOLDEN_CPS_SHARE = 0.2;

export interface Stage1Input {
  /** Unbuffed CpS. */
  cps: number;
  /** Wrinkler slots (10, 12 with Elder spice). */
  wrinklersMax: number;
  /** Pop multiplier of a normal wrinkler (1.1 + upgrades). */
  popMult: number;
  /** autoWrinklerMaturity. */
  maturity: number;
  /** Respawn time of a slot at stage 1 (seconds). */
  respawnSec: number;
}

/** Extra CpS stage 1 brings in the long run (0 if it would not pay at all). */
export function stage1Gain(s: Stage1Input): number {
  const n = Math.max(0, s.wrinklersMax);
  const m = Math.max(0, s.maturity);
  const duty = m / (m + 1);
  const factor = 1 - 0.05 * n + s.popMult * 0.05 * n * n * duty;

  return Math.max(0, s.cps * (factor - 1 - AUTO_GOLDEN_CPS_SHARE / 3));
}

/** Seconds until stage 1 pays its first spendable cookies, `researchesLeft` research times
 * from now. */
export function stage1DelaySec(s: Stage1Input, researchesLeft: number, researchSec: number): number {
  const r = Number.isFinite(s.respawnSec) ? s.respawnSec : 0;

  return Math.max(0, researchesLeft) * researchSec + r + Math.max(0, s.maturity) * r;
}

export interface ChainStepInput extends Stage1Input {
  /** Price of the step being valued. */
  cost: number;
  /** Price of it plus every later, not yet bought step up to One mind. */
  remainingCost: number;
  /** Their own CpS gains (grandma multipliers, +x% production, One mind's grandma bonus). */
  ownGain: number;
  /** Research waits still ahead after buying this step (steps left after it). */
  researchesLeft: number;
  researchSec: number;
}

/** dCps to give one chain step so its payback is that of finishing the chain. */
export function chainStepGain(s: ChainStepInput): number {
  const gain = stage1Gain(s) + Math.max(0, s.ownGain);
  if (!(gain > 0) || !(s.remainingCost > 0)) return 0;

  const payback = s.remainingCost / gain + stage1DelaySec(s, s.researchesLeft, s.researchSec);

  return payback > 0 ? s.cost / payback : 0;
}
