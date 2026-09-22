export type PawMood = 'shy' | 'cuddly';

/** One full shy/cuddly mood cycle. */
export const PAW_MOOD_PERIOD_MS = 120_000;

/** Sine threshold: sin(phase) >= this is cuddly, below is shy. 0 = an even split. */
export const PAW_MOOD_THRESHOLD = 0;

/** The paw's current social mood, derived deterministically from the wall-clock time by
 * passing the timestamp through a sine function and applying a threshold. The same moment
 * always has the same mood, and it flips between shy and cuddly as time passes. */
export function pawMoodAt(tsMs: number): PawMood {
  const phase = ((tsMs % PAW_MOOD_PERIOD_MS) / PAW_MOOD_PERIOD_MS) * Math.PI * 2;
  return Math.sin(phase) >= PAW_MOOD_THRESHOLD ? 'cuddly' : 'shy';
}
