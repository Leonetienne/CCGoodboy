import { beforeEach, describe, expect, it } from 'vitest';
import { FthofAction, RefillAction } from '../../src/actions/fthof';
import { GoldenCookieAction } from '../../src/actions/golden-cookie';
import { LumpHarvestAction } from '../../src/actions/lump-harvest';
import { RuntimeState } from '../../src/core/runtime-state';
import type { GameShimmer } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function connectedShimmer(overrides: Partial<GameShimmer> = {}): GameShimmer {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return { id: 1, type: 'golden', popped: false, l: el, ...overrides };
}

function withGrimoire(game: FakeGameAdapter, magic: number, spellId = 1) {
  game.grimoire = {
    spells: { 'hand of fate': { id: spellId } },
    getSpellCost: () => 100,
    magic,
  };
}

function withOutlastingBuffs(game: FakeGameAdapter, count: number) {
  game.rawBuffs = {};
  for (let i = 0; i < count; i++) {
    game.rawBuffs[`b${i}`] = { name: `Buff ${i}`, multCpS: 2, time: 3000 };
  }
}

describe('GoldenCookieAction', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('aborts when the shimmer is gone (popped, wrath or disconnected)', () => {
    const runtime = new RuntimeState();
    const game = new FakeGameAdapter();
    const make = (shimmer: GameShimmer) => new GoldenCookieAction(runtime, game, null as never, null as never, () => false, shimmer);

    expect(make(connectedShimmer({ popped: true })).abortIf()).toBe(true);
    expect(make(connectedShimmer({ wrath: 1 })).abortIf()).toBe(true);

    const disconnected = connectedShimmer();
    disconnected.l!.remove();
    expect(make(disconnected).abortIf()).toBe(true);
  });

  it('does not abort for a live good shimmer', () => {
    const runtime = new RuntimeState();
    const game = new FakeGameAdapter();
    const action = new GoldenCookieAction(runtime, game, null as never, null as never, () => false, connectedShimmer());

    expect(action.abortIf()).toBe(false);
    expect(action.label).toBe('click golden cookie');
    expect(action.abortOnGolden).toBe(false);
    expect(action.reacquire).toBe(true);
  });
});

describe('FthofAction.abortIf', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  function make(game: FakeGameAdapter) {
    const runtime = new RuntimeState();
    return new FthofAction(runtime, game, null as never, null as never, () => false);
  }

  it('is true without a Grimoire or without the spell control', () => {
    const game = new FakeGameAdapter();
    expect(make(game).abortIf()).toBe(true);

    withGrimoire(game, 200); // spell id 1, but no #grimoireSpell1 element
    expect(make(game).abortIf()).toBe(true);
  });

  it('is false when mana, buffs and the control are all in place', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 200);
    withOutlastingBuffs(game, 1);
    const control = document.createElement('div');
    control.id = 'grimoireSpell1';
    document.body.appendChild(control);

    expect(make(game).abortIf()).toBe(false);
  });

  it('is true during a Click Frenzy or when a good golden is ready', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 200);
    withOutlastingBuffs(game, 1);
    const control = document.createElement('div');
    control.id = 'grimoireSpell1';
    document.body.appendChild(control);

    game.buffNames.add('Click frenzy');
    expect(make(game).abortIf()).toBe(true);

    game.buffNames.clear();
    const runtime = new RuntimeState();
    const withGolden = new FthofAction(runtime, game, null as never, null as never, () => true);
    expect(withGolden.abortIf()).toBe(true);
  });
});

describe('RefillAction.abortIf', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  function make(game: FakeGameAdapter) {
    const runtime = new RuntimeState();
    return new RefillAction(runtime, game, null as never, null as never, () => false);
  }

  function withRefillControl() {
    const control = document.createElement('div');
    control.id = 'grimoireLumpRefill';
    document.body.appendChild(control);
  }

  it('is false when a refill is possible: >=2 outlasting buffs, low mana, lumps ready', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 10); // < cost 100
    withOutlastingBuffs(game, 2);
    withRefillControl();
    game.refillable = true;
    game.lumps = 5;

    expect(make(game).abortIf()).toBe(false);
  });

  it('is true when LOCK_A is set or refill is already in flight', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 10);
    withOutlastingBuffs(game, 2);
    withRefillControl();
    game.refillable = true;
    game.lumps = 5;

    const runtime = new RuntimeState();
    runtime.lockA = true;
    expect(new RefillAction(runtime, game, null as never, null as never, () => false).abortIf()).toBe(true);

    runtime.lockA = false;
    runtime.refillInFlight = true;
    expect(new RefillAction(runtime, game, null as never, null as never, () => false).abortIf()).toBe(true);
  });

  it('is true when the game cannot refill or no lumps are left', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 10);
    withOutlastingBuffs(game, 2);
    withRefillControl();
    game.refillable = false;
    game.lumps = 0;

    expect(make(game).abortIf()).toBe(true);
  });
});

describe('LumpHarvestAction.abortIf', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  function make(game: FakeGameAdapter, hasGoodGolden = () => false) {
    const runtime = new RuntimeState();
    return new LumpHarvestAction(runtime, game, null as never, null as never, hasGoodGolden);
  }

  function withLumpControl() {
    const control = document.createElement('div');
    control.id = 'lumps';
    document.body.appendChild(control);
  }

  it('is false for a ripe lump with the control present, outside Click Frenzy, no good golden', () => {
    const game = new FakeGameAdapter();
    withLumpControl();
    game.lumpRipe = true;

    expect(make(game).abortIf()).toBe(false);
  });

  it('is true when the lump control is missing or disconnected', () => {
    const game = new FakeGameAdapter();
    game.lumpRipe = true;

    expect(make(game).abortIf()).toBe(true);
  });

  it('is true when the lump is not ripe', () => {
    const game = new FakeGameAdapter();
    withLumpControl();
    game.lumpRipe = false;

    expect(make(game).abortIf()).toBe(true);
  });

  it('is true during Click Frenzy or when a good golden cookie is ready', () => {
    const game = new FakeGameAdapter();
    withLumpControl();
    game.lumpRipe = true;
    game.buffNames.add('Click frenzy');

    expect(make(game).abortIf()).toBe(true);

    game.buffNames.clear();
    expect(make(game, () => true).abortIf()).toBe(true);
  });
});
