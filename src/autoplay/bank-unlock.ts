import { sayCant, sayCantWhile } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { lumpSpendingEnabled } from '../hunting/fthof';
import type { MinigameView } from '../hunting/minigame-view';
import { stockMarketEnabled } from '../market/stock-trader';
import type { LogStore } from '../stats/log';

/** Auto play: unlocks the stock market (AUTO-16) by spending one sugar lump on Bank level 1
 * as soon as a Bank and a sugar lump are available, like the Grimoire unlock (AUTO-13), but
 * only while "Play the stock market" is on (STOCK-1): an unplayed market isn't worth a lump.
 * The way there (Options/Stats/Stats, scrolling, the "lvl" click) is planned one step per
 * tick by the Bank's MinigameView with goal 'level'. */
export class BankUnlocker {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly view: MinigameView,
    private readonly shoppingInterrupted: () => boolean,
  ) {}

  /** Auto play wants the stock market unlocked right now: mode and "Play the stock market"
   * on, "Spend sugar lumps" on (FT-9), AUTO-7 safety gates clear, >= 1 Bank still at level
   * 0, sugar lumps unlocked and >= 1 in stock. */
  wanted(): boolean {
    if (this.data.config.autoPlay !== true || !stockMarketEnabled(this.data.config)) return false;
    if (!lumpSpendingEnabled(this.data.config)) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;
    if (Date.now() < this.runtime.bankUnlockBlockUntil) return false;
    if (this.shoppingInterrupted()) return false;

    const bank = this.view.building();
    if (!bank || !((Number(bank.amount) || 0) >= 1) || this.view.level() !== 0) return false;

    const noLumps = !this.game.lumpsUnlocked() ? 'lumps-locked' : this.game.getLumps() < 1 ? 'no-lumps' : null;

    sayCantWhile(
      'bank unlock',
      noLumps,
      noLumps === 'lumps-locked'
        ? 'Wanted to unlock the stock market, but sugar lumps aren\'t unlocked yet :c'
        : 'Wanted to unlock the stock market, but I have no sugar popsies :c',
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
      const last = this.runtime.autoWouldLog.get('bank unlock') || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set('bank unlock', now);
        this.log.log('auto play (dry run)', 'would unlock the stock market (Bank level 1, 1 sugar lump)');
      }

      return null;
    }

    const step = this.view.nextStep({
      goal: 'level',
      priority: JOB_PRIORITY.AUTO_SHOP,
      keyPrefix: 'bank-unlock',
      abortIf: () => !this.wanted(),
      allowLevelUp: true,
      onFail: (why) => this.block(10000, why),
      onLevelResult: (leveled, level) => {
        if (leveled) {
          this.runtime.lastAutoBuyAt = Date.now();
          this.log.log('auto bank unlock', 'Bank level 1 (stock market)', { level, lumps: this.game.getLumps() });
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
    this.runtime.bankUnlockBlockUntil = Date.now() + ms;
    this.log.log('auto bank unlock', `paused: ${why}`);
    sayCant(`Wanted to unlock the stock market, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}
