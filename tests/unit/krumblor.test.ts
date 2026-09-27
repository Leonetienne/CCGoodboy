import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KrumblorTrainer } from '../../src/autoplay/krumblor';
import {
  DRAGON_SACRIFICE_BUILDINGS,
  dragonBatchNeeds,
  dragonCookieCost,
  dragonSacrificePlan,
  KRUMBLOR_STAGE_LEVEL,
  krumblorStageFor,
  nextAuraGoal,
  nextKrumblorStep,
  type KrumblorBuilding,
  type KrumblorState,
} from '../../src/autoplay/krumblor-strategy';
import { DragonClickAction, DragonStoreAction } from '../../src/actions/krumblor';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY } from '../../src/cursor/types';
import { getAuraPickerCrate, getDragonAuraSlot, getDragonTrainButton, specialTabCanvasPoint } from '../../src/game/dragon-dom';
import type { GameBuilding, GameUpgrade } from '../../src/game/types';
import { LogStore } from '../../src/stats/log';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

/** Buildings by Game.ObjectsById id; every copy costs `price`. */
function blds(owned: Record<number, number>, price = 1): KrumblorBuilding[] {
  return Object.entries(owned).map(([id, o]) => ({ id: Number(id), owned: o, costOf: (n: number) => n * price }));
}

/** Every one of the 20 buildings owned `n` times. */
function all(n: number, price = 1): KrumblorBuilding[] {
  return blds(Object.fromEntries(DRAGON_SACRIFICE_BUILDINGS.map((_b, id) => [id, n])), price);
}

function state(over: Partial<KrumblorState> = {}): KrumblorState {
  return {
    eggBought: true,
    eggInStore: false,
    eggCost: 25,
    dragonLevel: 0,
    auras: [0, 0],
    stage: 1,
    batchEnd: null,
    selectingAura: -1,
    menuOpen: false,
    menuOurs: false,
    pickerOurs: false,
    buildings: [],
    rebuy: [],
    spendable: 1e12,
    funds: { stocks: 0, wrinklers: 0 },
    ...over,
  };
}

describe('Krumblor stages and plans', () => {
  it('unlocks stage 2 with 150 shipments and stage 3 with 220 You', () => {
    expect(krumblorStageFor(149, 0)).toBe(1);
    expect(krumblorStageFor(150, 0)).toBe(2);
    expect(krumblorStageFor(0, 220)).toBe(3);
    expect(KRUMBLOR_STAGE_LEVEL).toEqual({ 1: 6, 2: 14, 3: 27 });
  });

  it('knows what each level sacrifices, and a batch all of it together', () => {
    expect([...dragonSacrificePlan(5)]).toEqual([[0, 100]]);
    expect([...dragonSacrificePlan(24)]).toEqual([[19, 100]]);
    expect(DRAGON_SACRIFICE_BUILDINGS[19]).toBe('You');
    expect(dragonSacrificePlan(25).get(7)).toBe(50);
    expect(dragonSacrificePlan(26).size).toBe(20);
    expect(dragonSacrificePlan(4).size).toBe(0);
    // stage 3 from level 14: 100 of each building from Alchemy labs to You, then 50 and 200 of every one
    const needs = dragonBatchNeeds(14, 27);
    expect(needs.get(19)).toBe(350);
    expect(needs.get(0)).toBe(250);
  });
});

describe('nextKrumblorStep', () => {
  it('buys the crumbly egg once it is in the store and cheap, and does nothing without it', () => {
    expect(nextKrumblorStep(state({ eggBought: false, eggInStore: false })).kind).toBe('done');
    expect(nextKrumblorStep(state({ eggBought: false, eggInStore: true }))).toEqual({ kind: 'buy-egg', cost: 25 });
    expect(nextKrumblorStep(state({ eggBought: false, eggInStore: true, spendable: 10 })).kind).toBe('wait');
  });

  it('pays the egg levels 1M, 2M, 4M, 8M, 16M, opening the popup first', () => {
    expect([0, 1, 2, 3, 4].map(dragonCookieCost)).toEqual([1e6, 2e6, 4e6, 8e6, 16e6]);
    expect(nextKrumblorStep(state({ dragonLevel: 2 })).kind).toBe('open-menu');
    expect(nextKrumblorStep(state({ dragonLevel: 2, menuOpen: true }))).toEqual({ kind: 'train', level: 2 });
  });

  it('only pays reserve-safe cookie costs, and puts its own popup away while waiting', () => {
    expect(nextKrumblorStep(state({ dragonLevel: 4, spendable: 15e6 })).kind).toBe('wait');
    expect(nextKrumblorStep(state({ dragonLevel: 4, spendable: 16e6 })).kind).toBe('open-menu');
    expect(nextKrumblorStep(state({ dragonLevel: 4, spendable: 15e6, menuOpen: true, menuOurs: true })).kind).toBe('close-menu');
    // the player's own popup stays open
    expect(nextKrumblorStep(state({ dragonLevel: 4, spendable: 15e6, menuOpen: true })).kind).toBe('wait');
  });

  it('stage 1: sacrifices 100 cursors (the ones above sold first), then wears Dragon Cursor and stops', () => {
    expect(nextKrumblorStep(state({ dragonLevel: 5, buildings: blds({ 0: 180 }), menuOpen: true }))).toEqual({ kind: 'sell-buildings', id: 0, n: 80, end: 6 });
    expect(nextKrumblorStep(state({ dragonLevel: 5, buildings: blds({ 0: 100 }), menuOpen: true, batchEnd: 6 }))).toEqual({ kind: 'train', level: 5, end: 6 });
    expect(nextKrumblorStep(state({ dragonLevel: 6, buildings: blds({ 0: 0, 1: 500 }), rebuy: [{ id: 0, n: 80 }] }))).toEqual({ kind: 'buy-buildings', id: 0, n: 80, restore: true });
    expect(nextKrumblorStep(state({ dragonLevel: 6, buildings: blds({ 0: 80, 1: 500 }), menuOpen: true }))).toEqual({ kind: 'open-aura', slot: 0, aura: 2 });
    expect(nextKrumblorStep(state({ dragonLevel: 6, auras: [2, 0], buildings: blds({ 0: 80, 1: 500 }) }))).toEqual({ kind: 'done', why: 'stage 1 done' });
  });

  it('batches: buys every missing building first, sells all the extras, trains through, and only then buys back', () => {
    const stage2 = { stage: 2 as const, dragonLevel: 6, auras: [2, 0] as [number, number], menuOpen: true };
    // grandmas ... shipments; the Wizard towers are 43 short
    const owned = { 1: 300, 2: 250, 3: 200, 4: 180, 5: 150, 6: 120, 7: 57, 8: 160 };
    expect(nextKrumblorStep(state({ ...stage2, buildings: blds(owned) }))).toEqual({ kind: 'buy-buildings', id: 7, n: 43, restore: false });
    // all there: the extras go, grandmas first, before a single sacrifice
    const ready = { ...owned, 7: 100 };
    expect(nextKrumblorStep(state({ ...stage2, buildings: blds(ready) }))).toEqual({ kind: 'sell-buildings', id: 1, n: 200, end: 14 });
    const sold = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100 };
    expect(nextKrumblorStep(state({ ...stage2, batchEnd: 14, buildings: blds(sold) }))).toEqual({ kind: 'train', level: 6, end: 14 });
    // mid-batch: the grandmas are gone, no rebuy yet, the next level trains
    const mid = { ...sold, 1: 0 };
    const rebuy = [{ id: 1, n: 200 }];
    expect(nextKrumblorStep(state({ ...stage2, dragonLevel: 7, batchEnd: 14, buildings: blds(mid), rebuy }))).toEqual({ kind: 'train', level: 7, end: 14 });
    // after the batch: buy back, then Dragonflight
    expect(nextKrumblorStep(state({ ...stage2, dragonLevel: 14, buildings: blds({ 1: 0 }), rebuy }))).toEqual({ kind: 'buy-buildings', id: 1, n: 200, restore: true });
    expect(nextKrumblorStep(state({ ...stage2, dragonLevel: 14, buildings: blds({ 1: 200 }) }))).toEqual({ kind: 'open-aura', slot: 0, aura: 10 });
  });

  it('runs a shorter batch when the rest of the stage is too dear, and waits when nothing is ready', () => {
    const stage2 = { stage: 2 as const, dragonLevel: 6, auras: [2, 0] as [number, number], menuOpen: true, spendable: 10 };
    const owned = { 1: 300, 2: 250, 3: 200, 4: 180, 5: 150, 6: 120, 7: 57, 8: 160 };
    // 43 Wizard towers cost 43, above the 10 in the bank: grandmas ... temples go now
    expect(nextKrumblorStep(state({ ...stage2, buildings: blds(owned) }))).toEqual({ kind: 'sell-buildings', id: 1, n: 200, end: 12 });
    expect(nextKrumblorStep(state({ ...stage2, dragonLevel: 12, buildings: blds(owned) })).kind).toBe('wait');
  });

  it('never buys a building it has enough of: it sells it down to what the batch takes', () => {
    const stage2 = { stage: 2 as const, dragonLevel: 6, auras: [2, 0] as [number, number], menuOpen: true };
    // everything is there, some exactly, some with extras: nothing is bought, only the extras sold
    const owned = { 1: 100, 2: 400, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100 };
    expect(nextKrumblorStep(state({ ...stage2, buildings: blds(owned) }))).toEqual({ kind: 'sell-buildings', id: 2, n: 300, end: 14 });
    // only the shortfall is bought: 3 temples, not 100
    expect(nextKrumblorStep(state({ ...stage2, buildings: blds({ ...owned, 6: 97 }) }))).toEqual({ kind: 'buy-buildings', id: 6, n: 3, restore: false });
  });

  it('keeps the buy-back for after the next batch when that one can start right away', () => {
    // stage 3, the first batch (levels 14-24) is done; 25-26 can start now: the sold copies stay sold
    const rebuy = [{ id: 9, n: 300 }];
    const ready = state({ stage: 3, dragonLevel: 25, auras: [10, 0], menuOpen: true, buildings: all(300), rebuy });
    expect(nextKrumblorStep(ready)).toEqual({ kind: 'sell-buildings', id: 0, n: 50, end: 27 });
    // it can't (too dear): buy them back now, before the aura
    const dear = state({ stage: 3, dragonLevel: 25, auras: [10, 0], menuOpen: true, buildings: all(10), rebuy, spendable: 5 });
    expect(nextKrumblorStep(dear)).toEqual({ kind: 'buy-buildings', id: 9, n: 300, restore: true });
  });

  it('never starts a batch the bank does not pay for, but cashes in stock wins and wrinklers when they would', () => {
    const stage2 = { stage: 2 as const, dragonLevel: 6, auras: [2, 0] as [number, number], menuOpen: true };
    // 100 grandmas short at 2 cookies each; 100 in the bank; everything else is there
    const owned = { 1: 0, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100 };
    const base = { ...stage2, buildings: blds(owned, 2), spendable: 100 };
    expect(nextKrumblorStep(state(base)).kind).toBe('wait');
    // the stock wins alone pay for it: cash them in, no wrinkler popped
    expect(nextKrumblorStep(state({ ...base, funds: { stocks: 100, wrinklers: 1000 } }))).toEqual({ kind: 'raise-funds', cost: 200, stocks: 100, wrinklers: 0, end: 14 });
    // the rest from the wrinklers
    expect(nextKrumblorStep(state({ ...base, spendable: 20, funds: { stocks: 100, wrinklers: 1000 } }))).toEqual({ kind: 'raise-funds', cost: 200, stocks: 100, wrinklers: 80, end: 14 });
    // not even all together: wait
    expect(nextKrumblorStep(state({ ...base, spendable: 20, funds: { stocks: 50, wrinklers: 10 } })).kind).toBe('wait');
    // raised: the batch starts
    expect(nextKrumblorStep(state({ ...base, spendable: 200 }))).toEqual({ kind: 'buy-buildings', id: 1, n: 100, restore: false });
  });

  it('gives up a batch that can no longer go on', () => {
    // the player sold the farms mid-batch and 90 new ones are too dear: the sold grandmas come back
    const s = state({ stage: 2, dragonLevel: 7, auras: [2, 0], batchEnd: 14, menuOpen: true, buildings: blds({ 1: 0, 2: 10 }), rebuy: [{ id: 1, n: 200 }], spendable: 5 });
    expect(nextKrumblorStep(s)).toEqual({ kind: 'buy-buildings', id: 1, n: 200, restore: true });
  });

  it('stage 3: trains everything in one batch when it can, 350 You included', () => {
    const s = state({ stage: 3, dragonLevel: 14, auras: [10, 0], menuOpen: true, buildings: all(400) });
    expect(nextKrumblorStep(s)).toEqual({ kind: 'sell-buildings', id: 9, n: 50, end: 27 });
  });

  it('puts on the best known auras between batches: Radiant Appetite first, Dragonflight in the second slot', () => {
    expect(nextAuraGoal(14, [2, 0])).toEqual({ slot: 0, aura: 10 });
    expect(nextAuraGoal(20, [10, 0])).toEqual({ slot: 0, aura: 15 });
    expect(nextAuraGoal(27, [10, 0])).toEqual({ slot: 1, aura: 15 });
    expect(nextAuraGoal(27, [15, 0])).toEqual({ slot: 1, aura: 10 });
    expect(nextAuraGoal(27, [15, 10])).toBeNull();
    // mid-batch nothing is swapped (it would cost a building the batch needs)
    const mid = state({ stage: 3, dragonLevel: 20, auras: [10, 0], batchEnd: 27, menuOpen: true, buildings: all(300) });
    expect(nextKrumblorStep(mid).kind).toBe('sell-buildings');
    expect(nextKrumblorStep(state({ stage: 3, dragonLevel: 27, auras: [10, 0], pickerOurs: true, selectingAura: 15 }))).toEqual({ kind: 'confirm-aura', slot: 1, aura: 15 });
    expect(nextKrumblorStep(state({ stage: 3, dragonLevel: 27, auras: [10, 15] }))).toEqual({ kind: 'done', why: 'stage 3 done' });
  });

  it('never overrides an aura the player picked', () => {
    expect(nextAuraGoal(20, [5, 0])).toBeNull();
    expect(nextAuraGoal(27, [5, 7])).toBeNull();
    expect(nextAuraGoal(27, [5, 0])).toEqual({ slot: 1, aura: 15 });
  });
});

describe('dragon DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="specialPopup" class="framed prompt onScreen">
        <div class="crate enabled" onclick="PlaySound('snd/tick.mp3');Game.SelectDragonAura(0);"></div>
        <div class="close">x</div>
        <div class="optionBox"><a class="option framed large title" onclick="Game.UpgradeDragon();">Train</a></div>
      </div>
      <div id="promptContentPickDragonAura">
        <div class="crate enabled" onclick="PlaySound('snd/tick.mp3');Game.SetDragonAura(1,0);"></div>
        <div class="crate enabled" onclick="PlaySound('snd/tick.mp3');Game.SetDragonAura(2,0);"></div>
      </div>`;
  });

  it('finds the train button, the aura slot and the Dragon Cursor crate by their handlers', () => {
    expect(getDragonTrainButton()?.textContent).toBe('Train');
    expect(getDragonAuraSlot(0)).not.toBeNull();
    expect(getDragonAuraSlot(1)).toBeNull();
    expect(getAuraPickerCrate(2)?.getAttribute('onclick')).toContain('SetDragonAura(2,0)');
  });

  it('ignores a popup that is off screen', () => {
    document.getElementById('specialPopup')!.className = 'framed prompt offScreen';
    expect(getDragonTrainButton()).toBeNull();
  });

  it('puts the dragon tab where Game.UpdateSpecial hit-tests it', () => {
    expect(specialTabCanvasPoint(['dragon'], 'dragon', 900)).toEqual({ x: 24, y: 900 - 72 });
    expect(specialTabCanvasPoint(['santa', 'dragon'], 'dragon', 900)).toEqual({ x: 24, y: 900 - 72 });
    expect(specialTabCanvasPoint(['santa', 'dragon'], 'santa', 900)).toEqual({ x: 24, y: 900 - 120 });
    expect(specialTabCanvasPoint(['santa'], 'dragon', 900)).toBeNull();
  });
});

function setup() {
  document.body.innerHTML = '';

  const runtime = new RuntimeState();
  runtime.running = true;
  const data = new PersistedData();
  data.config.autoPlay = true;
  const game = new FakeGameAdapter();
  game.unbuffedCps = 1e6;
  game.cookies = 1e9;

  const egg = { name: 'A crumbly egg', bought: 1, basePrice: 25, buy: () => {} } as GameUpgrade;
  game.upgradesByName['A crumbly egg'] = egg;

  const cursor = {
    name: 'Cursor',
    id: 0,
    amount: 180,
    buy(n: number) {
      this.amount = (this.amount || 0) + n;
    },
    sell(n: number) {
      this.amount = (this.amount || 0) - n;
    },
    getSumPrice: (n: number) => n * 10,
  } as GameBuilding;
  game.buildingsByName.Cursor = cursor;

  const trainer = new KrumblorTrainer(runtime, data, game, new LogStore(data), () => false);

  return { runtime, data, game, cursor, trainer };
}

describe('KrumblorTrainer', () => {
  beforeEach(() => localStorage.clear());

  it('only works in auto play with "Auto: train Krumblor" on, and not in a dry run', () => {
    const { data, game, trainer } = setup();
    game.dragonLevel = 5;
    game.specialTab = 'dragon';

    expect(trainer.pending()).toBe(true);
    data.config.autoKrumblor = false;
    expect(trainer.pending()).toBe(false);
    data.config.autoKrumblor = true;
    data.config.autoPlay = false;
    expect(trainer.pending()).toBe(false);
    data.config.autoPlay = true;
    data.config.autoDryRun = true;
    expect(trainer.pending()).toBe(false);
    expect(trainer.job()).toBeNull();
  });

  it('holds back while something more important goes on or a foreign prompt is open', () => {
    const { runtime, data, game } = setup();
    game.dragonLevel = 5;
    game.specialTab = 'dragon';

    const busy = new KrumblorTrainer(runtime, data, game, new LogStore(data), () => true);
    expect(busy.pending()).toBe(false);

    const trainer = new KrumblorTrainer(runtime, data, game, new LogStore(data), () => false);
    game.promptOpen = true;
    expect(trainer.pending()).toBe(false);
  });

  it('keeps the highest stage per run, also after the sacrifices drop the count, and starts over next run', () => {
    const { data, game, trainer } = setup();
    const shipment = building(game, 'Shipment', 8, 150);

    expect(trainer.stage()).toBe(2);
    shipment.amount = 0;
    expect(trainer.stage()).toBe(2);
    expect(data.stats.krumblorRun!.stage).toBe(2);
    game.runStartDate += 1000; // ascended
    expect(trainer.stage()).toBe(1);
    building(game, 'You', 19, 220);
    expect(trainer.stage()).toBe(3);
  });

  it('sells the extra cursors with a pulse, starts the batch, and buys them back after it', async () => {
    const { runtime, game, cursor, trainer } = setup();
    game.dragonLevel = 5;
    game.specialTab = 'dragon';

    const req = trainer.job()!;
    expect(req.priority).toBe(JOB_PRIORITY.AUTO_SHOP);
    expect(req.key).toBe('krumblor:sell-buildings');
    expect(req.action).toBeInstanceOf(DragonStoreAction);

    const sleep = vi.fn().mockResolvedValue(undefined);
    await req.action.cursor_at_position({ runtime, clock: { sleep } } as never);

    expect(cursor.amount).toBe(100);
    expect(runtime.krumblorRebuy).toEqual([{ id: 0, n: 80 }]);
    expect(runtime.krumblorBatchEnd).toBe(6);
    expect(runtime.pulseAt).toBeGreaterThan(0);
    expect(trainer.holds(0)).toBe(true);

    // after the sacrifice (level 6, 0 cursors) they are bought back
    cursor.amount = 0;
    game.dragonLevel = 6;
    const back = trainer.job()!;
    expect(back.key).toBe('krumblor:buy-buildings');
    await back.action.cursor_at_position({ runtime, clock: { sleep } } as never);
    expect(cursor.amount).toBe(80);
    expect(runtime.krumblorRebuy).toEqual([]);
    expect(runtime.krumblorBatchEnd).toBeNull();
    expect(trainer.holds(0)).toBe(false);
  });

  it('asks the stock market and the wrinklers for the cookies a batch still needs, and never walks for it', () => {
    const { runtime, game, cursor, trainer } = setup();
    game.dragonLevel = 5;
    cursor.amount = 0; // 100 cursors at 10 each: 1,000
    game.cookies = 100;
    const cashStocks = vi.fn();
    trainer.cashStocks = cashStocks;
    trainer.stockFunds = () => 500;
    trainer.wrinklerFunds = () => 1e6;

    expect(trainer.step()).toEqual({ kind: 'raise-funds', cost: 1000, stocks: 500, wrinklers: 400, end: 6 });
    expect(trainer.pending()).toBe(false);
    expect(trainer.job()).toBeNull();
    expect(cashStocks).toHaveBeenCalled();
    expect(runtime.krumblorWrinklerNeed).toBe(400);

    // paid: the request ends and the batch starts
    game.cookies = 1e9;
    expect(trainer.step()!.kind).toBe('buy-buildings');
    expect(runtime.krumblorWrinklerNeed).toBe(0);
  });

  it('never buys back through buy() while the store is in sell mode', async () => {
    const { runtime, game, cursor, trainer } = setup();
    game.dragonLevel = 6;
    game.dragonAuras = [2, 0];
    cursor.amount = 0;
    runtime.krumblorRebuy = [{ id: 0, n: 50 }];
    game.buyMode = -1;

    const req = trainer.job()!;
    await req.action.cursor_at_position({ runtime, clock: { sleep: vi.fn().mockResolvedValue(undefined) } } as never);

    expect(cursor.amount).toBe(0);
    expect(runtime.krumblorRebuy).toEqual([{ id: 0, n: 50 }]);
    expect(runtime.krumblorBlockUntil).toBeGreaterThan(Date.now());
  });

  it('opens the popup by clicking the dragon tab on the left canvas', () => {
    const { game, trainer } = setup();
    game.dragonLevel = 3;
    game.specialTabs = ['dragon'];
    game.cookies = 1e12; // the 8M egg level is insignificant (<= 0.1% of the bank)

    document.body.innerHTML = '<canvas id="backgroundLeftCanvas" width="300" height="900"></canvas>';
    const canvas = document.getElementById('backgroundLeftCanvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 30, width: 300, height: 900, right: 300, bottom: 930, x: 0, y: 30, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });

    const req = trainer.job()!;
    expect(req.key).toBe('krumblor:open-menu');
    expect(req.action).toBeInstanceOf(DragonClickAction);
    expect((req.action as DragonClickAction).target()).toEqual({ x: 24, y: 30 + 900 - 72 });
  });
});

function building(game: FakeGameAdapter, name: string, id: number, amount: number): GameBuilding {
  const b = { name, id, amount, buy() {}, sell() {} } as GameBuilding;
  game.buildingsByName[name] = b;
  return b;
}
