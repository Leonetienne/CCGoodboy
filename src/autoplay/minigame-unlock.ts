import { sayCant, sayCantWhile } from '../core/console-voice';
import type { Config, PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { lumpSpendingEnabled } from '../hunting/fthof';
import type { MinigameView } from '../hunting/minigame-view';
import type { LogStore } from '../stats/log';

/** What differs between the minigame unlocks. */
export interface MinigameUnlockSpec {
  /** 'the stock market', 'the garden' (console lines, dry run log). */
  what: string;
  /** 'Bank level 1 (stock market)' (the log line of a successful unlock). */
  levelText: string;
  /** Log action ('auto bank unlock') and dedup/dry-run key prefix ('bank-unlock'). */
  logAction: string;
  keyPrefix: string;
  /** The minigame's own setting ("Play the stock market", "Tend the garden"). */
  enabled: (config: Config) => boolean;
  /** Its pause after a failure (a RuntimeState field). */
  blockField: 'bankUnlockBlockUntil' | 'farmUnlockBlockUntil';
}

/** Auto play: unlocks a building's minigame by spending one sugar lump on its level 1 as soon
 * as the building and a sugar lump are available, like the Grimoire unlock (AUTO-13), but only
 * while the minigame's own setting is on: an unplayed minigame isn't worth a lump (the stock
 * market AUTO-16, the garden AUTO-17). The way there (Options/Stats/Stats, scrolling, the
 * "lvl" click) is planned one step per tick by the building's MinigameView with goal 'level'. */
export class MinigameUnlocker {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly view: MinigameView,
    private readonly shoppingInterrupted: () => boolean,
    private readonly spec: MinigameUnlockSpec,
  ) {}

  /** Auto play wants the minigame unlocked right now: mode and the minigame's setting on,
   * "Spend sugar lumps" on (FT-9), AUTO-7 safety gates clear, >= 1 of the building still at
   * level 0, sugar lumps unlocked and >= 1 in stock. */
  wanted(): boolean {
    if (this.data.config.autoPlay !== true || !this.spec.enabled(this.data.config)) return false;
    if (!lumpSpendingEnabled(this.data.config)) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;
    if (Date.now() < this.runtime[this.spec.blockField]) return false;
    if (this.shoppingInterrupted()) return false;

    const b = this.view.building();
    if (!b || !((Number(b.amount) || 0) >= 1) || this.view.level() !== 0) return false;

    const noLumps = !this.game.lumpsUnlocked() ? 'lumps-locked' : this.game.getLumps() < 1 ? 'no-lumps' : null;

    sayCantWhile(
      `${this.spec.keyPrefix}`,
      noLumps,
      noLumps === 'lumps-locked'
        ? `Wanted to unlock ${this.spec.what}, but sugar lumps aren't unlocked yet :c`
        : `Wanted to unlock ${this.spec.what}, but I have no sugar popsies :c`,
    );

    return noLumps == null;
  }

  /** Something for this module to do. A dry run only logs, so it never counts as pending. */
  pending(): boolean {
    return this.wanted() && this.data.config.autoDryRun !== true;
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    if (!this.wanted()) return null;

    if (this.data.config.autoDryRun === true) {
      const now = Date.now();
      const last = this.runtime.autoWouldLog.get(this.spec.keyPrefix) || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set(this.spec.keyPrefix, now);
        this.log.log('auto play (dry run)', `would unlock ${this.spec.what} (${this.spec.levelText.replace(/ \(.*\)$/, '')}, 1 sugar lump)`);
      }

      return null;
    }

    const step = this.view.nextStep({
      goal: 'level',
      priority: JOB_PRIORITY.AUTO_SHOP,
      keyPrefix: this.spec.keyPrefix,
      abortIf: () => !this.wanted(),
      allowLevelUp: true,
      onFail: (why) => this.block(10000, why),
      onLevelResult: (leveled, level) => {
        if (leveled) {
          this.runtime.lastAutoBuyAt = Date.now();
          this.log.log(this.spec.logAction, this.spec.levelText, { level, lumps: this.game.getLumps() });
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
    this.runtime[this.spec.blockField] = Date.now() + ms;
    this.log.log(this.spec.logAction, `paused: ${why}`);
    sayCant(`Wanted to unlock ${this.spec.what}, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}
