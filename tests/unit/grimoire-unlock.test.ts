import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GrimoireUnlocker } from '../../src/autoplay/grimoire-unlock';
import { MenuButtonAction, MinigameButtonAction, ScrollIntoViewAction } from '../../src/actions/buildings-view';
import { FthofAction } from '../../src/actions/fthof';
import { GrimoireUnlockAction } from '../../src/actions/grimoire-unlock';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../../src/cursor/types';
import { BUILDINGS_VIEW_RECIPE } from '../../src/game/buildings-view-dom';
import type { GameBuilding } from '../../src/game/types';
import { BuildingsViewNavigator } from '../../src/hunting/buildings-view';
import { FthofActions } from '../../src/hunting/fthof';
import { GrimoireView } from '../../src/hunting/grimoire-view';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

const RECT = { left: 100, top: 100, right: 160, bottom: 130, width: 60, height: 30, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;
const OFFSCREEN = { ...RECT, top: 5000, bottom: 5030, y: 5000 } as DOMRect;
const NONE = { ...RECT, width: 0, height: 0 } as DOMRect;
const COLUMN = { ...RECT, top: 0, bottom: 700, height: 700, width: 800, right: 900 } as DOMRect;

/** Minimal game DOM: the menu buttons, and #centerArea > #rows > #row7 with the Wizard
 * tower's level + minigame buttons and a Grimoire spell. jsdom has no layout, so rects are
 * stubbed per element. */
function buildDom(rects: { row?: DOMRect; level?: DOMRect; minigame?: DOMRect; spell?: DOMRect } = {}): void {
  document.body.innerHTML = `
    <div id="prefsButton"></div><div id="statsButton"></div>
    <div id="centerArea"><div id="rows"><div id="row7">
      <div id="productLevel7">lvl 0</div><div id="productMinigameButton7">View Grimoire</div>
      <div id="grimoireSpell1"></div>
    </div></div></div>`;

  // jsdom reports opacity '' (read as 0 = hidden) unless it's set on the element itself
  for (const el of Array.from(document.body.querySelectorAll('div'))) el.style.opacity = '1';

  const stub = (id: string, r: DOMRect) => {
    document.getElementById(id)!.getBoundingClientRect = () => r;
  };

  stub('prefsButton', RECT);
  stub('statsButton', RECT);
  stub('centerArea', COLUMN);
  stub('rows', COLUMN);
  stub('row7', rects.row ?? RECT);
  stub('productLevel7', rects.level ?? RECT);
  stub('productMinigameButton7', rects.minigame ?? RECT);
  stub('grimoireSpell1', rects.spell ?? RECT);
}

function setup() {
  const runtime = new RuntimeState();
  const data = new PersistedData();
  data.config.autoPlay = true;

  const game = new FakeGameAdapter();
  game.lumpsOn = true;
  game.lumps = 1;

  const wt = { name: 'Wizard tower', id: 7, amount: 1, level: 0, buy: () => {} } as GameBuilding;
  game.buildingsByName['Wizard tower'] = wt;

  const log = { log: vi.fn() };
  const enqueued: JobRequest[] = [];
  let interrupted = false;

  const nav = new BuildingsViewNavigator(runtime, game, () => false);
  const view = new GrimoireView(runtime, game, log as never, nav, (req) => enqueued.push(req));
  const unlocker = new GrimoireUnlocker(runtime, data, game, log as never, view, () => interrupted);

  return { runtime, data, game, wt, log, enqueued, nav, view, unlocker, interrupt: (v: boolean) => (interrupted = v) };
}

/** A Wizard tower with the Grimoire unlocked, enough mana and an outlasting CpS buff. */
function fthofReady(s: ReturnType<typeof setup>): FthofActions {
  s.wt.level = 1;
  s.game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 50, magic: 100, magicM: 100 };
  s.game.rawBuffs = { a: { name: 'Frenzy', multCpS: 7, time: 3000 } };

  return new FthofActions(s.runtime, s.game, null as never, s.log as never, () => false, s.view);
}

beforeEach(() => buildDom());

describe('GrimoireUnlocker.wanted', () => {
  it('wants to unlock with a level 0 Wizard tower and a sugar lump in auto play', () => {
    expect(setup().unlocker.wanted()).toBe(true);
  });

  it('does nothing while auto play is off', () => {
    const s = setup();
    s.data.config.autoPlay = false;
    expect(s.unlocker.wanted()).toBe(false);
    expect(s.unlocker.pending()).toBe(false);
  });

  it('needs a Wizard tower, level 0, unlocked lumps and at least one lump', () => {
    let s = setup();
    s.wt.amount = 0;
    expect(s.unlocker.wanted()).toBe(false);

    s = setup();
    s.wt.level = 1;
    expect(s.unlocker.wanted()).toBe(false);

    s = setup();
    s.game.lumps = 0;
    expect(s.unlocker.wanted()).toBe(false);

    s = setup();
    s.game.lumpsOn = false;
    expect(s.unlocker.wanted()).toBe(false);
  });

  it('respects the auto play safety gates', () => {
    const s = setup();
    s.interrupt(true);
    expect(s.unlocker.wanted()).toBe(false);

    s.interrupt(false);
    s.game.promptOpen = true;
    expect(s.unlocker.wanted()).toBe(false);
  });

  it('only logs in dry run', () => {
    const s = setup();
    s.data.config.autoDryRun = true;
    expect(s.unlocker.pending()).toBe(false);
    expect(s.unlocker.job()).toBeNull();
    expect(s.log.log).toHaveBeenCalledWith('auto play (dry run)', expect.stringContaining('Grimoire'));
  });
});

describe('GrimoireUnlocker.job', () => {
  it('clicks the level button when it is on screen', () => {
    const job = setup().unlocker.job()!;
    expect(job.action).toBeInstanceOf(GrimoireUnlockAction);
    expect(job.priority).toBe(JOB_PRIORITY.AUTO_SHOP);
    expect(job.key).toBe('grimoire-unlock:level');
  });

  it('scrolls the Wizard towers into view first when the level button is scrolled away', () => {
    buildDom({ level: OFFSCREEN });
    const job = setup().unlocker.job()!;
    expect(job.action).toBeInstanceOf(ScrollIntoViewAction);
    expect(job.key).toBe('grimoire-unlock:scroll-level');
  });

  it('runs Options, Stats, Stats when a menu is open, one click per step', () => {
    const s = setup();
    s.game.onMenu = 'log';

    const first = s.unlocker.job()!;
    expect(first.action).toBeInstanceOf(MenuButtonAction);
    expect(first.key).toBe('buildings-view:0');
    expect(s.runtime.buildingsViewSteps).toEqual([...BUILDINGS_VIEW_RECIPE]);

    s.runtime.buildingsViewSteps.shift();
    expect(s.unlocker.job()!.key).toBe('buildings-view:1');
  });

  it('refuses to restart the recipe right away if the menu stays open', () => {
    const s = setup();
    s.game.onMenu = 'stats';
    s.unlocker.job();
    s.runtime.buildingsViewSteps = [];

    expect(s.unlocker.job()).toBeNull();
    expect(s.runtime.grimoireUnlockBlockUntil).toBeGreaterThan(Date.now());
    expect(s.unlocker.wanted()).toBe(false);
  });

  it('pauses when the Wizard tower row is not laid out at all', () => {
    buildDom({ row: NONE, level: NONE });
    const s = setup();
    expect(s.unlocker.job()).toBeNull();
    expect(s.runtime.grimoireUnlockBlockUntil).toBeGreaterThan(Date.now());
  });
});

describe('FthofActions.castJob (FT-8: get the Grimoire on screen first)', () => {
  it('casts straight away when the Grimoire is open and the spell is on screen', () => {
    const s = setup();
    const fthof = fthofReady(s);
    s.wt.onMinigame = 1;

    const job = fthof.castJob();
    expect(job.action).toBeInstanceOf(FthofAction);
    expect(job.key).toBe('fthof');
  });

  it('goes back to the buildings view first when a menu is open', () => {
    const s = setup();
    const fthof = fthofReady(s);
    s.game.onMenu = 'prefs';

    const job = fthof.castJob();
    expect(job.action).toBeInstanceOf(MenuButtonAction);
    expect(job.priority).toBe(JOB_PRIORITY.FTHOF);
  });

  it('scrolls to the Wizard towers when the Grimoire is closed and its button is scrolled away', () => {
    buildDom({ minigame: OFFSCREEN });
    const s = setup();
    const fthof = fthofReady(s);

    const job = fthof.castJob();
    expect(job.action).toBeInstanceOf(ScrollIntoViewAction);
    expect(job.key).toBe('fthof-prep:scroll-towers');
  });

  it('clicks "View Grimoire" when the Grimoire is closed', () => {
    const s = setup();
    const fthof = fthofReady(s);

    const job = fthof.castJob();
    expect(job.action).toBeInstanceOf(MinigameButtonAction);
    expect(job.key).toBe('fthof-prep:open');
    expect(job.priority).toBe(JOB_PRIORITY.FTHOF);
  });

  it('scrolls to the spell when the Grimoire is open but scrolled away', () => {
    buildDom({ spell: OFFSCREEN });
    const s = setup();
    const fthof = fthofReady(s);
    s.wt.onMinigame = 1;

    expect(fthof.castJob().key).toBe('fthof-prep:scroll-grimoire');
  });

  it('falls back to the direct cast (FT-7) when preparing is blocked', () => {
    buildDom({ row: NONE, minigame: NONE });
    const s = setup();
    const fthof = fthofReady(s);

    expect(fthof.castJob().action).toBeInstanceOf(FthofAction);
    expect(s.runtime.fthofPrepBlockUntil).toBeGreaterThan(Date.now());

    // and keeps casting directly for a while instead of retrying the dead end every tick
    buildDom();
    expect(fthof.castJob().action).toBeInstanceOf(FthofAction);
  });
});

describe('MinigameButtonAction', () => {
  it('never clicks an already open minigame (the button toggles)', async () => {
    const s = setup();
    let open = false;
    const action = new MinigameButtonAction(7, 'Grimoire', () => open, () => false);

    expect(action.abortIf()).toBe(false);
    open = true;
    expect(action.abortIf()).toBe(true);

    const humanClick = vi.fn();
    await action.cursor_at_position({ runtime: s.runtime, clickTiming: { humanClick } } as never);
    expect(humanClick).not.toHaveBeenCalled();
  });
});

describe('debug tools', () => {
  it('"Show buildings view" queues the recipe even without auto play', () => {
    const s = setup();
    s.data.config.autoPlay = false;

    s.view.debugShowBuildingsView();

    expect(s.view.pending()).toBe(true);
    expect(s.view.job()!.action).toBeInstanceOf(MenuButtonAction);
  });

  it('"Scroll to Wizard towers" enqueues a scroll job', () => {
    const s = setup();
    s.view.debugScrollToWizardTowers();

    expect(s.enqueued).toHaveLength(1);
    expect(s.enqueued[0]!.action).toBeInstanceOf(ScrollIntoViewAction);
  });

  it('"Scroll to Wizard towers" fails loudly without a Wizard tower row', () => {
    buildDom({ row: NONE });
    expect(() => setup().view.debugScrollToWizardTowers()).toThrow();
  });

  it('"Show grimoire" fails at once without a Wizard tower, or at level 0 without a lump', () => {
    let s = setup();
    s.wt.amount = 0;
    expect(() => s.view.debugShowGrimoire()).toThrow(/Wizard tower/);

    s = setup();
    s.game.lumps = 0;
    expect(() => s.view.debugShowGrimoire()).toThrow(/sugar lump/);
  });

  it('"Show grimoire" unlocks (level 0), then opens the Grimoire, then finishes', () => {
    const s = setup();
    s.data.config.autoPlay = false;
    s.view.debugShowGrimoire();

    expect(s.view.pending()).toBe(true);
    expect(s.view.job()!.action).toBeInstanceOf(GrimoireUnlockAction);

    s.wt.level = 1;
    s.game.grimoire = { spells: { 'hand of fate': { id: 1 } } };
    expect(s.view.job()!.action).toBeInstanceOf(MinigameButtonAction);

    s.wt.onMinigame = 1;
    expect(s.view.job()).toBeNull();
    expect(s.view.pending()).toBe(false);
    expect(s.log.log).toHaveBeenCalledWith('debug tool', 'Show grimoire: done', expect.anything());
  });
});

describe('MenuButtonAction', () => {
  it('advances the recipe only after its click was dispatched', async () => {
    const s = setup();
    s.view.debugShowBuildingsView();
    const action = s.view.job()!.action;

    const humanClick = vi.fn().mockResolvedValue(true);
    await action.cursor_at_position({ runtime: s.runtime, clickTiming: { humanClick } } as never);

    expect(humanClick).toHaveBeenCalledWith(document.getElementById('prefsButton'), expect.any(Number), expect.any(Number));
    expect(s.runtime.buildingsViewSteps).toEqual(['statsButton', 'statsButton']);
  });
});

describe('GrimoireUnlockAction', () => {
  it('clicks the level button with the lump confirmation suppressed, then restores it', async () => {
    const s = setup();
    s.game.askLumpsPref = 1;
    const action = s.unlocker.job()!.action;

    const humanClick = vi.fn().mockImplementation(async () => {
      expect(s.game.askLumpsPref).toBe(0);
      s.wt.level = 1;
      return true;
    });

    await action.cursor_at_position({ runtime: s.runtime, game: s.game, clickTiming: { humanClick } } as never);

    expect(humanClick).toHaveBeenCalledWith(document.getElementById('productLevel7'), expect.any(Number), expect.any(Number));
    expect(s.game.askLumpsPref).toBe(1);
    expect(s.log.log).toHaveBeenCalledWith('auto grimoire unlock', 'Wizard tower level 1', expect.anything());
    expect(s.unlocker.wanted()).toBe(false);
  });
});

describe('ScrollIntoViewAction', () => {
  it('wheel-scrolls #centerArea toward the element and reports when done', async () => {
    const area = document.getElementById('centerArea')!;
    let top = 0;
    Object.defineProperty(area, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true });
    Object.defineProperty(area, 'scrollHeight', { value: 10000, configurable: true });
    Object.defineProperty(area, 'clientHeight', { value: 700, configurable: true });

    // the element moves up as the column scrolls down
    const el = document.getElementById('row7')!;
    el.getBoundingClientRect = () => ({ ...RECT, top: 2000 - top, bottom: 2030 - top }) as DOMRect;

    const onDone = vi.fn();
    const action = new ScrollIntoViewAction({ label: 'scroll', element: () => el, onDone });

    await action.cursor_at_position({ clock: { sleep: async () => {} }, abortRequested: () => false } as never);

    // centred: 2015 - top === 350
    expect(top).toBeCloseTo(1665, 0);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
