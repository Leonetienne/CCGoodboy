import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { GoldenCookieModel } from '../../src/game/golden-cookie-model';
import { HurryMode } from '../../src/game/hurry-mode';
import type { GameShimmer } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

// shimmer.life is a countdown of frames REMAINING until despawn (full at spawn, 0 at despawn),
// per Cookie Clicker's own convention. fps*dur is the full lifespan in frames.

function makeModel(game: FakeGameAdapter, data: PersistedData) {
  const runtime = new RuntimeState();
  const hurryMode = new HurryMode(game, data);
  const model = new GoldenCookieModel(game, data, hurryMode, runtime);
  return { model, runtime };
}

describe('GoldenCookieModel.goldenVisibility', () => {
  let game: FakeGameAdapter;
  let data: PersistedData;
  const fps = 30;
  const dur = 15;
  const lifespan = fps * dur;

  beforeEach(() => {
    localStorage.clear();
    game = new FakeGameAdapter();
    game.fps = fps;
    data = new PersistedData();
  });

  it('is curve 0 and not ready at the moment of spawn (full life remaining)', () => {
    const { model } = makeModel(game, data);
    const vis = model.goldenVisibility({ life: lifespan, dur } as GameShimmer);

    expect(vis.curve).toBeCloseTo(0, 5);
    expect(vis.progress).toBeCloseTo(0, 5);
    expect(vis.ready).toBe(false);
  });

  it('peaks (curve 1) at mid life and is ready', () => {
    const { model } = makeModel(game, data);
    const vis = model.goldenVisibility({ life: lifespan / 2, dur } as GameShimmer);

    expect(vis.curve).toBeCloseTo(1, 5);
    expect(vis.progress).toBeCloseTo(0.5, 5);
    expect(vis.ready).toBe(true);
  });

  it('stays ready near despawn even though the curve has faded back down (GC-3)', () => {
    const { model } = makeModel(game, data);
    // Only 5% of its life remains: well past the peak, curve has decayed below the
    // default 0.55 threshold, but the past-peak rule keeps it ready.
    const vis = model.goldenVisibility({ life: lifespan * 0.05, dur } as GameShimmer);

    expect(vis.progress).toBeGreaterThanOrEqual(0.5);
    expect(vis.curve).toBeLessThan(0.55);
    expect(vis.ready).toBe(true);
  });

  it('is not ready while still early in its fade-in, before the threshold and before the peak', () => {
    const { model } = makeModel(game, data);
    // 99% of its life remains: barely spawned, curve is still far below threshold.
    const vis = model.goldenVisibility({ life: lifespan * 0.99, dur } as GameShimmer);

    expect(vis.progress).toBeLessThan(0.5);
    expect(vis.curve).toBeLessThan(0.55);
    expect(vis.ready).toBe(false);
  });

  it('treats missing/invalid life-dur data as "unknown, always ready"', () => {
    const { model } = makeModel(game, data);
    expect(model.goldenVisibility({ life: undefined, dur: undefined } as GameShimmer)).toEqual({
      curve: 1,
      progress: 0.5,
      ready: true,
    });
    expect(model.goldenVisibility({ life: 5, dur: 0 } as GameShimmer).ready).toBe(true);
  });

  it('treats fps 0 (Game not ready) as "unknown, always ready"', () => {
    game.fps = 0;
    const { model } = makeModel(game, data);
    expect(model.goldenVisibility({ life: 5, dur: 15 } as GameShimmer).ready).toBe(true);
  });
});

describe('GoldenCookieModel.getGoldenShimmers', () => {
  let game: FakeGameAdapter;
  let data: PersistedData;
  const fps = 30;
  const dur = 15;
  const lifespan = fps * dur;

  beforeEach(() => {
    localStorage.clear();
    game = new FakeGameAdapter();
    game.fps = fps;
    data = new PersistedData();
  });

  function connectedEl(): Element {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }

  it('separates good, pending and wrath cookies, and skips popped/disconnected ones', () => {
    const { model } = makeModel(game, data);

    const good: GameShimmer = { id: 1, type: 'golden', wrath: 0, life: lifespan / 2, dur, l: connectedEl() };
    const pending: GameShimmer = { id: 2, type: 'golden', wrath: 0, life: lifespan * 0.99, dur, l: connectedEl() };
    const wrath: GameShimmer = { id: 3, type: 'golden', wrath: 1, life: lifespan / 2, dur, l: connectedEl() };
    const popped: GameShimmer = { id: 4, type: 'golden', popped: true, l: connectedEl() };
    const disconnected: GameShimmer = { id: 5, type: 'golden', l: document.createElement('div') };

    game.shimmers = [good, pending, wrath, popped, disconnected];

    const result = model.getGoldenShimmers();

    expect(result.good.map((s) => s.id)).toEqual([1]);
    expect(result.wrath.map((s) => s.id)).toEqual([3]);
    expect(result.pending.map((p) => p.shimmer.id)).toEqual([2]);
  });

  it('remembers when a good cookie first became ready and forgets it once gone', () => {
    const { model, runtime } = makeModel(game, data);
    const el = connectedEl();
    const shimmer: GameShimmer = { id: 42, type: 'golden', wrath: 0, life: lifespan / 2, dur, l: el };
    game.shimmers = [shimmer];

    model.getGoldenShimmers();
    expect(runtime.goldenReadyAt.has(42)).toBe(true);

    game.shimmers = [];
    model.getGoldenShimmers();
    expect(runtime.goldenReadyAt.has(42)).toBe(false);
  });

  it('returns empty sets and leaves goldenReadyAt untouched when Game is not present', () => {
    const { model, runtime } = makeModel(game, data);
    runtime.goldenReadyAt.set(99, 123);
    game.present = false;

    const result = model.getGoldenShimmers();

    expect(result).toEqual({ good: [], wrath: [], pending: [] });
    expect(runtime.goldenReadyAt.has(99)).toBe(true);
  });
});
