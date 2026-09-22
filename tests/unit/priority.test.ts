import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { ClickBigCookieTask } from '../../src/hunting/click-big-cookie';
import type { ClickGoldenTask } from '../../src/hunting/click-golden';
import type { FthofActions } from '../../src/hunting/fthof';
import type { GoldenQueueItem } from '../../src/hunting/golden-queue';
import type { HappyDance } from '../../src/hunting/happy-dance';
import type { LumpHarvestActions } from '../../src/hunting/lump-harvest';
import type { IdleBehavior } from '../../src/idle/idle-behavior';
import { JOB_PRIORITY } from '../../src/cursor/types';
import { selectJobRequest, type PriorityDeps } from '../../src/scheduler/priority';
import type { GameShimmer } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';
import type { AutoPlayEngine } from '../../src/autoplay/shopping';
import type { GrimoireUnlocker } from '../../src/autoplay/grimoire-unlock';

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

  const lumpHarvest = {
    pending: () => false,
    harvestJob: vi.fn().mockReturnValue({ action: { label: 'lump-harvest' }, priority: JOB_PRIORITY.LUMP_HARVEST, key: 'lump-harvest' }),
  } as unknown as LumpHarvestActions;

  const grimoireUnlock = {
    pending: () => false,
    job: vi.fn().mockReturnValue({ action: { label: 'grimoire-unlock' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'grimoire-unlock:level' }),
  } as unknown as GrimoireUnlocker;

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
    lumpHarvest,
    grimoireUnlock,
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

  it('picks refill when mana is short, LOCK_A is open, no refill is in flight, refill is off cooldown and a lump is available', () => {
    const game = new FakeGameAdapter();
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 100, magic: 10, magicM: 1000 };
    game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 }, b: { name: 'Buff2', multCpS: 2, time: 3000 } };
    game.refillable = true;
    game.lumps = 1;

    const job = selectJobRequest(makeDeps({ game, buffs: game.positiveCpsBuffs() }));
    expect(job?.key).toBe('refill');
  });

  it('falls through to hammer mode when a refill looks due but the refill is on cooldown or has no lumps', () => {
    const game = new FakeGameAdapter();
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 100, magic: 10, magicM: 1000 };
    game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 }, b: { name: 'Buff2', multCpS: 2, time: 3000 } };
    game.refillable = false; // still on the game's 15-minute cooldown
    game.lumps = 0;
    const runtime = new RuntimeState();

    const job = selectJobRequest(makeDeps({ game, buffs: game.positiveCpsBuffs(), runtime, hammerActive: () => true }));
    expect(job?.key).toBe('hammer');
    expect(job?.priority).toBe(JOB_PRIORITY.HAMMER);
  });

  it('falls through to hammer mode instead of refilling when max mana can never reach the FTHOF cost', () => {
    const game = new FakeGameAdapter();
    // cost is 100, but Wizard towers only allow 50 max mana: refilling could never pay for it.
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 100, magic: 10, magicM: 50 };
    game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 }, b: { name: 'Buff2', multCpS: 2, time: 3000 } };
    game.refillable = true;
    game.lumps = 1;
    const runtime = new RuntimeState();

    const job = selectJobRequest(makeDeps({ game, buffs: game.positiveCpsBuffs(), runtime, hammerActive: () => true }));
    expect(job?.key).toBe('hammer');
    expect(job?.priority).toBe(JOB_PRIORITY.HAMMER);
  });

  it('picks a ripe sugar lump below FTHOF/refill and above auto-shop', () => {
    const lumpHarvest = {
      pending: () => true,
      harvestJob: vi.fn().mockReturnValue({ action: { label: 'lump-harvest' }, priority: JOB_PRIORITY.LUMP_HARVEST, key: 'lump-harvest' }),
    } as unknown as LumpHarvestActions;

    const autoPlay = { shopReady: () => true, shopJob: vi.fn() } as unknown as AutoPlayEngine;

    const job = selectJobRequest(makeDeps({ lumpHarvest, autoPlay }));
    expect(job?.key).toBe('lump-harvest');
    expect(job?.priority).toBe(JOB_PRIORITY.LUMP_HARVEST);
  });

  it('picks the Grimoire unlock before auto-shop, below a ripe sugar lump', () => {
    const grimoireUnlock = {
      pending: () => true,
      job: vi.fn().mockReturnValue({ action: { label: 'grimoire-unlock' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'grimoire-unlock:level' }),
    } as unknown as GrimoireUnlocker;
    const autoPlay = { shopReady: () => true, shopJob: vi.fn() } as unknown as AutoPlayEngine;

    expect(selectJobRequest(makeDeps({ grimoireUnlock, autoPlay }))?.key).toBe('grimoire-unlock:level');
    expect(autoPlay.shopJob).not.toHaveBeenCalled();

    const lumpHarvest = {
      pending: () => true,
      harvestJob: vi.fn().mockReturnValue({ action: { label: 'lump-harvest' }, priority: JOB_PRIORITY.LUMP_HARVEST, key: 'lump-harvest' }),
    } as unknown as LumpHarvestActions;
    expect(selectJobRequest(makeDeps({ grimoireUnlock, lumpHarvest, autoPlay }))?.key).toBe('lump-harvest');
  });

  it('falls through to auto-shop when the Grimoire unlock has no step to hand out', () => {
    const grimoireUnlock = { pending: () => true, job: () => null } as unknown as GrimoireUnlocker;
    const autoPlay = { shopReady: () => true, shopJob: vi.fn().mockReturnValue({ action: { label: 'auto-shop' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'auto-shop:x' }) } as unknown as AutoPlayEngine;
    expect(selectJobRequest(makeDeps({ grimoireUnlock, autoPlay }))?.key).toBe('auto-shop:x');
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
