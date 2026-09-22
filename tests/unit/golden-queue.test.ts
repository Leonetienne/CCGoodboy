import { describe, expect, it } from 'vitest';
import { RuntimeState } from '../../src/core/runtime-state';
import { GoldenQueue } from '../../src/hunting/golden-queue';
import type { GameShimmer } from '../../src/game/types';

function shimmerAt(id: number, x: number, y: number): GameShimmer {
  const el = document.createElement('div');
  el.style.opacity = '1'; // jsdom's default computed opacity is '', which visibleRect() would treat as hidden
  document.body.appendChild(el);
  el.getBoundingClientRect = () => ({ left: x, top: y, right: x + 20, bottom: y + 20, width: 20, height: 20 }) as DOMRect;

  return { id, type: 'golden', wrath: 0, l: el };
}

describe('GoldenQueue', () => {
  it('returns items unchanged for 0 or 1 cookies (no route planning needed)', () => {
    const runtime = new RuntimeState();
    const queue = new GoldenQueue(runtime);

    expect(queue.build([])).toEqual([]);

    const one = shimmerAt(1, 100, 100);
    const result = queue.build([one]);
    expect(result).toHaveLength(1);
    expect(result[0]!.shimmer.id).toBe(1);
  });

  it('orders multiple cookies by least-travel from the cursor', () => {
    const runtime = new RuntimeState();
    runtime.cursor = { x: 0, y: 0 };
    const queue = new GoldenQueue(runtime);

    const near = shimmerAt(1, 10, 0);
    const far = shimmerAt(2, 200, 0);

    const result = queue.build([far, near]);
    expect(result.map((it) => it.shimmer.id)).toEqual([1, 2]);
  });

  it('caches the plan and reuses it for the same cookie set/position', () => {
    const runtime = new RuntimeState();
    runtime.cursor = { x: 0, y: 0 };
    const queue = new GoldenQueue(runtime);

    const a = shimmerAt(1, 10, 0);
    const b = shimmerAt(2, 200, 0);

    queue.build([a, b]);
    const cachedRoute = runtime.route;

    queue.build([a, b]);
    expect(runtime.route).toBe(cachedRoute); // same object: not recomputed
  });

  it('recomputes when the cursor moves more than 80px from where the plan was made', () => {
    const runtime = new RuntimeState();
    runtime.cursor = { x: 0, y: 0 };
    const queue = new GoldenQueue(runtime);

    const a = shimmerAt(1, 10, 0);
    const b = shimmerAt(2, 200, 0);

    queue.build([a, b]);
    const cachedRoute = runtime.route;

    runtime.cursor = { x: 500, y: 500 }; // > 80px away
    queue.build([a, b]);

    expect(runtime.route).not.toBe(cachedRoute);
  });

  it('recomputes when the cookie set changes', () => {
    const runtime = new RuntimeState();
    runtime.cursor = { x: 0, y: 0 };
    const queue = new GoldenQueue(runtime);

    const a = shimmerAt(1, 10, 0);
    const b = shimmerAt(2, 200, 0);
    const c = shimmerAt(3, 300, 0);

    queue.build([a, b]);
    const cachedRoute = runtime.route;

    queue.build([a, c]);
    expect(runtime.route).not.toBe(cachedRoute);
  });
});
