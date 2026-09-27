import { sayCant, sayYay } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { DragonClickAction, DragonStoreAction } from '../actions/krumblor';
import { storeScrollJob } from '../actions/store-visit';
import { visibleRect } from '../game/dom-geometry';
import { storeApproachPoint } from '../game/store-dom';
import {
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
import {
  auraName,
  DRAGON_SACRIFICE_BUILDINGS,
  dragonBatchNeeds,
  KRUMBLOR_STAGE_LEVEL,
  krumblorStageFor,
  nextKrumblorStep,
  type KrumblorBuilding,
  type KrumblorStage,
  type KrumblorState,
  type KrumblorStep,
} from './krumblor-strategy';
import { autoBuy } from './shopping';

const EGG = 'A crumbly egg';
/** What the console says once an aura is on (CON-1). */
const AURA_YAY: Record<number, string> = {
  2: 'Krumblor wears Dragon Cursor now, clicky paws ^w^',
  10: 'Krumblor wears Dragonflight now, zoomy clicky ^w^',
  15: 'Krumblor wears Radiant Appetite now, double cookies nom nom ^w^',
};
/** How long the aura picker the paw opened counts as the paw's own. */
const PICKER_OURS_MS = 30000;
/** A step whose element doesn't show up for this long pauses the module. */
const STUCK_MS = 5000;

/** Auto play: trains Krumblor, the cookie dragon, in three stages (KRUMB-*): 1 Dragon Cursor
 * as soon as there is a dragon, 2 Dragonflight once the run owns 150 shipments, 3 fully
 * trained with Radiant Appetite + Dragonflight once it owns 220 "You". It buys "A crumbly
 * egg", opens the dragon's popup through its tab on the left canvas, pays the egg levels in
 * cookies, and for every sacrifice sells the copies above what it takes, trains, and buys them
 * back; the auras go on through the aura picker, and the popup is closed again. One step per
 * scheduler tick, re-derived from the live game each time (nextKrumblorStep), so a preempted
 * step is simply picked up again. */
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

  /** The building with Game.ObjectsById id `id` (DRAGON_SACRIFICE_BUILDINGS). */
  private building(id: number): GameBuilding | null {
    const name = DRAGON_SACRIFICE_BUILDINGS[id];
    return name ? this.game.getBuildingByName(name) : null;
  }

  private owned(name: string): number {
    const b = this.game.getBuildingByName(name);
    return b ? Number(b.amount) || 0 : 0;
  }

  /** How far this run trains the dragon (KRUMB-1): the highest stage its buildings have
   * unlocked, kept per run in `stats.krumblorRun` (keyed by the run's start date, so it
   * survives a reload and starts over with the next ascension), since the sacrifices drop the
   * counts again. A new stage is logged once. */
  stage(): KrumblorStage {
    const start = this.game.getRunStartDate();
    const kept = this.data.stats.krumblorRun;
    const was = kept && kept.start === start ? kept.stage : 1;
    const now = Math.max(was, krumblorStageFor(this.owned('Shipment'), this.owned('You'))) as KrumblorStage;

    if (!kept || kept.start !== start || now !== kept.stage) {
      this.data.stats.krumblorRun = { start, stage: now };
      this.data.scheduleSave();
      if (now > was) this.log.log('krumblor', `stage ${now}: training Krumblor to level ${KRUMBLOR_STAGE_LEVEL[now]}`);
    }

    return now;
  }

  /** Krumblor still needs building `id` for its training (a sacrifice ahead at the current
   * level, or copies to buy back): the butter biscuit top-up leaves it alone (BUTTER-3). */
  holds(id: number): boolean {
    if (this.data.config.autoPlay !== true || this.data.config.autoKrumblor === false) return false;
    if (this.runtime.krumblorRebuy.some((r) => r.id === id && r.n > 0)) return true;

    const end = this.batchEnd();
    return end !== null && dragonBatchNeeds(this.game.getDragonLevel(), end).has(id);
  }

  /** The end of the batch of sacrifices under way, or null (over once the dragon got there). */
  private batchEnd(): number | null {
    const end = this.runtime.krumblorBatchEnd;
    if (end !== null && this.game.getDragonLevel() >= end) this.runtime.krumblorBatchEnd = null;

    return this.runtime.krumblorBatchEnd;
  }

  /** The live game as nextKrumblorStep() sees it. */
  state(): KrumblorState {
    const egg = this.game.getUpgradeByName(EGG);
    const dragonLevel = this.game.getDragonLevel();
    const cps = autoUnbuffedCps(this.game) || 0;
    const menuOpen = this.game.getSpecialTab() === 'dragon';

    if (!menuOpen) this.runtime.krumblorMenuOurs = false;

    const spendable = this.game.getCookies() - Math.max(0, Number(this.data.config.autoReserveSec) || 0) * cps;
    const buildings: KrumblorBuilding[] = [];

    DRAGON_SACRIFICE_BUILDINGS.forEach((_n, id) => {
      const b = this.building(id);
      if (!b) return;

      buildings.push({ id, owned: Number(b.amount) || 0, costOf: (n) => (n <= 0 ? 0 : b.getSumPrice ? Number(b.getSumPrice(n)) : Infinity) });
    });

    return {
      eggBought: !!(egg && egg.bought),
      eggInStore: !!egg && this.game.getUpgradesInStore().includes(egg),
      eggCost: egg ? upgradeCost(egg) : Infinity,
      dragonLevel,
      auras: this.game.getDragonAuras(),
      stage: this.stage(),
      batchEnd: this.batchEnd(),
      selectingAura: this.game.getSelectingDragonAura(),
      menuOpen,
      menuOurs: this.runtime.krumblorMenuOurs,
      pickerOurs: this.pickerOurs(),
      buildings,
      rebuy: this.runtime.krumblorRebuy,
      spendable,
      funds: { stocks: Math.max(0, this.stockFunds() || 0), wrinklers: Math.max(0, this.wrinklerFunds() || 0) },
    };
  }

  /** The next step while allowed, else null. */
  step(): KrumblorStep | null {
    const s = this.allowed() ? nextKrumblorStep(this.state()) : null;
    this.raiseFunds(s && s.kind === 'raise-funds' && this.data.config.autoDryRun !== true ? s : null);

    return s;
  }

  /** Loss-free cookies for a batch (KRUMB-2), set in main.ts: the stock market's wins
   * (STOCK-9's cash-out value) and the mature wrinklers' stash (WRINK-2). */
  stockFunds: () => number = () => 0;
  wrinklerFunds: () => number = () => 0;
  /** Starts the stock market's cash-out (STOCK-9), set in main.ts. */
  cashStocks: (why: string) => void = () => {};
  private raising = false;

  /** A batch waits for money the stocks and wrinklers can give: the trader cashes its wins
   * in, and the wrinkler popper pops what is still missing (`runtime.krumblorWrinklerNeed`);
   * both do it at their own tier with their own clicks. Anything else ends the request. */
  private raiseFunds(s: Extract<KrumblorStep, { kind: 'raise-funds' }> | null): void {
    if (s && !this.raising) {
      this.log.log('krumblor', `raising cookies for dragon levels ${this.game.getDragonLevel() + 1}-${s.end}`, {
        cost: Math.round(s.cost),
        stocks: Math.round(s.stocks),
        wrinklers: Math.round(s.wrinklers),
      });
    }

    this.raising = !!s;
    this.runtime.krumblorWrinklerNeed = s ? s.wrinklers : 0;
    if (s && s.stocks > 0) this.cashStocks(`Krumblor (dragon levels up to ${s.end})`);
  }

  /** Something for the paw to do (the scheduler, PendingWork and hammering use it). A dry
   * run only logs, so it never counts as pending. */
  pending(): boolean {
    const s = this.step();
    return !!s && s.kind !== 'wait' && s.kind !== 'done' && s.kind !== 'raise-funds' && this.data.config.autoDryRun !== true;
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    const s = this.step();
    if (!s || s.kind === 'wait' || s.kind === 'done' || s.kind === 'raise-funds') return null;

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

    // a store item scrolled out of the store column: scroll it into view first (AUTO-9)
    const scrollTo = (el: () => Element | null, what: string) =>
      storeScrollJob(this.runtime, el, { key: `krumblor:${s.kind}`, priority: JOB_PRIORITY.AUTO_SHOP, hud: { action: 'krumblor', target: `scrolling the store to ${what}` }, abortIf: () => !stillWanted() });

    switch (s.kind) {
      case 'buy-egg': {
        const egg = this.game.getUpgradeByName(EGG);
        if (!egg) return null;

        const eggEl = () => document.getElementById(`upgrade${this.game.getUpgradesInStore().indexOf(egg)}`);
        const scroll = scrollTo(eggEl, 'the crumbly egg');
        if (scroll) return scroll;

        return req(
          new DragonStoreAction({
            label: 'buy crumbly egg',
            target: 'buying a crumbly egg',
            point: storePoint(`upgrade${this.game.getUpgradesInStore().indexOf(egg)}`),
            el: () => document.getElementById(`upgrade${this.game.getUpgradesInStore().indexOf(egg)}`),
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
          () => {
            if (s.end !== undefined) this.commitBatch(before, s.end);
            this.log.log('krumblor', `trained to level ${this.game.getDragonLevel()}`);
          },
          'training Krumblor did not work',
        );
      }

      case 'sell-buildings':
      case 'buy-buildings': {
        const b = this.building(s.id);
        if (!b) return null;

        const what = `${s.n} ${plural(b)}`;
        const selling = s.kind === 'sell-buildings';
        const scroll = scrollTo(() => document.getElementById(`product${s.id}`), `the ${plural(b)}`);
        if (scroll) return scroll;

        return req(
          new DragonStoreAction({
            label: `${selling ? 'sell' : 'buy'} ${what}`,
            target: `${selling ? 'selling' : 'buying'} ${what} for Krumblor`,
            point: storePoint(`product${s.id}`),
            stillWanted,
            run: () => this.tradeBuildings(b, s),
          }),
        );
      }

      case 'open-aura':
        return click(
          'open aura picker',
          s.slot === 1 ? "Krumblor's second aura" : "Krumblor's aura",
          () => getDragonAuraSlot(s.slot),
          () => !!getAuraPicker(),
          () => {
            this.runtime.krumblorPickerAt = Date.now();
          },
          'the aura picker did not open',
        );

      case 'pick-aura':
        return click(
          `pick ${auraName(s.aura)}`,
          `the ${auraName(s.aura)} aura`,
          () => getAuraPickerCrate(s.aura),
          () => this.game.getSelectingDragonAura() === s.aura,
          () => {},
          `${auraName(s.aura)} did not get selected`,
        );

      case 'confirm-aura':
        return click(
          'confirm aura',
          'Confirm',
          getAuraPickerConfirm,
          () => this.game.getDragonAuras()[s.slot] === s.aura,
          () => {
            this.runtime.krumblorPickerAt = 0;
            this.log.log('krumblor', `aura${s.slot === 1 ? ' 2' : ''}: ${auraName(s.aura)}`);
            sayYay(AURA_YAY[s.aura] || `Krumblor wears ${auraName(s.aura)} now ^w^`);
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

  /** Sells the copies above what the sacrifice takes (remembered for the rebuy), buys the
   * missing ones, or buys the sold ones back. The game's buy(n) stops at what the bank can
   * pay; what it couldn't pay for on a rebuy is left to the normal shopping. */
  private tradeBuildings(b: GameBuilding, s: Extract<KrumblorStep, { kind: 'sell-buildings' | 'buy-buildings' }>): void {
    const before = Number(b.amount) || 0;
    const selling = s.kind === 'sell-buildings';

    if (selling) {
      if (b.sell) b.sell(s.n, 1);
    } else if (this.game.getBuyMode() === -1) {
      // buy() sells while the store is in sell mode (AUTO-7)
      this.block(3000, 'the store is in sell mode');
      return;
    } else {
      b.buy(s.n);
    }

    const moved = Math.abs((Number(b.amount) || 0) - before);
    const rebuy = this.runtime.krumblorRebuy;

    if (s.kind === 'sell-buildings') {
      this.commitBatch(this.game.getDragonLevel(), s.end);
      const r = rebuy.find((x) => x.id === s.id);
      if (r) r.n += moved;
      else if (moved > 0) rebuy.push({ id: s.id, n: moved });
    } else if (s.restore) {
      this.runtime.krumblorRebuy = rebuy.filter((x) => x.id !== s.id);
    }

    if (moved > 0) {
      this.runtime.lastAutoBuyAt = Date.now();
      this.log.log('krumblor', `${selling ? 'sold' : 'bought'} ${moved} ${plural(b)}${selling ? ' before the sacrifice' : s.kind === 'buy-buildings' && s.restore ? ' back' : ' for the sacrifice'}`, {
        building: b.name,
        amount: Number(b.amount) || 0,
      });
    } else {
      this.block(3000, `the shop would not ${selling ? 'take' : 'give me'} ${plural(b)}`);
    }
  }

  /** A batch of sacrifices starts (its first sale or training): from now on it runs to its
   * end before anything is bought back (KRUMB-2). */
  private commitBatch(from: number, end: number): void {
    if (this.runtime.krumblorBatchEnd !== null) return;

    this.runtime.krumblorBatchEnd = end;
    this.log.log('krumblor', `sacrificing for dragon levels ${from + 1}-${end}`, { from, end });
  }

  private block(ms: number, why: string): void {
    this.runtime.krumblorBlockUntil = Date.now() + ms;
    this.log.log('krumblor', `paused: ${why}`);
    sayCant(`Wanted to train Krumblor, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}

function plural(b: GameBuilding): string {
  return (b.plural || `${b.name}s`).toLowerCase();
}

function upgradeCost(up: GameUpgrade): number {
  try {
    const p = up.getPrice ? Number(up.getPrice()) : Number(up.basePrice);
    return Number.isFinite(p) ? p : Infinity;
  } catch (_e) {
    return Infinity;
  }
}

/** Where the paw heads for a store element (its collapsed section's strip when the element
 * is folded away), or null (then the paw pulses where it is). */
function storePoint(id: string): { x: number; y: number } | null {
  return storeApproachPoint(document.getElementById(id));
}
