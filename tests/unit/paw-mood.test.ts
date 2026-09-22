import { describe, expect, it } from 'vitest';
import { PAW_MOOD_PERIOD_MS, pawMoodAt } from '../../src/actions/paw-mood';

describe('pawMoodAt', () => {
  it('is deterministic for the same timestamp', () => {
    expect(pawMoodAt(123456)).toBe(pawMoodAt(123456));
  });

  it('flips between shy and cuddly across the sine period', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 20; i++) {
      seen.add(pawMoodAt((i / 20) * PAW_MOOD_PERIOD_MS));
    }

    expect(seen.has('shy')).toBe(true);
    expect(seen.has('cuddly')).toBe(true);
  });

  it('repeats with the mood period', () => {
    expect(pawMoodAt(42)).toBe(pawMoodAt(42 + PAW_MOOD_PERIOD_MS));
  });
});
