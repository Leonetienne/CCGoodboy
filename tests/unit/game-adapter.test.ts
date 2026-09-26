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

  describe('sugar lump ripeness', () => {
    afterEach(() => {
      delete (window as any).Game;
    });

    function withLump(age: number) {
      (window as any).Game = {
        canLumps: () => true,
        lumpT: Date.now() - age,
        lumpMatureAge: 1000,
        lumpRipeAge: 2000,
        lumpOverripeAge: 4000,
      };
    }

    it('isLumpRipe is false when lumps are not unlocked', () => {
      (window as any).Game = { canLumps: () => false, lumpT: Date.now(), lumpRipeAge: 2000, lumpOverripeAge: 3000 };
      expect(game.isLumpRipe()).toBe(false);
    });

    it('isLumpRipe is false while still growing/mature (below lumpRipeAge)', () => {
      withLump(1500); // mature but not yet ripe (< 2000)
      expect(game.isLumpRipe()).toBe(false);
    });

    it('isLumpRipe is true inside the ripe window [lumpRipeAge, lumpOverripeAge)', () => {
      withLump(3000);
      expect(game.isLumpRipe()).toBe(true);
    });

    it('isLumpRipe is false once overripe (the game auto-harvests those itself)', () => {
      withLump(4500);
      expect(game.isLumpRipe()).toBe(false);
    });

    it('ripenLump sets lumpT so the lump becomes ripe', () => {
      withLump(500); // still growing
      expect(game.isLumpRipe()).toBe(false);

      game.ripenLump();
      expect(game.isLumpRipe()).toBe(true);
    });

    it('ripenLump throws when no lump is growing yet', () => {
      (window as any).Game = { canLumps: () => true };
      expect(() => game.ripenLump()).toThrow();
    });
  });

  describe('stock market speed (DBG-24)', () => {
    it('sets the game\'s own tick length and reads it back as a factor', () => {
      const M = { secondsPerTick: 60, tickT: 1500, toRedraw: 0 };
      (window as any).Game = { fps: 30, Objects: { Bank: { minigameLoaded: true, minigame: M } } };

      expect(game.getMarketSpeed()).toBe(1);

      game.setMarketSpeed(50);
      expect(M.secondsPerTick).toBeCloseTo(1.2);
      expect(M.tickT).toBe(36); // never further than one (new) tick from the next one
      expect(game.getMarketSpeed()).toBeCloseTo(50);

      game.setMarketSpeed(1);
      expect(M.secondsPerTick).toBe(60);
    });

    it('throws while the market is locked', () => {
      (window as any).Game = { fps: 30, Objects: { Bank: { minigameLoaded: false } } };
      expect(() => game.setMarketSpeed(50)).toThrow(/not unlocked/);
      expect(game.getMarketSpeed()).toBe(1);
    });
  });
  describe('game speed (DBG-25)', () => {
    it('runs Game.Logic n times per frame, once while catching up, and restores it', () => {
      let calls = 0;
      const logic = () => {
        calls++;
      };
      const Game: any = { Logic: logic, catchupLogic: 0 };
      (window as any).Game = Game;

      expect(game.getGameSpeed()).toBe(1);

      game.setGameSpeed(100);
      expect(game.getGameSpeed()).toBe(100);
      Game.Logic();
      expect(calls).toBe(100);

      Game.catchupLogic = 1;
      Game.Logic();
      expect(calls).toBe(101);

      game.setGameSpeed(100); // switching on twice doesn't stack
      Game.catchupLogic = 0;
      Game.Logic();
      expect(calls).toBe(201);

      game.setGameSpeed(1);
      expect(Game.Logic).toBe(logic);
      expect(game.getGameSpeed()).toBe(1);
    });

    it('throws without Game.Logic', () => {
      (window as any).Game = {};
      expect(() => game.setGameSpeed(100)).toThrow(/Game.Logic/);
    });
  });
});
