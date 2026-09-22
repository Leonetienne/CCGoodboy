import type { IGameAdapter } from '../../../src/game/game-adapter';
import type { CpsBuff, GameShimmer, GrimoireMinigame, RawBuff } from '../../../src/game/types';

/** A hand-written stand-in for GameAdapter, settable per test. Everything defaults to the
 * "Game not ready" shape so a test only needs to override what it cares about. */
export class FakeGameAdapter implements IGameAdapter {
  present = true;
  fps = 30;
  buffNames = new Set<string>();
  upgradeNames = new Set<string>();
  auraMults: Record<string, number> = {};
  grimoire: GrimoireMinigame | null = null;
  rawBuffs: Record<string, RawBuff> = {};
  shimmers: GameShimmer[] = [];
  goldenChainCount = 0;
  ready = true;
  lastGoldenEffect = '';
  refillable = false;
  lumps = 0;
  askLumpsPref = 0;

  isPresent(): boolean {
    return this.present;
  }

  isReady(): boolean {
    return this.present && this.ready;
  }

  getFps(): number {
    return this.fps;
  }

  hasBuff(name: string): boolean {
    return this.buffNames.has(name);
  }

  hasUpgrade(name: string): boolean {
    return this.upgradeNames.has(name);
  }

  getAuraMult(name: string): number {
    return this.auraMults[name] || 0;
  }

  getGrimoire(): GrimoireMinigame | null {
    return this.grimoire;
  }

  getRawBuffs(): Record<string, RawBuff> {
    return this.rawBuffs;
  }

  getShimmers(): GameShimmer[] {
    return this.shimmers;
  }

  getGoldenChainCount(): number {
    return this.goldenChainCount;
  }

  positiveCpsBuffs(): CpsBuff[] {
    const out: CpsBuff[] = [];

    for (const key of Object.keys(this.rawBuffs)) {
      const buff = this.rawBuffs[key];
      if (!buff) continue;

      const mult = Number(buff.multCpS);
      if (Number.isFinite(mult) && mult > 1) {
        out.push({ key, name: buff.name || buff.dname || key, mult, time: Number(buff.time) || 0 });
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  estimateClickFrenzySec(): number {
    let mod = 1;
    if (this.hasUpgrade('Get lucky')) mod *= 2;
    if (this.hasUpgrade('Lasting fortune')) mod *= 1.1;
    mod *= 1 + this.getAuraMult('Epoch Manipulator') * 0.05;
    return Math.ceil(13 * mod);
  }

  cpsBuffOutlastsClickFrenzy(buffs?: CpsBuff[]): boolean {
    const cfSec = this.estimateClickFrenzySec();
    const fps = this.fps || 30;
    return (buffs || this.positiveCpsBuffs()).some((b) => b.time / fps >= cfSec);
  }

  clickFrenzyActive(): boolean {
    return this.hasBuff('Click frenzy');
  }

  getLastGoldenEffect(): string {
    return this.lastGoldenEffect;
  }

  canRefillLump(): boolean {
    return this.refillable;
  }

  getLumps(): number {
    return this.lumps;
  }

  getAskLumpsPref(): number {
    return this.askLumpsPref;
  }

  setAskLumpsPref(value: number): void {
    this.askLumpsPref = value;
  }
}
