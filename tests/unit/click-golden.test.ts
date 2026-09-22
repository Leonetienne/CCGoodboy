import { describe, expect, it } from 'vitest';
import { effectPrettyName } from '../../src/hunting/click-golden';

describe('effectPrettyName', () => {
  it('maps known internal effect keys to their display name', () => {
    expect(effectPrettyName('frenzy')).toBe('Frenzy');
    expect(effectPrettyName('multiply cookies')).toBe('Lucky');
    expect(effectPrettyName('click frenzy')).toBe('Click Frenzy');
    expect(effectPrettyName('everything must go')).toBe('Everything Must Go');
  });

  it('title-cases an unknown key rather than failing', () => {
    expect(effectPrettyName('some new effect')).toBe('Some New Effect');
  });

  it('returns Unknown for an empty/falsy key', () => {
    expect(effectPrettyName('')).toBe('Unknown');
  });
});
