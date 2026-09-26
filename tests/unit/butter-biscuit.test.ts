import { beforeEach, describe, expect, it } from 'vitest';
import { ButterBiscuitHunter } from '../../src/autoplay/butter-biscuit';
import { BUTTER_UNLOCK_WAIT_MS, nextButterStep, type ButterState } from '../../src/autoplay/butter-biscuit-strategy';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { DragonStoreAction } from '../../src/actions/krumblor';
import type { GameBuilding, GameUpgrade } from '../../src/game/types';
import { LogStore } from '../../src/stats/log';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function state(over: Partial<ButterState> = {}): ButterState {
  return {
    towers: 57,
    cap: 57,
    minOther: 120,
    unlocked: new Set(),
    buyCost: (n) => n * 10,
    spendable: 1e9,
    maxCost: 1e9,
    krumblorBusy: false,
    topUp: null,
    now: 100000,
    ...over,
  };
}

describe('nextButterStep', () => {
  it('tops Wizard towers up to 100 once everything else has 100', () => {
    expect(nextButterStep(state())).toEqual({ kind: 'buy-towers', n: 43, level: 100, cost: 430 });
    expect(nextButterStep(state({ minOther: 99 })).kind).toBe('done');
  });

  it('goes for the highest milestone it can pay, which also unlocks the lower ones', () => {
    expect(nextButterStep(state({ minOther: 210 }))).toMatchObject({ kind: 'buy-towers', n: 143, level: 200 });
    // 200 too dear: 150 then
    expect(nextButterStep(state({ minOther: 210, maxCost: 1000 }))).toMatchObject({ kind: 'buy-towers', n: 93, level: 150 });
    // already unlocked ones are skipped
    expect(nextButterStep(state({ minOther: 160, unlocked: new Set([100, 150]) })).kind).toBe('done');
  });

  it('waits unless the towers cost less than 1% of the bank, and leaves the reserve alone', () => {
    expect(nextButterStep(state({ maxCost: 430 })).kind).toBe('wait');
    expect(nextButterStep(state({ maxCost: 431 })).kind).toBe('buy-towers');
    expect(nextButterStep(state({ spendable: 429 })).kind).toBe('wait');
  });

  it('leaves it to shopping when the tower target reaches the milestone, and to Krumblor while it needs the towers', () => {
    expect(nextButterStep(state({ cap: 100 })).kind).toBe('done');
    expect(nextButterStep(state({ towers: 100 })).kind).toBe('done');
    expect(nextButterStep(state({ krumblorBusy: true })).kind).toBe('done');
  });

  it('waits for the unlock after a top-up, then sells back down', () => {
    const topUp = { level: 100, sellTo: 57, at: 99000 };
    expect(nextButterStep(state({ towers: 100, topUp })).kind).toBe('wait');
    expect(nextButterStep(state({ towers: 100, topUp, unlocked: new Set([100]) }))).toEqual({ kind: 'sell-towers', n: 43, level: 100 });
    // no unlock in time: sells anyway
    expect(nextButterStep(state({ towers: 100, topUp, now: 99000 + BUTTER_UNLOCK_WAIT_MS })).kind).toBe('sell-towers');
    expect(nextButterStep(state({ towers: 57, topUp })).kind).toBe('done');
  });
});

function setup() {
  document.body.innerHTML = '<div id="product7"></div>';

  const runtime = new RuntimeState();
  runtime.running = true;
  const data = new PersistedData();
  data.config.autoPlay = true;
  const game = new FakeGameAdapter();
  game.unbuffedCps = 1e6;
  game.cookies = 1e12;

  const mk = (name: string, id: number, amount: number) =>
    ({
      name,
      id,
      amount,
      buy(n: number) {
        this.amount = (this.amount || 0) + n;
      },
      sell(n: number) {
        this.amount = (this.amount || 0) - n;
      },
      getSumPrice: (n: number) => n * 1e6,
    }) as GameBuilding;

  const cursor = mk('Cursor', 0, 120);
  const towers = mk('Wizard tower', 7, 57);
  game.buildings = [cursor, towers];
  game.buildingsByName = { Cursor: cursor, 'Wizard tower': towers };

  const biscuit = { name: 'Milk chocolate butter biscuit', unlocked: 0, buy: () => {} } as GameUpgrade;
  game.upgradesByName[biscuit.name] = biscuit;

  const hunter = new ButterBiscuitHunter(runtime, data, game, new LogStore(data), () => false);

  return { runtime, data, game, towers, biscuit, hunter };
}

async function run(hunter: ButterBiscuitHunter) {
  const job = hunter.job();
  expect(job?.action).toBeInstanceOf(DragonStoreAction);
  (job!.action as unknown as { p: { run: () => void } }).p.run();
}

describe('ButterBiscuitHunter', () => {
  beforeEach(() => localStorage.clear());

  it('buys the towers up to 100, waits for the unlock, and sells back to the target', async () => {
    const { runtime, towers, biscuit, hunter } = setup();

    expect(hunter.pending()).toBe(true);
    await run(hunter);
    expect(towers.amount).toBe(100);
    expect(runtime.butterTopUp).toMatchObject({ level: 100, sellTo: 57 });
    expect(hunter.pending()).toBe(false);

    biscuit.unlocked = 1;
    expect(hunter.pending()).toBe(true);
    await run(hunter);
    expect(towers.amount).toBe(57);
    expect(runtime.butterTopUp).toBeNull();
    expect(hunter.pending()).toBe(false);
  });

  it('only runs in auto play, not in a dry run, and below 1% of the bank', () => {
    const { data, game, hunter } = setup();

    data.config.autoPlay = false;
    expect(hunter.pending()).toBe(false);
    data.config.autoPlay = true;
    data.config.autoDryRun = true;
    expect(hunter.pending()).toBe(false);
    expect(hunter.job()).toBeNull();
    data.config.autoDryRun = false;

    // 43 towers x 1M = 43M: needs a bank above 4.3B
    game.cookies = 4.3e9;
    expect(hunter.pending()).toBe(false);
    game.cookies = 4.4e9;
    expect(hunter.pending()).toBe(true);
  });

  it('pauses instead of buying again when the biscuit did not unlock', async () => {
    const { runtime, towers, hunter } = setup();

    await run(hunter);
    runtime.butterTopUp!.at = 0;
    await run(hunter);
    expect(towers.amount).toBe(57);
    expect(runtime.butterBlockUntil).toBeGreaterThan(Date.now() + 60000);
    expect(hunter.pending()).toBe(false);
  });
});
