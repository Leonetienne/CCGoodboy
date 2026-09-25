import { sayCant, sayYay } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { DragonClickAction, DragonStoreAction } from '../actions/krumblor';
import { visibleRect } from '../game/dom-geometry';
import {
  DRAGON_CURSOR_AURA,
  getAuraPicker,
  getAuraPickerConfirm,
  getAuraPickerCrate,
  getDragonAuraSlot,
  getDragonTrainButton,
  getSpecialPopupClose,
  specialTabPoint,
} from '../game/dragon-dom';
import type { IGameAdapter } from '../game/game-adapter';
import { elementCenter } from '../game/grimoire-dom';
import type { GameBuilding, GameUpgrade } from '../game/types';
import { getWrinklerCanvas } from '../game/wrinkler-dom';
import type { LogStore } from '../stats/log';
import { autoUnbuffedCps } from './building-valuation';
import { nextKrumblorStep, type KrumblorState, type KrumblorStep } from './krumblor-strategy';
import { autoBuy } from './shopping';

const EGG = 'A crumbly egg';
/** How long the aura picker the paw opened counts as the paw's own. */
const PICKER_OURS_MS = 30000;
/** A step whose element doesn't show up for this long pauses the module. */
const STUCK_MS = 5000;

/** Auto play: trains Krumblor, the cookie dragon, up to the Dragon Cursor aura (KRUMB-*):
 * buys "A crumbly egg", opens the dragon's popup through its tab on the left canvas, pays the
 * egg levels in cookies, sacrifices 100 cursors (selling the ones above 100 first and buying
 * them back after), then picks Dragon Cursor in the aura picker, confirms and closes the
 * popup. One step per scheduler tick, re-derived from the live game each time
 * (nextKrumblorStep), so a preempted step is simply picked up again. */
export class KrumblorTrainer {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly shoppingInterrupted: () => boolean,
  ) {}

  private pickerOurs(): boolean {
    return this.game.isPromptOpen() && !!getAuraPicker() && Date.now() - this.runtime.krumblorPickerAt < PICKER_OURS_MS;
  }

  /** Allowed right now: auto play and "Auto: train Krumblor" on, not paused after a failure,
   * the AUTO-7 safety gates clear (a prompt only counts when it isn't the paw's own aura
   * picker). */
  private allowed(): boolean {
    if (this.data.config.autoPlay !== true || this.data.config.autoKrumblor === false) return false;
    if (!this.game.isReady() || this.game.isAscending()) return false;
    if (this.game.isPromptOpen() && !this.pickerOurs()) return false;
    if (Date.now() < this.runtime.krumblorBlockUntil || Date.now() < this.runtime.autoBlockUntil) return false;

    return !this.shoppingInterrupted();
  }

  private cursorBuilding(): GameBuilding | null {
    return this.game.getBuildingByName('Cursor');
  }

  /** The live game as nextKrumblorStep() sees it. */
  state(): KrumblorState {
    const egg = this.game.getUpgradeByName(EGG);
    const cursor = this.cursorBuilding();
    const cursors = Number(cursor && cursor.amount) || 0;
    const cps = autoUnbuffedCps(this.game) || 0;
    const menuOpen = this.game.getSpecialTab() === 'dragon';

    if (!menuOpen) this.runtime.krumblorMenuOurs = false;

    return {
      eggBought: !!(egg && egg.bought),
      eggInStore: !!egg && this.game.getUpgradesInStore().includes(egg),
      eggCost: egg ? upgradeCost(egg) : Infinity,
      dragonLevel: this.game.getDragonLevel(),
      auras: this.game.getDragonAuras(),
      selectingAura: this.game.getSelectingDragonAura(),
      menuOpen,
      menuOurs: this.runtime.krumblorMenuOurs,
      pickerOurs: this.pickerOurs(),
      cursors,
      cursorBuyUpCost: cursor && cursors < 100 && cursor.getSumPrice ? Number(cursor.getSumPrice(100 - cursors)) : cursors >= 100 ? 0 : Infinity,
      rebuy: this.runtime.krumblorRebuy,
      spendable: this.game.getCookies() - Math.max(0, Number(this.data.config.autoReserveSec) || 0) * cps,
      insignificant: Math.max(0, Number(this.data.config.autoInsignificantSec) || 0) * cps,
    };
  }

  /** The next step while allowed, else null. */
  step(): KrumblorStep | null {
    return this.allowed() ? nextKrumblorStep(this.state()) : null;
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
      const last = this.runtime.autoWouldLog.get('krumblor') || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set('krumblor', now);
        this.log.log('auto play (dry run)', `would do Krumblor step "${s.kind}"`, { level: this.game.getDragonLevel() });
      }

      return null;
    }

    const req = this.jobFor(s);

    if (req) {
      this.runtime.krumblorStuckSince = 0;
    } else if (!this.runtime.krumblorStuckSince) {
      this.runtime.krumblorStuckSince = Date.now();
    } else if (Date.now() - this.runtime.krumblorStuckSince > STUCK_MS) {
      this.runtime.krumblorStuckSince = 0;
      this.block(10000, `I can't find what to click for "${s.kind}"`);
    }

    return req;
  }

  private jobFor(s: KrumblorStep): JobRequest | null {
    const stillWanted = () => {
      const now = this.step();
      return !!now && now.kind === s.kind;
    };
    const req = (action: DragonClickAction | DragonStoreAction): JobRequest => ({ action, priority: JOB_PRIORITY.AUTO_SHOP, key: `krumblor:${s.kind}` });
    const click = (label: string, target: string, el: () => Element | null, worked: () => boolean, onOk: () => void, failWhy: string, point?: () => { x: number; y: number } | null) => {
      const pt = point || (() => elementCenter(el()));
      if (!pt()) return null;

      return req(
        new DragonClickAction({
          label,
          target,
          point: pt,
          el,
          stillWanted,
          worked,
          onResult: (ok) => (ok ? onOk() : this.block(3000, failWhy)),
        }),
      );
    };

    switch (s.kind) {
      case 'buy-egg': {
        const egg = this.game.getUpgradeByName(EGG);
        if (!egg) return null;

        return req(
          new DragonStoreAction({
            label: 'buy crumbly egg',
            target: 'buying a crumbly egg',
            point: storePoint(`upgrade${this.game.getUpgradesInStore().indexOf(egg)}`),
            stillWanted,
            run: () => {
              if (autoBuy(this.game, { kind: 'upgrade', type: 'krumblor', name: EGG, obj: egg, cost: s.cost, dCps: 0 })) {
                this.runtime.lastAutoBuyAt = Date.now();
                this.log.log('krumblor', 'bought A crumbly egg', { cost: Math.round(s.cost) });
              } else {
                this.block(3000, 'the shop would not sell me the crumbly egg');
              }
            },
          }),
        );
      }

      case 'open-menu': {
        const tabs = this.game.getSpecialTabs();

        return click(
          'open Krumblor',
          "Krumblor's tab",
          getWrinklerCanvas,
          () => this.game.getSpecialTab() === 'dragon',
          () => {
            this.runtime.krumblorMenuOurs = true;
          },
          "Krumblor's tab did not open",
          () => specialTabPoint(tabs, 'dragon'),
        );
      }

      case 'train': {
        const before = s.level;

        return click(
          'train Krumblor',
          `Krumblor level ${before + 1}`,
          getDragonTrainButton,
          () => this.game.getDragonLevel() > before,
          () => this.log.log('krumblor', `trained to level ${this.game.getDragonLevel()}`, { cursors: Number(this.cursorBuilding()?.amount) || 0 }),
          'training Krumblor did not work',
        );
      }

      case 'sell-cursors':
      case 'buy-cursors': {
        const cursor = this.cursorBuilding();
        if (!cursor) return null;

        const selling = s.kind === 'sell-cursors';

        return req(
          new DragonStoreAction({
            label: `${selling ? 'sell' : 'buy'} ${s.n} cursors`,
            target: `${selling ? 'selling' : 'buying'} ${s.n} cursors for Krumblor`,
            point: storePoint('product0'),
            stillWanted,
            run: () => this.tradeCursors(cursor, s),
          }),
        );
      }

      case 'open-aura':
        return click(
          'open aura picker',
          "Krumblor's aura",
          () => getDragonAuraSlot(0),
          () => !!getAuraPicker(),
          () => {
            this.runtime.krumblorPickerAt = Date.now();
          },
          'the aura picker did not open',
        );

      case 'pick-aura':
        return click(
          'pick Dragon Cursor',
          'the Dragon Cursor aura',
          () => getAuraPickerCrate(DRAGON_CURSOR_AURA),
          () => this.game.getSelectingDragonAura() === DRAGON_CURSOR_AURA,
          () => {},
          'Dragon Cursor did not get selected',
        );

      case 'confirm-aura':
        return click(
          'confirm aura',
          'Confirm',
          getAuraPickerConfirm,
          () => this.game.getDragonAuras()[0] === DRAGON_CURSOR_AURA,
          () => {
            this.runtime.krumblorPickerAt = 0;
            this.log.log('krumblor', 'aura: Dragon Cursor');
            sayYay('Krumblor wears Dragon Cursor now, clicky clicky ^w^');
          },
          'the aura did not change',
        );

      case 'close-menu':
        return click(
          'close Krumblor',
          "Krumblor's x",
          getSpecialPopupClose,
          () => this.game.getSpecialTab() !== 'dragon',
          () => {
            this.runtime.krumblorMenuOurs = false;
          },
          "Krumblor's popup did not close",
        );
    }

    return null;
  }

  /** Sells the cursors above 100 (remembering them for the rebuy), buys the missing ones up
   * to 100, or buys the sold ones back. The game's buy(n) stops at what the bank can pay. */
  private tradeCursors(cursor: GameBuilding, s: { kind: 'sell-cursors' | 'buy-cursors'; n: number; restore?: boolean }): void {
    const before = Number(cursor.amount) || 0;

    if (s.kind === 'sell-cursors') {
      if (cursor.sell) cursor.sell(s.n, 1);
    } else if (this.game.getBuyMode() === -1) {
      // buy() sells while the store is in sell mode (AUTO-7)
      this.block(3000, 'the store is in sell mode');
      return;
    } else {
      cursor.buy(s.n);
    }

    const moved = Math.abs((Number(cursor.amount) || 0) - before);

    if (s.kind === 'sell-cursors') {
      this.runtime.krumblorRebuy += moved;
    } else if (s.restore) {
      // Whatever the bank couldn't pay for now is left to the normal shopping.
      this.runtime.krumblorRebuy = 0;
    }

    if (moved > 0) {
      this.runtime.lastAutoBuyAt = Date.now();
      this.log.log('krumblor', `${s.kind === 'sell-cursors' ? 'sold' : 'bought'} ${moved} cursors${s.kind === 'sell-cursors' ? ' before the sacrifice' : s.restore ? ' back' : ' for the sacrifice'}`, {
        cursors: Number(cursor.amount) || 0,
      });
    } else {
      this.block(3000, `the shop would not ${s.kind === 'sell-cursors' ? 'take' : 'give me'} cursors`);
    }
  }

  private block(ms: number, why: string): void {
    this.runtime.krumblorBlockUntil = Date.now() + ms;
    this.log.log('krumblor', `paused: ${why}`);
    sayCant(`Wanted to train Krumblor, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}

function upgradeCost(up: GameUpgrade): number {
  try {
    const p = up.getPrice ? Number(up.getPrice()) : Number(up.basePrice);
    return Number.isFinite(p) ? p : Infinity;
  } catch (_e) {
    return Infinity;
  }
}

/** Centre of a visible store element, or null (then the paw pulses where it is). */
function storePoint(id: string): { x: number; y: number } | null {
  const r = visibleRect(document.getElementById(id));
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}
