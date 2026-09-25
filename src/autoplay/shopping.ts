import { errText, sayCant, sayOops } from '../core/console-voice';
import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { enterStoreElement, storeScrollJob } from '../actions/store-visit';
import { visibleRect } from '../game/dom-geometry';
import { closeStoreSection, storeApproachPoint, storeSectionOf } from '../game/store-dom';
import type { IGameAdapter } from '../game/game-adapter';
import type { GameBuilding } from '../game/types';
import { JOB_PRIORITY, type CursorAction, type CursorJobContext, type JobRequest } from '../cursor/types';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import {
  AUTO_STREAK_JITTER_MS,
  AUTO_STREAK_JITTER_X,
  AUTO_STREAK_JITTER_Y,
  AUTO_STREAK_MAX,
  AUTO_SPREE_MAX,
  AUTO_STACK,
  AUTO_STREAK_RATE,
  autoSpreeNext,
  autoStackSize,
} from './buy-streak';
import { autoCollect, buildingSumPrice, type AutoCollectCtx, type PurchaseCandidate } from './collector';
import type { Decision, DecisionRow } from './strategy';
import { autoDecide, shopPickAt } from './strategy';
import type { IncomeTracker } from './income-tracker';
import { AUTO_CONFIRM_BYPASS, AUTO_ESCALATION_NAMES } from './valuation-tables';

export interface AutoPlan {
  at: number;
  buy: PurchaseCandidate | null;
  save: PurchaseCandidate | null;
  note: string;
  why?: string;
  row?: DecisionRow;
  /** Everything this tick would buy, best first (Decision.buyable). */
  buyable?: DecisionRow[];
}

/** One purchase of a shopping visit (`n` copies of a building stack), for the log. */
interface SpreeBuy {
  c: PurchaseCandidate;
  n?: number;
  /** What it cost (default c.cost). */
  cost?: number;
  row?: DecisionRow;
  why?: string;
}

/** Colour for the "how good is a buy" box: red (0, worst on offer) through amber (0.5) to
 * green (1, best on offer). */
export function buyRankColor(rank: number): string {
  const stops: Array<[number, number, number]> = [
    [255, 90, 90],
    [255, 210, 90],
    [130, 255, 130],
  ];

  const seg = clamp(rank, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;

  const a = stops[i]!;
  const b = stops[i + 1]!;
  const mix = (x: number, y: number) => Math.round(x + (y - x) * f);

  return `rgb(${mix(a[0], b[0])},${mix(a[1], b[1])},${mix(a[2], b[2])})`;
}

/** Short human time for the HUD ("45s", "3m 20s", "2h 5m"). */
export function autoFmtTime(sec: number): string {
  sec = Math.max(0, Math.round(sec));

  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;

  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/** The store element of a purchase option (building row or upgrade crate), for the paw's
 * visit. */
export function autoStoreElement(game: IGameAdapter, c: PurchaseCandidate): Element | null {
  if (c.kind === 'building') {
    const id = (c.obj as { id?: number }).id;
    return document.getElementById(`product${id}`);
  }

  const i = game.getUpgradesInStore().indexOf(c.obj as never);
  return i >= 0 ? document.getElementById(`upgrade${i}`) : null;
}

/** Buys `n` copies of a building through the game's own API (`buy(n)`, not the store, so its
 * buy/sell and bulk modes can never cause a mistake); `n` > 1 only for a streak's stack
 * (AUTO-14), which must be affordable as a whole (`stackCost`). Returns how many it bought. */
export function autoBuyBuilding(game: IGameAdapter, c: PurchaseCandidate, n = 1, stackCost = c.cost): number {
  const me = c.obj as { amount?: number; buy: (n: number) => void };

  if (game.getBuyMode() === -1 || !(game.getCookies() >= stackCost)) {
    return 0;
  }

  const before = Number(me.amount) || 0;
  me.buy(n);

  return Math.max(0, (Number(me.amount) || 0) - before);
}

/** Makes the purchase through the game's own API (NOT by clicking the store, so the store's
 * buy/sell and bulk modes can never cause a mistake). Buildings are bought one at a time. */
export function autoBuy(game: IGameAdapter, c: PurchaseCandidate): boolean {
  if (c.kind === 'building') {
    return autoBuyBuilding(game, c) > 0;
  }

  const up = c.obj as { bought?: boolean | number; buy: (bypass?: number) => void };

  // Second guard behind autoCollect(): never past Grandmapocalypse stage 1 (WRINK-1).
  if (up.bought || AUTO_ESCALATION_NAMES.has(c.name) || !(game.getCookies() >= c.cost)) {
    return false;
  }

  if (AUTO_CONFIRM_BYPASS.has(c.name)) {
    up.buy(1);
  } else {
    up.buy();
  }

  return !!up.bought;
}

/** Orchestrates auto play shopping: planning (autoEvaluate), the "how good is a buy" overlay
 * snapshot, the interrupt/allowed/ready gates, and the shopping task itself. */
export class AutoPlayEngine {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly stats: StatsRecorder,
    private readonly incomeTracker: IncomeTracker,
    private readonly hasGoodGolden: () => boolean,
    private readonly cookieStormActive: () => boolean,
    private readonly cookieChainActive: () => boolean,
    private readonly fthofOrRefillPending: () => boolean,
  ) {}

  /** Candidates + decision for the "how good is a buy" overlay, cached for ~500ms (works
   * whether or not auto play is switched on; it never buys anything by itself). */
  buyValueSnapshot(): { decision: Decision } | null {
    const now = Date.now();

    if (this.runtime.buyValueCache && now < this.runtime.buyValueAt + 500) {
      return this.runtime.buyValueCache;
    }

    this.runtime.buyValueAt = now;

    try {
      const g = autoCollect(this.game, this.data, this.runtime, this.incomeTracker);

      this.runtime.buyValueCache = 'skip' in g ? null : { decision: autoDecide(g.cands, g.ctx) };
    } catch (_e) {
      this.runtime.buyValueCache = null;
    }

    return this.runtime.buyValueCache;
  }

  /** What would auto play buy right now if `extra` more cookies were in the bank? Used by the
   * wrinkler popper (WRINK-3) with the mature wrinklers' cookies as `extra`. `ctx` is the
   * REAL one (bank without `extra`). Null when auto play can't plan (game not ready, ...). */
  decideWithExtraBank(extra: number): { decision: Decision; ctx: AutoCollectCtx } | null {
    const g = autoCollect(this.game, this.data, this.runtime, this.incomeTracker);
    if ('skip' in g) return null;

    return { decision: autoDecide(g.cands, { ...g.ctx, bank: g.ctx.bank + Math.max(0, extra) }), ctx: g.ctx };
  }

  /** Computes (at most once per second, unless forced) the shopping plan and keeps it in
   * runtime.autoPlan. In dry-run mode a purchase is only logged ("would buy", at most once per
   * 30s per item) and plan.buy stays null. Any error pauses the auto player for 30s and is
   * logged. */
  evaluate(force = false): AutoPlan {
    const now = Date.now();

    if (!force && this.runtime.autoPlan && now < this.runtime.autoNextEvalAt) {
      return this.runtime.autoPlan;
    }

    this.runtime.autoNextEvalAt = now + 1000;

    const plan: AutoPlan = { at: now, buy: null, save: null, note: 'watching' };

    try {
      const g = autoCollect(this.game, this.data, this.runtime, this.incomeTracker);

      if ('skip' in g) {
        plan.note = g.skip;
      } else {
        const d = autoDecide(g.cands, g.ctx);

        plan.why = d.why;
        plan.save = d.save || null;

        if (d.buy) {
          if (this.data.config.autoDryRun === true) {
            plan.note = `dry run: would buy ${d.buy.name}`;

            const last = this.runtime.autoWouldLog.get(d.buy.name) || 0;

            if (now - last > 30000) {
              this.runtime.autoWouldLog.set(d.buy.name, now);

              this.log.log('auto play (dry run)', `would buy ${d.buy.name}`, {
                type: d.buy.type,
                cost: Math.round(d.buy.cost),
                dCps: d.buy.dCps,
                payback: d.row!.payback,
                why: d.why,
              });
            }
          } else {
            plan.buy = d.buy;
            plan.row = d.row;
            plan.buyable = d.buyable;
            plan.note = `buying ${d.buy.name} (${d.buy.milestone != null ? `to ${d.buy.milestone} for an achievement` : d.why})`;
          }
        } else if (d.save && d.saveRow) {
          plan.note = `saving for ${d.save.name} (+${(d.saveRow.impact * 100).toFixed(1)}% CpS, ~${autoFmtTime(d.saveRow.wait)})`;
        } else {
          plan.note = d.note || 'watching';
        }
      }
    } catch (e) {
      plan.note = 'error, paused for 30 s';
      this.runtime.autoBlockUntil = now + 30000;

      this.log.log('auto play error', errText(e));
      sayOops('Oopsie, my shopping brain tripped, taking a 30s break >_<', e);
    }

    this.runtime.autoPlan = plan;
    return plan;
  }

  /** Should the paw drop what it is doing / not start shopping? True when anything more
   * important is going on: a ready golden cookie, Click Frenzy, a cookie storm or chain, an
   * FTHOF/refill waiting, or the bot is paused/destroyed. */
  shoppingInterrupted(): boolean {
    return (
      this.runtime.destroyed ||
      !this.runtime.running ||
      this.hasGoodGolden() ||
      this.game.clickFrenzyActive() ||
      this.cookieStormActive() ||
      this.cookieChainActive() ||
      this.fthofOrRefillPending()
    );
  }

  /** Is auto shopping allowed right now? Needs: mode on, not blocked after an error/failed
   * purchase, at least 400ms since the last purchase, and nothing more important going on. */
  shoppingAllowed(): boolean {
    return (
      this.data.config.autoPlay === true &&
      this.game.isPresent() &&
      this.game.isReady() &&
      // AUTO-7: never with a prompt open (its re-plan would be refused, and the refusal pauses
      // shopping; the ascension's own "Ascend" prompt must not get a shopping trip in between).
      !this.game.isPromptOpen() &&
      Date.now() >= this.runtime.autoBlockUntil &&
      Date.now() - this.runtime.lastAutoBuyAt >= 400 &&
      !this.shoppingInterrupted()
    );
  }

  /** Is a purchase due? (allowed, and the current plan says buy). Also used to interrupt
   * hammering and idle play. */
  shopReady(): boolean {
    if (!this.shoppingAllowed()) return false;

    const plan = this.evaluate(false);
    return !!(plan && plan.buy);
  }

  /** Text of the HUD row "Auto play". */
  statusText(): string {
    if (this.data.config.autoPlay !== true) return 'off';

    const plan = this.runtime.autoPlan;
    const st = this.runtime.autoHammerState;

    const hammer =
      this.data.config.autoHammer === false
        ? ''
        : st.on
          ? ` | hammering (clicks ~+${Math.round(st.share * 100)}% CpS${st.probeUntil ? ', probing' : ''})`
          : ` | idling (clicks would add ~${Math.round(st.share * 100)}%)`;

    return (this.data.config.autoDryRun === true ? '[dry run] ' : '') + (plan ? plan.note : 'starting...') + hammer;
  }

  /** Auto play is opt-in: everything that belongs to it (its settings, the HUD row, its
   * statistics) is hidden until the mode is switched on. */
  applyVisibility(): void {
    const on = this.data.config.autoPlay === true;

    const box = document.getElementById('ccsb-auto-settings');
    if (box) box.classList.toggle('open', on);

    const row = document.getElementById('ccsb-auto-row');
    if (row) row.style.display = on ? '' : 'none';
  }

  /** Turns auto play on/off (persisted). Off by default. */
  setAutoPlay(on: boolean): void {
    this.data.config.autoPlay = !!on;
    this.runtime.autoPlan = null;
    this.runtime.autoNextEvalAt = 0;
    this.runtime.autoHammerState.on = false;
    this.runtime.autoHammerState.wanted = null;
    this.runtime.autoHammerState.nextEvalAt = 0;
    this.runtime.autoHammerState.probeUntil = 0;
    this.runtime.autoHammerState.nextProbeAt = 0;

    this.applyVisibility();
    this.log.log('auto play', on ? 'on' : 'off');
    this.data.scheduleSave();
  }

  private recordBuy(): void {
    this.runtime.lastAutoBuyAt = Date.now();
    this.stats.recordAutoBuy();
  }

  /** AUTO-14/AUTO-18: after the visit's first purchase, keeps buying at ~AUTO_STREAK_RATE per
   * second (± time jitter) whatever autoSpreeNext() picks from a fresh plan: the same building
   * again (the press point wandering a few px on its row), or the next insignificant purchase,
   * which the paw hops over to (opening its store section, AUTO-9). Up to AUTO_STREAK_MAX of
   * one building in a row and AUTO_SPREE_MAX in total. Every buy gets its own paw pulse
   * (NFR-8). Returns what it bought, in order, and the store section open at the end (for the
   * caller to close). */
  async buySpree(
    ctx: CursorJobContext,
    first: PurchaseCandidate,
    el: Element | null,
    section: HTMLElement | null,
  ): Promise<{ bought: SpreeBuy[]; section: HTMLElement | null }> {
    const interval = 1000 / AUTO_STREAK_RATE;
    const bought: SpreeBuy[] = [];
    let last = first;
    let run = 1;
    let due = performance.now();
    const reachable = (c: PurchaseCandidate) => !!storeApproachPoint(autoStoreElement(this.game, c));

    let total = 1;

    while (total < AUTO_SPREE_MAX) {
      due += interval + (Math.random() * 2 - 1) * AUTO_STREAK_JITTER_MS;
      await ctx.clock.sleep(Math.max(0, due - performance.now()));

      if (this.shoppingInterrupted() || ctx.abortRequested()) break;

      const g = autoCollect(this.game, this.data, this.runtime, this.incomeTracker);
      if ('skip' in g) break;

      const d = autoDecide(g.cands, g.ctx);
      const c = autoSpreeNext(d, last, this.game.getCookies(), reachable);
      if (!c) break;

      const same = c.kind === 'building' && last.kind === 'building' && c.name === last.name;
      if (same && run >= AUTO_STREAK_MAX) break;

      // a whole stack per press while it is pocket money (AUTO-14)
      const stackCost = c.kind === 'building' ? buildingSumPrice(c.obj as GameBuilding, AUTO_STACK) : 0;
      const n = Math.min(autoStackSize(d, c, stackCost, g.ctx), same ? AUTO_STREAK_MAX - run : AUTO_STREAK_MAX);

      if (same) {
        const r = el ? visibleRect(el) : null;

        if (r) {
          const jx = Math.min(AUTO_STREAK_JITTER_X, r.width / 4);
          const jy = Math.min(AUTO_STREAK_JITTER_Y, r.height / 4);
          const x = r.left + r.width / 2 + (Math.random() * 2 - 1) * jx;
          const y = r.top + r.height / 2 + (Math.random() * 2 - 1) * jy;

          await ctx.cursor.glideCursor(x, y, 18 + Math.random() * 14, () => this.shoppingInterrupted());
        }
      } else {
        // hop to the next item: open its store section (closing the last one), move onto it
        el = autoStoreElement(this.game, c);
        const next = storeSectionOf(el);

        if (next !== section) {
          closeStoreSection(section);
          section = next ? await enterStoreElement(ctx, el) : null;
        }

        // the store may have been rebuilt meanwhile (a purchase reshuffles the crates)
        el = autoStoreElement(this.game, c);
        const r = visibleRect(el);
        if (!r) break;

        const { x, y } = ctx.runtime.cursor;

        if (!(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) {
          await ctx.cursor.moveCursorTo(r.left + r.width / 2, r.top + r.height / 2, true);
        }
      }

      if (this.shoppingInterrupted() || ctx.abortRequested()) break;

      // visual press, then the purchase itself
      ctx.runtime.pulseAt = performance.now();

      const got = c.kind === 'building' ? autoBuyBuilding(this.game, c, n, n > 1 ? stackCost : c.cost) : autoBuy(this.game, c) ? 1 : 0;
      if (!got) break;

      for (let i = 0; i < got; i++) this.recordBuy();

      const row = (d.buyable || []).find((x) => x.c === c);
      // a stack the bank only partly paid for is priced roughly (log only)
      const cost = n > 1 && got === n ? stackCost : c.cost * got;
      bought.push({ c, n: got, cost, why: same ? d.why : row && row.insignificant ? 'insignificant cost' : d.why });
      run = same ? run + got : got;
      total += got;
      last = c;
    }

    return { bought, section };
  }

  /** Logs a visit's purchases as `"auto buy"`, one entry per run of the same item
   * ("37x Cursor", AUTO-10/AUTO-14). */
  private logBuys(buys: SpreeBuy[]): void {
    for (let i = 0; i < buys.length; ) {
      const b = buys[i]!;
      let j = i + 1;
      let cost = b.cost ?? b.c.cost;
      let n = b.n ?? 1;

      while (j < buys.length && buys[j]!.c.name === b.c.name && buys[j]!.c.kind === b.c.kind) {
        cost += buys[j]!.cost ?? buys[j]!.c.cost;
        n += buys[j]!.n ?? 1;
        j++;
      }


      this.log.log('auto buy', n > 1 ? `${n}x ${b.c.name}` : b.c.name, {
        type: b.c.type,
        ...(n > 1 ? { count: n } : {}),
        ...(b.c.milestone != null ? { milestone: b.c.milestone } : {}),
        cost: Math.round(cost),
        dCps: b.c.dCps,
        payback: b.row && b.row.payback,
        impact: b.row && b.row.impact,
        why: b.why,
      });

      i = j;
    }
  }

  /** Shopping job: re-plan, let the paw visit the store item (if it is visible; a visual
   * press only, no click is sent to the store), re-check that nothing more important came up,
   * then buy through autoBuy(). Records stats, logs "auto buy" with the numbers behind the
   * decision, and blocks re-planning for a moment after a failed attempt so it can never
   * spin. The returned action runs the whole flow inside cursor_at_position; the scheduler
   * only enqueues it. */
  shopJob(): JobRequest | null {
    const plan = this.evaluate(true);
    const c = plan && plan.buy;

    if (!c) {
      this.runtime.autoBlockUntil = Date.now() + 1500;
      return null;
    }

    // scrolled out of the store column: the paw scrolls it into view first (AUTO-9)
    const scroll = storeScrollJob(this.runtime, () => autoStoreElement(this.game, c), {
      key: `auto-shop:${c.name}`,
      priority: JOB_PRIORITY.AUTO_SHOP,
      hud: { action: 'auto-shop', target: `scrolling the store to ${c.name}` },
      abortIf: () => this.shoppingInterrupted(),
    });
    if (scroll) return scroll;

    // a crate in a collapsed store row is reached through its section's visible strip
    const pt = storeApproachPoint(autoStoreElement(this.game, c));
    const engine = this;

    const action: CursorAction = {
      label: `buy ${c.name}`,
      target: pt,
      waitClickGap: false,
      preClickPause: false,
      hud: { action: 'auto-shop', target: `buying ${c.name}` },
      abortIf: () => engine.shoppingInterrupted(),
      async cursor_at_position(ctx: CursorJobContext): Promise<void> {
        // AUTO-9: open the crate's store section like a hover would, and close it on leaving
        const el = autoStoreElement(engine.game, c);
        let section = await enterStoreElement(ctx, el);

        try {
          if (pt) {
            await ctx.clock.sleep(90);
          }

          if (engine.shoppingInterrupted()) return;

          // things may have changed while the paw was on its way: decide BEFORE the press, so
          // the paw never presses without a purchase (AUTO-9, NFR-8)
          const fresh = engine.evaluate(true);
          const pick = shopPickAt(fresh, c.name, engine.game.getCookies());

          if (engine.shoppingInterrupted()) return;

          if (!pick) {
            engine.log.log('auto play', `changed its mind at ${c.name}`, {
              now: fresh.buy ? fresh.buy.name : fresh.note,
            });
            return;
          }

          const first = pick.c;

          // visual press, and the purchase at that very moment
          ctx.runtime.pulseAt = performance.now();

          if (!autoBuy(engine.game, first)) {
            engine.runtime.autoBlockUntil = Date.now() + 3000;
            sayCant(`Wanted to buy ${first.name}, but the shop said no :c`);
            return;
          }

          engine.recordBuy();
          await ctx.clock.sleep(70);

          // AUTO-14/AUTO-18: the paw doesn't walk away: the same building again while it is
          // still the pick, then every insignificant purchase in turn, ~10 presses per second.
          const spree = await engine.buySpree(ctx, first, el, section);
          section = spree.section;

          engine.runtime.lastAutoBuyAt = Date.now();
          engine.runtime.autoNextEvalAt = 0;

          engine.logBuys([{ c: first, row: pick.row, why: pick.why }, ...spree.bought]);
        } finally {
          closeStoreSection(section);
        }
      },
    };

    return {
      action,
      priority: JOB_PRIORITY.AUTO_SHOP,
      key: `auto-shop:${c.name}`,
    };
  }
}
