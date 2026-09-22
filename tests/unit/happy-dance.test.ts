import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { anyGoldenPresent, danceEligible } from '../../src/hunting/happy-dance';
import type { GameShimmer } from '../../src/game/types';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

function connectedShimmer(id: number): GameShimmer {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return { id, type: 'golden', popped: false, l: el };
}

describe('anyGoldenPresent', () => {
  it('is true only for a connected, not-popped golden shimmer', () => {
    const game = new FakeGameAdapter();

    game.shimmers = [connectedShimmer(1)];
    expect(anyGoldenPresent(game)).toBe(true);

    game.shimmers = [{ id: 2, type: 'golden', popped: true, l: document.createElement('div') }];
    expect(anyGoldenPresent(game)).toBe(false);

    game.shimmers = [];
    expect(anyGoldenPresent(game)).toBe(false);
  });
});

describe('danceEligible', () => {
  let data: PersistedData;
  let game: FakeGameAdapter;

  beforeEach(() => {
    localStorage.clear();
    data = new PersistedData();
    game = new FakeGameAdapter();
  });

  it('is true when dance is enabled and nothing else is going on', () => {
    expect(danceEligible(data, game, () => false, () => false)).toBe(true);
  });

  it('is false when the dance length setting is 0', () => {
    data.config.happyDanceMs = 0;
    expect(danceEligible(data, game, () => false, () => false)).toBe(false);
  });

  it('is false during a cookie chain', () => {
    expect(danceEligible(data, game, () => true, () => false)).toBe(false);
  });

  it('is false when another golden cookie is still present', () => {
    game.shimmers = [connectedShimmer(1)];
    expect(danceEligible(data, game, () => false, () => false)).toBe(false);
  });

  it('is false when real work is pending', () => {
    expect(danceEligible(data, game, () => false, () => true)).toBe(false);
  });
});
