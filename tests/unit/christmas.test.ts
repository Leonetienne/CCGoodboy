import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DragonClickAction } from '../../src/actions/krumblor';
import { christmasUpgradeGain, SANTA_DROPS, type XmasClassifyCtx } from '../../src/autoplay/christmas';
import { autoCollect } from '../../src/autoplay/collector';
import { IncomeTracker } from '../../src/autoplay/income-tracker';
import { SantaTrainer } from '../../src/autoplay/santa';
import { nextSantaStep, santaEvolveCost, santaEvolvePaybackSec, SANTA_MAX_PAYBACK_SEC, type SantaState } from '../../src/autoplay/santa-strategy';
import { autoDecide } from '../../src/autoplay/strategy';
import { AUTO_PREF_GOLDEN } from '../../src/autoplay/valuation-tables';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY } from '../../src/cursor/types';
import { getSantaEvolveButton } from '../../src/game/dragon-dom';
import type { GameBuilding, GameUpgrade } from '../../src/game/types';
import { LogStore } from '../../src/stats/log';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function up(name: string, price: number, extra: Partial<GameUpgrade> = {}): GameUpgrade {
  return { name, pool: '', desc: 'Cost scales with Santa level.', getPrice: () => price, buy: () => {}, ...extra } as GameUpgrade;
}

function ctx(overrides: Partial<XmasClassifyCtx> = {}): XmasClassifyCtx {
  return { cps: 1000, mult: 2, biscuitBase: null, cursor: null, nonCursor: 0, clickUnit: 1, clicksPerSec: 8, santaLevel: 0, ...overrides };
}

describe('christmasUpgradeGain', () => {
  it('ignores anything that is not a Christmas upgrade (the reindeer biscuits are plain biscuits)', () => {
    expect(christmasUpgradeGain(new FakeGameAdapter(), up('Chicken egg', 1), ctx())).toBeNull();
    expect(christmasUpgradeGain(new FakeGameAdapter(), up('Bell biscuits', 1), ctx())).toBeNull();
  });

  it('values the flat gifts by their CpS share, and prefers every gift and the hat', () => {
    const game = new FakeGameAdapter();
    expect(christmasUpgradeGain(game, up('Increased merriness', 1), ctx())).toEqual({ gain: 150, type: 'christmas', pref: AUTO_PREF_GOLDEN });
    expect(christmasUpgradeGain(game, up('A lump of coal', 1), ctx())!.gain).toBeCloseTo(10);
    expect(christmasUpgradeGain(game, up('A festive hat', 25), ctx())).toEqual({ gain: 1, type: 'christmas', pref: AUTO_PREF_GOLDEN });

    for (const name of SANTA_DROPS) {
      const g = christmasUpgradeGain(game, up(name, 1), ctx());
      expect(g!.gain).toBeGreaterThan(0);
      expect(g!.pref).toBe(AUTO_PREF_GOLDEN);
    }
  });

  it("values Santa's legacy by the Santa level, Naughty list by the grandmas, Santa's helpers by the clicks", () => {
    const game = new FakeGameAdapter();
    expect(christmasUpgradeGain(game, up("Santa's legacy", 1), ctx({ santaLevel: 4 }))!.gain).toBeCloseTo(1000 * 0.03 * 5);

    game.buildingsByName.Grandma = { name: 'Grandma', storedTotalCps: 100 } as GameBuilding;
    expect(christmasUpgradeGain(game, up('Naughty list', 1), ctx())!.gain).toBe(200);

    game.computedMouseCps = 500;
    expect(christmasUpgradeGain(game, up("Santa's helpers", 1), ctx())!.gain).toBeCloseTo(500 * 8 * 0.1);
  });

  it("values Santa's dominion as +21% CpS, not preferred", () => {
    const g = christmasUpgradeGain(new FakeGameAdapter(), up("Santa's dominion", 1), ctx());
    expect(g).toEqual({ gain: 210, type: 'christmas' });
  });
});

describe('autoCollect: Christmas upgrades', () => {
  beforeEach(() => localStorage.clear());

  it('offers the hat and the gifts, preferred, and auto play buys them', () => {
    const game = new FakeGameAdapter();
    game.unbuffedCps = 1000;
    game.cookiesPs = 1000;
    game.cookies = 1e9;
    game.upgradesInStore = [up('A festive hat', 25), up('Reindeer baking grounds', 2525), up('Improved jolliness', 2525)];

    const runtime = new RuntimeState();
    const r = autoCollect(game, new PersistedData(), runtime, new IncomeTracker(runtime, game));
    if ('skip' in r) throw new Error(r.skip);

    expect(r.cands.map((c) => c.name).sort()).toEqual(['A festive hat', 'Improved jolliness', 'Reindeer baking grounds']);
    expect(r.cands.every((c) => c.pref === AUTO_PREF_GOLDEN)).toBe(true);
    expect(autoDecide(r.cands, r.ctx).buy?.name).toBe('Improved jolliness'); // best payback first
  });
});

function state(over: Partial<SantaState> = {}): SantaState {
  return { hatBought: true, santaLevel: 0, giftWaiting: false, hasLegacy: false, menuOpen: false, menuOurs: false, cps: 1e6, spendable: 1e12, insignificant: 1e12, ...over };
}

describe('nextSantaStep', () => {
  it('costs (level + 1)^(level + 1)', () => {
    expect([0, 1, 2, 3, 13].map(santaEvolveCost)).toEqual([1, 4, 27, 256, Math.pow(14, 14)]);
  });

  it('does nothing without the festive hat or at Final Claus', () => {
    expect(nextSantaStep(state({ hatBought: false })).kind).toBe('done');
    expect(nextSantaStep(state({ santaLevel: 14 })).kind).toBe('done');
    expect(nextSantaStep(state({ santaLevel: 14, menuOpen: true, menuOurs: true })).kind).toBe('close-menu');
  });

  it('opens the popup, then evolves', () => {
    expect(nextSantaStep(state({ santaLevel: 3 })).kind).toBe('open-menu');
    expect(nextSantaStep(state({ santaLevel: 3, menuOpen: true }))).toEqual({ kind: 'evolve', level: 3, cost: 256 });
  });

  it('waits while a gift is in the store (evolving triples its price), putting its popup away', () => {
    expect(nextSantaStep(state({ giftWaiting: true })).kind).toBe('wait');
    expect(nextSantaStep(state({ giftWaiting: true, menuOpen: true, menuOurs: true })).kind).toBe('close-menu');
    // the player's own popup stays open
    expect(nextSantaStep(state({ giftWaiting: true, menuOpen: true })).kind).toBe('wait');
  });

  it('needs more than the cost in the bank (reserve kept)', () => {
    expect(nextSantaStep(state({ santaLevel: 3, spendable: 256 })).kind).toBe('wait');
    expect(nextSantaStep(state({ santaLevel: 3, spendable: 257 })).kind).toBe('open-menu');
  });

  it('pays a significant cost only when it pays back quickly enough', () => {
    // level 13 -> Final Claus: 14^14 + the dominion against +20% (and +3% with legacy)
    const cps = 2e13;
    const s = state({ santaLevel: 13, cps, insignificant: 60 * cps, spendable: 1e17 });
    expect(santaEvolvePaybackSec(s)).toBeLessThan(SANTA_MAX_PAYBACK_SEC);
    expect(nextSantaStep(s).kind).toBe('open-menu');

    const poor = state({ santaLevel: 13, cps: 1e12, insignificant: 6e13, spendable: 1e17 });
    expect(nextSantaStep(poor).kind).toBe('wait');

    // without Santa's legacy an ordinary level adds nothing right away: only when insignificant
    expect(santaEvolvePaybackSec(state({ santaLevel: 8 }))).toBe(Infinity);
    expect(nextSantaStep(state({ santaLevel: 8, insignificant: 1e8 })).kind).toBe('wait');
    expect(nextSantaStep(state({ santaLevel: 8, insignificant: 1e8, hasLegacy: true, cps: 1e8 })).kind).toBe('open-menu');
  });
});

/** Gives Santa's "Evolve" button an on-screen box (jsdom lays nothing out, and reads a
 * missing opacity as hidden). */
function placeEvolveButton(): void {
  for (const node of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) node.style.opacity = '1';
  const el = getSantaEvolveButton() as HTMLElement;
  el.getBoundingClientRect = () => ({ left: 100, top: 100, right: 180, bottom: 130, width: 80, height: 30, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
}

function setup() {
  document.body.innerHTML = '';

  const runtime = new RuntimeState();
  runtime.running = true;
  const data = new PersistedData();
  data.config.autoPlay = true;
  const game = new FakeGameAdapter();
  game.unbuffedCps = 1e6;
  game.cookies = 1e9;
  game.upgradeNames.add('A festive hat');
  game.specialTabs = ['santa'];

  const trainer = new SantaTrainer(runtime, data, game, new LogStore(data), () => false);

  return { runtime, data, game, trainer };
}

describe('SantaTrainer', () => {
  beforeEach(() => localStorage.clear());

  it('only works in auto play, not in a dry run, and not while something more important goes on', () => {
    const { runtime, data, game, trainer } = setup();
    game.specialTab = 'santa';

    expect(trainer.pending()).toBe(true);
    data.config.autoPlay = false;
    expect(trainer.pending()).toBe(false);
    data.config.autoPlay = true;
    data.config.autoDryRun = true;
    expect(trainer.pending()).toBe(false);
    expect(trainer.job()).toBeNull();
    data.config.autoDryRun = false;

    expect(new SantaTrainer(runtime, data, game, new LogStore(data), () => true).pending()).toBe(false);
    game.promptOpen = true;
    expect(trainer.pending()).toBe(false);
  });

  it('waits for a gift in the store', () => {
    const { game, trainer } = setup();
    game.upgradesInStore = [up('Toy workshop', 2525)];
    expect(trainer.step()?.kind).toBe('wait');
  });

  it('opens the popup by clicking the Santa tab on the left canvas', () => {
    const { game, trainer } = setup();
    game.specialTabs = ['santa', 'dragon'];

    document.body.innerHTML = '<canvas id="backgroundLeftCanvas" width="300" height="900"></canvas>';
    const canvas = document.getElementById('backgroundLeftCanvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 30, width: 300, height: 900, right: 300, bottom: 930, x: 0, y: 30, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });

    const req = trainer.job()!;
    expect(req.key).toBe('santa:open-menu');
    expect(req.priority).toBe(JOB_PRIORITY.AUTO_SHOP);
    expect(req.action).toBeInstanceOf(DragonClickAction);
    expect((req.action as DragonClickAction).hud.action).toBe('santa');
    expect((req.action as DragonClickAction).target()).toEqual({ x: 24, y: 30 + 900 - 120 });
  });

  it('clicks "Evolve" in the popup and checks the level went up', async () => {
    const { runtime, game, trainer } = setup();
    game.specialTab = 'santa';
    game.santaLevel = 2;
    document.body.innerHTML = `
      <div id="specialPopup" class="framed prompt onScreen">
        <div class="close">x</div>
        <div class="optionBox"><a class="option framed large title" onclick="Game.UpgradeSanta();">Evolve</a></div>
      </div>`;
    expect(getSantaEvolveButton()?.textContent).toBe('Evolve');
    placeEvolveButton();

    const req = trainer.job()!;
    expect(req.key).toBe('santa:evolve');

    const humanClick = vi.fn(async () => {
      game.santaLevel = 3;
    });
    await req.action.cursor_at_position({ runtime, clickTiming: { humanClick }, clock: { sleep: vi.fn().mockResolvedValue(undefined) } } as never);

    expect(humanClick).toHaveBeenCalledWith(getSantaEvolveButton(), expect.any(Number), expect.any(Number));
    expect(runtime.santaBlockUntil).toBe(0);
  });

  it('pauses when "Evolve" did nothing', async () => {
    const { runtime, game, trainer } = setup();
    game.specialTab = 'santa';
    document.body.innerHTML = `
      <div id="specialPopup" class="framed prompt onScreen">
        <a class="option" onclick="Game.UpgradeSanta();">Evolve</a>
      </div>`;
    placeEvolveButton();

    const req = trainer.job()!;
    await req.action.cursor_at_position({ runtime, clickTiming: { humanClick: vi.fn() }, clock: { sleep: vi.fn().mockResolvedValue(undefined) } } as never);

    expect(runtime.santaBlockUntil).toBeGreaterThan(Date.now());
  });
});
