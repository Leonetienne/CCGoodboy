import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import { JOB_PRIORITY, type CursorAction, type CursorJobContext, type JobRequest } from '../cursor/types';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import { autoCollect, type AutoCollectCtx, type PurchaseCandidate } from './collector';
import type { Decision, DecisionRow } from './strategy';
import { autoDecide } from './strategy';
import type { IncomeTracker } from './income-tracker';
import { AUTO_CONFIRM_BYPASS, AUTO_ESCALATION_NAMES } from './valuation-tables';

export interface AutoPlan {
  at: number;
  buy: PurchaseCandidate | null;
  save: PurchaseCandidate | null;
  note: string;
  why?: string;
  row?: DecisionRow;
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

/** Makes the purchase through the game's own API (NOT by clicking the store, so the store's
 * buy/sell and bulk modes can never cause a mistake). Buildings are bought one at a time. */
export function autoBuy(game: IGameAdapter, c: PurchaseCandidate): boolean {
  if (c.kind === 'building') {
    const me = c.obj as { amount?: number; buy: (n: number) => void };

    if (game.getBuyMode() === -1 || !(game.getCookies() >= c.cost)) {
      return false;
    }

    const before = Number(me.amount) || 0;
    me.buy(1);

    return (Number(me.amount) || 0) > before;
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
            plan.note = `buying ${d.buy.name} (${d.why})`;
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

      this.log.log('auto play error', String(e && (e as Error).message ? (e as Error).message : e));
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

    const el = autoStoreElement(this.game, c);
    const r = el ? visibleRect(el) : null;
    const cx = r ? r.left + r.width / 2 : this.runtime.cursor.x;
    const cy = r ? r.top + r.height / 2 : this.runtime.cursor.y;
    const engine = this;

    const action: CursorAction = {
      label: `buy ${c.name}`,
      target: r ? { x: cx, y: cy } : null,
      waitClickGap: false,
      preClickPause: false,
      hud: { action: 'auto-shop', target: `buying ${c.name}` },
      abortIf: () => engine.shoppingInterrupted(),
      async cursor_at_position(ctx: CursorJobContext): Promise<void> {
        if (r) {
          await ctx.clock.sleep(90);
        }

        // visual press only
        ctx.runtime.pulseAt = performance.now();

        await ctx.clock.sleep(70);

        if (engine.shoppingInterrupted()) return;

        // things may have changed while the paw was on its way
        const fresh = engine.evaluate(true);

        if (engine.shoppingInterrupted() || !fresh.buy || fresh.buy.name !== c.name) {
          return;
        }

        if (autoBuy(engine.game, fresh.buy)) {
          engine.runtime.lastAutoBuyAt = Date.now();
          engine.runtime.autoNextEvalAt = 0;

          engine.stats.recordAutoBuy();

          engine.log.log('auto buy', fresh.buy.name, {
            type: fresh.buy.type,
            cost: Math.round(fresh.buy.cost),
            dCps: fresh.buy.dCps,
            payback: fresh.row && fresh.row.payback,
            impact: fresh.row && fresh.row.impact,
            why: fresh.why,
          });
        } else {
          engine.runtime.autoBlockUntil = Date.now() + 3000;
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
