import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameAdapter } from '../../src/game/game-adapter';

describe('GameAdapter', () => {
  const game = new GameAdapter();

  afterEach(() => {
    delete (window as any).Game;
  });

  it('reports not present and fps 0 when window.Game is missing', () => {
    expect(game.isPresent()).toBe(false);
    expect(game.getFps()).toBe(0);
    expect(game.getGrimoire()).toBeNull();
    expect(game.getShimmers()).toEqual([]);
    expect(game.getRawBuffs()).toEqual({});
    expect(game.clickFrenzyActive()).toBe(false);
  });

  it('falls back to 13s for estimateClickFrenzySec when Game is missing', () => {
    expect(game.estimateClickFrenzySec()).toBe(13);
  });

  describe('with a Game object present', () => {
    beforeEach(() => {
      (window as any).Game = {
        fps: 30,
        hasBuff: (name: string) => name === 'Click frenzy',
        Has: (name: string) => name === 'Get lucky',
        auraMult: () => 0,
        buffs: {
          a: { name: 'Frenzy', multCpS: 7, time: 900 },
          b: { name: 'Weak', multCpS: 1, time: 900 }, // filtered out: mult must be > 1
          c: { dname: 'Devil', multCpS: 3, time: 10 },
        },
      };
    });

    it('positiveCpsBuffs filters multCpS <= 1 and sorts by name', () => {
      const buffs = game.positiveCpsBuffs();
      expect(buffs.map((b) => b.name)).toEqual(['Devil', 'Frenzy']);
      expect(buffs.every((b) => b.mult > 1)).toBe(true);
    });

    it('doubles the estimate when Get lucky is owned', () => {
      // 13 * 2 (Get lucky) = 26
      expect(game.estimateClickFrenzySec()).toBe(26);
    });

    it('cpsBuffOutlastsClickFrenzy is true only for a buff long enough to outlast a frenzy', () => {
      // estimate is 26s; 900 frames / 30 fps = 30s >= 26s, 10 frames / 30 fps = 0.33s < 26s
      expect(game.cpsBuffOutlastsClickFrenzy()).toBe(true);
    });

    it('clickFrenzyActive reflects Game.hasBuff', () => {
      expect(game.clickFrenzyActive()).toBe(true);
    });
  });
});
