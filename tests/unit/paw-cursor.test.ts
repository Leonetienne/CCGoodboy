import { describe, expect, it } from 'vitest';
import { clickPulseActive, clickPulseScale } from '../../src/rendering/paw-cursor';

describe('clickPulseActive', () => {
  it('is false when no click has happened (pulseAt 0)', () => {
    expect(clickPulseActive(0, 1000)).toBe(false);
  });

  it('is true right after a click and false once the pulse (80ms) has elapsed', () => {
    expect(clickPulseActive(1000, 1000)).toBe(true);
    expect(clickPulseActive(1000, 1050)).toBe(true);
    expect(clickPulseActive(1000, 1081)).toBe(false);
  });
});

describe('clickPulseScale', () => {
  it('is 1 when idle', () => {
    expect(clickPulseScale(0, 1000)).toBe(1);
  });

  it('shrinks towards the bottom scale during the press phase (downMs=25)', () => {
    expect(clickPulseScale(1000, 1000)).toBeCloseTo(1, 5);
    expect(clickPulseScale(1000, 1025)).toBeCloseTo(0.92, 5); // fully down
  });

  it('springs back to 1 by the end of the release phase (upMs=55)', () => {
    expect(clickPulseScale(1000, 1080)).toBeCloseTo(1, 5);
    expect(clickPulseScale(1000, 1081)).toBe(1); // past the pulse window entirely
  });
});
