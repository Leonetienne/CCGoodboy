import { describe, expect, it } from 'vitest';
import { DanceAction } from '../../src/actions/dance';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

/** A job context whose frames only advance when step() is called, with a fake clock. */
function frameCtx(runtime: RuntimeState, abort = () => false) {
  let pending: ((ts: number) => void) | null = null;
  let now = performance.now();

  const ctx = {
    runtime,
    abortRequested: abort,
    cursor: { setPosition: (x: number, y: number) => { runtime.cursor.x = x; runtime.cursor.y = y; } },
    clock: { nextFrame: (cb: (ts: number) => void) => { pending = cb; } },
  };

  const step = (ms: number) => {
    now += ms;
    const cb = pending;
    pending = null;
    cb?.(now);
  };

  return { ctx, step };
}

describe('DanceAction peace sign (PAW-2)', () => {
  it('shows the peace sign while dancing and drops it at the end', async () => {
    const runtime = new RuntimeState();
    const { ctx, step } = frameCtx(runtime);
    const done = new DanceAction(new PersistedData(), new FakeGameAdapter(), () => false, () => false, { durationMs: 500 })
      .cursor_at_position(ctx as never);

    expect(runtime.pawPeace).toBe(true);
    step(200);
    expect(runtime.pawPeace).toBe(true);
    step(1000);
    await done;
    expect(runtime.pawPeace).toBe(false);
  });

  it('drops the peace sign when the dance is interrupted', async () => {
    const runtime = new RuntimeState();
    let abort = false;
    const { ctx, step } = frameCtx(runtime, () => abort);
    const done = new DanceAction(new PersistedData(), new FakeGameAdapter(), () => false, () => false, { durationMs: 5000 })
      .cursor_at_position(ctx as never);

    step(100);
    expect(runtime.pawPeace).toBe(true);
    abort = true;
    step(16);
    await done;
    expect(runtime.pawPeace).toBe(false);
  });

  it('never shows it when the dance is skipped', async () => {
    const runtime = new RuntimeState();
    const { ctx } = frameCtx(runtime);
    await new DanceAction(new PersistedData(), new FakeGameAdapter(), () => true, () => false, { durationMs: 500 })
      .cursor_at_position(ctx as never);

    expect(runtime.pawPeace).toBe(false);
  });
});
