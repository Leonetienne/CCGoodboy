import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConsoleVoice, sayCantWhile, sayOops } from '../../src/core/console-voice';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { FthofActions } from '../../src/hunting/fthof';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetConsoleVoice();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

const said = () => logSpy.mock.calls.map((c) => String(c[0]));

describe('sayCantWhile (CON-2)', () => {
  it('says a reason once, again only when it changes or after being re-armed', () => {
    sayCantWhile('x', 'a', 'A');
    sayCantWhile('x', 'a', 'A');
    sayCantWhile('x', 'b', 'B');
    sayCantWhile('x', null);
    sayCantWhile('x', 'b', 'B');

    expect(said()).toEqual(['A', 'B', 'B']);
  });

  it('keeps wishes apart', () => {
    sayCantWhile('x', 'a', 'A');
    sayCantWhile('y', 'a', 'A2');

    expect(said()).toEqual(['A', 'A2']);
  });
});

describe('sayOops (CON-3)', () => {
  it('goes to console.error with the error object', () => {
    const e = new Error('boom');
    sayOops('Oopsie', e);

    expect(errSpy).toHaveBeenCalledWith('Oopsie', e);
  });
});

describe('FthofActions.reportBlockers (CON-2)', () => {
  const grimoireView = (amount: number) => ({ wizardTower: () => ({ name: 'Wizard tower', amount, level: 0 }) });

  function setup(opts: { magic?: number; magicM?: number; grimoire?: boolean; towers?: number; buffs: number }) {
    const game = new FakeGameAdapter();
    if (opts.grimoire !== false) {
      game.grimoire = { spells: { 'hand of fate': { id: 1 } }, getSpellCost: () => 100, magic: opts.magic ?? 0, magicM: opts.magicM ?? 1000 };
    }
    game.rawBuffs = {};
    for (let i = 0; i < opts.buffs; i++) game.rawBuffs[`b${i}`] = { name: `Buff ${i}`, multCpS: 2, time: 3000 };
    const runtime = new RuntimeState();
    const f = new FthofActions(runtime, game, null as never, null as never, () => false, grimoireView(opts.towers ?? 1) as never, new PersistedData());
    return { game, runtime, f };
  }

  it('says there are no wizard towers', () => {
    const { f } = setup({ grimoire: false, towers: 0, buffs: 1 });
    f.reportBlockers(f['game'].positiveCpsBuffs());

    expect(said()[0]).toMatch(/no wizard towers/);
  });

  it('says the Grimoire is locked when towers exist but no minigame', () => {
    const { f } = setup({ grimoire: false, towers: 3, buffs: 1 });
    f.reportBlockers(f['game'].positiveCpsBuffs());

    expect(said()[0]).toMatch(/Grimoire is still locked/);
  });

  it('says not enough mana once, even while mana keeps changing', () => {
    const { game, f } = setup({ magic: 10, buffs: 1 });
    f.reportBlockers(game.positiveCpsBuffs());
    game.grimoire!.magic = 20;
    f.reportBlockers(game.positiveCpsBuffs());

    expect(said()).toEqual(['Wanted to cast Force the Hand of Fate, but not enough mana (10/100) :c']);
  });

  it('with 2 buffs, also says why the refill cannot happen: cooldown, then no lumps', () => {
    const { game, f } = setup({ magic: 10, buffs: 2 });
    game.refillable = false;
    game.lumps = 3;
    f.reportBlockers(game.positiveCpsBuffs());
    game.refillable = true;
    game.lumps = 0;
    f.reportBlockers(game.positiveCpsBuffs());

    expect(said().slice(1)).toEqual([
      'Wanted to refill mana, but refilling is still on cooldown :c',
      'Wanted to refill mana, but I have no sugar popsies :c',
    ]);
  });

  it('says full mana is too small to ever pay for the spell', () => {
    const { game, f } = setup({ magic: 10, magicM: 50, buffs: 2 });
    game.refillable = true;
    game.lumps = 3;
    f.reportBlockers(game.positiveCpsBuffs());

    expect(said()[1]).toMatch(/even full mana \(50\)/);
  });

  it('is silent without a CpS buff', () => {
    const { game, f } = setup({ magic: 10, buffs: 0 });
    f.reportBlockers(game.positiveCpsBuffs());

    expect(said()).toEqual([]);
  });
});

describe('FthofActions.reportBlockers while the Grimoire loads', () => {
  it('stays quiet when the Wizard tower is levelled but the minigame is not loaded yet', () => {
    const game = new FakeGameAdapter();
    game.rawBuffs = { b0: { name: 'Frenzy', multCpS: 7, time: 3000 } };
    const view = { wizardTower: () => ({ name: 'Wizard tower', amount: 50, level: 1 }) };
    const f = new FthofActions(new RuntimeState(), game, null as never, null as never, () => false, view as never, new PersistedData());

    f.reportBlockers(game.positiveCpsBuffs());

    expect(said()).toEqual([]);
  });
});
