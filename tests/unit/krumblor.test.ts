import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KrumblorTrainer } from '../../src/autoplay/krumblor';
import { DRAGON_SACRIFICE_BUILDINGS, DRAGONFLIGHT_LEVEL, dragonCookieCost, dragonSacrificeIndex, nextKrumblorStep, type KrumblorState } from '../../src/autoplay/krumblor-strategy';
import { DragonClickAction, DragonStoreAction } from '../../src/actions/krumblor';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY } from '../../src/cursor/types';
import { getAuraPickerCrate, getDragonAuraSlot, getDragonTrainButton, specialTabCanvasPoint } from '../../src/game/dragon-dom';
import type { GameBuilding, GameUpgrade } from '../../src/game/types';
import { LogStore } from '../../src/stats/log';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function state(over: Partial<KrumblorState> = {}): KrumblorState {
  return {
    eggBought: true,
    eggInStore: false,
    eggCost: 25,
    dragonLevel: 0,
    auras: [0, 0],
    selectingAura: -1,
    menuOpen: false,
    menuOurs: false,
    pickerOurs: false,
    sacrifice: null,
    rebuy: null,
    spendable: 1e12,
    insignificant: 1e12,
    ...over,
  };
}

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

  it('only pays insignificant, reserve-safe cookie costs, and puts its own popup away while waiting', () => {
    expect(nextKrumblorStep(state({ dragonLevel: 4, insignificant: 15e6 })).kind).toBe('wait');
    expect(nextKrumblorStep(state({ dragonLevel: 4, spendable: 15e6 })).kind).toBe('wait');
    expect(nextKrumblorStep(state({ dragonLevel: 4, spendable: 15e6, menuOpen: true, menuOurs: true })).kind).toBe('close-menu');
    // the player's own popup stays open
    expect(nextKrumblorStep(state({ dragonLevel: 4, spendable: 15e6, menuOpen: true })).kind).toBe('wait');
  });

  it('sells the buildings above 100 right before the sacrifice, then trains', () => {
    const cursors = (owned: number) => ({ id: 0, owned, buyUpCost: 0 });
    expect(nextKrumblorStep(state({ dragonLevel: 5, sacrifice: cursors(180) })).kind).toBe('open-menu');
    expect(nextKrumblorStep(state({ dragonLevel: 5, sacrifice: cursors(180), menuOpen: true }))).toEqual({ kind: 'sell-buildings', id: 0, n: 80 });
    expect(nextKrumblorStep(state({ dragonLevel: 5, sacrifice: cursors(100), menuOpen: true, rebuy: { building: cursors(100), n: 80 } }))).toEqual({ kind: 'train', level: 5 });
  });

  it('buys the buildings back after the sacrifice, before the next one', () => {
    const cursors = { id: 0, owned: 0, buyUpCost: 0 };
    const grandmas = { id: 1, owned: 300, buyUpCost: 0 };
    expect(nextKrumblorStep(state({ dragonLevel: 6, sacrifice: grandmas, rebuy: { building: cursors, n: 80 }, menuOpen: true }))).toEqual({
      kind: 'buy-buildings',
      id: 0,
      n: 80,
      restore: true,
    });
    expect(nextKrumblorStep(state({ dragonLevel: 6, sacrifice: grandmas, menuOpen: true }))).toEqual({ kind: 'sell-buildings', id: 1, n: 200 });
  });

  it('sacrifices every building from cursors to shipments, in Game.ObjectsById order', () => {
    expect([5, 6, 12, 13, 14].map(dragonSacrificeIndex)).toEqual([0, 1, 7, 8, -1]);
    expect(DRAGON_SACRIFICE_BUILDINGS[dragonSacrificeIndex(13)]).toBe('Shipment');
    expect(DRAGONFLIGHT_LEVEL).toBe(14);
    const shipments = { id: 8, owned: 100, buyUpCost: 0 };
    expect(nextKrumblorStep(state({ dragonLevel: 13, sacrifice: shipments, menuOpen: true }))).toEqual({ kind: 'train', level: 13 });
  });

  it('buys missing buildings up to 100 when that is cheap, else waits', () => {
    const towers = { id: 7, owned: 57, buyUpCost: 5e6 };
    expect(nextKrumblorStep(state({ dragonLevel: 12, sacrifice: towers, menuOpen: true }))).toEqual({ kind: 'buy-buildings', id: 7, n: 43, restore: false });
    expect(nextKrumblorStep(state({ dragonLevel: 12, sacrifice: towers, insignificant: 1e6 })).kind).toBe('wait');
    expect(nextKrumblorStep(state({ dragonLevel: 12, sacrifice: null })).kind).toBe('wait');
  });

  it('puts on Dragonflight: slot, pick, confirm, then closes its popup', () => {
    expect(nextKrumblorStep(state({ dragonLevel: 14 })).kind).toBe('open-menu');
    expect(nextKrumblorStep(state({ dragonLevel: 14, menuOpen: true, menuOurs: true })).kind).toBe('open-aura');
    expect(nextKrumblorStep(state({ dragonLevel: 14, menuOpen: true, pickerOurs: true, selectingAura: 0 })).kind).toBe('pick-aura');
    expect(nextKrumblorStep(state({ dragonLevel: 14, menuOpen: true, pickerOurs: true, selectingAura: 10 })).kind).toBe('confirm-aura');
    expect(nextKrumblorStep(state({ dragonLevel: 14, auras: [10, 0], menuOpen: true, menuOurs: true })).kind).toBe('close-menu');
    expect(nextKrumblorStep(state({ dragonLevel: 14, auras: [10, 0] })).kind).toBe('done');
  });

  it('keeps training past Dragon Cursor and swaps it for Dragonflight', () => {
    expect(nextKrumblorStep(state({ dragonLevel: 6, auras: [2, 0], sacrifice: { id: 1, owned: 100, buyUpCost: 0 }, menuOpen: true })).kind).toBe('train');
    expect(nextKrumblorStep(state({ dragonLevel: 14, auras: [2, 0], menuOpen: true })).kind).toBe('open-aura');
  });

  it('never overrides an aura the player picked', () => {
    expect(nextKrumblorStep(state({ dragonLevel: 20, auras: [15, 0] })).kind).toBe('done');
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

  it('sells the extra cursors at the Cursor row with a pulse, and remembers them for the rebuy', async () => {
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
    expect(runtime.krumblorRebuy).toBe(80);
    expect(runtime.krumblorRebuyId).toBe(0);
    expect(runtime.pulseAt).toBeGreaterThan(0);

    // after the sacrifice (level 6, 0 cursors) they are bought back
    cursor.amount = 0;
    game.dragonLevel = 6;
    const back = trainer.job()!;
    expect(back.key).toBe('krumblor:buy-buildings');
    await back.action.cursor_at_position({ runtime, clock: { sleep } } as never);
    expect(cursor.amount).toBe(80);
    expect(runtime.krumblorRebuy).toBe(0);
  });

  it('sells the grandmas above 100 before the Elder Battalion sacrifice', async () => {
    const { runtime, game, trainer } = setup();
    const grandma = { name: 'Grandma', id: 1, plural: 'grandmas', amount: 130, buy() {}, sell(n: number) { this.amount = (this.amount || 0) - n; } } as GameBuilding;
    game.buildingsByName.Grandma = grandma;
    game.dragonLevel = 6;
    game.specialTab = 'dragon';

    const req = trainer.job()!;
    expect(req.key).toBe('krumblor:sell-buildings');
    await req.action.cursor_at_position({ runtime, clock: { sleep: vi.fn().mockResolvedValue(undefined) } } as never);

    expect(grandma.amount).toBe(100);
    expect(runtime.krumblorRebuy).toBe(30);
    expect(runtime.krumblorRebuyId).toBe(1);
  });

  it('never buys back through buy() while the store is in sell mode', async () => {
    const { runtime, game, cursor, trainer } = setup();
    game.dragonLevel = 6;
    game.dragonAuras = [2, 0];
    cursor.amount = 0;
    runtime.krumblorRebuy = 50;
    game.buyMode = -1;

    const req = trainer.job()!;
    await req.action.cursor_at_position({ runtime, clock: { sleep: vi.fn().mockResolvedValue(undefined) } } as never);

    expect(cursor.amount).toBe(0);
    expect(runtime.krumblorRebuy).toBe(50);
    expect(runtime.krumblorBlockUntil).toBeGreaterThan(Date.now());
  });

  it('opens the popup by clicking the dragon tab on the left canvas', () => {
    const { game, trainer } = setup();
    game.dragonLevel = 3;
    game.specialTabs = ['dragon'];

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
