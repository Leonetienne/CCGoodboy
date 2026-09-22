import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { BotStateMachine } from '../../src/core/state-machine';
import { BuffLockTracker } from '../../src/game/buffs-lock';
import { GoldenCookieModel } from '../../src/game/golden-cookie-model';
import { HurryMode } from '../../src/game/hurry-mode';
import { GoldenQueue } from '../../src/hunting/golden-queue';
import { Scheduler, type SchedulerDeps } from '../../src/scheduler/scheduler';
import { LogStore } from '../../src/stats/log';
import { FakeGameAdapter } from './fakes/fake-game-adapter';
import type { ClickBigCookieTask } from '../../src/hunting/click-big-cookie';
import type { ClickGoldenTask } from '../../src/hunting/click-golden';
import type { FthofActions } from '../../src/hunting/fthof';
import type { HappyDance } from '../../src/hunting/happy-dance';
import type { IdleBehavior } from '../../src/idle/idle-behavior';
import type { AutoPlayEngine } from '../../src/autoplay/shopping';

function makeScheduler(game: FakeGameAdapter, idleWanderImpl: () => Promise<void>) {
  const runtime = new RuntimeState();
  const data = new PersistedData();
  const log = new LogStore(data);
  const hurryMode = new HurryMode(game, data);
  const buffLock = new BuffLockTracker(game, runtime, log);
  const goldenModel = new GoldenCookieModel(game, data, hurryMode, runtime);
  const goldenQueue = new GoldenQueue(runtime);
  const stateMachine = new BotStateMachine(runtime);

  const idleBehavior = { idleWander: idleWanderImpl } as unknown as IdleBehavior;

  const deps: SchedulerDeps = {
    runtime,
    data,
    game,
    clickGolden: {} as unknown as ClickGoldenTask,
    clickBigCookie: {} as unknown as ClickBigCookieTask,
    fthof: {} as unknown as FthofActions,
    autoPlay: { shopReady: () => false } as unknown as AutoPlayEngine,
    happyDance: {} as unknown as HappyDance,
    idleBehavior,
    hammerActive: () => false,
  };

  const scheduler = new Scheduler(runtime, game, log, buffLock, goldenModel, goldenQueue, stateMachine, deps);

  return { scheduler, runtime, log };
}

describe('Scheduler.tick', () => {
  beforeEach(() => localStorage.clear());

  it('does nothing when the game is not ready', () => {
    const game = new FakeGameAdapter();
    game.ready = false;
    const { scheduler, runtime } = makeScheduler(game, vi.fn());

    scheduler.tick();
    expect(runtime.actionInProgress).toBe(false);
  });

  it('does nothing while a task is already in progress (reentrancy guard)', () => {
    const game = new FakeGameAdapter();
    const idleWander = vi.fn().mockResolvedValue(undefined);
    const { scheduler, runtime } = makeScheduler(game, idleWander);
    runtime.actionInProgress = true;

    scheduler.tick();
    expect(idleWander).not.toHaveBeenCalled();
  });

  it('runs the selected task and resets to idle once it settles', async () => {
    const game = new FakeGameAdapter();
    const idleWander = vi.fn().mockResolvedValue(undefined);
    const { scheduler, runtime } = makeScheduler(game, idleWander);

    scheduler.tick();
    expect(runtime.actionInProgress).toBe(true);

    await vi.waitFor(() => expect(runtime.actionInProgress).toBe(false));

    expect(idleWander).toHaveBeenCalledOnce();
    expect(runtime.idleStay).toBe(false); // idle-wander itself never sets idleStay
    expect(runtime.currentAction).toBe('idle');
    expect(runtime.currentTarget).toBe('none');
  });

  it('sets idleStay after a non-idle task, logs an error, and keeps running when a task throws', async () => {
    const game = new FakeGameAdapter();
    game.buffNames.add('Click frenzy');

    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now(); // due now, so click-frenzy gets picked

    const data = new PersistedData();
    const log = new LogStore(data);
    const hurryMode = new HurryMode(game, data);
    const buffLock = new BuffLockTracker(game, runtime, log);
    const goldenModel = new GoldenCookieModel(game, data, hurryMode, runtime);
    const goldenQueue = new GoldenQueue(runtime);
    const stateMachine = new BotStateMachine(runtime);

    const failingClickBigCookie = { run: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as ClickBigCookieTask;

    const loggedEntries: string[] = [];
    log.onLog((e) => loggedEntries.push(e.action));

    const deps: SchedulerDeps = {
      runtime,
      data,
      game,
      clickGolden: {} as unknown as ClickGoldenTask,
      clickBigCookie: failingClickBigCookie,
      fthof: {} as unknown as FthofActions,
      autoPlay: { shopReady: () => false } as unknown as AutoPlayEngine,
      happyDance: {} as unknown as HappyDance,
      idleBehavior: {} as unknown as IdleBehavior,
      hammerActive: () => false,
    };

    const scheduler = new Scheduler(runtime, game, log, buffLock, goldenModel, goldenQueue, stateMachine, deps);

    scheduler.tick();
    await vi.waitFor(() => expect(runtime.actionInProgress).toBe(false));

    expect(loggedEntries).toContain('error');
    expect(runtime.idleStay).toBe(true); // click-frenzy is not idle-wander, so it settles here
    expect(runtime.running).toBe(true); // a throwing task never stops the bot
  });
});
