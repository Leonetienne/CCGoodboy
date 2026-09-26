import { sayCant, sayYay } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { DragonClickAction } from '../actions/krumblor';
import { getSantaEvolveButton, getSpecialPopupClose, specialTabPoint } from '../game/dragon-dom';
import type { IGameAdapter } from '../game/game-adapter';
import { elementCenter } from '../game/grimoire-dom';
import { getWrinklerCanvas } from '../game/wrinkler-dom';
import type { LogStore } from '../stats/log';
import { autoUnbuffedCps } from './building-valuation';
import { FESTIVE_HAT, SANTA_DROPS } from './christmas';
import { nextSantaStep, SANTA_FINAL_LEVEL, type SantaState, type SantaStep } from './santa-strategy';

/** A step whose element doesn't show up for this long pauses the module. */
const STUCK_MS = 5000;

/** Auto play: evolves Santa up to "Final Claus" (XMAS-*): opens Santa's popup through his tab
 * on the left canvas, clicks "Evolve" once per level, and closes the popup again. One step per
 * scheduler tick, re-derived from the live game each time (nextSantaStep), so a preempted step
 * is simply picked up again. The gifts each evolution unlocks are bought by the normal
 * shopping (christmas.ts). */
export class SantaTrainer {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly shoppingInterrupted: () => boolean,
  ) {}

  /** Allowed right now: auto play on, not paused after a failure, the AUTO-7 safety gates
   * clear. */
  private allowed(): boolean {
    if (this.data.config.autoPlay !== true) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;
    if (Date.now() < this.runtime.santaBlockUntil || Date.now() < this.runtime.autoBlockUntil) return false;

    return !this.shoppingInterrupted();
  }

  /** The live game as nextSantaStep() sees it. */
  state(): SantaState {
    const cps = autoUnbuffedCps(this.game) || 0;
    const menuOpen = this.game.getSpecialTab() === 'santa';

    if (!menuOpen) this.runtime.santaMenuOurs = false;

    const spendable = this.game.getCookies() - Math.max(0, Number(this.data.config.autoReserveSec) || 0) * cps;

    return {
      hatBought: this.game.hasUpgrade(FESTIVE_HAT),
      santaLevel: this.game.getSantaLevel(),
      giftWaiting: this.game.getUpgradesInStore().some((u) => u && !u.bought && SANTA_DROPS.includes(u.name)),
      hasLegacy: this.game.hasUpgrade("Santa's legacy"),
      menuOpen,
      menuOurs: this.runtime.santaMenuOurs,
      cps,
      spendable,
      insignificant: Math.max(0, Number(this.data.config.autoInsignificantShare) || 0) * Math.max(0, spendable),
    };
  }

  /** The next step while allowed, else null. */
  step(): SantaStep | null {
    return this.allowed() ? nextSantaStep(this.state()) : null;
  }

  /** Something for the paw to do (the scheduler, PendingWork and hammering use it). A dry
   * run only logs, so it never counts as pending. */
  pending(): boolean {
    const s = this.step();
    return !!s && s.kind !== 'wait' && s.kind !== 'done' && this.data.config.autoDryRun !== true;
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    const s = this.step();
    if (!s || s.kind === 'wait' || s.kind === 'done') return null;

    if (this.data.config.autoDryRun === true) {
      const now = Date.now();
      const last = this.runtime.autoWouldLog.get('santa') || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set('santa', now);
        this.log.log('auto play (dry run)', `would do Santa step "${s.kind}"`, { level: this.game.getSantaLevel() });
      }

      return null;
    }

    const req = this.jobFor(s);

    if (req) {
      this.runtime.santaStuckSince = 0;
    } else if (!this.runtime.santaStuckSince) {
      this.runtime.santaStuckSince = Date.now();
    } else if (Date.now() - this.runtime.santaStuckSince > STUCK_MS) {
      this.runtime.santaStuckSince = 0;
      this.block(10000, `I can't find what to click for "${s.kind}"`);
    }

    return req;
  }

  private jobFor(s: SantaStep): JobRequest | null {
    const stillWanted = () => {
      const now = this.step();
      return !!now && now.kind === s.kind;
    };
    const click = (label: string, target: string, el: () => Element | null, worked: () => boolean, onOk: () => void, failWhy: string, point?: () => { x: number; y: number } | null): JobRequest | null => {
      const pt = point || (() => elementCenter(el()));
      if (!pt()) return null;

      return {
        action: new DragonClickAction({
          label,
          target,
          point: pt,
          el,
          stillWanted,
          worked,
          onResult: (ok) => (ok ? onOk() : this.block(3000, failWhy)),
          mood: 'santa',
        }),
        priority: JOB_PRIORITY.AUTO_SHOP,
        key: `santa:${s.kind}`,
      };
    };

    switch (s.kind) {
      case 'open-menu': {
        const tabs = this.game.getSpecialTabs();

        return click(
          'open Santa',
          "Santa's tab",
          getWrinklerCanvas,
          () => this.game.getSpecialTab() === 'santa',
          () => {
            this.runtime.santaMenuOurs = true;
          },
          "Santa's tab did not open",
          () => specialTabPoint(tabs, 'santa'),
        );
      }

      case 'evolve': {
        const before = s.level;

        return click(
          'evolve Santa',
          `Santa level ${before + 1}`,
          getSantaEvolveButton,
          () => this.game.getSantaLevel() > before,
          () => {
            const level = this.game.getSantaLevel();
            this.log.log('santa', `evolved Santa to level ${level}`, { cost: Math.round(s.cost) });
            if (level >= SANTA_FINAL_LEVEL) sayYay('Santa is Final Claus now, ho ho ho ^w^');
          },
          'evolving Santa did not work',
        );
      }

      case 'close-menu':
        return click(
          'close Santa',
          "Santa's x",
          getSpecialPopupClose,
          () => this.game.getSpecialTab() !== 'santa',
          () => {
            this.runtime.santaMenuOurs = false;
          },
          "Santa's popup did not close",
        );
    }

    return null;
  }

  private block(ms: number, why: string): void {
    this.runtime.santaBlockUntil = Date.now() + ms;
    this.log.log('santa', `paused: ${why}`);
    sayCant(`Wanted to evolve Santa, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}
