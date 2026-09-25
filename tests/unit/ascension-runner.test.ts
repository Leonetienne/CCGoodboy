import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AscensionPlanner } from '../../src/autoplay/ascension';
import { ASCEND_SETTLE_MS, AscensionRunner, LEAD_PER_POP_SEC, LEAD_FACTOR, LEAD_SAFETY_SEC, LOCK_SLACK_SEC } from '../../src/autoplay/ascension-runner';
import { nextAscensionStep, type AscendState } from '../../src/autoplay/ascension-steps';
import { cookiesForLevel, type AscensionPlan } from '../../src/autoplay/ascension-strategy';
import type { HeavenlyShopPlan } from '../../src/autoplay/heavenly-shopping';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY } from '../../src/cursor/types';
import type { GameWrinkler } from '../../src/game/types';
import { LogStore } from '../../src/stats/log';
import { StatsRecorder } from '../../src/stats/stats';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function state(over: Partial<AscendState> = {}): AscendState {
  return { committed: false, want: false, ours: false, prompt: '', intro: false, onScreen: false, wrinklers: [], stocks: [], dump: null, toBuy: [], ...over };
}

describe('nextAscensionStep (ASC-10/12)', () => {
  it('does nothing until a target is locked', () => {
    expect(nextAscensionStep(state())).toEqual({ kind: 'wait' });
    expect(nextAscensionStep(state({ wrinklers: [1], stocks: [1] }))).toEqual({ kind: 'wait' });
  });

  it('pops, sells and spends, in that order, then holds until the level is there', () => {
    const dump = { name: 'Farm', id: 2, target: 50, count: 3 };
    expect(nextAscensionStep(state({ committed: true, wrinklers: [4, 2], stocks: [1], dump }))).toEqual({ kind: 'pop-wrinkler', id: 4 });
    expect(nextAscensionStep(state({ committed: true, stocks: [1], dump }))).toEqual({ kind: 'sell-stock', id: 1 });
    expect(nextAscensionStep(state({ committed: true, dump }))).toEqual({ kind: 'dump', ...dump });
    expect(nextAscensionStep(state({ committed: true }))).toEqual({ kind: 'hold' });
  });

  it('goes straight to Legacy once the level is there, whatever preparation is left', () => {
    expect(nextAscensionStep(state({ committed: true, want: true }))).toEqual({ kind: 'open-legacy' });
    expect(nextAscensionStep(state({ committed: true, want: true, wrinklers: [4], stocks: [1] }))).toEqual({ kind: 'open-legacy' });
  });

  it('confirms its own "Ascend" prompt, or cancels it once the level is gone', () => {
    expect(nextAscensionStep(state({ ours: true, prompt: 'Ascend', want: true }))).toEqual({ kind: 'confirm-ascend' });
    expect(nextAscensionStep(state({ ours: true, prompt: 'Ascend', want: false }))).toEqual({ kind: 'cancel-ascend' });
  });

  it('never touches a prompt or an ascension it did not start', () => {
    expect(nextAscensionStep(state({ prompt: 'Ascend', want: true }))).toEqual({ kind: 'wait' });
    expect(nextAscensionStep(state({ ours: true, prompt: 'PickDragonAura' }))).toEqual({ kind: 'wait' });
    expect(nextAscensionStep(state({ committed: true, prompt: 'PickDragonAura' }))).toEqual({ kind: 'wait' });
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

/** Just what the runner reads from a plan: the target level, its ETA and window. */
function plan(verdict: AscensionPlan['verdict'], level = 250, etaSec = 0, sevens = 0, luckyEnd = Infinity): AscensionPlan {
  return { verdict, prestige: 100, gain: 150, pendingLevel: 250, shop: { items: [], level, etaSec, sevens }, routineEtaSec: etaSec, luckyEnd } as unknown as AscensionPlan;
}

function wrinkler(id: number, sucked: number, r: number): GameWrinkler {
  return { id, phase: 2, sucked, x: 300, y: 300, r };
}

/** All-time cookies just past `level`. */
function atLevel(level: number): number {
  return cookiesForLevel(level, 3) * (1 + 1e-9);
}

describe('AscensionRunner (ASC-10/12)', () => {
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
    game.cookiesEarned = atLevel(250);
    // 1170-1179 lasts ~40s, 1170 is ~27 min away from 250
    game.unbuffedCps = 1e18;
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
    expect(runtime.ascendTarget).toBeNull();
  });

  it('only ascends when the plan says so', () => {
    current = plan('growing');
    expect(runner.step()).toBeNull();
    current = plan('ascend');
    expect(runner.step()).toEqual({ kind: 'open-legacy' });
    expect(runner.committed()).toBe(true);
  });

  it('never starts during a CpS buff, a golden cookie or anything else more important', () => {
    game.rawBuffs = { Frenzy: { name: 'Frenzy', multCpS: 7, time: 3000 } };
    expect(runner.step()).toBeNull();
    game.rawBuffs = {};
    interrupted = true;
    expect(runner.step()).toBeNull();
    expect(runtime.ascendTarget).toBeNull();
  });

  it('estimates the lead time from the pops, sales and achievements ahead, plus a safety buffer', () => {
    expect(runner.leadSec()).toBe(LEAD_SAFETY_SEC);
    game.wrinklers = [wrinkler(0, 100, 0), wrinkler(1, 500, 180)];
    expect(runner.leadSec()).toBe(Math.ceil(2 * LEAD_PER_POP_SEC * LEAD_FACTOR) + LEAD_SAFETY_SEC);
  });

  it('locks the target once its ETA is down to the lead time, not before', () => {
    const lead = runner.leadSec();
    current = plan('waiting', 1170, lead + LOCK_SLACK_SEC + 60, 1, 1179);
    expect(runner.step()).toBeNull();
    expect(runtime.ascendTarget).toBeNull();
    expect(runner.botLine()).toMatch(/^Paw: will get ready ~.* before level 1,170, then ascend there$/);

    current = plan('waiting', 1170, lead + 10, 1, 1179);
    expect(runner.step()).toEqual({ kind: 'hold' });
    expect(runtime.ascendTarget).toMatchObject({ level: 1170, end: 1179, sevens: 1 });
  });

  it('keeps the locked level, whatever the plan says afterwards', () => {
    current = plan('waiting', 1170, 10, 1, 1179);
    runner.step();
    current = plan('growing', 1270, 10, 1, 1279);
    expect(runner.step()).toEqual({ kind: 'hold' });
    expect(runtime.ascendTarget?.level).toBe(1170);
    // a buff or a golden cookie no longer holds it back
    game.rawBuffs = { Frenzy: { name: 'Frenzy', multCpS: 7, time: 3000 } };
    interrupted = true;
    expect(runner.step()).toEqual({ kind: 'hold' });
  });

  it('pops, sells and spends, then holds at Legacy, then ascends when the level comes', () => {
    game.wrinklers = [wrinkler(0, 100, 0), wrinkler(1, 500, 180)];
    current = plan('waiting', 1170, 10, 1, 1179);
    expect(runner.step()).toEqual({ kind: 'pop-wrinkler', id: 1 });
    game.wrinklers = [];
    expect(runner.step()).toEqual({ kind: 'hold' });
    expect(runtime.ascendPrepDone).toBe(true);
    expect(runner.botLine()).toMatch(/^Paw: ready at Legacy, waiting for level 1,170 \(now 250\), no golden cookies meanwhile$/);

    // wrinklers that grow back during the wait are left alone
    game.wrinklers = [wrinkler(2, 5, 0)];
    expect(runner.step()).toEqual({ kind: 'hold' });

    game.cookiesEarned = atLevel(1170);
    expect(runner.step()).toEqual({ kind: 'open-legacy' });
  });

  it('holds with the paw at Legacy, above golden cookies', () => {
    place('legacyButton', ON);
    current = plan('waiting', 1170, 10, 1, 1179);
    const job = runner.job()!;
    expect(job.key).toBe('ascend:hold');
    expect(job.priority).toBe(JOB_PRIORITY.ASCEND);
    expect((job.action as unknown as { abortOnGolden?: boolean }).abortOnGolden).toBe(false);
  });

  it('moves on to the next window when the level passed, and stays committed (ASC-12)', () => {
    current = plan('waiting', 1170, 10, 1, 1179);
    runner.step();
    game.cookiesEarned = atLevel(1180);
    current = plan('growing');
    expect(runner.step()).toEqual({ kind: 'hold' });
    // ~4s per level at 1e18/s: the 7 goes to the hundreds, so the next window is 1,700-1,799
    expect(runtime.ascendTarget).toMatchObject({ level: 1700, end: 1799 });
    expect(data.logs.some((l) => /moved the target to level 1,700: level 1,179 passed/.test(l.meta))).toBe(true);
  });

  it('moves on when the window is too short at the real CpS (the routine raised it)', () => {
    // late game: 1,177,000-1,177,999 lasts ~7 min at 1e25/s
    game.cookiesEarned = atLevel(1_170_000);
    game.unbuffedCps = 1e25;
    current = plan('waiting', 1_177_000, 10, 1, 1_177_999);
    runner.step();
    expect(runtime.ascendTarget?.level).toBe(1_177_000);
    // the buildings and milk bought on the way made it 30x: that window is ~14s now; the 7 goes
    // to the ten-thousands and 1,178,000-1,179,999 is too short a rest, so 1,270,000 it is
    game.unbuffedCps = 3e26;
    expect(runner.step()).toEqual({ kind: 'hold' });
    expect(runtime.ascendTarget).toMatchObject({ level: 1_270_000, end: 1_279_999 });
  });

  it('never moves the target once the level is inside its window', () => {
    current = plan('waiting', 1170, 10, 1, 1179);
    runner.step();
    game.cookiesEarned = atLevel(1178);
    game.unbuffedCps = 1e19;
    expect(runner.step()).toEqual({ kind: 'open-legacy' });
    expect(runtime.ascendTarget!.level).toBe(1170);
  });

  it('keeps holding while the level is on its way, however long that takes', () => {
    current = plan('waiting', 1170, 10, 1, 1179);
    runner.step();
    runtime.ascendTarget!.lockedAt = Date.now() - 5 * 3600 * 1000;
    current = plan('growing');
    expect(runner.step()).toEqual({ kind: 'hold' });
  });

  it('gives up on a level that is more than an hour off at the unbuffed CpS', () => {
    current = plan('waiting', 1170, 10, 1, 1179);
    runner.step();
    // 1170^3 - 250^3 ~ 1.6e21 cookies at 1e17/s ~ 4.4h
    game.unbuffedCps = 1e17;
    current = plan('growing');
    runner.step();
    expect(runtime.ascendTarget).toBeNull();
  });

  it('times the start with the routine income, not the measured one (wrinklers inflate it)', () => {
    const lead = runner.leadSec();
    const p = plan('waiting', 1170, 10, 1, 1179);
    (p as { routineEtaSec: number }).routineEtaSec = lead + LOCK_SLACK_SEC + 60;
    current = p;
    expect(runner.step()).toBeNull();
    expect(runtime.ascendTarget).toBeNull();
  });

  it('forgets the target when auto ascension is switched off', () => {
    runner.step();
    expect(runtime.ascendTarget).not.toBeNull();
    data.config.autoAscend = false;
    runner.step();
    data.config.autoAscend = true;
    current = plan('growing');
    runner.step();
    expect(runtime.ascendTarget).toBeNull();
  });

  it('without lucky wishes any level from the target on will do', () => {
    game.cookiesEarned = atLevel(9999);
    expect(runner.step()).toEqual({ kind: 'open-legacy' });
  });

  it('pops the fattest wrinkler first, shiny ones too (ascending would lose them)', () => {
    game.wrinklers = [wrinkler(0, 100, 0), { ...wrinkler(1, 500, 180), type: 1 }];
    current = plan('waiting', 1107, 10);
    expect(runner.step()).toEqual({ kind: 'pop-wrinkler', id: 1 });
  });

  it('clicks the Legacy button, above golden cookies', () => {
    place('legacyButton', ON);
    const job = runner.job()!;
    expect(job.key).toBe('ascend:open-legacy');
    expect(job.priority).toBe(JOB_PRIORITY.ASCEND);
  });

  it('only logs in a dry run, never locks and never counts as pending', () => {
    data.config.autoDryRun = true;
    place('legacyButton', ON);
    expect(runner.pending()).toBe(false);
    expect(runner.job()).toBeNull();
    expect(runtime.ascendTarget).toBeNull();
    expect(data.logs.some((l) => l.meta === 'would ascend')).toBe(true);
  });

  it('confirms its own "Ascend" prompt at the level, and cancels it once the level is gone', () => {
    runner.step();
    const box = place('promptContent', ON);
    place('promptContentAscend', ON, box);
    game.promptOpen = true;
    runtime.ascendOurs = true;
    expect(runner.step()).toEqual({ kind: 'confirm-ascend' });

    // a buff doesn't matter any more
    game.rawBuffs = { Frenzy: { name: 'Frenzy', multCpS: 7, time: 3000 } };
    expect(runner.step()).toEqual({ kind: 'confirm-ascend' });

    runtime.ascendTarget = { ...runtime.ascendTarget!, end: 260 };
    game.cookiesEarned = atLevel(261);
    expect(runner.step()).toEqual({ kind: 'cancel-ascend' });
  });

  it("does not mind shopping's pause (the open/cancel loop)", () => {
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
    data.config.autoDryRun = true;
    expect(runner.botLine()).toBe('Paw: dry run, it only writes "would ascend" in the log');
    data.config.autoDryRun = false;
    current = plan('growing');
    expect(runner.botLine()).toBe('Paw: will ascend by itself once it pays off');
    current = plan('ascend');
    game.rawBuffs = { Frenzy: { name: 'Frenzy', multCpS: 7, time: 3000 } };
    expect(runner.botLine()).toBe('Paw: will ascend once the buffs are over');
    game.rawBuffs = {};
    expect(runner.botLine()).toBe('Paw: ascending now');
  });

  describe('selling and spending before Legacy (ASC-13)', () => {
    let held: number[];

    beforeEach(() => {
      held = [];
      const market = { dumpableGoods: () => held, sellAllJob: () => ({ action: { label: 'sell' }, priority: 5, key: 'ascend:sell-stock:0' }) };
      const planner = { plan: () => current, shoppingNow: () => shopNow } as unknown as AscensionPlanner;
      runner = new AscensionRunner(runtime, data, game, new LogStore(data), new StatsRecorder(data), planner, () => interrupted, market as never);
      game.cookies = 1000;
      const farm = { name: 'Farm', id: 2, amount: 48, price: 100, buy: () => {} };
      game.buildings = [farm as never];
      game.unwonBuildingAchievementCounts = { Farm: [50, 100] };
      current = plan('waiting', 1107, 10);
    });

    it('sells every held stock first, then buys to the cheapest achievement', () => {
      held = [3];
      expect(runner.step()).toEqual({ kind: 'sell-stock', id: 3 });
      held = [];
      expect(runner.step()).toEqual({ kind: 'dump', id: 2, name: 'Farm', target: 50, count: 2 });
      expect(runner.armed()).toBe(true);
    });

    it('selling is urgent too: above golden cookies', () => {
      held = [3];
      expect(runner.job()?.priority).toBe(JOB_PRIORITY.ASCEND);
    });

    it('holds when nothing is left to spend on', () => {
      game.cookies = 10;
      expect(runner.step()).toEqual({ kind: 'hold' });
    });

    it('leaves the bank alone with the setting off, or the store in sell mode', () => {
      data.config.ascendDumpBank = false;
      expect(runner.step()).toEqual({ kind: 'hold' });
      runtime.ascendPrepDone = false;
      data.config.ascendDumpBank = true;
      game.buyMode = -1;
      expect(runner.step()).toEqual({ kind: 'hold' });
    });

    it('gives up on selling and spending after 90s', () => {
      runner.step();
      held = [3];
      runtime.ascendDumpSince = Date.now() - 91000;
      expect(runner.step()).toEqual({ kind: 'hold' });
    });

    it('spends once: the bank that builds up during the wait stays', () => {
      expect(runner.step()).toEqual({ kind: 'dump', id: 2, name: 'Farm', target: 50, count: 2 });
      game.cookies = 10; // spent
      expect(runner.step()).toEqual({ kind: 'hold' });
      game.cookies = 1000;
      expect(runner.step()).toEqual({ kind: 'hold' });
    });

    it('says what it is doing', () => {
      expect(runner.botLine()).toBe('Paw: getting ready for level 1,107: spending the bank on achievements (Farm to 50)');
    });

    it('buys one copy per press, only in buy mode', () => {
      let bought = 0;
      const farm = { name: 'Farm', id: 2, amount: 48, price: 100, buy: () => { farm.amount++; bought++; } };
      game.buildings = [farm as never];
      const job = runner.job()!;
      const p = (job.action as unknown as { p: { buyOne: () => boolean } }).p;
      expect(p.buyOne()).toBe(true);
      game.buyMode = -1;
      expect(p.buyOne()).toBe(false);
      expect(bought).toBe(1);
    });
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
    runtime.ascendTarget = { level: 1, end: 1, sevens: 0, lockedAt: 0 };
    runtime.autoHammerState.cal = 3;

    runtime.resetForNewRun(ASCEND_SETTLE_MS, 1000);

    expect(runtime.lockA).toBe(false);
    expect(runtime.krumblorRebuy).toBe(0);
    expect(runtime.ascendOurs).toBe(false);
    expect(runtime.ascendSkip.size).toBe(0);
    expect(runtime.ascendTarget).toBeNull();
    expect(runtime.autoHammerState.cal).toBe(1);
    expect(runtime.settleUntil).toBe(1000 + ASCEND_SETTLE_MS);
  });
});
