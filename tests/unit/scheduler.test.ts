import type { AscensionRunner } from '../../src/autoplay/ascension-runner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { BotStateMachine } from '../../src/core/state-machine';
import { BuffLockTracker } from '../../src/game/buffs-lock';
import { GoldenCookieModel } from '../../src/game/golden-cookie-model';
import { HurryMode } from '../../src/game/hurry-mode';
import { GoldenQueue } from '../../src/hunting/golden-queue';
import type { ClickBigCookieTask } from '../../src/hunting/click-big-cookie';
import type { ClickGoldenTask } from '../../src/hunting/click-golden';
import type { FthofActions } from '../../src/hunting/fthof';
import type { HappyDance } from '../../src/hunting/happy-dance';
import type { LumpHarvestActions } from '../../src/hunting/lump-harvest';
import type { IdleBehavior } from '../../src/idle/idle-behavior';
import type { GrimoireUnlocker } from '../../src/autoplay/grimoire-unlock';
import type { GrimoireView } from '../../src/hunting/grimoire-view';
import type { AutoPlayEngine } from '../../src/autoplay/shopping';
import type { WrinklerPopper } from '../../src/autoplay/wrinkler-popper';
import type { KrumblorTrainer } from '../../src/autoplay/krumblor';
import type { SantaTrainer } from '../../src/autoplay/santa';
import { JOB_PRIORITY, type CursorAction, type CursorJob, type EnqueueOpts } from '../../src/cursor/types';
import { Scheduler, type SchedulerDeps } from '../../src/scheduler/scheduler';
import { LogStore } from '../../src/stats/log';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

class FakeCursorManager {
  enqueued: Array<{ action: CursorAction; opts: EnqueueOpts }> = [];

  enqueue(action: CursorAction, opts: EnqueueOpts = {}): CursorJob {
    this.enqueued.push({ action, opts });
    return { id: 1, action, priority: opts.priority ?? JOB_PRIORITY.IDLE, label: action.label, key: opts.key, dueAt: opts.dueAt ?? 0, state: 'queued', done: Promise.resolve('done') };
  }
}

function makeScheduler(game: FakeGameAdapter, overrides: Partial<SchedulerDeps> = {}) {
  const runtime = overrides.runtime ?? new RuntimeState();
  const data = overrides.data ?? new PersistedData();
  const log = new LogStore(data);
  const hurryMode = new HurryMode(game, data);
  const buffLock = new BuffLockTracker(game, runtime, log);
  const goldenModel = new GoldenCookieModel(game, data, hurryMode, runtime);
  const goldenQueue = new GoldenQueue(runtime);
  const stateMachine = new BotStateMachine(runtime);
  const cursorManager = new FakeCursorManager();

  const deps: SchedulerDeps = {
    runtime,
    data,
    game,
    clickGolden: {
      jobFor: vi.fn().mockReturnValue({ action: { label: 'golden' }, priority: JOB_PRIORITY.GOLDEN, key: 'golden:1' }),
    } as unknown as ClickGoldenTask,
    clickBigCookie: {
      job: vi.fn().mockReturnValue({ action: { label: 'hammer' }, priority: JOB_PRIORITY.HAMMER, key: 'hammer' }),
    } as unknown as ClickBigCookieTask,
    fthof: {
      castJob: vi.fn().mockReturnValue({ action: { label: 'fthof' }, priority: JOB_PRIORITY.FTHOF, key: 'fthof' }),
      reportBlockers: vi.fn(),
      refillJob: vi.fn().mockReturnValue({ action: { label: 'refill' }, priority: JOB_PRIORITY.REFILL, key: 'refill' }),
    } as unknown as FthofActions,
    lumpHarvest: {
      pending: () => false,
      harvestJob: vi.fn().mockReturnValue({ action: { label: 'lump-harvest' }, priority: JOB_PRIORITY.LUMP_HARVEST, key: 'lump-harvest' }),
    } as unknown as LumpHarvestActions,
    grimoireView: { pending: () => false } as unknown as GrimoireView,
    grimoireUnlock: { pending: () => false } as unknown as GrimoireUnlocker,
    krumblor: { pending: () => false } as unknown as KrumblorTrainer,
    santa: { pending: () => false } as unknown as SantaTrainer,
    ascension: { pending: () => false } as unknown as AscensionRunner,
    autoPlay: { shopReady: () => false } as unknown as AutoPlayEngine,
    wrinklerPopper: { pending: () => false } as unknown as WrinklerPopper,
    happyDance: {
      job: vi.fn().mockReturnValue({ action: { label: 'dance' }, priority: JOB_PRIORITY.HAPPY_DANCE, key: 'happy-dance' }),
    } as unknown as HappyDance,
    idleBehavior: {
      idleJob: vi.fn().mockReturnValue({ action: { label: 'idle' }, priority: JOB_PRIORITY.IDLE, key: 'idle-wander' }),
    } as unknown as IdleBehavior,
    hammerActive: () => false,
    ...overrides,
  };

  const scheduler = new Scheduler(runtime, game, log, buffLock, goldenModel, goldenQueue, stateMachine, cursorManager as never, deps);

  return { scheduler, runtime, cursorManager };
}

describe('Scheduler.tick', () => {
  beforeEach(() => localStorage.clear());

  it('does nothing when the game is not ready', () => {
    const game = new FakeGameAdapter();
    game.ready = false;
    const { scheduler, cursorManager } = makeScheduler(game);

    scheduler.tick();
    expect(cursorManager.enqueued).toHaveLength(0);
  });

  it('enqueues the selected job (idle wander by default)', () => {
    const game = new FakeGameAdapter();
    const runtime = new RuntimeState();
    runtime.nextIdleAt = Date.now() - 1;

    const { scheduler, cursorManager } = makeScheduler(game, { runtime });

    scheduler.tick();

    expect(cursorManager.enqueued).toHaveLength(1);
    expect(cursorManager.enqueued[0]!.opts.key).toBe('idle-wander');
    expect(cursorManager.enqueued[0]!.opts.priority).toBe(JOB_PRIORITY.IDLE);
  });

  it('clears danceQueued when the selected job is not the happy dance', () => {
    const game = new FakeGameAdapter();
    const runtime = new RuntimeState();
    runtime.danceQueued = true;
    runtime.nextBigClickAt = Date.now() - 1;

    const { scheduler } = makeScheduler(game, { runtime, hammerActive: () => true });

    scheduler.tick();
    expect(runtime.danceQueued).toBe(false);
  });

  it('keeps danceQueued when the happy dance itself is selected', () => {
    const game = new FakeGameAdapter();
    const runtime = new RuntimeState();
    runtime.danceQueued = true;

    const data = new PersistedData();
    data.config.idleWander = false;

    const { scheduler, cursorManager } = makeScheduler(game, { runtime, data });

    scheduler.tick();

    expect(runtime.danceQueued).toBe(true);
    expect(cursorManager.enqueued[0]!.opts.key).toBe('happy-dance');
  });
});
