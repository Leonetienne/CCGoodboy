import type { Point } from '../game/dom-geometry';

// This module ports a dense numeric algorithm (Held-Karp DP, 2-opt/Or-opt local search) whose
// array indices are all in-bounds by construction. Non-null assertions (`!`) are used at those
// index sites instead of restructuring the algorithm, to keep it a verbatim, behavior-preserving
// port under `noUncheckedIndexedAccess`.

/** Exact shortest OPEN path (Held-Karp dynamic programming, O(2^n * n^2)): start at node 0,
 * visit all n cookies, end anywhere.
 * @param D (n+1)x(n+1) distance matrix, node 0 = start, 1..n = cookies
 * @param n number of cookies (used for n <= 11)
 * @returns node path [0, first, ..., last]
 */
export function exactRoute(D: Float64Array, n: number): number[] {
  const N = n + 1;
  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const par = new Int8Array(size * n).fill(-1);

  for (let j = 0; j < n; j++) {
    dp[(1 << j) * n + j] = D[j + 1]!;
  }

  for (let mask = 1; mask < size; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;

      const cur = dp[mask * n + j]!;
      if (cur === Infinity) continue;

      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;

        const nm = mask | (1 << k);
        const c = cur + D[(j + 1) * N + (k + 1)]!;

        if (c < dp[nm * n + k]!) {
          dp[nm * n + k] = c;
          par[nm * n + k] = j;
        }
      }
    }
  }

  const full = size - 1;
  let best = 0;
  let bestCost = Infinity;

  for (let j = 0; j < n; j++) {
    if (dp[full * n + j]! < bestCost) {
      bestCost = dp[full * n + j]!;
      best = j;
    }
  }

  const order: number[] = [];
  let mask = full;
  let j = best;

  while (j !== -1) {
    order.push(j + 1);

    const pj = par[mask * n + j]!;
    mask &= ~(1 << j);
    j = pj;
  }

  // path with the start in front: [0, first, ..., last]
  return [0].concat(order.reverse());
}

/** Length of an open path. */
export function routeCost(D: Float64Array, N: number, path: number[]): number {
  let c = 0;

  for (let k = 0; k + 1 < path.length; k++) {
    c += D[path[k]! * N + path[k + 1]!]!;
  }

  return c;
}

/** Local search on an open path whose first node (the start) is fixed: 2-opt (reverse a
 * segment) and Or-opt (move a run of 1-3 nodes, optionally reversed) until no move helps.
 * Modifies and returns the given path. */
export function improveRoute(D: Float64Array, N: number, path: number[]): number[] {
  const n = path.length - 1;

  for (let guard = 0; guard < 400; guard++) {
    let changed = false;

    // 2-opt: reverse path[i..j]
    for (let i = 1; i <= n && !changed; i++) {
      for (let j = i + 1; j <= n; j++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const c = path[j]!;
        const d = j < n ? path[j + 1]! : -1;

        const delta = D[a * N + c]! + (d >= 0 ? D[b * N + d]! : 0) - D[a * N + b]! - (d >= 0 ? D[c * N + d]! : 0);

        if (delta < -1e-9) {
          const seg = path.slice(i, j + 1).reverse();

          for (let t = 0; t < seg.length; t++) {
            path[i + t] = seg[t]!;
          }

          changed = true;
          break;
        }
      }
    }

    if (changed) continue;

    // Or-opt: move a run of 1-3 cookies elsewhere (maybe reversed)
    for (let L = 1; L <= 3 && !changed; L++) {
      for (let i = 1; i + L - 1 <= n && !changed; i++) {
        const j = i + L - 1;
        const prev = path[i - 1]!;
        const first = path[i]!;
        const last = path[j]!;
        const next = j < n ? path[j + 1]! : -1;

        const removeGain = D[prev * N + first]! + (next >= 0 ? D[last * N + next]! : 0) - (next >= 0 ? D[prev * N + next]! : 0);

        let bestDelta = -1e-9;
        let bestK = -1;
        let bestRev = false;

        for (let k = 0; k <= n; k++) {
          if (k >= i - 1 && k <= j) continue;

          const a = path[k]!;
          const b = k < n ? path[k + 1]! : -1;
          const ab = b >= 0 ? D[a * N + b]! : 0;

          const fwd = D[a * N + first]! + (b >= 0 ? D[last * N + b]! : 0) - ab - removeGain;
          const rev = D[a * N + last]! + (b >= 0 ? D[first * N + b]! : 0) - ab - removeGain;

          if (fwd < bestDelta) {
            bestDelta = fwd;
            bestK = k;
            bestRev = false;
          }

          if (rev < bestDelta) {
            bestDelta = rev;
            bestK = k;
            bestRev = true;
          }
        }

        if (bestK >= 0) {
          const seg = path.slice(i, j + 1);
          if (bestRev) seg.reverse();

          const rest = path.slice(0, i).concat(path.slice(j + 1));
          const after = bestK < i ? bestK : bestK - L;
          const out = rest.slice(0, after + 1).concat(seg, rest.slice(after + 1));

          for (let t = 0; t < out.length; t++) {
            path[t] = out[t]!;
          }

          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  return path;
}

/** Route for many cookies (n > 11): nearest-neighbour tour plus (n <= 60) 8 seeded random
 * restarts, each improved by improveRoute(); the cheapest wins. Deterministic (seeded from the
 * distances) so the plan is stable. */
export function heuristicRoute(D: Float64Array, n: number): number[] {
  const N = n + 1;

  // nearest-neighbour tour as the first candidate
  const nn = [0];
  const left = new Set<number>();

  for (let i = 1; i <= n; i++) left.add(i);

  while (left.size) {
    const cur = nn[nn.length - 1]!;
    let best = -1;
    let bd = Infinity;

    for (const i of left) {
      if (D[cur * N + i]! < bd) {
        bd = D[cur * N + i]!;
        best = i;
      }
    }

    nn.push(best);
    left.delete(best);
  }

  let bestPath = improveRoute(D, N, nn.slice());
  let bestCost = routeCost(D, N, bestPath);

  // a few seeded random restarts (deterministic)
  let seed = (n * 2654435761) >>> 0;

  for (let i = 0; i < N; i++) {
    seed = (seed + Math.round(D[i]! * 7) * 40503) >>> 0;
  }

  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;

    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const restarts = n > 60 ? 0 : 8;

  for (let r = 0; r < restarts; r++) {
    const perm: number[] = [];

    for (let i = 1; i <= n; i++) perm.push(i);

    for (let i = perm.length - 1; i > 0; i--) {
      const k = Math.floor(rnd() * (i + 1));
      const tmp = perm[i]!;

      perm[i] = perm[k]!;
      perm[k] = tmp;
    }

    const cand = improveRoute(D, N, [0].concat(perm));
    const cost = routeCost(D, N, cand);

    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      bestPath = cand;
    }
  }

  return bestPath;
}

/** Visiting order with the least total travel from a start point through all points. Exact up
 * to 11 points, heuristic beyond. Never worse than nearest-first.
 * @param start the paw
 * @param pts the cookies
 * @returns indices into pts in visiting order
 */
export function planRoute(start: Point, pts: Point[]): number[] {
  const n = pts.length;

  if (n <= 1) return pts.map((_, i) => i);

  const P = [start].concat(pts);
  const N = n + 1;
  const D = new Float64Array(N * N);

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      D[i * N + j] = Math.hypot(P[i]!.x - P[j]!.x, P[i]!.y - P[j]!.y);
    }
  }

  const path = n <= 11 ? exactRoute(D, n) : heuristicRoute(D, n);

  return path.slice(1).map((i) => i - 1);
}
