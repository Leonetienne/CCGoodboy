import { describe, expect, it } from 'vitest';
import { buildCursorPath, buildSpeedWarp, splinePoint } from '../../src/input/cursor-controller';

describe('buildCursorPath', () => {
  it('returns a direct two-point path for a very short hop', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };

    expect(buildCursorPath(start, end)).toEqual({ pts: [start, end], dips: [] });
  });

  it('starts and ends exactly at the requested points for a longer hop', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 500, y: 200 };

    const path = buildCursorPath(start, end);

    expect(path.pts[0]).toEqual(start);
    expect(path.pts[path.pts.length - 1]).toEqual(end);
    expect(path.pts.length).toBeGreaterThan(2);
  });
});

describe('splinePoint', () => {
  it('is exactly the first point at u=0 and the last point at u=1', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: -5 },
      { x: 30, y: 0 },
    ];

    expect(splinePoint(pts, 0)).toEqual({ x: 0, y: 0 });
    expect(splinePoint(pts, 1)).toEqual({ x: 30, y: 0 });
  });

  it('clamps out-of-range u to the endpoints', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];

    expect(splinePoint(pts, -1)).toEqual(splinePoint(pts, 0));
    expect(splinePoint(pts, 2)).toEqual(splinePoint(pts, 1));
  });
});

describe('buildSpeedWarp', () => {
  it('maps tau=0 to u=0 and tau=1 to u=1 (starts and ends the trip)', () => {
    const warp = buildSpeedWarp([]);

    expect(warp(0)).toBeCloseTo(0, 6);
    expect(warp(1)).toBeCloseTo(1, 6);
  });

  it('is monotonically non-decreasing (the cursor never travels backwards in time)', () => {
    const warp = buildSpeedWarp([0.3, 0.7]);

    let prev = -1;
    for (let tau = 0; tau <= 1; tau += 0.01) {
      const u = warp(tau);
      expect(u).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = u;
    }
  });
});
