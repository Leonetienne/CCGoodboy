import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WrinklerPopAction } from '../../src/actions/wrinkler-pop';
import { autoCollect, type PurchaseCandidate } from '../../src/autoplay/collector';
import { IncomeTracker } from '../../src/autoplay/income-tracker';
import { autoBuy, type AutoPlayEngine } from '../../src/autoplay/shopping';
import { autoResearchCandidateGain, autoResearchGain } from '../../src/autoplay/upgrade-classifier';
import { chainStepGain, stage1Gain } from '../../src/autoplay/grandmapocalypse-valuation';
import { WrinklerPopper } from '../../src/autoplay/wrinkler-popper';
import { autoDecide } from '../../src/autoplay/strategy';
import { AUTO_PREF_BINGO, AUTO_PREF_GOLDEN, AUTO_PREF_WIZARD } from '../../src/autoplay/valuation-tables';
import { matureWrinklers, pickWrinklersToPop, wrinklerRespawnSec, type WrinklerMaturityInput } from '../../src/autoplay/wrinkler-strategy';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import type { CursorJobContext } from '../../src/cursor/types';
import { GameAdapter } from '../../src/game/game-adapter';
import type { GameBuilding, GameUpgrade, GameWrinkler } from '../../src/game/types';
import { LogStore } from '../../src/stats/log';
import { StatsRecorder } from '../../src/stats/stats';
import { wrinklerHit, wrinklerPokeCanvasPoint } from '../../src/game/wrinkler-dom';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

const STAGE1_CHANCE = 0.00001;
const STAGE1_RESPAWN = 1 / (STAGE1_CHANCE * 30) + 10; // ~3343s

function wrinkler(id: number, sucked: number, extra: Partial<GameWrinkler> = {}): GameWrinkler {
  return { id, phase: 2, sucked, type: 0, x: 0, y: 0, r: id * 36, ...extra }; // fanned out like the real ring, so bodies don't overlap
}

/** Cookies a wrinkler holds after digesting `sec` seconds with 10 attached at 100 CpS. */
function fed(sec: number): number {
  return sec * 100 * 0.5;
}

function maturityInput(overrides: Partial<WrinklerMaturityInput> = {}): WrinklerMaturityInput {
  return {
    wrinklers: [],
    popMult: 1.1,
    cookiesPs: 100,
    cpsSucked: 0.5,
    spawnChance: STAGE1_CHANCE,
    fps: 30,
    maturity: 5,
    ...overrides,
  };
}

describe('wrinklerRespawnSec', () => {
  it('is the spawn wait plus the 10s crawl, ~56 min at stage 1', () => {
    expect(wrinklerRespawnSec(STAGE1_CHANCE, 30)).toBeCloseTo(STAGE1_RESPAWN, 6);
    expect(wrinklerRespawnSec(STAGE1_CHANCE, 30) / 60).toBeGreaterThan(55);
  });

  it('is Infinity when nothing respawns (calm grandmas)', () => {
    expect(wrinklerRespawnSec(0, 30)).toBe(Infinity);
  });
});

describe('matureWrinklers', () => {
  const old = fed(6 * STAGE1_RESPAWN);
  const young = fed(2 * STAGE1_RESPAWN);

  it('keeps only attached, normal wrinklers that digested >= maturity x respawn, fattest first', () => {
    const views = [
      { id: 0, sucked: old, attached: true, shiny: false },
      { id: 1, sucked: young, attached: true, shiny: false },
      { id: 2, sucked: old * 3, attached: true, shiny: true },
      { id: 3, sucked: old, attached: false, shiny: false },
      { id: 4, sucked: old * 2, attached: true, shiny: false },
    ];

    const m = matureWrinklers(maturityInput({ wrinklers: views }));

    expect(m.map((w) => w.id)).toEqual([4, 0]);
    expect(m[1]!.yield).toBeCloseTo(old * 1.1, 6);
  });

  it('a lower maturity lets younger wrinklers go too', () => {
    const views = [{ id: 1, sucked: young, attached: true, shiny: false }];

    expect(matureWrinklers(maturityInput({ wrinklers: views }))).toEqual([]);
    expect(matureWrinklers(maturityInput({ wrinklers: views, maturity: 1 })).map((w) => w.id)).toEqual([1]);
  });

  it('never pops when slots would not respawn', () => {
    const views = [{ id: 0, sucked: old * 100, attached: true, shiny: false }];
    expect(matureWrinklers(maturityInput({ wrinklers: views, spawnChance: 0 }))).toEqual([]);
  });
});

describe('pickWrinklersToPop', () => {
  const mature = [
    { id: 4, yield: 500 },
    { id: 0, yield: 300 },
    { id: 7, yield: 100 },
  ];

  it('takes the fewest, fattest first', () => {
    expect(pickWrinklersToPop(mature, 450)!.map((w) => w.id)).toEqual([4]);
    expect(pickWrinklersToPop(mature, 700)!.map((w) => w.id)).toEqual([4, 0]);
  });

  it('pops nothing when nothing is needed or they cannot cover it', () => {
    expect(pickWrinklersToPop(mature, 0)).toBeNull();
    expect(pickWrinklersToPop(mature, 901)).toBeNull();
  });
});

function grandmaGame(): FakeGameAdapter {
  const game = new FakeGameAdapter();
  const grandma = { name: 'Grandma', amount: 50, storedTotalCps: 1000, storedCps: 20, price: 1e20, buy: () => {} } as GameBuilding;
  game.buildings = [grandma];
  game.buildingsByName['Grandma'] = grandma;
  game.unbuffedCps = 1000;
  game.cookiesPs = 1000;
  return game;
}

describe('autoResearchGain', () => {
  const ctx = { cps: 1000, mult: 1 };

  it('values the research chain', () => {
    const game = grandmaGame();

    expect(autoResearchGain(game, 'Bingo center/Research facility', ctx)).toBe(3000); // x4
    expect(autoResearchGain(game, 'Ritual rolling pins', ctx)).toBe(1000); // x2
    expect(autoResearchGain(game, 'Designer cocoa beans', ctx)).toBe(20); // +2%
    expect(autoResearchGain(game, 'One mind', ctx)).toBe(1000 * 0.02 * 50);
    expect(autoResearchGain(game, 'Communal brainsweep', ctx)).toBeNull();
  });
});

describe('stage 1 valuation', () => {
  const s1 = { cps: 1000, wrinklersMax: 10, popMult: 1.1, maturity: 5, respawnSec: STAGE1_RESPAWN };

  it('is worth about +400% CpS with 10 wrinklers (x1.1, popped at 5x respawn), minus 1/3 of the golden cookies', () => {
    // bank 0.5 + pops 1.1 x 0.05 x 100 x 5/6 = 5.083 -> +4.083, minus 0.2/3
    expect(stage1Gain(s1) / 1000).toBeCloseTo(4.0833 - 0.0667, 3);
    expect(stage1Gain({ ...s1, wrinklersMax: 12 }) / 1000).toBeGreaterThan(5.5);
  });

  it('gives a chain step the payback of finishing the chain, delayed until wrinklers pay out', () => {
    const step = { ...s1, cost: 1e6, remainingCost: 32e6, ownGain: 0, researchesLeft: 5, researchSec: 1800 };
    const payback = 32e6 / stage1Gain(s1) + 5 * 1800 + 6 * STAGE1_RESPAWN;

    expect(chainStepGain(step)).toBeCloseTo(1e6 / payback, 6);
    expect(1e6 / chainStepGain(step)).toBeCloseTo(payback, 3);

    // closer to the goal = less to pay and less to wait = better payback
    const later = { ...step, cost: 16e6, remainingCost: 16e6, researchesLeft: 0 };
    expect(later.cost / chainStepGain(later)).toBeLessThan(payback);
  });
});

describe('autoResearchCandidateGain', () => {
  function chainGame(): FakeGameAdapter {
    const game = grandmaGame();
    const prices: Record<string, number> = {
      'Bingo center/Research facility': 1e15,
      'Specialized chocolate chips': 1e15,
      'Designer cocoa beans': 2e15,
      'Ritual rolling pins': 4e15,
      'Underworld ovens': 8e15,
      'One mind': 16e15,
    };
    for (const [name, p] of Object.entries(prices)) {
      game.upgradesByName[name] = { name, bought: false, getPrice: () => p, buy: () => {} };
    }
    return game;
  }

  it('values the Bingo center by the whole chain to One mind, not by grandmas x4', () => {
    const game = chainGame();
    const ctx = { cps: 1e11, mult: 1 };

    const g = autoResearchCandidateGain(game, game.upgradesByName['Bingo center/Research facility']!, ctx, 5)!;
    const payback = 1e15 / g;

    // 3.2e16 left to spend against ~+4e11 CpS, plus 5 researches and a wrinkler lifetime
    expect(payback / 3600).toBeGreaterThan(25);
    expect(payback / 3600).toBeLessThan(35);
    expect(g).not.toBeCloseTo(autoResearchGain(game, 'Bingo center/Research facility', ctx)!, 0);
  });

  it('skips bought steps, and counts only its own gain once One mind is owned', () => {
    const game = chainGame();
    const ctx = { cps: 1e11, mult: 1 };
    const before = autoResearchCandidateGain(game, game.upgradesByName['Underworld ovens']!, ctx, 5)!;

    game.upgradesByName['Bingo center/Research facility']!.bought = true;
    expect(autoResearchCandidateGain(game, game.upgradesByName['Underworld ovens']!, ctx, 5)).toBeCloseTo(before, 6);

    game.upgradeNames.add('One mind');
    expect(autoResearchCandidateGain(game, game.upgradesByName['Underworld ovens']!, ctx, 5)).toBe(1e11 * 0.03);
  });
});

describe('autoCollect: Grandmapocalypse research', () => {
  beforeEach(() => localStorage.clear());

  function store(game: FakeGameAdapter, names: string[]): void {
    game.upgradesInStore = names.map((name) => ({ name, pool: name.startsWith('Bingo') ? '' : 'tech', getPrice: () => 1e6, buy: () => {} }) as GameUpgrade);
  }

  function collect(game: FakeGameAdapter, data = new PersistedData()) {
    const runtime = new RuntimeState();
    const r = autoCollect(game, data, runtime, new IncomeTracker(runtime, game));
    if ('skip' in r) throw new Error(r.skip);
    return r;
  }

  const chain = ['Bingo center/Research facility', 'Underworld ovens', 'One mind', 'Exotic nuts', 'Communal brainsweep', 'Elder Pact', 'Elder Pledge'];

  it('offers the chain up to stage 1 by default (only the Bingo center preferred), and never exotic nuts/brainsweep/pact/pledge', () => {
    const game = grandmaGame();
    store(game, chain);

    const cands = collect(game).cands.filter((c) => c.kind === 'upgrade');

    expect(cands.map((c) => c.name)).toEqual(['Bingo center/Research facility', 'Underworld ovens', 'One mind']);
    expect(cands.map((c) => c.pref)).toEqual([AUTO_PREF_BINGO, 0, 0]);
  });

  it('buys the Bingo center after golden/click/kitten upgrades, before Wizard towers and everything else, however it rates', () => {
    const b = (name: string, cost: number, dCps: number, pref = 0): PurchaseCandidate => ({ kind: 'building', type: 'building', name, obj: { name, buy: () => {} } as never, cost, dCps, pref });
    const game = grandmaGame();
    store(game, ['Bingo center/Research facility']);
    const r = collect(game);
    const bingo = r.cands.find((c) => c.name === 'Bingo center/Research facility')!;
    // far better paybacks all around, a Wizard tower below its target too
    const others = [b('Wizard tower', 1, 1e9, AUTO_PREF_WIZARD), b('Farm', 1, 1e12), b('Mine', 2, 1e12)];

    const d = autoDecide([...others, bingo], { ...r.ctx, bank: bingo.cost * 10 });
    expect(d.buy).toBe(bingo);
    expect(d.why).toBe('starts the research');
    // nothing else is held back for it
    expect(d.buyable!.map((x) => x.c.name)).toEqual(['Bingo center/Research facility', 'Wizard tower', 'Farm', 'Mine']);

    // a golden/click/kitten upgrade goes first
    const lucky: PurchaseCandidate = { kind: 'upgrade', type: 'golden', name: 'Lucky day', obj: { name: 'Lucky day', buy: () => {} } as never, cost: 1, dCps: 1e-6, pref: AUTO_PREF_GOLDEN };
    const e = autoDecide([...others, bingo, lucky], { ...r.ctx, bank: bingo.cost * 10 });
    expect(e.buyable!.map((x) => x.c.name).slice(0, 3)).toEqual(['Lucky day', 'Bingo center/Research facility', 'Wizard tower']);
  });

  it('buys none of it with the grandmapocalypse setting off', () => {
    const game = grandmaGame();
    store(game, chain);

    const data = new PersistedData();
    data.config.autoGrandmapocalypse = false;

    expect(collect(game, data).cands.filter((c) => c.kind === 'upgrade')).toEqual([]);
  });

  it('counts the withered CpS out of the saving-up income', () => {
    const game = grandmaGame();

    expect(collect(game).ctx.income).toBeCloseTo(1000, 6);

    game.cpsSucked = 0.5;
    expect(collect(game).ctx.income).toBeCloseTo(500, 6);
  });
});

describe('autoBuy guards', () => {
  function cand(name: string, up: GameUpgrade): PurchaseCandidate {
    return { kind: 'upgrade', type: 'research', name, obj: up, cost: 10, dCps: 1 };
  }

  it('confirms One mind like the prompt does (buy with bypass)', () => {
    const game = new FakeGameAdapter();
    game.cookies = 100;

    const up: GameUpgrade = { name: 'One mind', bought: false, buy: vi.fn((bypass?: number) => { if (bypass) up.bought = true; }) };

    expect(autoBuy(game, cand('One mind', up))).toBe(true);
    expect(up.buy).toHaveBeenCalledWith(1);
  });

  it('refuses stage 2/3 even if a candidate slipped through', () => {
    const game = new FakeGameAdapter();
    game.cookies = 100;

    for (const name of ['Exotic nuts', 'Communal brainsweep', 'Elder Pact']) {
      const up: GameUpgrade = { name, bought: false, buy: vi.fn() };
      expect(autoBuy(game, cand(name, up))).toBe(false);
      expect(up.buy).not.toHaveBeenCalled();
    }
  });
});

describe('WrinklerPopper', () => {
  beforeEach(() => localStorage.clear());

  function setup(decision: { buy: { name: string; cost: number } | null }, bank = 1000) {
    const runtime = new RuntimeState();
    const data = new PersistedData();
    data.config.autoPlay = true;

    const game = new FakeGameAdapter();
    game.elderWrath = 1;
    game.cookiesPs = 100;
    game.cpsSucked = 0.5;
    game.wrinklerSpawnChance = STAGE1_CHANCE;
    game.wrinklers = [wrinkler(0, fed(6 * STAGE1_RESPAWN)), wrinkler(1, fed(10 * STAGE1_RESPAWN)), wrinkler(2, fed(STAGE1_RESPAWN))];

    const decideWithExtraBank = vi.fn().mockReturnValue({ decision, ctx: { bank, reserve: 0 } });
    const autoPlay = { decideWithExtraBank, shoppingInterrupted: () => false } as unknown as AutoPlayEngine;

    const log = new LogStore(data);
    const popper = new WrinklerPopper(runtime, data, game, log, new StatsRecorder(data), autoPlay);

    return { runtime, data, game, popper, decideWithExtraBank };
  }

  it('pops the fattest mature wrinkler when the next purchase needs its cookies', () => {
    const { popper, decideWithExtraBank } = setup({ buy: { name: 'Portal', cost: 1000 + fed(9 * STAGE1_RESPAWN) } });

    const plan = popper.plan();

    // the mature stash (wrinklers 0 and 1, not the young 2) was offered to auto play
    expect(decideWithExtraBank.mock.calls[0]![0]).toBeCloseTo(fed(16 * STAGE1_RESPAWN) * 1.1, 0);
    expect(plan!.ids).toEqual([1]);
    expect(popper.pending()).toBe(true);
    expect(popper.job()!.key).toBe('wrinkler-pop:1');
  });

  it('pops nothing when the bank already covers the purchase, or nothing is bought', () => {
    expect(setup({ buy: { name: 'Portal', cost: 500 } }).popper.plan()).toBeNull();
    expect(setup({ buy: null }).popper.plan()).toBeNull();
  });

  it('keeps them attached during a CpS buff, with popping or auto play off, and in a dry run', () => {
    const need = { buy: { name: 'Portal', cost: 1e12 } };

    const buffed = setup(need);
    buffed.game.rawBuffs = { f: { name: 'Frenzy', multCpS: 7, time: 100 } };
    expect(buffed.popper.plan()).toBeNull();

    const off = setup(need);
    off.data.config.autoPopWrinklers = false;
    expect(off.popper.plan()).toBeNull();

    const noAuto = setup(need);
    noAuto.data.config.autoPlay = false;
    expect(noAuto.popper.plan()).toBeNull();

    const dry = setup({ buy: { name: 'Portal', cost: 1000 + 1 } });
    dry.data.config.autoDryRun = true;
    expect(dry.popper.pending()).toBe(false);
    expect(dry.popper.job()).toBeNull();
  });
});

describe('wrinkler debug tools', () => {
  beforeEach(() => localStorage.clear());

  function setup(wrinklers: GameWrinkler[]) {
    const runtime = new RuntimeState();
    const data = new PersistedData(); // auto play OFF
    const game = new FakeGameAdapter();
    game.wrinklers = wrinklers;

    const decideWithExtraBank = vi.fn();
    const autoPlay = { decideWithExtraBank, shoppingInterrupted: () => false } as unknown as AutoPlayEngine;
    const popper = new WrinklerPopper(runtime, data, game, new LogStore(data), new StatsRecorder(data), autoPlay);

    return { runtime, data, game, popper, decideWithExtraBank };
  }

  it('"Pop a wrinkler" goes through the runtime path: pending -> job for the fattest attached normal one', () => {
    const { popper, decideWithExtraBank } = setup([wrinkler(0, 10), wrinkler(1, 500, { type: 1 }), wrinkler(2, 50), wrinkler(3, 900, { phase: 1 })]);

    expect(popper.pending()).toBe(false); // auto play off, nothing mature
    popper.debugPopWrinkler();

    expect(popper.pending()).toBe(true);
    const job = popper.job()!;
    expect(job.key).toBe('wrinkler-pop:2');
    expect(job.action).toBeInstanceOf(WrinklerPopAction);
    expect(decideWithExtraBank).not.toHaveBeenCalled(); // no purchase needed for a forced pop
  });

  it('a forced pop still waits for the safety gates, and ends once it popped', async () => {
    const { runtime, game, popper } = setup([wrinkler(2, 50)]);
    popper.debugPopWrinkler();

    game.rawBuffs = { f: { name: 'Frenzy', multCpS: 7, time: 100 } };
    expect(popper.pending()).toBe(false);

    game.rawBuffs = {};
    runtime.wrinklerNextEvalAt = 0;
    const job = popper.job()!;

    document.body.innerHTML = '<canvas id="backgroundLeftCanvas" width="400" height="600"></canvas>';
    const ctx = {
      runtime,
      game,
      clock: { sleep: () => Promise.resolve() },
      clickTiming: { humanClick: vi.fn(async () => { game.wrinklers[0]!.phase = 0; return true; }) },
      abortRequested: () => false,
    } as unknown as CursorJobContext;

    await job.action.cursor_at_position(ctx);

    expect(runtime.wrinklerForcePopUntil).toBe(0);
    expect(popper.pending()).toBe(false);
  });

  it('a forced pop that did not pop stays forced, so it is retried after the 3s pause', async () => {
    const { runtime, game, popper } = setup([wrinkler(2, 50)]);
    popper.debugPopWrinkler();
    const job = popper.job()!;

    document.body.innerHTML = '<canvas id="backgroundLeftCanvas" width="400" height="600"></canvas>';
    const ctx = {
      runtime,
      game,
      clock: { sleep: () => Promise.resolve() },
      clickTiming: { humanClick: vi.fn(async () => true) }, // pokes that never land
      abortRequested: () => false,
    } as unknown as CursorJobContext;

    await job.action.cursor_at_position(ctx);

    expect(runtime.wrinklerForcePopUntil).toBeGreaterThan(Date.now());
    expect(popper.pending()).toBe(false); // paused 3s

    runtime.wrinklerBlockUntil = 0;
    runtime.wrinklerNextEvalAt = 0;
    expect(popper.pending()).toBe(true);
  });

  it('"Pop a wrinkler" fails when no normal wrinkler is attached', () => {
    const { popper } = setup([wrinkler(0, 10, { phase: 1 }), wrinkler(1, 500, { type: 1 })]);

    expect(() => popper.debugPopWrinkler()).toThrow(/no normal wrinkler/);
  });

  it('"Spawn a wrinkler" uses the game SpawnWrinkler on the first free slot, and fails when all are taken', () => {
    const slots = [0, 1, 2].map((id) => ({ id, phase: id === 0 ? 2 : 0 }));
    const spawn = vi.fn((w: { phase: number }) => {
      w.phase = 1;
    });
    (window as any).Game = { wrinklers: slots, getWrinklersMax: () => 2, SpawnWrinkler: spawn };

    try {
      const game = new GameAdapter();

      expect(game.spawnWrinkler()).toBe(1);
      expect(spawn).toHaveBeenCalledWith(slots[1]);
      expect(() => game.spawnWrinkler()).toThrow(/every wrinkler slot is taken/); // slot 2 is beyond max
    } finally {
      delete (window as any).Game;
    }
  });
});

describe('WrinklerPopAction', () => {
  beforeEach(() => {
    document.body.innerHTML = '<canvas id="backgroundLeftCanvas" width="400" height="600"></canvas>';
  });

  function ctx(game: FakeGameAdapter, onClick: () => void): CursorJobContext {
    return {
      runtime: new RuntimeState(),
      game,
      clock: { sleep: () => Promise.resolve() },
      clickTiming: { humanClick: vi.fn(async () => { onClick(); return true; }) },
      abortRequested: () => false,
    } as unknown as CursorJobContext;
  }

  it('pokes the wrinkler on the canvas until it pops, then reports the cookies gained', async () => {
    const game = new FakeGameAdapter();
    const w = wrinkler(3, 1000, { hp: 2.1 });
    game.wrinklers = [w];

    const onResult = vi.fn();
    const action = new WrinklerPopAction(3, game, () => false, onResult);

    const c = ctx(game, () => {
      w.hp! -= 0.75;
      if (w.hp! <= 0.5) {
        w.phase = 0;
        game.cookies += 1100;
      }
    });

    await action.cursor_at_position(c);

    expect(c.clickTiming.humanClick).toHaveBeenCalledTimes(3);
    expect((c.clickTiming.humanClick as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(document.getElementById('backgroundLeftCanvas'));
    expect(onResult).toHaveBeenCalledWith(true, 1100);
  });

  it('aborts once the wrinkler is gone or something more important comes up', () => {
    const game = new FakeGameAdapter();
    const w = wrinkler(3, 1000);
    game.wrinklers = [w];

    let busy = false;
    const action = new WrinklerPopAction(3, game, () => busy, () => {});

    expect(action.abortIf()).toBe(false);
    busy = true;
    expect(action.abortIf()).toBe(true);
    busy = false;
    w.phase = 0;
    expect(action.abortIf()).toBe(true);
    expect(action.target()).toBeNull();
  });
});

describe('wrinkler poke point (WRINK-5)', () => {
  it('hit-tests the body like the game: 100x200, centred 90px out along the angle', () => {
    const w = wrinkler(0, 0, { x: 200, y: 300, r: 0 });

    expect(wrinklerHit(w, 200, 390)).toBe(true);
    expect(wrinklerHit(w, 245, 390)).toBe(true);
    expect(wrinklerHit(w, 255, 390)).toBe(false);
    expect(wrinklerHit(w, 200, 495)).toBe(false);

    const turned = wrinkler(0, 0, { x: 200, y: 300, r: 90 }); // body points to +x
    expect(wrinklerHit(turned, 290, 300)).toBe(true);
    expect(wrinklerHit(turned, 200, 390)).toBe(false);
  });

  it('pokes the body centre when nothing earlier covers it', () => {
    const w = wrinkler(3, 0, { x: 200, y: 300, r: 0 });
    const later = wrinkler(4, 0, { x: 200, y: 300, r: 0 }); // later ones never steal the click

    expect(wrinklerPokeCanvasPoint(w, [w, later])).toEqual({ x: 200, y: 390 });
  });

  it('dodges an earlier overlapping wrinkler, or gives up when fully covered', () => {
    const w = wrinkler(3, 0, { x: 200, y: 300, r: 0 });
    const neighbour = wrinkler(1, 0, { x: 240, y: 300, r: 0 }); // covers x 190..290
    const all = [neighbour, w];

    const p = wrinklerPokeCanvasPoint(w, all)!;
    expect(wrinklerHit(w, p.x, p.y)).toBe(true);
    expect(wrinklerHit(neighbour, p.x, p.y)).toBe(false);

    const twin = wrinkler(1, 0, { x: 200, y: 300, r: 0 });
    expect(wrinklerPokeCanvasPoint(w, [twin, w])).toBeNull();

    const detached = wrinkler(1, 0, { x: 200, y: 300, r: 0, phase: 0 }); // empty slots don't count
    expect(wrinklerPokeCanvasPoint(w, [detached, w])).toEqual({ x: 200, y: 390 });
  });
});
