import { sayCant, sayCantWhile } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { lumpSpendingEnabled } from '../hunting/fthof';
import type { GrimoireView } from '../hunting/grimoire-view';
import type { LogStore } from '../stats/log';

/** Auto play: unlocks the Grimoire (AUTO-13) by spending one sugar lump on Wizard tower
 * level 1 as soon as at least one Wizard tower and one sugar lump are available. The way
 * there (Options/Stats/Stats back to the buildings, scrolling, the "lvl" click) is planned
 * one step per tick by GrimoireView with goal 'level'. */
export class GrimoireUnlocker {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly grimoireView: GrimoireView,
    private readonly shoppingInterrupted: () => boolean,
  ) {}

  /** Auto play wants the Grimoire unlocked right now (AUTO-13): mode on, "Spend sugar lumps"
   * on (FT-9), AUTO-7 safety gates clear, >= 1 Wizard tower still at level 0, sugar lumps
   * unlocked and >= 1 in stock. */
  wanted(): boolean {
    if (this.data.config.autoPlay !== true) return false;
    if (!lumpSpendingEnabled(this.data.config)) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;
    if (Date.now() < this.runtime.grimoireUnlockBlockUntil) return false;
    if (this.shoppingInterrupted()) return false;

    const wt = this.grimoireView.wizardTower();
    if (!wt || !((Number(wt.amount) || 0) >= 1) || this.grimoireView.wizardLevel() !== 0) return false;

    const noLumps = !this.game.lumpsUnlocked() ? 'lumps-locked' : this.game.getLumps() < 1 ? 'no-lumps' : null;

    sayCantWhile(
      'grimoire unlock',
      noLumps,
      noLumps === 'lumps-locked'
        ? 'Wanted to unlock my Grimoire, but sugar lumps aren\'t unlocked yet :c'
        : 'Wanted to unlock my Grimoire, but I have no sugar popsies :c',
    );

    return noLumps == null;
  }

  /** Something for this module to do (the scheduler, PendingWork and hammering use it). A
   * dry run only logs, so it never counts as pending. */
  pending(): boolean {
    return this.wanted() && this.data.config.autoDryRun !== true;
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    if (!this.wanted()) return null;

    if (this.data.config.autoDryRun === true) {
      const now = Date.now();
      const last = this.runtime.autoWouldLog.get('grimoire unlock') || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set('grimoire unlock', now);
        this.log.log('auto play (dry run)', 'would unlock the Grimoire (Wizard tower level 1, 1 sugar lump)');
      }

      return null;
    }

    const step = this.grimoireView.nextStep({
      goal: 'level',
      priority: JOB_PRIORITY.AUTO_SHOP,
      keyPrefix: 'grimoire-unlock',
      abortIf: () => !this.wanted(),
      allowLevelUp: true,
      onFail: (why) => this.block(10000, why),
      onLevelResult: (leveled, level) => {
        if (leveled) {
          this.runtime.lastAutoBuyAt = Date.now();
          this.log.log('auto grimoire unlock', 'Wizard tower level 1', { level, lumps: this.game.getLumps() });
        } else {
          this.block(3000, 'level up did not happen');
        }
      },
    });

    if (step.kind === 'job') return step.job;
    if (step.kind === 'blocked') this.block(10000, step.why);

    return null;
  }

  private block(ms: number, why: string): void {
    this.runtime.grimoireUnlockBlockUntil = Date.now() + ms;
    this.log.log('auto grimoire unlock', `paused: ${why}`);
    sayCant(`Wanted to unlock my Grimoire, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}
