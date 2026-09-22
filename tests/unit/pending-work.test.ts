import { describe, expect, it } from 'vitest';
import { PendingWork } from '../../src/idle/pending-work';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function makePendingWork(
  game: FakeGameAdapter,
  overrides: Partial<{ hasGoodGolden: boolean; hammerActive: boolean; fthofOrRefillPending: boolean; autoShopReady: boolean }> = {},
) {
  return new PendingWork(
    game,
    () => overrides.hasGoodGolden ?? false,
    () => overrides.hammerActive ?? false,
    () => overrides.fthofOrRefillPending ?? false,
    () => overrides.autoShopReady ?? false,
  );
}

describe('PendingWork', () => {
  it('is false when Game is not present or not ready', () => {
    const game = new FakeGameAdapter();
    game.present = false;
    expect(makePendingWork(game, { hammerActive: true }).isPending()).toBe(false);

    game.present = true;
    game.ready = false;
    expect(makePendingWork(game, { hammerActive: true }).isPending()).toBe(false);
  });

  it('is true when hammer mode is active', () => {
    const game = new FakeGameAdapter();
    expect(makePendingWork(game, { hammerActive: true }).isPending()).toBe(true);
  });

  it('is true when a good golden cookie is ready or Click Frenzy is active', () => {
    const game = new FakeGameAdapter();
    expect(makePendingWork(game, { hasGoodGolden: true }).isPending()).toBe(true);

    game.buffNames.add('Click frenzy');
    expect(makePendingWork(game).isPending()).toBe(true);
  });

  it('falls through to fthof/refill and auto-shop readiness', () => {
    const game = new FakeGameAdapter();
    expect(makePendingWork(game).isPending()).toBe(false);
    expect(makePendingWork(game, { fthofOrRefillPending: true }).isPending()).toBe(true);
    expect(makePendingWork(game, { autoShopReady: true }).isPending()).toBe(true);
  });
});
