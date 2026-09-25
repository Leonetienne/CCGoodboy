import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anyGoldenPresent } from '../../src/actions/dance';
import { GoldenCookieAction } from '../../src/actions/golden-cookie';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { GoldenCookieModel } from '../../src/game/golden-cookie-model';
import { REINDEER_BOUNCE_PX, reindeerCenterAhead, reindeerIntercept, type ReindeerMotion } from '../../src/game/reindeer';
import { HurryMode } from '../../src/game/hurry-mode';
import type { GameShimmer } from '../../src/game/types';
import { chartColor, CHART_PALETTE } from '../../src/ui/stats-window/chart-engine';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function shimmer(overrides: Partial<GameShimmer> = {}): GameShimmer {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return { id: 1, type: 'reindeer', popped: false, l: el, ...overrides };
}

function model(game: FakeGameAdapter) {
  const data = new PersistedData();
  const runtime = new RuntimeState();
  return { model: new GoldenCookieModel(game, data, new HurryMode(game, data), runtime), runtime };
}

describe('reindeer (XMAS-6)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('counts a visible reindeer as a good shimmer to catch, and other shimmer types not', () => {
    const game = new FakeGameAdapter();
    game.fps = 30;
    // 4s reindeer, a quarter into its run
    game.shimmers = [shimmer({ id: 7, life: 90, dur: 4 }), shimmer({ id: 8, type: 'other' })];

    const { model: m, runtime } = model(game);
    const r = m.getGoldenShimmers();

    expect(r.good.map((s) => s.id)).toEqual([7]);
    expect(r.wrath).toEqual([]);
    expect(runtime.goldenReadyAt.has(7)).toBe(true);
    expect(anyGoldenPresent(game)).toBe(true);
  });

  it("follows the reindeer's own fade curve (power 12), which is visible almost at once", () => {
    const game = new FakeGameAdapter();
    game.fps = 30;
    const { model: m } = model(game);

    // 5% into its run: a golden cookie (power 4) is still faint, a reindeer is not
    const golden = m.goldenVisibility({ id: 1, type: 'golden', life: 114, dur: 4, l: null });
    const reindeer = m.goldenVisibility({ id: 2, type: 'reindeer', life: 114, dur: 4, l: null });

    expect(golden.ready).toBe(false);
    expect(reindeer.curve).toBeCloseTo(1 - Math.pow(0.9, 12));
    expect(reindeer.ready).toBe(true);
  });

  it('records, logs and brags about a caught reindeer', async () => {
    const runtime = new RuntimeState();
    const game = new FakeGameAdapter();
    const stats = { recordGolden: vi.fn() };
    const log = { log: vi.fn() };
    const s = shimmer();
    const action = new GoldenCookieAction(runtime, game, stats as never, log as never, () => true, s);

    expect(action.label).toBe('click reindeer');
    expect(action.hud.target).toBe('a reindeer');

    const humanClick = vi.fn(async () => {
      s.popped = true;
    });
    await action.cursor_at_position({ runtime, clickTiming: { humanClick } } as never);

    expect(humanClick).toHaveBeenCalledWith(s.l, expect.any(Number), expect.any(Number));
    expect(stats.recordGolden).toHaveBeenCalledWith('Reindeer');
    expect(log.log).toHaveBeenCalledWith('click reindeer', 'reindeer', { shimmerId: 1 });
    expect(runtime.danceQueued).toBe(true);
  });

  it('records nothing when the reindeer got away', async () => {
    const runtime = new RuntimeState();
    const stats = { recordGolden: vi.fn() };
    const action = new GoldenCookieAction(runtime, new FakeGameAdapter(), stats as never, { log: vi.fn() } as never, () => true, shimmer());

    await action.cursor_at_position({ runtime, clickTiming: { humanClick: vi.fn() } } as never);

    expect(stats.recordGolden).not.toHaveBeenCalled();
    expect(runtime.danceQueued).toBe(false);
  });

  it('gives the Reindeer series its own chart colour', () => {
    expect(chartColor('Reindeer')).toBe(CHART_PALETTE[12]);
  });
});

describe('reindeer motion (XMAS-6)', () => {
  // 4s run across a 1200px field at 30 fps: 300 px/s
  const m: ReindeerMotion = { life: 59, dur: 4, fps: 30, fieldWidth: 1200 };

  it('runs left to right at fieldWidth / dur and bounces like the game draws it', () => {
    const p = reindeerCenterAhead({ x: 100, y: 500 }, m, 1000)!;
    expect(p.x).toBeCloseTo(400);
    // drawn at life 60, a second later at life 30
    expect(p.y).toBeCloseTo(500 + REINDEER_BOUNCE_PX * (Math.abs(Math.sin(6)) - Math.abs(Math.sin(3))));
    expect(reindeerCenterAhead({ x: 100, y: 500 }, m, 0)).toEqual({ x: 100, y: 500 });
  });

  it('is gone once its life runs out', () => {
    expect(reindeerCenterAhead({ x: 100, y: 500 }, m, 1990)).toBeNull();
    expect(reindeerCenterAhead({ x: 100, y: 500 }, { ...m, dur: NaN }, 100)).toBeNull();
  });

  it('meets the reindeer where it will be when the paw gets there and clicks', () => {
    const travel = (d: number) => d; // 1 px per ms
    const run = { ...m, life: 90 };
    const r = reindeerIntercept({ x: 400, y: 500 }, { x: 100, y: 500 }, run, travel, 100)!;

    // the reindeer covers 0.3 px per ms; the paw needs (dist) ms + 100ms of pause
    const at = reindeerCenterAhead({ x: 100, y: 500 }, run, r.inMs)!;
    expect(r.point.x).toBeCloseTo(at.x);
    expect(r.inMs).toBeCloseTo(travel(Math.hypot(at.x - 400, at.y - 500)) + 100, 0);
    expect(r.point.x).toBeGreaterThan(100 + 0.3 * 100); // well ahead of where it is now
  });
});

describe('GoldenCookieAction leads a reindeer (XMAS-6)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  function running(game: FakeGameAdapter) {
    game.fps = 30;
    game.shimmerFieldWidth = 1200;
    const s = shimmer({ life: 90, dur: 4 });
    (s.l as HTMLElement).style.opacity = '1';
    let left = 100;
    s.l!.getBoundingClientRect = () => ({ left, top: 400, width: 160, height: 200, right: left + 160, bottom: 600, x: left, y: 400, toJSON: () => ({}) }) as DOMRect;
    return { s, move: (dx: number) => (left += dx) };
  }

  function ctx(runtime: RuntimeState) {
    const data = new PersistedData();
    data.config.cursorSpeedPxPerSec = 4000;
    return {
      runtime,
      data,
      hurry: { urgencyFactor: () => 1 },
      clickTiming: { getClickDelayMs: () => 0, getPreClickDelayMs: () => 100, waitUntil: async () => true },
    } as never;
  }

  it('aims ahead of the running reindeer, not at where it is now', async () => {
    const runtime = new RuntimeState();
    runtime.cursor = { x: 700, y: 300 };
    const game = new FakeGameAdapter();
    const { s } = running(game);
    const action = new GoldenCookieAction(runtime, game, null as never, null as never, () => false, s);

    await action.beforeMove!(ctx(runtime));
    const aim = action.target()!;

    // now at x 180 (centre); 300 px/s for at least the 100ms pause + press
    expect(aim.x).toBeGreaterThan(180 + 300 * 0.115);
    expect(aim.x).toBeLessThan(180 + 300 * 0.6);
  });

  it('gives up on a reindeer that leaves the screen before the paw gets there', async () => {
    const runtime = new RuntimeState();
    const game = new FakeGameAdapter();
    const { s, move } = running(game);
    move(window.innerWidth - 200);
    const action = new GoldenCookieAction(runtime, game, null as never, null as never, () => false, s);

    await action.beforeMove!(ctx(runtime));
    expect(action.target()).toBeNull();
  });
});
