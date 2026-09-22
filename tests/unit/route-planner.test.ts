import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/game/dom-geometry';
import { exactRoute, heuristicRoute, improveRoute, planRoute, routeCost } from '../../src/routing/route-planner';

function distMatrix(points: Point[]): { D: Float64Array; N: number } {
  const N = points.length;
  const D = new Float64Array(N * N);

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      D[i * N + j] = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y);
    }
  }

  return { D, N };
}

describe('planRoute', () => {
  it('returns an empty/trivial order for 0 or 1 points', () => {
    expect(planRoute({ x: 0, y: 0 }, [])).toEqual([]);
    expect(planRoute({ x: 0, y: 0 }, [{ x: 5, y: 5 }])).toEqual([0]);
  });

  it('visits the nearer point first when it is unambiguous', () => {
    const start = { x: 0, y: 0 };
    const near = { x: 10, y: 0 };
    const far = { x: 100, y: 0 };

    // pts given far-then-near; the optimal open path still visits near first.
    const order = planRoute(start, [far, near]);
    expect(order).toEqual([1, 0]);
  });

  it('finds the optimal order for a small exact case (n <= 11)', () => {
    const start = { x: 0, y: 0 };
    // 4 points on a line: visiting in distance order is obviously optimal.
    const pts = [
      { x: 30, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ];

    const order = planRoute(start, pts);
    expect(order).toEqual([1, 2, 0, 3]); // by x: 10, 20, 30, 40
  });

  it('returns a valid permutation of all points for a large (heuristic) instance', () => {
    const start = { x: 0, y: 0 };
    const pts: Point[] = [];

    for (let i = 0; i < 20; i++) {
      pts.push({ x: (i * 37) % 500, y: (i * 91) % 500 });
    }

    const order = planRoute(start, pts);

    expect(order).toHaveLength(pts.length);
    expect([...order].sort((a, b) => a - b)).toEqual(pts.map((_, i) => i));
  });

  it('is deterministic: the same input always plans the same route', () => {
    const start = { x: 3, y: 7 };
    const pts: Point[] = [];

    for (let i = 0; i < 20; i++) {
      pts.push({ x: (i * 53) % 700, y: (i * 29) % 700 });
    }

    expect(planRoute(start, pts)).toEqual(planRoute(start, pts));
  });
});

describe('routeCost', () => {
  it('sums the distance along consecutive path nodes', () => {
    const { D, N } = distMatrix([
      { x: 0, y: 0 },
      { x: 3, y: 4 }, // dist 5 from node 0
      { x: 3, y: 4 + 12 }, // dist 12 from node 1
    ]);

    expect(routeCost(D, N, [0, 1, 2])).toBeCloseTo(17, 9);
  });
});

describe('exactRoute', () => {
  it('always starts at node 0 and visits every node exactly once', () => {
    // node 0 = start, nodes 1..4 = the 4 cookies.
    const { D } = distMatrix([
      { x: -10, y: -10 }, // start
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ]);

    const path = exactRoute(D, 4);

    expect(path[0]).toBe(0);
    expect([...path].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('finds the true minimum-cost open path (brute force cross-check)', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 5 },
      { x: 10, y: 60 },
      { x: 40, y: 40 },
      { x: 5, y: 5 },
    ];

    const { D, N } = distMatrix(points);
    const n = points.length - 1;

    const exact = exactRoute(D, n);
    const exactCost = routeCost(D, N, exact);

    // Brute force every permutation of the 4 cookies (indices 1..4) as a cross-check.
    const indices = [1, 2, 3, 4];
    const permute = (arr: number[]): number[][] =>
      arr.length <= 1 ? [arr] : arr.flatMap((v, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [v, ...p]));

    let bruteBest = Infinity;
    for (const perm of permute(indices)) {
      bruteBest = Math.min(bruteBest, routeCost(D, N, [0, ...perm]));
    }

    expect(exactCost).toBeCloseTo(bruteBest, 9);
  });
});

describe('improveRoute', () => {
  it('never makes a path more expensive', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
    ];

    const { D, N } = distMatrix(points);
    // A deliberately bad path: visits in a crossed-over order.
    const badPath = [0, 2, 4, 1, 3];
    const before = routeCost(D, N, badPath);

    const improved = improveRoute(D, N, badPath.slice());
    const after = routeCost(D, N, improved);

    expect(after).toBeLessThanOrEqual(before + 1e-9);
    expect(improved[0]).toBe(0); // start stays fixed
  });
});

describe('heuristicRoute', () => {
  it('is deterministic for the same distance matrix', () => {
    const points: Point[] = [];
    for (let i = 0; i < 15; i++) {
      points.push({ x: (i * 41) % 300, y: (i * 67) % 300 });
    }

    const { D } = distMatrix(points);
    const n = points.length - 1;

    expect(heuristicRoute(D, n)).toEqual(heuristicRoute(D, n));
  });

  it('is never worse than the identity nearest-neighbour-improved baseline', () => {
    const points: Point[] = [];
    for (let i = 0; i < 15; i++) {
      points.push({ x: (i * 41) % 300, y: (i * 67) % 300 });
    }

    const { D, N } = distMatrix(points);
    const n = points.length - 1;

    const heuristic = heuristicRoute(D, n);
    const naive = [0, ...Array.from({ length: n }, (_, i) => i + 1)];

    expect(routeCost(D, N, heuristic)).toBeLessThanOrEqual(routeCost(D, N, naive) + 1e-9);
  });
});
