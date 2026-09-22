import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { ClickBigCookieTask } from '../../src/hunting/click-big-cookie';
import type { ClickGoldenTask } from '../../src/hunting/click-golden';
import type { FthofActions } from '../../src/hunting/fthof';
import type { GoldenQueueItem } from '../../src/hunting/golden-queue';
import type { HappyDance } from '../../src/hunting/happy-dance';
import type { IdleBehavior } from '../../src/idle/idle-behavior';
import { JOB_PRIORITY } from '../../src/cursor/types';
import { selectJobRequest, type PriorityDeps } from '../../src/scheduler/priority';
import type { GameShimmer } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';
import type { AutoPlayEngine } from '../../src/autoplay/shopping';

function makeDeps(overrides: Partial<PriorityDeps> = {}): PriorityDeps {
  const runtime = overrides.runtime ?? new RuntimeState();
  const data = overrides.data ?? new PersistedData();
  const game = overrides.game ?? new FakeGameAdapter();

  const clickGolden = {
    jobFor: vi.fn().mockImplementation((shimmer: GameShimmer) => ({
      action: { label: 'golden' },
      priority: JOB_PRIORITY.GOLDEN,
      key: `golden:${shimmer.id}`,
    })),
  } as unknown as ClickGoldenTask;

  const clickBigCookie = {
    job: vi.fn().mockReturnValue({
      action: { label: 'hammer' },
      priority: game.clickFrenzyActive() ? JOB_PRIORITY.CLICK_FRENZY : JOB_PRIORITY.HAMMER,
      key: 'hammer',
    }),
  } as unknown as ClickBigCookieTask;

  const fthof = {
    castJob: vi.fn().mockReturnValue({ action: { label: 'fthof' }, priority: JOB_PRIORITY.FTHOF, key: 'fthof' }),
    refillJob: vi.fn().mockReturnValue({ action: { label: 'refill' }, priority: JOB_PRIORITY.REFILL, key: 'refill' }),
  } as unknown as FthofActions;

  const autoPlay = {
    shopReady: () => false,
    shopJob: vi.fn().mockReturnValue({ action: { label: 'auto-shop' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'auto-shop:x' }),
  } as unknown as AutoPlayEngine;

  const happyDance = {
    job: vi.fn().mockReturnValue({ action: { label: 'dance' }, priority: JOB_PRIORITY.HAPPY_DANCE, key: 'happy-dance' }),
  } as unknown as HappyDance;

  const idleBehavior = {
    idleJob: vi.fn().mockReturnValue({ action: { label: 'idle' }, priority: JOB_PRIORITY.IDLE, key: 'idle-wander' }),
  } as unknown as IdleBehavior;

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

describe('selectJobRequest', () => {
  beforeEach(() => localStorage.clear());

  it('picks a ready golden cookie above everything else', () => {
    const deps = makeDeps({ queue: [goldenItem(7)] });
    const job = selectJobRequest(deps);

    expect(job?.key).toBe('golden:7');
    expect(job?.priority).toBe(JOB_PRIORITY.GOLDEN);
  });

  it('picks click-frenzy when Click Frenzy is active and the lead time has arrived', () => {
    const game = new FakeGameAdapter();
    game.buffNames.add('Click frenzy');
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now(); // already due

    const job = selectJobRequest(makeDeps({ game, runtime }));
    expect(job?.priority).toBe(JOB_PRIORITY.CLICK_FRENZY);
    expect(job?.key).toBe('hammer');
  });

  it('picks nothing during Click Frenzy before the lead time, even though FTHOF looks skippable', () => {
    const game = new FakeGameAdapter();
    game.buffNames.add('Click frenzy');
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now() + 100000; // far in the future

    const job = selectJobRequest(makeDeps({ game, runtime }));
    expect(job).toBeNull();
  });

  it('picks fthof when a Grimoire has enough magic and an outlasting buff', () => {
    const game = new FakeGameAdapter();
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 50, magic: 100 };
    game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 } };

    const job = selectJobRequest(makeDeps({ game, buffs: game.positiveCpsBuffs() }));
    expect(job?.key).toBe('fthof');
  });

  it('picks refill when mana is short, LOCK_A is open and no refill is in flight', () => {
    const game = new FakeGameAdapter();
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 100, magic: 10 };
    game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 }, b: { name: 'Buff2', multCpS: 2, time: 3000 } };

    const job = selectJobRequest(makeDeps({ game, buffs: game.positiveCpsBuffs() }));
    expect(job?.key).toBe('refill');
  });

  it('falls back to auto-shop when nothing else is due', () => {
    const autoPlay = { shopReady: () => true, shopJob: vi.fn().mockReturnValue({ action: { label: 'auto-shop' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'auto-shop:x' }) } as unknown as AutoPlayEngine;
    const job = selectJobRequest(makeDeps({ autoPlay }));
    expect(job?.key).toBe('auto-shop:x');
  });

  it('falls back to hammer mode when active and due', () => {
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now();
    const job = selectJobRequest(makeDeps({ runtime, hammerActive: () => true }));
    expect(job?.priority).toBe(JOB_PRIORITY.HAMMER);
    expect(job?.key).toBe('hammer');
  });

  it('falls back to a queued happy dance', () => {
    const runtime = new RuntimeState();
    runtime.danceQueued = true;
    const job = selectJobRequest(makeDeps({ runtime }));
    expect(job?.key).toBe('happy-dance');
  });

  it('falls back to idle wander when nothing else is due and idle is allowed', () => {
    const job = selectJobRequest(makeDeps());
    expect(job?.key).toBe('idle-wander');
  });

  it('picks nothing when idle wander is disabled and nothing else is due', () => {
    const data = new PersistedData();
    data.config.idleWander = false;
    const job = selectJobRequest(makeDeps({ data }));
    expect(job).toBeNull();
  });
});
