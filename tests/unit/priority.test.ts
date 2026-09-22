import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { ClickBigCookieTask } from '../../src/hunting/click-big-cookie';
import type { ClickGoldenTask } from '../../src/hunting/click-golden';
import type { FthofActions } from '../../src/hunting/fthof';
import type { GoldenQueueItem } from '../../src/hunting/golden-queue';
import type { HappyDance } from '../../src/hunting/happy-dance';
import type { IdleBehavior } from '../../src/idle/idle-behavior';
import { selectTask, type PriorityDeps } from '../../src/scheduler/priority';
import type { GameShimmer } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';
import type { AutoPlayEngine } from '../../src/autoplay/shopping';

function makeDeps(overrides: Partial<PriorityDeps> = {}): PriorityDeps {
  const runtime = overrides.runtime ?? new RuntimeState();
  const data = overrides.data ?? new PersistedData();
  const game = overrides.game ?? new FakeGameAdapter();

  const clickGolden = { run: vi.fn().mockResolvedValue(undefined) } as unknown as ClickGoldenTask;
  const clickBigCookie = { run: vi.fn().mockResolvedValue(undefined) } as unknown as ClickBigCookieTask;
  const fthof = {
    castFthof: vi.fn().mockResolvedValue(undefined),
    refillGrimoire: vi.fn().mockResolvedValue(undefined),
  } as unknown as FthofActions;
  const autoPlay = { shopReady: () => false, shop: vi.fn().mockResolvedValue(undefined) } as unknown as AutoPlayEngine;
  const happyDance = { run: vi.fn().mockResolvedValue(true) } as unknown as HappyDance;
  const idleBehavior = { idleWander: vi.fn().mockResolvedValue(undefined) } as unknown as IdleBehavior;

  return {
    queue: [],
    buffs: [],
    runtime,
    data,
    game,
    clickGolden,
    clickBigCookie,
    fthof,
    autoPlay,
    happyDance,
    idleBehavior,
    hammerActive: () => false,
    ...overrides,
  };
}

function goldenItem(id: number): GoldenQueueItem {
  return { shimmer: { id, type: 'golden', l: null } as GameShimmer, pos: { x: 0, y: 0, rect: {} as DOMRect } };
}

describe('selectTask', () => {
  beforeEach(() => localStorage.clear());

  it('picks a ready golden cookie above everything else', () => {
    const deps = makeDeps({ queue: [goldenItem(7)] });
    const task = selectTask(deps);

    expect(task?.name).toBe('golden');
  });

  it('picks click-frenzy when Click Frenzy is active and the lead time has arrived', () => {
    const game = new FakeGameAdapter();
    game.buffNames.add('Click frenzy');
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now(); // already due

    const task = selectTask(makeDeps({ game, runtime }));
    expect(task?.name).toBe('click-frenzy');
  });

  it('picks nothing during Click Frenzy before the lead time, even though FTHOF looks skippable', () => {
    const game = new FakeGameAdapter();
    game.buffNames.add('Click frenzy');
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now() + 100000; // far in the future

    const task = selectTask(makeDeps({ game, runtime }));
    expect(task).toBeNull();
  });

  it('picks fthof when a Grimoire has enough magic and an outlasting buff', () => {
    const game = new FakeGameAdapter();
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 50, magic: 100 };
    game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 } };

    // selectTask takes `buffs` as an explicit dependency (the scheduler computes it once per
    // tick via BuffLockTracker); mirror that here from the fake adapter's own buff list.
    const task = selectTask(makeDeps({ game, buffs: game.positiveCpsBuffs() }));
    expect(task?.name).toBe('fthof');
  });

  it('picks refill when mana is short, LOCK_A is open and no refill is in flight', () => {
    const game = new FakeGameAdapter();
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 100, magic: 10 };
    game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 }, b: { name: 'Buff2', multCpS: 2, time: 3000 } };

    const task = selectTask(makeDeps({ game, buffs: game.positiveCpsBuffs() }));
    expect(task?.name).toBe('refill');
  });

  it('falls back to auto-shop when nothing else is due', () => {
    const autoPlay = { shopReady: () => true, shop: vi.fn() } as unknown as AutoPlayEngine;
    const task = selectTask(makeDeps({ autoPlay }));
    expect(task?.name).toBe('auto-shop');
  });

  it('falls back to hammer mode when active and due', () => {
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now();
    const task = selectTask(makeDeps({ runtime, hammerActive: () => true }));
    expect(task?.name).toBe('hammer');
  });

  it('falls back to a queued happy dance', () => {
    const runtime = new RuntimeState();
    runtime.danceQueued = true;
    const task = selectTask(makeDeps({ runtime }));
    expect(task?.name).toBe('happy-dance');
  });

  it('falls back to idle wander when nothing else is due and idle is allowed', () => {
    const task = selectTask(makeDeps());
    expect(task?.name).toBe('idle-wander');
  });

  it('picks nothing when idle wander is disabled and nothing else is due', () => {
    const data = new PersistedData();
    data.config.idleWander = false;
    const task = selectTask(makeDeps({ data }));
    expect(task).toBeNull();
  });
});
