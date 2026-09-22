import { describe, expect, it } from 'vitest';
import { RuntimeState } from '../../src/core/runtime-state';
import { FthofActions } from '../../src/hunting/fthof';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

// fthofOrRefillPending only touches `game` and `runtime`; the other collaborators (stats,
// log) are irrelevant to it and never invoked here.
function makeFthofActions(game: FakeGameAdapter, runtime: RuntimeState): FthofActions {
  return new FthofActions(runtime, game, null as never, null as never, () => false);
}

function withGrimoire(game: FakeGameAdapter, magic: number) {
  game.grimoire = {
    spells: { 'hand of fate': { id: 1 } },
    getSpellCost: () => 100,
    magic,
  };
}

function withCpsBuffs(game: FakeGameAdapter, count: number, timeFrames: number) {
  game.rawBuffs = {};
  for (let i = 0; i < count; i++) {
    game.rawBuffs[`b${i}`] = { name: `Buff ${i}`, multCpS: 2, time: timeFrames };
  }
}

describe('FthofActions.fthofOrRefillPending', () => {
  it('is false without a Grimoire', () => {
    const game = new FakeGameAdapter();
    const runtime = new RuntimeState();
    expect(makeFthofActions(game, runtime).fthofOrRefillPending()).toBe(false);
  });

  it('is false when no CpS buff would outlast a click frenzy', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 50);
    withCpsBuffs(game, 1, 1); // far too short
    const runtime = new RuntimeState();

    expect(makeFthofActions(game, runtime).fthofOrRefillPending()).toBe(false);
  });

  it('is true for a cast: >=1 outlasting buff and enough mana', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 200); // >= cost (100)
    withCpsBuffs(game, 1, 3000); // 3000/30fps = 100s, well over the ~13-26s estimate
    const runtime = new RuntimeState();

    expect(makeFthofActions(game, runtime).fthofOrRefillPending()).toBe(true);
  });

  it('is true for a refill: >=2 outlasting buffs, not enough mana, LOCK_A open, no refill in flight', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 10); // < cost (100)
    withCpsBuffs(game, 2, 3000);
    const runtime = new RuntimeState();

    expect(makeFthofActions(game, runtime).fthofOrRefillPending()).toBe(true);
  });

  it('is false for a would-be refill when LOCK_A is set', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 10);
    withCpsBuffs(game, 2, 3000);
    const runtime = new RuntimeState();
    runtime.lockA = true;

    expect(makeFthofActions(game, runtime).fthofOrRefillPending()).toBe(false);
  });

  it('is false for a would-be refill already in flight', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 10);
    withCpsBuffs(game, 2, 3000);
    const runtime = new RuntimeState();
    runtime.refillInFlight = true;

    expect(makeFthofActions(game, runtime).fthofOrRefillPending()).toBe(false);
  });

  it('is false for a would-be refill with only 1 buff (needs >= 2)', () => {
    const game = new FakeGameAdapter();
    withGrimoire(game, 10);
    withCpsBuffs(game, 1, 3000);
    const runtime = new RuntimeState();

    expect(makeFthofActions(game, runtime).fthofOrRefillPending()).toBe(false);
  });
});
