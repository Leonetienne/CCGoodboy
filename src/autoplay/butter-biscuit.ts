import { sayCant, sayYay } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { DragonStoreAction } from '../actions/krumblor';
import { storeScrollJob } from '../actions/store-visit';
import type { IGameAdapter } from '../game/game-adapter';
import { storeApproachPoint } from '../game/store-dom';
import type { GameBuilding } from '../game/types';
import type { LogStore } from '../stats/log';
import { autoUnbuffedCps } from './building-valuation';
import { BUTTER_BISCUITS, BUTTER_MAX_BANK_SHARE, nextButterStep, type ButterState, type ButterStep } from './butter-biscuit-strategy';
import { DRAGON_SACRIFICE_BUILDINGS, DRAGON_SACRIFICE_FIRST } from './krumblor-strategy';

const TOWER = 'Wizard tower';
/** A top-up that didn't unlock its biscuit pauses the module this long (each costs ~75%). */
const UNLOCK_FAIL_BLOCK_MS = 10 * 60 * 1000;
/** Krumblor's dragon level whose training sacrifices 100 Wizard towers. */
const KRUMBLOR_TOWER_LEVEL = DRAGON_SACRIFICE_FIRST + DRAGON_SACRIFICE_BUILDINGS.indexOf(TOWER);

/** Auto play: unlocks the butter biscuits (BUTTER-*) by buying Wizard towers past their target
 * up to the next "N of everything" milestone for a moment, then selling them back. Both are
 * store actions through the game's API with the paw visiting the Wizard tower row and pulsing
 * (NFR-8 b, like KRUMB-2). One step per scheduler tick, re-derived from the live game. */
export class ButterBiscuitHunter {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly shoppingInterrupted: () => boolean,
  ) {}

  /** Allowed right now: auto play on, not paused after a failure, the AUTO-7 safety gates
   * clear, the store in buy mode (buy() sells in sell mode). */
  private allowed(): boolean {
    if (this.data.config.autoPlay !== true) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;
    if (Date.now() < this.runtime.butterBlockUntil || Date.now() < this.runtime.autoBlockUntil) return false;

    return !this.shoppingInterrupted();
  }

  private towers(): GameBuilding | null {
    return this.game.getBuildingByName(TOWER);
  }

  /** The live game as nextButterStep() sees it, or null without Wizard towers in the game. */
  state(): ButterState | null {
    const b = this.towers();
    if (!b) return null;

    const towers = Number(b.amount) || 0;
    let minOther = Infinity;
    for (const o of this.game.getBuildings()) {
      if (o && o.name !== TOWER) minOther = Math.min(minOther, Number(o.amount) || 0);
    }

    const unlocked = new Set(BUTTER_BISCUITS.filter((bb) => this.unlocked(bb.level)).map((bb) => bb.level));

    const t = this.runtime.butterTopUp;
    if (t && towers <= t.sellTo) this.runtime.butterTopUp = null;

    const cps = autoUnbuffedCps(this.game) || 0;
    const krumblorOn = this.data.config.autoKrumblor !== false && this.game.hasUpgrade('A crumbly egg');

    return {
      towers,
      cap: Math.max(0, Math.floor(Number(this.data.config.autoWizardTowerTarget) || 0)),
      minOther,
      unlocked,
      buyCost: (n) => (b.getSumPrice ? Number(b.getSumPrice(n)) : Infinity),
      spendable: this.game.getCookies() - Math.max(0, Number(this.data.config.autoReserveSec) || 0) * cps,
      maxCost: BUTTER_MAX_BANK_SHARE * this.game.getCookies(),
      krumblorBusy: krumblorOn && (this.game.getDragonLevel() === KRUMBLOR_TOWER_LEVEL || (this.runtime.krumblorRebuy > 0 && this.runtime.krumblorRebuyId === b.id)),
      topUp: this.runtime.butterTopUp,
      now: Date.now(),
    };
  }

  /** The next step while allowed, else null. */
  step(): ButterStep | null {
    if (!this.allowed()) return null;
    const s = this.state();
    return s ? nextButterStep(s) : null;
  }

  /** Something for the paw to do. A dry run only logs, so it never counts as pending. */
  pending(): boolean {
    const s = this.step();
    return !!s && (s.kind === 'buy-towers' || s.kind === 'sell-towers') && this.data.config.autoDryRun !== true;
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    const s = this.step();
    if (!s || (s.kind !== 'buy-towers' && s.kind !== 'sell-towers')) return null;

    if (this.data.config.autoDryRun === true) {
      const now = Date.now();
      const last = this.runtime.autoWouldLog.get('butter') || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set('butter', now);
        this.log.log('auto play (dry run)', `would ${s.kind === 'buy-towers' ? 'buy' : 'sell'} ${s.n} Wizard towers for the ${s.level} butter biscuit`);
      }

      return null;
    }

    const b = this.towers();
    if (!b) return null;

    const key = `butter:${s.kind}`;
    const stillWanted = () => {
      const now = this.step();
      return !!now && now.kind === s.kind;
    };
    const el = () => document.getElementById(`product${b.id}`);
    const buying = s.kind === 'buy-towers';

    const scroll = storeScrollJob(this.runtime, el, {
      key,
      priority: JOB_PRIORITY.AUTO_SHOP,
      hud: { action: 'butter-biscuit', target: 'scrolling the store to the wizard towers' },
      abortIf: () => !stillWanted(),
    });
    if (scroll) return scroll;

    return {
      action: new DragonStoreAction({
        label: `${buying ? 'buy' : 'sell'} ${s.n} wizard towers`,
        target: `${buying ? 'buying' : 'selling'} ${s.n} wizard towers for a butter biscuit`,
        point: storeApproachPoint(el()),
        stillWanted,
        run: () => this.trade(b, s),
        mood: 'butter-biscuit',
      }),
      priority: JOB_PRIORITY.AUTO_SHOP,
      key,
    };
  }

  private trade(b: GameBuilding, s: Extract<ButterStep, { kind: 'buy-towers' | 'sell-towers' }>): void {
    const before = Number(b.amount) || 0;

    if (s.kind === 'buy-towers') {
      if (this.game.getBuyMode() === -1) {
        this.block(3000, 'the store is in sell mode');
        return;
      }

      b.buy(s.n);
      const after = Number(b.amount) || 0;

      const cap = Math.max(0, Math.floor(Number(this.data.config.autoWizardTowerTarget) || 0));

      if (after < s.level) {
        // didn't get all of them: sell back what it got right away (at 0: no unlock to wait for)
        if (after > before) this.runtime.butterTopUp = { level: s.level, sellTo: Math.max(before, cap), at: 0 };
        this.block(3000, `the shop only gave me ${after - before} of ${s.n} Wizard towers`);
        return;
      }

      this.runtime.butterTopUp = { level: s.level, sellTo: Math.max(before, cap), at: Date.now() };
      this.runtime.lastAutoBuyAt = Date.now();
      this.log.log('butter biscuit', `bought ${after - before} Wizard towers up to ${after} for the ${s.level} butter biscuit`, { cost: Math.round(s.cost), amount: after });
      return;
    }

    if (b.sell) b.sell(s.n, 1);
    const after = Number(b.amount) || 0;

    if (after >= before) {
      this.block(3000, 'the shop would not take the Wizard towers back');
      return;
    }

    this.runtime.lastAutoBuyAt = Date.now();
    const got = this.unlocked(s.level);
    this.log.log('butter biscuit', `sold ${before - after} Wizard towers back down to ${after}${got ? '' : ' (the biscuit did not unlock)'}`, { level: s.level, amount: after });
    if (after <= (this.runtime.butterTopUp?.sellTo ?? after)) this.runtime.butterTopUp = null;

    if (got) {
      sayYay(`Unlocked the ${biscuitName(s.level)}, +10% CpS ^w^`);
    } else {
      // never loop buying and selling at a loss: try again much later
      this.block(UNLOCK_FAIL_BLOCK_MS, `the ${biscuitName(s.level)} did not unlock`);
    }
  }

  private unlocked(level: number): boolean {
    const up = this.game.getUpgradeByName(biscuitName(level));
    return !!(up && (up.unlocked || up.bought));
  }

  private block(ms: number, why: string): void {
    this.runtime.butterBlockUntil = Date.now() + ms;
    this.log.log('butter biscuit', `paused: ${why}`);
    sayCant(`Wanted to unlock a butter biscuit, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}

function biscuitName(level: number): string {
  return BUTTER_BISCUITS.find((b) => b.level === level)?.name || `${level} butter biscuit`;
}
