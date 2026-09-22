import type { RuntimeState } from '../core/runtime-state';
import type { LogStore } from '../stats/log';
import type { IGameAdapter } from './game-adapter';
import type { CpsBuff } from './types';

/** Called every scheduler tick. Logs CpS-buff and Click Frenzy changes, maintains LOCK_A
 * (opens it when the buff count returns to 0 or rises to >= 3) and restarts the big-cookie
 * timeline when a Click Frenzy starts. */
export class BuffLockTracker {
  constructor(
    private readonly game: IGameAdapter,
    private readonly runtime: RuntimeState,
    private readonly log: LogStore,
  ) {}

  update(): CpsBuff[] {
    const buffs = this.game.positiveCpsBuffs();
    const count = buffs.length;
    const signature = buffs.map((b) => `${b.name}@${b.mult}`).join('|');
    const cf = this.game.clickFrenzyActive();

    if (count === 0 && this.runtime.lockA) {
      this.runtime.lockA = false;
      this.log.log('unlock A', 'cps buff count returned to 0');
    } else if (count >= 3 && count > this.runtime.lastCpsBuffCount && this.runtime.lockA) {
      this.runtime.lockA = false;
      this.log.log('unlock A', `cps buff count increased ${this.runtime.lastCpsBuffCount}->${count}`);
    }

    if (signature !== this.runtime.lastCpsSignature) {
      this.log.log('cps buffs changed', signature || 'none', { count });
      this.runtime.lastCpsSignature = signature;
    }

    if (cf !== this.runtime.lastClickFrenzy) {
      this.log.log('click frenzy', cf ? 'started' : 'ended');
      this.runtime.lastClickFrenzy = cf;

      if (cf) {
        this.runtime.nextBigClickAt = Date.now();
      }
    }

    this.runtime.lastCpsBuffCount = count;
    return buffs;
  }
}
