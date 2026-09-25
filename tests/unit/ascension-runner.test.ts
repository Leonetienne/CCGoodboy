import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AscensionPlanner } from '../../src/autoplay/ascension';
import { ASCEND_SETTLE_MS, AscensionRunner } from '../../src/autoplay/ascension-runner';
import { nextAscensionStep, type AscendState } from '../../src/autoplay/ascension-steps';
import type { AscensionPlan } from '../../src/autoplay/ascension-strategy';
import type { HeavenlyShopPlan } from '../../src/autoplay/heavenly-shopping';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { GameWrinkler } from '../../src/game/types';
import { LogStore } from '../../src/stats/log';
import { StatsRecorder } from '../../src/stats/stats';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function state(over: Partial<AscendState> = {}): AscendState {
  return { want: false, ours: false, prompt: '', intro: false, onScreen: false, wrinklers: [], toBuy: [], ...over };
}

describe('nextAscensionStep (ASC-10)', () => {
  it('does nothing until the plan says ascend', () => {
    expect(nextAscensionStep(state())).toEqual({ kind: 'wait' });
  });

  it('pops every wrinkler first, then clicks Legacy', () => {
    expect(nextAscensionStep(state({ want: true, wrinklers: [4, 2] }))).toEqual({ kind: 'pop-wrinkler', id: 4 });
    expect(nextAscensionStep(state({ want: true }))).toEqual({ kind: 'open-legacy' });
  });

  it('confirms its own "Ascend" prompt, or cancels it once the moment passed', () => {
    expect(nextAscensionStep(state({ ours: true, prompt: 'Ascend', want: true }))).toEqual({ kind: 'confirm-ascend' });
    expect(nextAscensionStep(state({ ours: true, prompt: 'Ascend', want: false }))).toEqual({ kind: 'cancel-ascend' });
  });

  it('never touches a prompt or an ascension it did not start', () => {
    expect(nextAscensionStep(state({ prompt: 'Ascend', want: true }))).toEqual({ kind: 'wait' });
    expect(nextAscensionStep(state({ ours: true, prompt: 'PickDragonAura' }))).toEqual({ kind: 'wait' });
    expect(nextAscensionStep(state({ intro: true }))).toEqual({ kind: 'wait' });
    expect(nextAscensionStep(state({ onScreen: true, toBuy: [{ id: 1, name: 'A', clickable: true }] }))).toEqual({ kind: 'wait' });
  });

  it('sits out the animation, then buys the list crate by crate, dragging to each first', () => {
    expect(nextAscensionStep(state({ ours: true, intro: true }))).toEqual({ kind: 'intro' });
    expect(nextAscensionStep(state({ ours: true, onScreen: true, toBuy: [{ id: 1, name: 'A', clickable: false }] }))).toEqual({ kind: 'pan', id: 1, name: 'A' });
    expect(nextAscensionStep(state({ ours: true, onScreen: true, toBuy: [{ id: 1, name: 'A', clickable: true }] }))).toEqual({ kind: 'buy', id: 1, name: 'A' });
  });

  it('reincarnates once the list is bought', () => {
    expect(nextAscensionStep(state({ ours: true, onScreen: true }))).toEqual({ kind: 'reincarnate' });
    expect(nextAscensionStep(state({ ours: true, onScreen: true, prompt: 'Reincarnate' }))).toEqual({ kind: 'confirm-reincarnate' });
  });
});

const ON = { left: 480, top: 360, right: 540, bottom: 400, width: 60, height: 40, x: 480, y: 360, toJSON: () => ({}) } as DOMRect;
const OFF = { ...ON, left: 3000, right: 3060, x: 3000 } as DOMRect;

/** An element with `id` in the page at `rect`. */
function place(id: string, rect: DOMRect, parent: Element = document.body): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.style.opacity = '1';
  el.getBoundingClientRect = () => rect;
  parent.appendChild(el);
  return el;
}

/** Just what the runner reads from a plan. */
function plan(verdict: AscensionPlan['verdict'], sevens = 0, luckySafeSec = Infinity): AscensionPlan {
  return { verdict, prestige: 100, gain: 150, pendingLevel: 250, shop: { items: [], sevens }, luckySafeSec } as unknown as AscensionPlan;
}

function wrinkler(id: number, sucked: number, r: number): GameWrinkler {
  return { id, phase: 2, sucked, x: 300, y: 300, r };
}

describe('AscensionRunner (ASC-10)', () => {
  let runtime: RuntimeState;
  let data: PersistedData;
  let game: FakeGameAdapter;
  let current: AscensionPlan | null;
  let shopNow: HeavenlyShopPlan | null;
  let interrupted: boolean;
  let runner: AscensionRunner;

  beforeEach(() => {
    localStorage.clear();
    runtime = new RuntimeState();
    data = new PersistedData();
    data.config.autoPlay = true;
    data.config.autoAscend = true;
    game = new FakeGameAdapter();
    current = plan('ascend');
    shopNow = null;
    interrupted = false;

    const planner = { plan: () => current, shoppingNow: () => shopNow } as unknown as AscensionPlanner;
    runner = new AscensionRunner(runtime, data, game, new LogStore(data), new StatsRecorder(data), planner, () => interrupted);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('stays off without "Auto: ascend" or auto play', () => {
    data.config.autoAscend = false;
    expect(runner.step()).toBeNull();
    data.config.autoAscend = true;
    data.config.autoPlay = false;
    expect(runner.step()).toBeNull();
  });

  it('only ascends when the plan says so', () => {
    current = plan('growing');
    expect(runner.step()).toBeNull();
    current = plan('ascend');
    expect(runner.step()).toEqual({ kind: 'open-legacy' });
  });

  it('never ascends during a CpS buff, a golden cookie or anything else more important', () => {
    game.rawBuffs = { Frenzy: { name: 'Frenzy', multCpS: 7, time: 3000 } };
    expect(runner.step()).toBeNull();
    game.rawBuffs = {};
    interrupted = true;
    expect(runner.step()).toBeNull();
  });

  it('lets a lucky level go that ends before the wrinklers are popped (ASC-12)', () => {
    game.wrinklers = [wrinkler(0, 100, 0), wrinkler(1, 500, 180)];
    // 30s + 2 pops x 5s = 40s needed
    current = plan('ascend', 1, 39);
    expect(runner.step()).toBeNull();
    expect(runner.botLine()).toMatch(/^Paw: will ascend once the next lucky level/);
    current = plan('ascend', 1, 41);
    expect(runner.step()).toEqual({ kind: 'pop-wrinkler', id: 1 });
    // without lucky wishes the 7s don't matter
    current = plan('ascend', 0, 0);
    expect(runner.step()).toEqual({ kind: 'pop-wrinkler', id: 1 });
  });

  it('pops the fattest wrinkler first, shiny ones too (ascending would lose them)', () => {
    game.wrinklers = [wrinkler(0, 100, 0), { ...wrinkler(1, 500, 180), type: 1 }];
    expect(runner.step()).toEqual({ kind: 'pop-wrinkler', id: 1 });
  });

  it('clicks the Legacy button', () => {
    place('legacyButton', ON);
    expect(runner.job()?.key).toBe('ascend:open-legacy');
  });

  it('only logs in a dry run and never counts as pending', () => {
    data.config.autoDryRun = true;
    place('legacyButton', ON);
    expect(runner.pending()).toBe(false);
    expect(runner.job()).toBeNull();
    expect(data.logs.some((l) => l.meta === 'would ascend')).toBe(true);
  });

  it('confirms its own "Ascend" prompt, and cancels it when a buff comes up', () => {
    const box = place('promptContent', ON);
    place('promptContentAscend', ON, box);
    game.promptOpen = true;
    runtime.ascendOurs = true;
    expect(runner.step()).toEqual({ kind: 'confirm-ascend' });

    game.rawBuffs = { Frenzy: { name: 'Frenzy', multCpS: 7, time: 3000 } };
    expect(runner.step()).toEqual({ kind: 'cancel-ascend' });
  });

  it("does not cancel its own prompt over shopping's pause (the open/cancel loop)", () => {
    // Shopping pauses itself when a re-plan is refused, e.g. because a prompt is open.
    runtime.autoBlockUntil = Date.now() + 10000;
    expect(runner.step()).toEqual({ kind: 'open-legacy' });

    const box = place('promptContent', ON);
    place('promptContentAscend', ON, box);
    game.promptOpen = true;
    runtime.ascendOurs = true;
    expect(runner.step()).toEqual({ kind: 'confirm-ascend' });
  });

  it('claims the "Ascend" prompt the moment it clicks Legacy', () => {
    place('legacyButton', ON);
    const action = runner.job()!.action as unknown as { p: { onClicked?: () => void } };
    action.p.onClicked!();
    expect(runtime.ascendOurs).toBe(true);
  });

  it('forgets an ascension it started once the game is back to normal without its prompt', () => {
    runtime.ascendOurs = true;
    runner.state();
    expect(runtime.ascendOurs).toBe(false);
  });

  it('always says what the bot does about ascending (ASC-11)', () => {
    data.config.autoPlay = false;
    expect(runner.botLine()).toBe("Paw: auto play is off, so it won't ascend by itself");
    data.config.autoPlay = true;
    data.config.autoAscend = false;
    expect(runner.botLine()).toBe('Paw: "Auto: ascend" is off, so it won\'t ascend by itself');
    data.config.autoAscend = true;
    expect(runner.botLine()).toBe('Paw: ascending now');
    game.rawBuffs = { Frenzy: { name: 'Frenzy', multCpS: 7, time: 3000 } };
    expect(runner.botLine()).toBe('Paw: will ascend once the buffs are over');
    data.config.autoDryRun = true;
    expect(runner.botLine()).toBe('Paw: dry run, it only writes "would ascend" in the log');
    current = plan('growing');
    expect(runner.botLine()).toBe('Paw: dry run, it only writes "would ascend" in the log');
    data.config.autoDryRun = false;
    expect(runner.botLine()).toBe('Paw: will ascend by itself once it pays off');
  });

  describe('on the ascension screen', () => {
    beforeEach(() => {
      game.ascending = true;
      game.ascendScreen = true;
      runtime.ascendOurs = true;
      runtime.ascendOursAt = Date.now();
      game.heavenlyUpgrades = [{ id: 5, name: 'Heavenly cookies', price: 3, bought: false, parents: [], canBePurchased: true }];
      shopNow = { items: [{ name: 'Heavenly cookies', price: 3 }] } as unknown as HeavenlyShopPlan;
    });

    it('leaves an ascension it did not start alone', () => {
      runtime.ascendOurs = false;
      expect(runner.step()).toBeNull();
    });

    it('drags the tree to a crate off screen, then buys it', () => {
      const crate = place('heavenlyUpgrade5', OFF);
      expect(runner.step()).toEqual({ kind: 'pan', id: 5, name: 'Heavenly cookies' });

      crate.getBoundingClientRect = () => ON;
      expect(runner.step()).toEqual({ kind: 'buy', id: 5, name: 'Heavenly cookies' });
      expect(runner.job()?.key).toBe('ascend:buy:5');
    });

    it('skips a crate that is not in the tree and reincarnates', () => {
      runner.job();
      expect(runtime.ascendSkip.has('Heavenly cookies')).toBe(true);
      expect(runner.step()).toEqual({ kind: 'reincarnate' });
    });

    it('never stays in heaven longer than 3 minutes', () => {
      place('heavenlyUpgrade5', ON);
      runtime.ascendOursAt = Date.now() - 4 * 60 * 1000;
      expect(runner.step()).toEqual({ kind: 'reincarnate' });
    });
  });
});

describe('RuntimeState.resetForNewRun (ASC-10)', () => {
  it('forgets the old run and holds the scheduler while the game settles', () => {
    const runtime = new RuntimeState();
    runtime.lockA = true;
    runtime.krumblorRebuy = 40;
    runtime.ascendOurs = true;
    runtime.ascendSkip.add('X');
    runtime.autoHammerState.cal = 3;

    runtime.resetForNewRun(ASCEND_SETTLE_MS, 1000);

    expect(runtime.lockA).toBe(false);
    expect(runtime.krumblorRebuy).toBe(0);
    expect(runtime.ascendOurs).toBe(false);
    expect(runtime.ascendSkip.size).toBe(0);
    expect(runtime.autoHammerState.cal).toBe(1);
    expect(runtime.settleUntil).toBe(1000 + ASCEND_SETTLE_MS);
  });
});
