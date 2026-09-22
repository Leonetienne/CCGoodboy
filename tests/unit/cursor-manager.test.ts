import { beforeEach, describe, expect, it } from 'vitest';
import { ClickElementAction, MoveAction, VisualPressAction } from '../../src/actions/click-element';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { CursorManager } from '../../src/cursor/cursor-manager';
import { JOB_PRIORITY, type CursorAction, type CursorClickTiming, type CursorJobContext, type CursorMover } from '../../src/cursor/types';
import { HurryMode } from '../../src/game/hurry-mode';
import { BackgroundClock } from '../../src/input/background-clock';
import type { MoveCursorOpts } from '../../src/input/cursor-controller';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

class FakeMover implements CursorMover {
  calls: Array<{ x: number; y: number; abortForGolden: boolean; speed?: number; maxMs?: number }> = [];
  moveResult = true;
  onMove?: () => void;

  constructor(private readonly runtime: RuntimeState) {}

  setPosition(x: number, y: number): void {
    this.runtime.cursor.x = x;
    this.runtime.cursor.y = y;
  }

  async moveCursorTo(x: number, y: number, abortForGolden: boolean, opts?: MoveCursorOpts): Promise<boolean> {
    this.calls.push({ x, y, abortForGolden, speed: opts?.speed, maxMs: opts?.maxMs });
    this.onMove?.();
    this.runtime.cursor.x = x;
    this.runtime.cursor.y = y;
    return this.moveResult;
  }

  async glideCursor(x: number, y: number, _ms: number, _abortIf?: () => boolean): Promise<boolean> {
    this.runtime.cursor.x = x;
    this.runtime.cursor.y = y;
    return true;
  }
}

class FakeTiming implements CursorClickTiming {
  gapCalls = 0;
  preCalls = 0;
  humanCalls = 0;
  waitUntilCalls = 0;
  delayMs = 200;
  gapResult = true;
  preResult = true;
  waitUntilResult = true;
  gapAbortForGolden: boolean | undefined;
  preAbortForGolden: boolean | undefined;
  lastHuman: { el: Element | null; x: number; y: number; holdMs?: number } | null = null;
  onGap?: () => void;
  onPre?: () => void;

  getClickDelayMs(): number {
    return this.delayMs;
  }

  async waitUntil(_ts: number, _abortForGolden?: boolean, _abortIf?: () => boolean): Promise<boolean> {
    this.waitUntilCalls++;
    return this.waitUntilResult;
  }

  async waitForClickGap(abortForGolden?: boolean, _abortIf?: () => boolean): Promise<boolean> {
    this.gapCalls++;
    this.gapAbortForGolden = abortForGolden;
    this.onGap?.();
    return this.gapResult;
  }

  async waitPreClick(abortForGolden?: boolean, _abortIf?: () => boolean): Promise<boolean> {
    this.preCalls++;
    this.preAbortForGolden = abortForGolden;
    this.onPre?.();
    return this.preResult;
  }

  async humanClick(el: Element | null, x: number, y: number, holdMs?: number): Promise<boolean> {
    this.humanCalls++;
    this.lastHuman = { el, x, y, holdMs };
    return true;
  }
}

interface Harness {
  manager: CursorManager;
  runtime: RuntimeState;
  mover: FakeMover;
  timing: FakeTiming;
  clock: BackgroundClock;
  game: FakeGameAdapter;
  data: PersistedData;
}

function makeHarness(): Harness {
  const runtime = new RuntimeState();
  const data = new PersistedData();
  const game = new FakeGameAdapter();
  const hurry = new HurryMode(game, data);
  const clock = new BackgroundClock();
  const mover = new FakeMover(runtime);
  const timing = new FakeTiming();
  const manager = new CursorManager(runtime, data, game, hurry, clock, mover, timing);

  return { manager, runtime, mover, timing, clock, game, data };
}

function plainAction(label: string, fn?: (ctx: CursorJobContext) => void, opts: Partial<CursorAction> = {}): CursorAction {
  return {
    label,
    target: null,
    cursor_at_position: () => {
      fn?.({} as never);
    },
    ...opts,
  };
}

describe('CursorManager queue', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('runs jobs ordered by priority (lower first)', async () => {
    const { manager } = makeHarness();
    const seen: string[] = [];

    manager.enqueue(plainAction('low', () => seen.push('low')), { priority: JOB_PRIORITY.IDLE });
    manager.enqueue(plainAction('mid', () => seen.push('mid')), { priority: JOB_PRIORITY.AUTO_SHOP });
    manager.enqueue(plainAction('high', () => seen.push('high')), { priority: JOB_PRIORITY.GOLDEN });

    await manager.waitUntilIdle();

    expect(seen).toEqual(['high', 'mid', 'low']);
  });

  it('deduplicates jobs by key and returns the existing job', async () => {
    const { manager } = makeHarness();
    const seen: string[] = [];

    const first = manager.enqueue(plainAction('a', () => seen.push('a')), { key: 'k', priority: 1 });
    const second = manager.enqueue(plainAction('b', () => seen.push('b')), { key: 'k', priority: 0 });

    expect(second).toBe(first);

    await manager.waitUntilIdle();

    expect(seen).toEqual(['a']);
    expect(first.state).toBe('done');
  });

  it('waits until dueAt before running a job', async () => {
    const { manager } = makeHarness();
    const seen: string[] = [];
    const startedAt = Date.now();

    manager.enqueue(plainAction('later', () => seen.push('later')), { priority: 1, dueAt: Date.now() + 30 });

    await manager.waitUntilIdle();

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(25);
    expect(seen).toEqual(['later']);
  });

  it('cancels a queued job before it runs', async () => {
    const { manager } = makeHarness();
    const seen: string[] = [];

    const job = manager.enqueue(plainAction('never', () => seen.push('never')), { priority: 1 });
    manager.cancel(job.id);

    await manager.waitUntilIdle();

    expect(seen).toEqual([]);
    expect(job.state).toBe('cancelled');
    expect(manager.isIdle()).toBe(true);
  });

  it('preempts a running lower-priority job when a higher one is enqueued', async () => {
    const { manager, clock } = makeHarness();
    let sawAbort = false;

    const low: CursorAction = {
      label: 'low',
      target: null,
      waitClickGap: false,
      preClickPause: false,
      async cursor_at_position(ctx) {
        for (let i = 0; i < 200; i++) {
          if (ctx.abortRequested()) break;
          await ctx.clock.sleep(1);
        }
        sawAbort = ctx.abortRequested();
      },
    };

    const highSeen: string[] = [];
    const lowJob = manager.enqueue(low, { priority: JOB_PRIORITY.IDLE });
    await clock.sleep(5);

    manager.enqueue(plainAction('high', () => highSeen.push('high')), { priority: JOB_PRIORITY.GOLDEN });

    await manager.waitUntilIdle();

    expect(sawAbort).toBe(true);
    expect(lowJob.state).toBe('cancelled');
    expect(highSeen).toEqual(['high']);
  });

  it('reports pending state through hasPendingJobs/isIdle', async () => {
    const { manager } = makeHarness();

    expect(manager.isIdle()).toBe(true);

    const job = manager.enqueue(plainAction('x'), { priority: 1 });

    expect(manager.hasPendingJobs()).toBe(true);
    expect(manager.isIdle()).toBe(false);

    await manager.waitUntilIdle();

    expect(manager.hasPendingJobs()).toBe(false);
    expect(manager.isIdle()).toBe(true);
    expect(job.state).toBe('done');
  });
});

describe('CursorManager execution pipeline', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('applies click gap, travel, pre-click pause, then calls cursor_at_position', async () => {
    const { manager, mover, timing } = makeHarness();
    const events: string[] = [];

    timing.onGap = () => events.push('gap');
    mover.onMove = () => events.push('move');
    timing.onPre = () => events.push('pre');

    const action = plainAction('click', () => events.push('click'), {
      target: { x: 40, y: 60 },
      moveSpeed: 1234,
    });

    manager.enqueue(action, { priority: 1 });
    await manager.waitUntilIdle();

    expect(events).toEqual(['gap', 'move', 'pre', 'click']);
    expect(timing.gapAbortForGolden).toBe(true);
    expect(timing.preAbortForGolden).toBe(true);
    expect(mover.calls[0]).toMatchObject({ x: 40, y: 60, abortForGolden: true, speed: 1234 });
  });

  it('leaves the cursor at the last job position', async () => {
    const { manager, runtime } = makeHarness();

    manager.enqueue(plainAction('a', undefined, { target: { x: 100, y: 120 } }), { priority: 1 });
    manager.enqueue(plainAction('b', undefined, { target: { x: 466, y: 233 } }), { priority: 1 });

    await manager.waitUntilIdle();

    expect(runtime.cursor).toEqual({ x: 466, y: 233 });
  });

  it('passes abortOnGolden=false through to travel and pauses', async () => {
    const { manager, mover, timing } = makeHarness();

    manager.enqueue(plainAction('golden', undefined, { target: { x: 5, y: 5 }, abortOnGolden: false }), { priority: 0 });

    await manager.waitUntilIdle();

    expect(mover.calls[0]!.abortForGolden).toBe(false);
    expect(timing.gapAbortForGolden).toBe(false);
    expect(timing.preAbortForGolden).toBe(false);
  });

  it('runs beforeMove instead of the generic click gap', async () => {
    const { manager, timing } = makeHarness();
    const events: string[] = [];

    const action = plainAction('x', () => events.push('click'), {
      target: { x: 1, y: 1 },
      beforeMove: async () => {
        events.push('before');
        return true;
      },
    });

    manager.enqueue(action, { priority: 1 });
    await manager.waitUntilIdle();

    expect(timing.gapCalls).toBe(0);
    expect(events).toEqual(['before', 'click']);
  });

  it('cancels before cursor_at_position when abortIf turns true during the pre-click pause', async () => {
    const { manager, timing } = makeHarness();
    let abort = false;
    let clicked = false;

    timing.onPre = () => {
      abort = true;
    };

    const job = manager.enqueue(
      plainAction('x', () => {
        clicked = true;
      }, {
        target: { x: 10, y: 10 },
        abortIf: () => abort,
      }),
      { priority: 1 },
    );

    await manager.waitUntilIdle();

    expect(clicked).toBe(false);
    expect(job.state).toBe('cancelled');
  });

  it('sets the HUD state from the action while it runs and resets to idle after', async () => {
    const { manager, runtime } = makeHarness();

    manager.enqueue(plainAction('x', undefined, { hud: { action: 'fthof', target: 'Force the Hand of Fate' } }), { priority: 1 });

    await manager.waitUntilIdle();

    expect(runtime.currentAction).toBe('idle');
    expect(runtime.currentTarget).toBe('none');
  });
});

describe('createAction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('relabels and enqueues a clone without mutating the original', async () => {
    const { manager } = makeHarness();
    const original = plainAction('original');
    const seen: string[] = [];

    const job = manager.createAction(plainAction('ignored', () => seen.push('ran')), 'foobar', { priority: 2 });

    await manager.waitUntilIdle();

    expect(job.label).toBe('foobar');
    expect(original.label).toBe('original');
    expect(seen).toEqual(['ran']);
  });
});

describe('generic actions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ClickElementAction defaults to click gap + pre-click pause and clicks via humanClick', async () => {
    const { manager, timing } = makeHarness();
    const el = document.createElement('div');

    manager.enqueue(new ClickElementAction({ label: 'click el', el, x: 12, y: 34, holdMs: 9 }), { priority: 1 });

    await manager.waitUntilIdle();

    expect(timing.gapCalls).toBe(1);
    expect(timing.preCalls).toBe(1);
    expect(timing.humanCalls).toBe(1);
    expect(timing.lastHuman).toMatchObject({ el, x: 12, y: 34, holdMs: 9 });
  });

  it('MoveAction travels without click gap, pause or click', async () => {
    const { manager, mover, timing } = makeHarness();

    manager.enqueue(new MoveAction({ label: 'look', x: 70, y: 80, moveSpeed: 500, moveMaxMs: 6000 }), { priority: 1 });

    await manager.waitUntilIdle();

    expect(mover.calls[0]).toMatchObject({ x: 70, y: 80, speed: 500, maxMs: 6000 });
    expect(timing.gapCalls).toBe(0);
    expect(timing.preCalls).toBe(0);
    expect(timing.humanCalls).toBe(0);
  });

  it('VisualPressAction pulses without dispatching a click', async () => {
    const { manager, runtime, timing } = makeHarness();
    const before = performance.now();

    manager.enqueue(new VisualPressAction({ label: 'visual', x: 5, y: 6, pulseAfterMs: 10 }), { priority: 1 });

    await manager.waitUntilIdle();

    expect(runtime.pulseAt).toBeGreaterThanOrEqual(before);
    expect(timing.humanCalls).toBe(0);
  });
});

describe('enqueueAndWait', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('resolves done when the job completes', async () => {
    const { manager } = makeHarness();
    const seen: string[] = [];

    const outcome = await manager.enqueueAndWait(plainAction('x', () => seen.push('ran')), { priority: 1 });

    expect(outcome).toBe('done');
    expect(seen).toEqual(['ran']);
  });

  it('resolves cancelled when the job aborts before clicking', async () => {
    const { manager } = makeHarness();
    let clicked = false;

    const outcome = await manager.enqueueAndWait(
      plainAction('x', () => {
        clicked = true;
      }, { target: { x: 1, y: 1 }, abortIf: () => true }),
      { priority: 1 },
    );

    expect(outcome).toBe('cancelled');
    expect(clicked).toBe(false);
  });
});
