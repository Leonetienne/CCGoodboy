import type { AscensionRunner } from '../../src/autoplay/ascension-runner';
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
import type { BankUnlocker } from '../../src/autoplay/bank-unlock';
import type { FarmUnlocker } from '../../src/autoplay/farm-unlock';
import type { Gardener } from '../../src/garden/gardener';
import type { StockTrader } from '../../src/market/stock-trader';
import { selectJobRequest, type PriorityDeps } from '../../src/scheduler/priority';
import type { GameShimmer } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';
import type { AutoPlayEngine } from '../../src/autoplay/shopping';
import type { GrimoireUnlocker } from '../../src/autoplay/grimoire-unlock';
import type { GrimoireView } from '../../src/hunting/grimoire-view';
import type { WrinklerPopper } from '../../src/autoplay/wrinkler-popper';
import type { KrumblorTrainer } from '../../src/autoplay/krumblor';
import type { SantaTrainer } from '../../src/autoplay/santa';

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

  const krumblor = {
    pending: () => false,
    job: vi.fn().mockReturnValue({ action: { label: 'krumblor' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'krumblor:train' }),
  } as unknown as KrumblorTrainer;

  const wrinklerPopper = {
    pending: () => false,
    job: vi.fn().mockReturnValue({ action: { label: 'wrinkler-pop' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'wrinkler-pop:3' }),
  } as unknown as WrinklerPopper;

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
    grimoireView: { pending: () => false } as unknown as GrimoireView,
    ascension: { pending: () => false, committed: () => false } as unknown as AscensionRunner,
    grimoireUnlock,
    bankUnlock: { pending: () => false } as unknown as BankUnlocker,
    farmUnlock: { pending: () => false } as unknown as FarmUnlocker,
    krumblor,
    santa: { pending: () => false } as unknown as SantaTrainer,
    stockTrader: { pending: () => false } as unknown as StockTrader,
    gardener: { pending: () => false } as unknown as Gardener,
    autoPlay,
    wrinklerPopper,
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

  it('puts a committed ascension above golden cookies, and nothing else runs meanwhile (ASC-12)', () => {
    const hold = { action: { label: 'hold' }, priority: JOB_PRIORITY.ASCEND, key: 'ascend:hold' };
    const ascension = { pending: () => true, committed: () => true, job: () => hold } as unknown as AscensionRunner;
    expect(selectJobRequest(makeDeps({ queue: [goldenItem(7)], ascension }))?.key).toBe('ascend:hold');

    // paused after a hiccup: still nothing else
    const idle = { pending: () => false, committed: () => true, job: () => null } as unknown as AscensionRunner;
    expect(selectJobRequest(makeDeps({ queue: [goldenItem(7)], ascension: idle }))).toBeNull();
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

  it('falls through to hammer mode when FTHOF casting is switched off (FT-9)', () => {
    const game = new FakeGameAdapter();
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 50, magic: 100 };
    game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 } };
    const data = new PersistedData();
    data.config.grimoireFthof = false;

    const job = selectJobRequest(makeDeps({ game, data, buffs: game.positiveCpsBuffs(), hammerActive: () => true }));
    expect(job?.key).toBe('hammer');
  });

  it('falls through to hammer mode when the mana refill is switched off, or FTHOF is (FT-9)', () => {
    for (const off of ['spendLumps', 'grimoireFthof'] as const) {
      const game = new FakeGameAdapter();
      game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 100, magic: 10, magicM: 1000 };
      game.rawBuffs = { a: { name: 'Buff', multCpS: 2, time: 3000 }, b: { name: 'Buff2', multCpS: 2, time: 3000 } };
      game.refillable = true;
      game.lumps = 1;
      const data = new PersistedData();
      data.config[off] = false;

      const job = selectJobRequest(makeDeps({ game, data, buffs: game.positiveCpsBuffs(), hammerActive: () => true }));
      expect(job?.key).toBe('hammer');
    }
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

  it('pops a wrinkler before auto-shop, after the Grimoire unlock', () => {
    const wrinklerPopper = {
      pending: () => true,
      job: vi.fn().mockReturnValue({ action: { label: 'wrinkler-pop' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'wrinkler-pop:3' }),
    } as unknown as WrinklerPopper;
    const autoPlay = { shopReady: () => true, shopJob: vi.fn() } as unknown as AutoPlayEngine;

    expect(selectJobRequest(makeDeps({ wrinklerPopper, autoPlay }))?.key).toBe('wrinkler-pop:3');
    expect(autoPlay.shopJob).not.toHaveBeenCalled();

    const grimoireUnlock = {
      pending: () => true,
      job: vi.fn().mockReturnValue({ action: { label: 'grimoire-unlock' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'grimoire-unlock:level' }),
    } as unknown as GrimoireUnlocker;
    expect(selectJobRequest(makeDeps({ grimoireUnlock, wrinklerPopper, autoPlay }))?.key).toBe('grimoire-unlock:level');
  });

  it('trains Krumblor after the Grimoire unlock, before a wrinkler pop and auto-shop', () => {
    const krumblor = {
      pending: () => true,
      job: vi.fn().mockReturnValue({ action: { label: 'krumblor' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'krumblor:train' }),
    } as unknown as KrumblorTrainer;
    const wrinklerPopper = { pending: () => true, job: vi.fn() } as unknown as WrinklerPopper;
    const autoPlay = { shopReady: () => true, shopJob: vi.fn() } as unknown as AutoPlayEngine;

    expect(selectJobRequest(makeDeps({ krumblor, wrinklerPopper, autoPlay }))?.key).toBe('krumblor:train');
    expect(wrinklerPopper.job).not.toHaveBeenCalled();
    expect(autoPlay.shopJob).not.toHaveBeenCalled();

    const grimoireUnlock = {
      pending: () => true,
      job: vi.fn().mockReturnValue({ action: { label: 'grimoire-unlock' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'grimoire-unlock:level' }),
    } as unknown as GrimoireUnlocker;
    expect(selectJobRequest(makeDeps({ grimoireUnlock, krumblor, autoPlay }))?.key).toBe('grimoire-unlock:level');
  });

  it('evolves Santa after a Krumblor step, before a wrinkler pop and auto-shop', () => {
    const santa = {
      pending: () => true,
      job: vi.fn().mockReturnValue({ action: { label: 'santa' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'santa:evolve' }),
    } as unknown as SantaTrainer;
    const wrinklerPopper = { pending: () => true, job: vi.fn() } as unknown as WrinklerPopper;
    const autoPlay = { shopReady: () => true, shopJob: vi.fn() } as unknown as AutoPlayEngine;

    expect(selectJobRequest(makeDeps({ santa, wrinklerPopper, autoPlay }))?.key).toBe('santa:evolve');
    expect(wrinklerPopper.job).not.toHaveBeenCalled();
    expect(autoPlay.shopJob).not.toHaveBeenCalled();

    const krumblor = {
      pending: () => true,
      job: vi.fn().mockReturnValue({ action: { label: 'krumblor' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'krumblor:train' }),
    } as unknown as KrumblorTrainer;
    expect(selectJobRequest(makeDeps({ krumblor, santa }))?.key).toBe('krumblor:train');
  });

  it('falls through to auto-shop when the wrinkler popper has no job to hand out', () => {
    const wrinklerPopper = { pending: () => true, job: () => null } as unknown as WrinklerPopper;
    const autoPlay = { shopReady: () => true, shopJob: vi.fn().mockReturnValue({ action: { label: 'auto-shop' }, priority: JOB_PRIORITY.AUTO_SHOP, key: 'auto-shop:x' }) } as unknown as AutoPlayEngine;
    expect(selectJobRequest(makeDeps({ wrinklerPopper, autoPlay }))?.key).toBe('auto-shop:x');
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
  it('the kick-off hammering after the Heavenly key (AUTO-19) goes before shopping, a lump harvest still first', () => {
    const autoPlay = { shopReady: () => true, shopJob: vi.fn() } as unknown as AutoPlayEngine;
    const krumblor = { pending: () => true, job: vi.fn() } as unknown as KrumblorTrainer;

    expect(selectJobRequest(makeDeps({ autoPlay, krumblor, hammerKick: () => true }))?.key).toBe('hammer');
    expect(autoPlay.shopJob).not.toHaveBeenCalled();
    expect(krumblor.job).not.toHaveBeenCalled();

    const lumpHarvest = {
      pending: () => true,
      harvestJob: vi.fn().mockReturnValue({ action: { label: 'lump-harvest' }, priority: JOB_PRIORITY.LUMP_HARVEST, key: 'lump-harvest' }),
    } as unknown as LumpHarvestActions;
    expect(selectJobRequest(makeDeps({ autoPlay, lumpHarvest, hammerKick: () => true }))?.key).toBe('lump-harvest');


    // without the kick, shopping goes first again
    selectJobRequest(makeDeps({ autoPlay, hammerKick: () => false, hammerActive: () => true }));
    expect(autoPlay.shopJob).toHaveBeenCalled();
  });
  it('hammers through a combo of two positive buffs (CF-7), above a ripe lump and shopping', () => {
    const game = new FakeGameAdapter();
    game.rawBuffs = { a: { name: 'Frenzy', multCpS: 7, time: 3000 }, b: { name: 'Dragonflight', multClick: 1111, time: 300 } };
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now();
    const autoPlay = { shopReady: () => true, shopJob: vi.fn() } as unknown as AutoPlayEngine;
    const lumpHarvest = { pending: () => true, harvestJob: vi.fn() } as unknown as LumpHarvestActions;

    expect(selectJobRequest(makeDeps({ game, runtime, autoPlay, lumpHarvest, buffs: game.positiveCpsBuffs() }))?.key).toBe('hammer');

    // between two clicks nothing below it gets the paw
    runtime.nextBigClickAt = Date.now() + 100000;
    expect(selectJobRequest(makeDeps({ game, runtime, autoPlay, lumpHarvest, buffs: game.positiveCpsBuffs() }))).toBeNull();
    expect(autoPlay.shopJob).not.toHaveBeenCalled();
    expect(lumpHarvest.harvestJob).not.toHaveBeenCalled();
  });

  it('a buff combo still lets the Grimoire go first (CF-7)', () => {
    const game = new FakeGameAdapter();
    game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 50, magic: 100 };
    game.rawBuffs = { a: { name: 'Frenzy', multCpS: 7, time: 3000 }, b: { name: 'Building special', multCpS: 10, time: 3000 } };
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now();

    expect(selectJobRequest(makeDeps({ game, runtime, buffs: game.positiveCpsBuffs() }))?.key).toBe('fthof');
  });

  it('one positive buff is no combo (CF-7)', () => {
    const game = new FakeGameAdapter();
    game.rawBuffs = { a: { name: 'Frenzy', multCpS: 7, time: 3000 }, b: { name: 'Clot', multCpS: 0.5, time: 3000 } };
    const runtime = new RuntimeState();
    runtime.nextBigClickAt = Date.now();

    expect(selectJobRequest(makeDeps({ game, runtime, data: (() => { const d = new PersistedData(); d.config.idleWander = false; return d; })() }))).toBeNull();
  });
});
