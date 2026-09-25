import { AchievementDumpAction } from '../actions/achievement-dump';
import { storeScrollJob } from '../actions/store-visit';
import { DragTreeAction, WaitWhileAction } from '../actions/ascension';
import { DragonClickAction } from '../actions/krumblor';
import { WrinklerPopAction } from '../actions/wrinkler-pop';
import { sayCant, sayYay } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import {
  crateClickable,
  getAscendCancelButton,
  getAscendConfirmButton,
  getHeavenlyCrate,
  getLegacyButton,
  getReincarnateButton,
  getReincarnateConfirmButton,
  openPromptId,
  panToCrate,
} from '../game/ascension-dom';
import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import { elementCenter } from '../game/grimoire-dom';
import { wrinklerPokeCanvasPoint } from '../game/wrinkler-dom';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import { formatNum } from '../ui/format';
import { dumpCopies, planAchievementDump, type DumpBuilding, type DumpStep } from './achievement-dump';
import type { AscensionPlanner } from './ascension';
import { ASC_FINAL_SEC, cookiesForLevel, levelForCookies, luckyMinDigit, luckyWindowLevels } from './ascension-strategy';
import { luckyWindowEnd, nextLuckyTarget } from './heavenly-shopping';
import { autoFmtTime } from './shopping';
import { nextAscensionStep, type AscendCrate, type AscendState, type AscendStep } from './ascension-steps';

/** A step whose element doesn't show up for this long pauses the module. */
const STUCK_MS = 5000;
/** On the ascension screen longer than this: the rest of the list is skipped, so a crate that
 * can't be bought never keeps the bot in heaven. */
const MAX_HEAVEN_MS = 3 * 60 * 1000;
/** A crate whose purchase failed this often is skipped. */
const MAX_BUY_FAILS = 3;
/** Drags towards a crate before it counts as reachable wherever it ended up. */
const MAX_PANS = 4;
/** The scheduler holds still this long after reincarnating (like LIFE-1 at start-up). */
export const ASCEND_SETTLE_MS = 3000;
/** ASC-12: the routine's time estimate per wrinkler pop, per stock sale (market view steps +
 * click), per building visited and per copy bought (the streak buys ~10 per second)... */
export const LEAD_PER_POP_SEC = 5;
export const LEAD_PER_SALE_SEC = 6;
export const LEAD_PER_VISIT_SEC = 2;
export const LEAD_PER_COPY_SEC = 0.1;
/** ...stretched by this factor, plus a fixed safety buffer on top. */
export const LEAD_FACTOR = 1.5;
export const LEAD_SAFETY_SEC = 60;
/** The routine starts once the target is at most the lead time + this far off (the plan is
 * refreshed twice a second; this keeps one tick of a hold-up from skipping a target). */
export const LOCK_SLACK_SEC = 30;
/** A committed routine gives up when the level is further off than this at the unbuffed CpS
 * (it keeps holding as long as the level is honestly on its way). */
export const MAX_HOLD_SEC = 3600;
/** ASC-12: a lucky window that lasts less than this at the current CpS (the routine's
 * purchases raise it) is not waited for: the target moves on to the next one. */
export const MIN_WINDOW_SEC = 20;
/** ASC-13: selling and spending before an ascension gives up after this long, so a stuck
 * market or store never holds the ascension back for good. */
const MAX_DUMP_MS = 90 * 1000;

/** What the ascension needs from the stock trader (ASC-13). */
export interface AscensionMarket {
  dumpableGoods(): number[];
  sellAllJob(goodId: number, stillWanted: () => boolean): JobRequest | null;
}

/** ASC-13: "Auto: spend the bank on achievements before ascending" (on by default). */
export function dumpEnabled(config: PersistedData['config']): boolean {
  return config.ascendDumpBank !== false;
}

/** Auto play: ascends when the planner says so (ASC-10/12). Once the target level is near
 * (its ETA down to the routine's lead time) it locks that level and commits: from then on it
 * outranks everything, golden cookies included. It pops every wrinkler (their cookies count
 * for prestige, and ascending would throw them away), sells the stocks, spends the bank on
 * achievements, holds still at Legacy until the level is there, clicks Legacy and "Ascend",
 * buys the heavenly shopping list crate by crate, clicks Reincarnate and "Yes", then resets
 * the bot's per-run state. One step per scheduler tick, re-derived from the live game
 * (nextAscensionStep), every step a real click or a visible drag (NFR-8). */
export class AscensionRunner {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly stats: StatsRecorder,
    private readonly planner: AscensionPlanner,
    private readonly shoppingInterrupted: () => boolean,
    private readonly market: AscensionMarket | null = null,
  ) {}

  private enabled(): boolean {
    return this.data.config.autoPlay === true && this.data.config.autoAscend !== false;
  }

  /** ASC-10's safety gates for starting the routine: nothing more important is going on right
   * now, and no buff inflates the income the timing is based on. */
  private gatesClear(): boolean {
    if (!this.enabled() || !this.runtime.running || !this.game.isReady() || this.game.isAscending()) return false;
    // Its own pause only: shopping's (autoBlockUntil) says nothing about ascending.
    if (Date.now() < this.runtime.ascendBlockUntil) return false;
    if (this.game.isPromptOpen()) return false;
    return !this.shoppingInterrupted() && !this.game.positiveCpsBuffs().length;
  }

  /** ASC-12: a target is locked and the routine runs: it outranks everything (SCHED-1). */
  committed(): boolean {
    return !!this.runtime.ascendTarget && this.enabled() && this.data.config.autoDryRun !== true;
  }

  /** The stock trader holds off on new buys while an ascension is committed: they would only
   * be sold again. */
  armed(): boolean {
    return this.committed();
  }

  /** The prestige level ascending right now would give, without the unpopped wrinklers (the
   * game throws them away): what the target is checked against. */
  private realLevel(): number {
    return levelForCookies(this.game.getCookiesReset() + this.game.getCookiesEarned(), this.game.getHCFactor());
  }

  /** ASC-12: how long the routine before an ascension takes from now: every pop, stock sale
   * and achievement purchase (for the bank plus the wrinklers' cookies) at a rough pace,
   * stretched by LEAD_FACTOR, plus LEAD_SAFETY_SEC. */
  leadSec(): number {
    try {
      const wrinklers = this.game.getWrinklers().filter((w) => w && w.phase === 2);
      const stash = wrinklers.reduce((sum, w) => sum + (w.sucked > 0 ? w.sucked * this.game.getWrinklerPopMult(w.type === 1) : 0), 0);
      const plan = this.dumpPlan(this.game.getCookies() + stash);
      const dumpSec = Math.min(MAX_DUMP_MS / 1000, LEAD_PER_VISIT_SEC * plan.length + LEAD_PER_COPY_SEC * dumpCopies(plan));
      const prep = LEAD_PER_POP_SEC * wrinklers.length + LEAD_PER_SALE_SEC * this.stocksToSell().length + dumpSec;

      return Math.ceil(prep * LEAD_FACTOR) + LEAD_SAFETY_SEC;
    } catch (_e) {
      return LEAD_SAFETY_SEC;
    }
  }

  /** ASC-12: locks the target once the plan's level is within the lead time, or (a dry run)
   * says it would. The level is never re-planned after that. */
  private maybeCommit(): void {
    if (this.runtime.ascendTarget || this.runtime.ascendOurs || !this.gatesClear()) return;

    const p = this.planner.plan();
    if (!p || (p.verdict !== 'ascend' && p.verdict !== 'waiting')) return;

    // timed with the routine's own income (no wrinklers, nothing clicked), not the measured one
    const lead = this.leadSec();
    if (!(p.routineEtaSec <= lead + LOCK_SLACK_SEC)) return;

    const now = Date.now();
    const target = { level: p.shop.level, end: p.luckyEnd, sevens: p.shop.sevens };

    if (this.data.config.autoDryRun === true) {
      const last = this.runtime.autoWouldLog.get('ascend') || 0;

      if (now - last > 60000) {
        this.runtime.autoWouldLog.set('ascend', now);
        this.log.log('auto play (dry run)', 'would ascend', { level: target.level, end: target.end, gain: p.gain, buys: p.shop.items.map((i) => i.name).join(', ') });
      }

      return;
    }

    this.runtime.ascendTarget = { ...target, lockedAt: now };
    this.runtime.ascendPrepDone = false;
    this.runtime.ascendDumpSince = 0;
    this.log.log('ascend', `getting ready to ascend at level ${formatNum(target.level)}`, {
      level: target.level,
      end: Number.isFinite(target.end) ? target.end : undefined,
      sevens: target.sevens,
      leadSec: lead,
      etaSec: Math.round(p.routineEtaSec),
      buys: p.shop.items.map((i) => i.name).join(', '),
    });
  }

  /** Drops a locked target (it passed, took too long, auto ascension was switched off). */
  private release(why: string, complain = true): void {
    const t = this.runtime.ascendTarget;
    this.runtime.ascendTarget = null;
    this.runtime.ascendPrepDone = false;
    this.runtime.ascendDumpSince = 0;
    if (!t) return;

    this.log.log('ascend', `called off (level ${formatNum(t.level)}): ${why}`);
    if (complain) sayCant(`Wanted to ascend at level ${formatNum(t.level)}, but ${why}, so I'm picking a new level :c`);
  }

  /** Keeps a locked target honest: still wanted, still reachable. */
  private checkTarget(): void {
    let t = this.runtime.ascendTarget;
    if (!t || this.runtime.ascendOurs) return;

    if (!this.enabled() || this.data.config.autoDryRun === true) return this.release('auto ascension is off', false);
    this.keepWindow(t);
    const now = this.runtime.ascendTarget;
    if (!now) return;
    if (this.realLevel() > now.end) return this.release(`level ${formatNum(now.end)} passed before I got there`);
    t = now;
    if (!(this.holdEtaSec(t.level) <= MAX_HOLD_SEC)) return this.release('the level is too far off at this income');
  }

  /** ASC-12: a lucky window that already passed, or that is too short at the CpS the routine
   * really has (its purchases raise it), is not waited for: the target moves on to the next
   * window that holds long enough, and the routine stays committed (no golden cookies in
   * between). Once the level is inside the window the target never moves. */
  private keepWindow(t: NonNullable<RuntimeState['ascendTarget']>): void {
    if (!Number.isFinite(t.end) || t.sevens <= 0) return;

    const real = this.realLevel();
    if (real >= t.level && real <= t.end) return;

    const cps = Number(this.game.getUnbuffedCps());
    if (!(cps > 0)) return;

    const hc = this.game.getHCFactor();
    const windowSec = (cookiesForLevel(t.end + 1, hc) - cookiesForLevel(t.level, hc)) / cps;
    if (real <= t.end && windowSec >= MIN_WINDOW_SEC) return;

    const total = this.game.getCookiesReset() + this.game.getCookiesEarned() + this.wrinklerStash();
    const at = levelForCookies(total, hc);
    const secPerLevel = (cookiesForLevel(at + 1, hc) - cookiesForLevel(at, hc)) / cps;
    const digit = luckyMinDigit(secPerLevel, ASC_FINAL_SEC);
    // still to prepare: the rest of the routine's time must fit in before the new target
    const ahead = this.runtime.ascendPrepDone ? 0 : this.leadSec();
    const from = Math.max(t.end + 1, levelForCookies(total + cps * ahead, hc));
    const level = nextLuckyTarget(from, t.sevens, digit, luckyWindowLevels(secPerLevel));

    if (level == null) return this.release('there is no lucky level ahead that holds long enough');

    const why = real > t.end ? `level ${formatNum(t.end)} passed` : `its window only lasts ~${Math.round(windowSec)}s at this CpS`;
    this.runtime.ascendTarget = { ...t, level, end: luckyWindowEnd(level, t.sevens, digit) };
    this.log.log('ascend', `moved the target to level ${formatNum(level)}: ${why}`, { from: t.level, to: level, end: this.runtime.ascendTarget.end, now: real });
  }

  /** Cookies the attached wrinklers give when popped. */
  private wrinklerStash(): number {
    return this.game
      .getWrinklers()
      .filter((w) => w && w.phase > 0 && w.sucked > 0)
      .reduce((sum, w) => sum + w.sucked * this.game.getWrinklerPopMult(w.type === 1), 0);
  }

  /** Seconds until `level` at the unbuffed CpS (the wrinklers' cookies count: they are popped
   * first); Infinity without CpS. */
  private holdEtaSec(level: number): number {
    const stash = this.wrinklerStash();
    const missing = cookiesForLevel(level, this.game.getHCFactor()) - (this.game.getCookiesReset() + this.game.getCookiesEarned() + stash);
    if (missing <= 0) return 0;

    const cps = Number(this.game.getUnbuffedCps());
    return cps > 0 ? missing / cps : Infinity;
  }

  /** The locked level is there: ascend now. */
  private atTarget(): boolean {
    const t = this.runtime.ascendTarget;
    if (!t) return false;

    const level = this.realLevel();
    return level >= t.level && level <= t.end;
  }

  /** ASC-13: whether selling and spending is still allowed (it gives up after MAX_DUMP_MS). */
  private dumpTimeLeft(): boolean {
    return !this.runtime.ascendDumpSince || Date.now() - this.runtime.ascendDumpSince < MAX_DUMP_MS;
  }

  /** ASC-13: stock market goods to sell before ascending (they fund the achievements). */
  private stocksToSell(): number[] {
    return this.market && dumpEnabled(this.data.config) && this.dumpTimeLeft() ? this.market.dumpableGoods() : [];
  }

  /** ASC-13: the whole greedy achievement plan for `bank` cookies (buy mode only: in sell mode
   * the game's buy() would sell). */
  private dumpPlan(bank = this.game.getCookies()): DumpStep[] {
    if (!dumpEnabled(this.data.config) || !this.dumpTimeLeft() || this.game.getBuyMode() !== 1) return [];

    const buildings: DumpBuilding[] = this.game
      .getBuildings()
      .filter((b) => b && !b.locked && Number.isFinite(b.price) && Number(b.price) > 0 && b.id != null)
      .map((b) => ({
        name: b.name,
        id: Number(b.id),
        amount: Number(b.amount) || 0,
        price: Number(b.price),
        unwon: this.game.getUnwonBuildingAchievementCounts(b),
      }));

    return planAchievementDump(buildings, bank);
  }

  /** The live game as nextAscensionStep() sees it. */
  state(): AscendState {
    const onScreen = this.game.onAscendScreen();
    const intro = this.game.isAscendIntro();
    const prompt = this.game.isPromptOpen() ? openPromptId() || '?' : '';

    // Back in a normal game without its prompt: whatever it started is over.
    if (!onScreen && !intro && prompt !== 'Ascend' && prompt !== 'Reincarnate') this.runtime.ascendOurs = false;

    const normal = !onScreen && !intro;
    if (normal) {
      this.checkTarget();
      this.maybeCommit();
    }

    const committed = normal && this.committed();
    const want = committed && this.atTarget();
    const prep = committed && !want && !this.runtime.ascendPrepDone;

    const all = this.game.getWrinklers();
    const wrinklers = prep
      ? all
          .filter((w) => w && w.phase === 2 && wrinklerPokeCanvasPoint(w, all))
          .sort((a, b) => b.sucked - a.sucked)
          .map((w) => w.id)
      : [];
    const stocks = prep ? this.stocksToSell() : [];
    const dump = prep ? this.dumpPlan()[0] : undefined;

    // The preparation ran out of things to pop, sell and buy: hold still until the level.
    if (prep && !wrinklers.length && !stocks.length && !dump) {
      this.runtime.ascendPrepDone = true;
      this.runtime.ascendDumpSince = 0;
      this.log.log('ascend', `ready: waiting for level ${formatNum(this.runtime.ascendTarget!.level)}`, { now: this.realLevel() });
    }

    return {
      committed,
      want,
      ours: this.runtime.ascendOurs,
      prompt,
      intro,
      onScreen,
      wrinklers,
      stocks,
      dump: dump ? { name: dump.name, id: dump.id, target: dump.target, count: dump.count } : null,
      toBuy: onScreen && this.runtime.ascendOurs ? this.toBuy() : [],
    };
  }

  /** What's left of the shopping list for the chips on hand (ASC-9), minus what it gave up on. */
  private toBuy(): AscendCrate[] {
    if (Date.now() - this.runtime.ascendOursAt > MAX_HEAVEN_MS) return [];

    const shop = this.planner.shoppingNow();
    if (!shop) return [];

    const ids = new Map(this.game.getHeavenlyUpgrades().map((u) => [u.name, u.id]));

    return shop.items
      .filter((item) => !this.runtime.ascendSkip.has(item.name) && ids.has(item.name))
      .map((item) => {
        const id = ids.get(item.name)!;
        const el = getHeavenlyCrate(id);
        const dragged = (this.runtime.ascendPans.get(id) || 0) >= MAX_PANS;

        return { id, name: item.name, clickable: crateClickable(el) || (dragged && !!visibleRect(el)) };
      });
  }

  /** The next step, or null while there is nothing to do. */
  step(): AscendStep | null {
    if (!this.enabled()) {
      if (this.runtime.ascendTarget && !this.runtime.ascendOurs) this.release('auto ascension is off', false);
      return null;
    }
    if (!this.runtime.running || !this.game.isReady()) return null;
    if (Date.now() < this.runtime.ascendBlockUntil) return null;

    const s = nextAscensionStep(this.state());
    return s.kind === 'wait' ? null : s;
  }

  /** Something for the paw to do (the scheduler, PendingWork and hammering use it). A dry
   * run only logs, so it never counts as pending. */
  pending(): boolean {
    return !!this.step() && this.data.config.autoDryRun !== true;
  }

  /** ASC-11: one plain line on what the BOT does about ascending, for the HUD row and the
   * cards. Always there (also with auto play off), so nobody has to guess from a missing line;
   * '' only when there is no plan to talk about. */
  botLine(): string {
    const c = this.data.config;

    if (this.game.onAscendScreen() || this.game.isAscendIntro()) {
      if (this.runtime.ascendOurs) return 'Paw: buying the pink ones, then reincarnating';
      return "Paw: you ascended yourself, so the buying is up to you";
    }

    const p = this.planner.plan();
    if (!p) return '';

    if (c.autoPlay !== true) return "Paw: auto play is off, so it won't ascend by itself";
    if (c.autoAscend === false) return 'Paw: "Auto: ascend" is off, so it won\'t ascend by itself';
    if (c.autoDryRun === true) return 'Paw: dry run, it only writes "would ascend" in the log';

    const s = this.step();
    const t = this.runtime.ascendTarget;

    if (t) {
      const lv = formatNum(t.level);
      if (s && s.kind === 'pop-wrinkler') return `Paw: getting ready for level ${lv}: popping the wrinklers`;
      if (s && s.kind === 'sell-stock') return `Paw: getting ready for level ${lv}: selling the stocks`;
      if (s && s.kind === 'dump') return `Paw: getting ready for level ${lv}: spending the bank on achievements (${s.name} to ${s.target})`;
      if (s && s.kind === 'hold') return `Paw: ready at Legacy, waiting for level ${lv} (now ${formatNum(this.realLevel())}), no golden cookies meanwhile`;
      return 'Paw: ascending now';
    }

    if (s) return 'Paw: ascending now';

    if (p.verdict === 'waiting') {
      return `Paw: will get ready ~${autoFmtTime(this.leadSec())} before level ${formatNum(p.shop.level)}, then ascend there`;
    }
    if (p.verdict !== 'ascend') return 'Paw: will ascend by itself once it pays off';

    return `Paw: will ascend once ${this.holdReason()}`;
  }

  /** Why an ascension that is due isn't starting yet. */
  private holdReason(): string {
    if (!this.runtime.running) return 'unpaused';
    if (Date.now() < this.runtime.ascendBlockUntil) return 'its pause after a hiccup is over';
    if (this.game.isPromptOpen()) return 'the open prompt is closed';
    if (this.game.positiveCpsBuffs().length) return 'the buffs are over';
    if (this.shoppingInterrupted()) return 'golden cookies and frenzies are done';

    return 'it is safe';
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    const s = this.step();
    if (!s || this.data.config.autoDryRun === true) return null;

    const req = this.jobFor(s);

    if (req) {
      this.runtime.ascendStuckSince = 0;
    } else if (!this.runtime.ascendStuckSince) {
      this.runtime.ascendStuckSince = Date.now();
    } else if (Date.now() - this.runtime.ascendStuckSince > STUCK_MS) {
      this.runtime.ascendStuckSince = 0;
      this.block(10000, `I can't find what to click for "${s.kind}"`);
    }

    return req && this.runtime.ascendTarget ? committedJob(req) : req;
  }

  private jobFor(s: AscendStep): JobRequest | null {
    const sameStep = (now: AscendStep | null) => !!now && now.kind === s.kind && (!('id' in s) || ('id' in now && now.id === s.id));
    const stillWanted = () => sameStep(this.step());
    const key = `ascend:${s.kind}${'id' in s ? `:${s.id}` : ''}`;

    const click = (label: string, target: string, el: () => Element | null, worked: () => boolean, onResult: (ok: boolean) => void, onClicked?: () => void): JobRequest | null => {
      if (!elementCenter(el())) return null;

      return {
        action: new DragonClickAction({ label, target, point: () => elementCenter(el()), el, stillWanted, worked, onResult, onClicked, mood: 'ascend' }),
        priority: JOB_PRIORITY.AUTO_SHOP,
        key,
      };
    };
    const orFail = (why: string, onOk: () => void) => (ok: boolean) => (ok ? onOk() : this.block(3000, why));

    // ASC-13: the selling and spending phase has a time limit, counted from its first step.
    if ((s.kind === 'sell-stock' || s.kind === 'dump') && !this.runtime.ascendDumpSince) this.runtime.ascendDumpSince = Date.now();

    switch (s.kind) {
      case 'hold': {
        const t = this.runtime.ascendTarget;

        return {
          action: new WaitWhileAction('ascend', `level ${formatNum(t ? t.level : 0)}`, stillWanted, () => elementCenter(getLegacyButton())),
          priority: JOB_PRIORITY.AUTO_SHOP,
          key,
        };
      }

      case 'sell-stock':
        return this.market ? this.market.sellAllJob(s.id, stillWanted) : null;

      case 'dump': {
        const scroll = storeScrollJob(this.runtime, () => document.getElementById(`product${s.id}`), {
          key,
          priority: JOB_PRIORITY.AUTO_SHOP,
          hud: { action: 'ascend', target: `scrolling the store to ${s.name}` },
          abortIf: () => !stillWanted(),
        });
        if (scroll) return scroll;

        const building = () => this.game.getBuildings().find((b) => Number(b.id) === s.id) || null;
        const before = Number(building()?.amount) || 0;

        return {
          action: new AchievementDumpAction({
            name: s.name,
            target: s.target,
            count: s.count,
            row: () => document.getElementById(`product${s.id}`),
            stillWanted,
            buyOne: () => {
              const b = building();
              if (!b || this.game.getBuyMode() !== 1) return false;
              const had = Number(b.amount) || 0;
              b.buy(1);
              return (Number(b.amount) || 0) > had;
            },
            onDone: (bought) => {
              const now = Number(building()?.amount) || 0;
              if (!bought) return this.block(3000, `buying ${s.name} for its achievement did not work`);
              this.log.log('ascend', `bought ${bought}x ${s.name} for the ${s.target} achievement`, { from: before, to: now, target: s.target });
            },
          }),
          priority: JOB_PRIORITY.AUTO_SHOP,
          key,
        };
      }

      case 'pop-wrinkler':
        return {
          action: new WrinklerPopAction(s.id, this.game, () => !stillWanted(), (popped, gained) => {
            if (!popped) return this.block(3000, 'a wrinkler did not pop');
            this.stats.recordWrinklerPop();
            this.log.log('pop wrinkler', 'before ascending', { id: s.id, gained: Math.round(gained) });
          }),
          priority: JOB_PRIORITY.AUTO_SHOP,
          key,
        };

      case 'open-legacy':
        return click(
          'ascend',
          'the Legacy button',
          getLegacyButton,
          () => openPromptId() === 'Ascend',
          (ok) => {
            if (ok) return;
            this.runtime.ascendOurs = false;
            this.block(3000, 'the Legacy button did not ask "Ascend"');
          },
          // The prompt opens with the click itself: it is ours from that moment, so nothing
          // else gets a tick in between (and nothing mistakes it for someone else's prompt).
          () => {
            const t = this.runtime.ascendTarget;
            this.log.log('ascend', `clicked Legacy at level ${formatNum(this.realLevel())}`, { level: t?.level, end: t && Number.isFinite(t.end) ? t.end : undefined });
            this.runtime.ascendOurs = true;
            this.runtime.ascendOursAt = Date.now();
          },
        );

      case 'confirm-ascend': {
        const p = this.planner.plan();

        return click(
          'ascend',
          '"Ascend"',
          getAscendConfirmButton,
          () => this.game.isAscending(),
          orFail('"Ascend" did not start the ascension', () => {
            this.runtime.ascendOursAt = Date.now();
            this.runtime.ascendTarget = null;
            this.stats.recordAscension();
            const landed = this.realLevel();
            this.log.log('ascend', p ? `level ${formatNum(p.prestige)} + ${formatNum(landed - p.prestige)} = ${formatNum(landed)}` : `ascended at level ${formatNum(landed)}`, {
              landed,
              prestige: p?.prestige,
              gain: p?.gain,
              plan: p?.shop.items.map((i) => i.name).join(', '),
            });
            sayYay('Ascending!! See you on the other side, cookies ^w^');
          }),
        );
      }

      case 'cancel-ascend':
        return click('cancel ascending', '"Cancel"', getAscendCancelButton, () => !this.game.isPromptOpen(), (ok) => {
          if (!ok) return this.block(3000, 'the "Ascend" prompt did not close');
          this.runtime.ascendOurs = false;
          this.log.log('ascend', 'cancelled: the level is gone', { now: this.realLevel(), end: this.runtime.ascendTarget?.end });
        });

      case 'intro':
        return {
          action: new WaitWhileAction('ascend', 'the ascend animation', () => this.game.isAscendIntro()),
          priority: JOB_PRIORITY.AUTO_SHOP,
          key,
        };

      case 'pan': {
        const el = () => getHeavenlyCrate(s.id);

        if (!panToCrate(el())) {
          this.skip(s.name, 'its crate is not in the tree');
          return null;
        }

        return {
          action: new DragTreeAction({
            label: 'drag the heavenly tree',
            target: s.name,
            delta: () => {
              this.runtime.ascendPans.set(s.id, (this.runtime.ascendPans.get(s.id) || 0) + 1);
              return panToCrate(el());
            },
            pan: (dx, dy) => this.game.panAscendTree(dx, dy),
            stillWanted,
          }),
          priority: JOB_PRIORITY.AUTO_SHOP,
          key,
        };
      }

      case 'buy': {
        const price = this.game.getHeavenlyUpgrades().find((u) => u.id === s.id)?.price ?? 0;

        return click(
          `buy ${s.name}`,
          s.name,
          () => getHeavenlyCrate(s.id),
          () => !!this.game.getHeavenlyUpgrades().find((u) => u.id === s.id)?.bought,
          (ok) => {
            if (ok) {
              this.log.log('heavenly upgrade', `bought ${s.name}`, { price });
              return;
            }

            const fails = (this.runtime.ascendFails.get(s.id) || 0) + 1;
            this.runtime.ascendFails.set(s.id, fails);

            if (fails >= MAX_BUY_FAILS) this.skip(s.name, 'buying it did not work');
            else this.block(3000, `buying ${s.name} did not work`);
          },
        );
      }

      case 'reincarnate':
        return click('reincarnate', 'the Reincarnate button', getReincarnateButton, () => openPromptId() === 'Reincarnate', orFail('Reincarnate did not ask "Yes"', () => {}));

      case 'confirm-reincarnate':
        return click(
          'reincarnate',
          '"Yes"',
          getReincarnateConfirmButton,
          () => !this.game.onAscendScreen(),
          orFail('"Yes" did not reincarnate', () => {
            this.runtime.resetForNewRun(ASCEND_SETTLE_MS);
            this.log.log('ascend', `reincarnated at level ${formatNum(this.game.getPrestige())}`, { chipsLeft: this.game.getHeavenlyChips() });
            sayYay('Back in the mortal world, time to bake again :3');
          }),
        );
    }

    return null;
  }

  /** Gives up on one heavenly upgrade for this ascension. */
  private skip(name: string, why: string): void {
    this.runtime.ascendSkip.add(name);
    this.log.log('ascend', `skipping ${name}: ${why}`);
    sayCant(`Wanted to buy ${name} in heaven, but ${why}, so I'm skipping it :c`);
  }

  private block(ms: number, why: string): void {
    this.runtime.ascendBlockUntil = Date.now() + ms;
    this.log.log('ascend', `paused: ${why}`);
    sayCant(`Wanted to ascend, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}

/** ASC-12: a committed ascension's step outranks golden cookies and never gives way to one
 * (they would push the level past its target). */
function committedJob(req: JobRequest): JobRequest {
  try {
    Object.defineProperty(req.action, 'abortOnGolden', { value: false, configurable: true });
  } catch (_e) {
    // a frozen action keeps its own setting
  }

  return { ...req, priority: JOB_PRIORITY.ASCEND };
}
