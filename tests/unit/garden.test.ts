import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GardenClickAction } from '../../src/actions/garden';
import { MinigameButtonAction, ScrollIntoViewAction } from '../../src/actions/buildings-view';
import { MinigameUnlockAction } from '../../src/actions/minigame-unlock';
import { FarmUnlocker } from '../../src/autoplay/farm-unlock';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY } from '../../src/cursor/types';
import type { GameBuilding, GardenSeed, GardenSnapshot, GardenTile } from '../../src/game/types';
import { Gardener } from '../../src/garden/gardener';
import { gardenSoilTarget, planGardenMove, type GardenContext } from '../../src/garden/garden-strategy';
import { BuildingsViewNavigator } from '../../src/hunting/buildings-view';
import { StatsRecorder } from '../../src/stats/stats';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

const SEEDS: GardenSeed[] = [
  { id: 0, key: 'bakerWheat', name: "Baker's wheat", unlocked: true, plantable: true, cost: 60 },
  { id: 1, key: 'thumbcorn', name: 'Thumbcorn', unlocked: false, plantable: true, cost: 300 },
  { id: 8, key: 'bakeberry', name: 'Bakeberry', unlocked: true, plantable: true, cost: 2700 },
  { id: 13, key: 'meddleweed', name: 'Meddleweed', unlocked: true, plantable: true, cost: 10 },
];

function tile(x: number, y: number, over: Partial<GardenTile> = {}): GardenTile {
  return { x, y, plant: 'bakerWheat', age: 10, mature: 35, dying: false, immortal: false, ...over };
}

/** A 2x2 plot (Farm level 1), full of young wheat unless told otherwise, on clay. */
function snap(tiles: GardenTile[] = [tile(2, 2), tile(3, 2), tile(2, 3), tile(3, 3)], over: Partial<GardenSnapshot> = {}): GardenSnapshot {
  return {
    tiles,
    seeds: SEEDS.map((s) => ({ ...s })),
    soil: 2,
    soils: [
      { id: 0, key: 'dirt', name: 'Dirt', req: 0 },
      { id: 1, key: 'fertilizer', name: 'Fertilizer', req: 50 },
      { id: 2, key: 'clay', name: 'Clay', req: 100 },
      { id: 3, key: 'pebbles', name: 'Pebbles', req: 200 },
      { id: 4, key: 'woodchips', name: 'Wood chips', req: 300 },
    ],
    soilCooldownSec: 0,
    frozen: false,
    seedSelected: -1,
    nextTickSec: 120,
    farms: 150,
    cpsMult: 1,
    ...over,
  };
}

const CTX: GardenContext = { spendable: 1e6, buffed: false };

describe('planGardenMove (GARDEN-2..7)', () => {
  it('does nothing in a full, young, frozen or healthy garden', () => {
    expect(planGardenMove(snap(), CTX)).toBeNull();
    expect(planGardenMove(snap([tile(2, 2, { plant: null })], { frozen: true }), CTX)).toBeNull();
  });

  it('selects the wheat seed, then plants it on an empty tile', () => {
    const empty = [tile(2, 2), tile(3, 2, { plant: null, age: 0, mature: 0 })];
    expect(planGardenMove(snap(empty), CTX)).toMatchObject({ kind: 'select', seed: { key: 'bakerWheat' } });
    expect(planGardenMove(snap(empty, { seedSelected: 0 }), CTX)).toMatchObject({ kind: 'plant', tile: { x: 3, y: 2 } });
  });

  it('never plants during a CpS buff or without the cookies for it', () => {
    const empty = [tile(2, 2, { plant: null, age: 0, mature: 0 })];
    expect(planGardenMove(snap(empty), { ...CTX, buffed: true })).toBeNull();
    expect(planGardenMove(snap(empty), { ...CTX, spendable: 59 })).toBeNull();
  });

  it('harvests a mature plant before it withers, not before', () => {
    expect(planGardenMove(snap([tile(2, 2, { age: 90, dying: false })]), CTX)).toBeNull();
    expect(planGardenMove(snap([tile(2, 2, { age: 95, dying: true })]), CTX)).toMatchObject({ kind: 'harvest', why: 'about to wither' });
  });

  it('harvests a new seed as soon as it is mature, and leaves it alone until then', () => {
    expect(planGardenMove(snap([tile(2, 2, { plant: 'thumbcorn', age: 10, mature: 20 })]), CTX)).toBeNull();
    expect(planGardenMove(snap([tile(2, 2, { plant: 'thumbcorn', age: 20, mature: 20 })]), CTX)).toMatchObject({ kind: 'harvest', why: 'a new seed' });
  });

  it('unearths a known pest at once', () => {
    expect(planGardenMove(snap([tile(2, 2, { plant: 'meddleweed', age: 3, mature: 50 })]), CTX)).toMatchObject({ kind: 'unearth', name: 'Meddleweed' });
  });

  it('harvests a mature payout crop during a buff', () => {
    const berry = [tile(2, 2, { plant: 'bakeberry', age: 60, mature: 50 })];
    expect(planGardenMove(snap(berry), CTX)).toBeNull();
    expect(planGardenMove(snap(berry), { ...CTX, buffed: true })).toMatchObject({ kind: 'harvest', why: 'pays out more during a buff' });
  });

  it('keeps clay with 100 farms, dirt below, and waits out the soil cooldown', () => {
    expect(planGardenMove(snap(undefined, { soil: 0 }), CTX)).toMatchObject({ kind: 'soil', soil: { key: 'clay' } });
    expect(planGardenMove(snap(undefined, { soil: 0, soilCooldownSec: 30 }), CTX)).toBeNull();
    expect(gardenSoilTarget(snap(undefined, { farms: 99 }))!.key).toBe('dirt');
    expect(planGardenMove(snap(undefined, { soil: 2, farms: 10 }), CTX)).toMatchObject({ kind: 'soil', soil: { key: 'dirt' } });
  });
});

const RECT = { left: 100, top: 100, right: 140, bottom: 140, width: 40, height: 40, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;
const COLUMN = { ...RECT, top: 0, bottom: 700, height: 700, width: 800, right: 900 } as DOMRect;
const OFFSCREEN = { ...RECT, top: 5000, bottom: 5040, y: 5000 } as DOMRect;

function buildDom(tileRect: DOMRect = RECT): void {
  document.body.innerHTML = `
    <div id="prefsButton"></div><div id="statsButton"></div>
    <div id="centerArea"><div id="rows"><div id="row2">
      <div id="productLevel2">lvl 0</div><div id="productMinigameButton2">View Garden</div>
      <div id="gardenSeed-0"></div><div id="gardenSoil-2"></div>
      <div id="gardenTile-2-2"></div><div id="gardenTile-3-2"></div>
    </div></div></div>`;

  for (const el of Array.from(document.body.querySelectorAll('div'))) el.style.opacity = '1';

  const stub = (id: string, r: DOMRect) => {
    document.getElementById(id)!.getBoundingClientRect = () => r;
  };

  for (const id of ['prefsButton', 'statsButton', 'row2', 'productLevel2', 'productMinigameButton2', 'gardenSeed-0', 'gardenSoil-2', 'gardenTile-2-2']) stub(id, RECT);
  stub('centerArea', COLUMN);
  stub('rows', COLUMN);
  stub('gardenTile-3-2', tileRect);
}

function setup() {
  const runtime = new RuntimeState();
  const data = new PersistedData();

  const game = new FakeGameAdapter();
  game.cookies = 1e6;
  game.lumpsOn = true;
  game.lumps = 1;
  game.unbuffedCps = 1;

  const farm = { name: 'Farm', id: 2, amount: 150, level: 1, onMinigame: true, buy: () => {} } as GameBuilding;
  game.buildingsByName['Farm'] = farm;
  game.garden = snap([tile(2, 2), tile(3, 2, { plant: null, age: 0, mature: 0 })], { seedSelected: 0 });

  const log = { log: vi.fn() };
  const stats = new StatsRecorder(data);
  let interrupted = false;

  const nav = new BuildingsViewNavigator(runtime, game, () => false);
  const gardener = Gardener.create(runtime, data, game, log as never, stats, nav, () => interrupted);
  const unlocker = new FarmUnlocker(runtime, data, game, log as never, gardener.view, () => interrupted);

  return { runtime, data, game, farm, log, stats, gardener, unlocker, interrupt: (v: boolean) => (interrupted = v) };
}

function clickCtx(s: ReturnType<typeof setup>, onClick: (el: Element) => void) {
  return {
    runtime: s.runtime,
    clickTiming: {
      humanClick: vi.fn().mockImplementation(async (el: Element) => {
        onClick(el);
        return true;
      }),
    },
  };
}

beforeEach(() => buildDom());

describe('Gardener (GARDEN-*)', () => {
  it('is on by default, and does nothing while "Tend the garden" is off', () => {
    const s = setup();
    s.data.config.garden = false;

    expect(new PersistedData().config.garden).toBe(true);
    expect(s.gardener.pending()).toBe(false);
    expect(s.gardener.job()).toBeNull();
    expect(s.gardener.statusText()).toBe('');
  });

  it('plants with a real click on the empty tile, and counts it', async () => {
    const s = setup();
    expect(s.gardener.pending()).toBe(true);

    const job = s.gardener.job()!;
    expect(job.action).toBeInstanceOf(GardenClickAction);
    expect(job.priority).toBe(JOB_PRIORITY.AUTO_SHOP);
    expect(job.key).toBe('garden:plant:3-2');

    const target = document.getElementById('gardenTile-3-2');
    await (job.action as GardenClickAction).cursor_at_position(
      clickCtx(s, (el) => {
        if (el === target) s.game.garden!.tiles[1]!.plant = 'bakerWheat';
      }) as never,
    );

    expect(s.data.stats.gardenPlants).toBe(1);
    expect(s.log.log).toHaveBeenCalledWith('garden plant', "Baker's wheat at 3,2", { cost: 60 });
    expect(s.data.stats.gardenProfit).toBe(-60);
  });

  it('logs a harvest with its payout and a new seed, and pauses when a click did nothing', async () => {
    const s = setup();
    s.game.garden = snap([tile(2, 2, { plant: 'thumbcorn', age: 20, mature: 20 })]);
    const job = s.gardener.job()!;
    expect(job.key).toBe('garden:harvest:2-2');

    await (job.action as GardenClickAction).cursor_at_position(
      clickCtx(s, () => {
        s.game.garden!.tiles[0]!.plant = null;
        s.game.garden!.seeds[1]!.unlocked = true;
        s.game.cookies += 500;
      }) as never,
    );

    expect(s.data.stats.gardenHarvests).toBe(1);
    expect(s.log.log).toHaveBeenCalledWith('garden harvest', 'Thumbcorn at 2,2', expect.objectContaining({ cookies: undefined, seed: 'Thumbcorn' }));
    expect(s.data.stats.gardenProfit).toBe(0); // no payout crop: the 500 were just CpS during the click

    s.game.garden = snap([tile(2, 2, { plant: 'meddleweed', age: 1, mature: 50 })]);
    await (s.gardener.job()!.action as GardenClickAction).cursor_at_position(clickCtx(s, () => {}) as never);
    expect(s.runtime.gardenBlockUntil).toBeGreaterThan(Date.now());
    expect(s.gardener.pending()).toBe(false);
  });

  it('counts a payout crop\'s harvest as garden profit', async () => {
    const s = setup();
    s.game.garden = snap([tile(2, 2, { plant: 'bakeberry', age: 97, mature: 50, dying: true })]);

    await (s.gardener.job()!.action as GardenClickAction).cursor_at_position(
      clickCtx(s, () => {
        s.game.garden!.tiles[0]!.plant = null;
        s.game.cookies += 3000;
      }) as never,
    );

    expect(s.data.stats.gardenProfit).toBe(3000);
    expect(s.log.log).toHaveBeenCalledWith('garden harvest', 'Bakeberry at 2,2', expect.objectContaining({ cookies: 3000 }));
  });

  it('adds the garden\'s share of the income over time (GARDEN-10)', () => {
    const s = setup();
    s.game.garden!.cpsMult = 1.05;
    s.game.cookiesPs = 105; // 100 without the garden

    s.gardener.track(10_000);
    expect(s.data.stats.gardenProfit).toBe(0); // first sample only starts the clock

    s.gardener.track(10_500); // < 1s: not yet
    s.gardener.track(12_000); // 2s
    expect(s.data.stats.gardenProfit).toBeCloseTo(10);

    s.gardener.track(72_000); // a 60s stall counts as 5s
    expect(s.data.stats.gardenProfit).toBeCloseTo(35);

    s.game.garden!.cpsMult = 0.99; // brown mold: a loss
    s.gardener.track(73_000);
    expect(s.data.stats.gardenProfit).toBeCloseTo(35 + 105 * (1 - 1 / 0.99));

    s.data.config.garden = false;
    s.gardener.track(74_000);
    s.data.config.garden = true;
    s.gardener.track(80_000);
    expect(s.runtime.gardenTrackedAt).toBe(80_000); // restarted: nothing counted while off
    expect(s.data.stats.gardenProfit).toBeCloseTo(35 + 105 * (1 - 1 / 0.99));
  });

  it('gets the garden on screen first: opens it, scrolls to the tile', () => {
    let s = setup();
    s.farm.onMinigame = false;
    expect(s.gardener.job()!.action).toBeInstanceOf(MinigameButtonAction);

    buildDom(OFFSCREEN);
    s = setup();
    expect(s.gardener.job()!.action).toBeInstanceOf(ScrollIntoViewAction);
  });

  it('respects the safety gates (golden cookie, Click Frenzy, prompt, ascension)', () => {
    const s = setup();
    s.interrupt(true);
    expect(s.gardener.pending()).toBe(false);

    s.interrupt(false);
    s.game.promptOpen = true;
    expect(s.gardener.pending()).toBe(false);

    s.game.promptOpen = false;
    s.game.ascending = true;
    expect(s.gardener.pending()).toBe(false);
  });

  it('never unlocks the garden by itself and never spends a lump', () => {
    const s = setup();
    s.game.garden = null;
    s.farm.level = 0;

    expect(s.gardener.pending()).toBe(false);
    expect(s.gardener.statusText()).toContain('locked');
  });

  it('keeps auto play\'s bank reserve when buying seeds', () => {
    const s = setup();
    s.data.config.autoPlay = true;
    s.data.config.autoReserveSec = 1e6; // 1M cookies at 1 CpS: the whole bank

    expect(s.gardener.pending()).toBe(false);
  });
});

describe('FarmUnlocker (AUTO-17)', () => {
  function locked() {
    const s = setup();
    s.data.config.autoPlay = true;
    s.farm.level = 0;
    s.game.garden = null;
    return s;
  }

  it('spends a lump on Farm level 1 in auto play with the garden on', () => {
    const s = locked();
    expect(s.unlocker.pending()).toBe(true);

    const job = s.unlocker.job()!;
    expect(job.action).toBeInstanceOf(MinigameUnlockAction);
    expect(job.key).toBe('farm-unlock:level');
    expect(job.action.hud).toEqual({ action: 'farm-unlock', target: 'Farm level 1 (Garden)' });
  });

  it('needs auto play, the garden setting, lump spending and a lump', () => {
    let s = locked();
    s.data.config.autoPlay = false;
    expect(s.unlocker.wanted()).toBe(false);

    s = locked();
    s.data.config.garden = false;
    expect(s.unlocker.wanted()).toBe(false);

    s = locked();
    s.data.config.spendLumps = false;
    expect(s.unlocker.wanted()).toBe(false);

    s = locked();
    s.game.lumps = 0;
    expect(s.unlocker.wanted()).toBe(false);
  });

  it('never levels the Farm past 1', () => {
    const s = locked();
    s.farm.level = 1;
    expect(s.unlocker.wanted()).toBe(false);
  });
});
