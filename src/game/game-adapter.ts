import type { CpsBuff, GameShimmer, GrimoireMinigame, RawBuff } from './types';

/** Every access to the live Cookie Clicker `Game` object goes through this interface. It is
 * the one mockable seam between our logic and the page's own global. */
export interface IGameAdapter {
  isPresent(): boolean;
  getFps(): number;
  hasBuff(name: string): boolean;
  hasUpgrade(name: string): boolean;
  getAuraMult(name: string): number;
  getGrimoire(): GrimoireMinigame | null;
  getRawBuffs(): Record<string, RawBuff>;
  getShimmers(): GameShimmer[];
  getGoldenChainCount(): number;
  positiveCpsBuffs(): CpsBuff[];
  estimateClickFrenzySec(): number;
  cpsBuffOutlastsClickFrenzy(buffs?: CpsBuff[]): boolean;
  clickFrenzyActive(): boolean;
}

export class GameAdapter implements IGameAdapter {
  isPresent(): boolean {
    return !!window.Game;
  }

  getFps(): number {
    const Game = window.Game;
    return Game ? Number(Game.fps) || 0 : 0;
  }

  hasBuff(name: string): boolean {
    const Game = window.Game;
    return !!(Game && typeof Game.hasBuff === 'function' && Game.hasBuff(name));
  }

  hasUpgrade(name: string): boolean {
    try {
      const Game = window.Game;
      return !!(Game && typeof Game.Has === 'function' && Game.Has(name));
    } catch (_e) {
      return false;
    }
  }

  getAuraMult(name: string): number {
    try {
      const Game = window.Game;
      if (Game && typeof Game.auraMult === 'function') {
        return Number(Game.auraMult(name)) || 0;
      }
    } catch (_e) {
      /* fall through */
    }
    return 0;
  }

  getGrimoire(): GrimoireMinigame | null {
    try {
      const Game = window.Game;
      return Game && Game.Objects && Game.Objects['Wizard tower'] && Game.Objects['Wizard tower'].minigame
        ? Game.Objects['Wizard tower'].minigame
        : null;
    } catch (_e) {
      return null;
    }
  }

  getRawBuffs(): Record<string, RawBuff> {
    const Game = window.Game;
    return Game && Game.buffs ? Game.buffs : {};
  }

  getShimmers(): GameShimmer[] {
    const Game = window.Game;
    return Game && Array.isArray(Game.shimmers) ? Game.shimmers : [];
  }

  getGoldenChainCount(): number {
    const Game = window.Game;
    if (Game && Game.shimmerTypes && Game.shimmerTypes.golden) {
      return Number(Game.shimmerTypes.golden.chain) || 0;
    }
    return 0;
  }

  /** All active buffs that multiply CpS (multCpS > 1), sorted by name. */
  positiveCpsBuffs(): CpsBuff[] {
    const buffs = this.getRawBuffs();
    const out: CpsBuff[] = [];

    for (const key of Object.keys(buffs)) {
      const buff = buffs[key];
      if (!buff) continue;

      const mult = Number(buff.multCpS);
      if (Number.isFinite(mult) && mult > 1) {
        out.push({
          key,
          name: buff.name || buff.dname || key,
          mult,
          time: Number(buff.time) || 0,
        });
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /** Rough length (seconds) a Click Frenzy would have if it fired now: 13s x 2 (Get lucky) x
   * 1.1 (Lasting fortune) x (1 + 0.05 x Epoch Manipulator aura). Small +1% upgrades and the
   * Pantheon bonus are ignored on purpose (precision is not needed). */
  estimateClickFrenzySec(): number {
    try {
      let mod = 1;

      if (this.hasUpgrade('Get lucky')) mod *= 2;
      if (this.hasUpgrade('Lasting fortune')) mod *= 1.1;

      mod *= 1 + this.getAuraMult('Epoch Manipulator') * 0.05;

      return Math.ceil(13 * mod);
    } catch (_e) {
      return 13;
    }
  }

  /** The 'outlast' rule: is there a CpS buff with at least estimateClickFrenzySec() seconds
   * left? A FTHOF that rolls Click Frenzy is only worth it when that frenzy fully overlaps a
   * buff. */
  cpsBuffOutlastsClickFrenzy(buffs?: CpsBuff[]): boolean {
    const cfSec = this.estimateClickFrenzySec();
    const fps = this.getFps() || 30;

    return (buffs || this.positiveCpsBuffs()).some((b) => b.time / fps >= cfSec);
  }

  clickFrenzyActive(): boolean {
    return this.hasBuff('Click frenzy');
  }
}
