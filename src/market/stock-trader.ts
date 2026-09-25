import { sayCant, sayCantWhile, sayYay } from '../core/console-voice';
import type { Config, PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { MarketClickAction } from '../actions/market';
import { MinigameUnlockAction } from '../actions/minigame-unlock';
import type { IGameAdapter } from '../game/game-adapter';
import { getMarketBrokerButton, getMarketTradeButton } from '../game/market-dom';
import type { MarketSnapshot } from '../game/types';
import type { BuildingsViewNavigator } from '../hunting/buildings-view';
import { MinigameView, type MinigameInfo } from '../hunting/minigame-view';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import { autoFmtTime } from '../autoplay/shopping';
import { formatShort } from '../ui/format';
import { marketHoldingsValue, marketPeakFromHistory, planMarketMove, type MarketMove } from './market-strategy';

/** The Bank's minigame, for MinigameView (STOCK-*, AUTO-16). */
export const STOCK_MARKET_INFO: MinigameInfo = {
  building: 'Bank',
  buildingPlural: 'Banks',
  minigame: 'Stock Market',
  unlockAction: (id, stillWanted, readLevel, onResult) =>
    new MinigameUnlockAction(
      id,
      { label: 'unlock stock market', hud: { action: 'bank-unlock', target: 'Bank level 1 (Stock Market)' } },
      stillWanted,
      readLevel,
      onResult,
    ),
};

/** STOCK-1: the "Play the stock market" setting (on by default). */
export function stockMarketEnabled(config: Pick<Config, 'stockMarket'>): boolean {
  return config.stockMarket !== false;
}

/** Plays the Bank's stock market (STOCK-*): once per market tick it sells what has peaked,
 * hires a broker when that pays, and buys what is low and turning up, every trade a real
 * click on the market's own buttons (MarketClickAction), one per scheduler tick, planned
 * fresh from the live market each time (planMarketMove). Not tied to auto play: the setting
 * "Play the stock market" switches it. */
export class StockTrader {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly stats: StatsRecorder,
    readonly view: MinigameView,
    private readonly interrupted: () => boolean,
  ) {}

  static create(
    runtime: RuntimeState,
    data: PersistedData,
    game: IGameAdapter,
    log: LogStore,
    stats: StatsRecorder,
    nav: BuildingsViewNavigator,
    interrupted: () => boolean,
  ): StockTrader {
    return new StockTrader(runtime, data, game, log, stats, new MinigameView(game, nav, STOCK_MARKET_INFO), interrupted);
  }

  /** The live market when trading may happen right now (STOCK-5 gates), else null. */
  private market(): MarketSnapshot | null {
    if (!stockMarketEnabled(this.data.config)) {
      sayCantWhile('stock market', null);
      return null;
    }

    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return null;

    const snap = this.game.getMarketSnapshot();

    const why = snap ? null : this.view.building() && (Number(this.view.building()!.amount) || 0) >= 1 ? 'locked' : 'no-bank';
    sayCantWhile(
      'stock market',
      why,
      why === 'locked'
        ? 'Wanted to play the stock market, but it isn\'t unlocked yet (Bank level 0) :c'
        : 'Wanted to play the stock market, but I have no Bank yet :c',
    );

    if (!snap) return null;

    // peaks keep being watched while trading waits (a frenzy can outlast a few ticks)
    this.observe(snap);

    // a committed ascension's sales (ASC-12) ignore golden cookies and frenzies
    if (Date.now() < this.runtime.marketBlockUntil || (this.interrupted() && !this.runtime.ascendTarget)) return null;

    return snap;
  }

  /** Keeps each held good's peak since it was bought (for the trailing stop); a good seen
   * held for the first time (after a reload) gets its peak from the graph. */
  private observe(snap: MarketSnapshot): void {
    const peaks = this.runtime.marketPeaks;

    this.stats.reconcileStockBasis(new Map(snap.goods.map((g) => [g.id, g.stock])));

    for (const g of snap.goods) {
      if (!(g.stock > 0)) {
        peaks.delete(g.id);
        continue;
      }

      peaks.set(g.id, Math.max(peaks.get(g.id) ?? marketPeakFromHistory(g), g.val));
    }
  }

  /** ASC-14: set by the ascension; while it returns true no new stocks are bought (they would
   * only be sold again before ascending), sales and everything else go on. */
  holdBuys: () => boolean = () => false;

  private plan(snap: MarketSnapshot): MarketMove | null {
    const move = planMarketMove(snap, this.runtime.marketPeaks, this.game.getCookies(), this.maxShare());
    return move && move.kind !== 'sell' && this.holdBuys() ? null : move;
  }

  private maxShare(): number {
    const v = Number(this.data.config.stockMaxShare);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  }

  /** A trade is due right now (the scheduler, PendingWork and hammering use it). */
  pending(): boolean {
    const snap = this.market();
    return !!(snap && this.plan(snap));
  }

  /** The next single step (getting the market on screen, or one click) as a job, or null. */
  job(): JobRequest | null {
    const snap = this.market();
    if (!snap) return null;

    const move = this.plan(snap);
    if (!move) return null;

    const stillWanted = () => {
      const now = this.market();
      const again = now && this.plan(now);
      return !!again && sameMove(again, move);
    };

    return this.jobForMove(move, snap, stillWanted, 'stock-market');
  }

  /** ASC-13: goods an ascension should sell before it throws the market away (held, and not
   * bought this very tick, which the game refuses to sell). Empty while trading is off or
   * the market is locked. */
  dumpableGoods(): number[] {
    if (!stockMarketEnabled(this.data.config)) return [];

    const snap = this.game.getMarketSnapshot();
    return snap ? snap.goods.filter((g) => g.stock > 0 && g.last !== 1).map((g) => g.id) : [];
  }

  /** ASC-13: sells ALL of one good for the ascension (the "All" button, the same view steps
   * and click as a normal sale), or null while that isn't possible right now. */
  sellAllJob(goodId: number, stillWanted: () => boolean): JobRequest | null {
    const snap = this.market();
    const good = snap && snap.goods.find((g) => g.id === goodId && g.stock > 0);
    if (!snap || !good) return null;

    const move: MarketMove = { kind: 'sell', good, button: '-All', why: 'ascending (the market is thrown away)' };
    return this.jobForMove(move, snap, stillWanted, 'ascend:sell-stock');
  }

  private jobForMove(move: MarketMove, snap: MarketSnapshot, stillWanted: () => boolean, keyPrefix: string): JobRequest | null {
    const element = () => (move.kind === 'broker' ? getMarketBrokerButton() : getMarketTradeButton(move.good.id, move.button));

    const step = this.view.nextStep({
      goal: 'open',
      priority: JOB_PRIORITY.AUTO_SHOP,
      keyPrefix,
      abortIf: () => !stillWanted(),
      allowLevelUp: false,
      onFail: (why) => this.block(10000, why),
      focus: element,
      focusLabel: { label: 'scroll to the stock market', hudTarget: 'the stock market', key: 'scroll-market' },
    });

    if (step.kind === 'blocked') this.block(10000, step.why);
    if (step.kind === 'job') return step.job;
    if (step.kind !== 'ready') return null;

    return {
      action: this.clickAction(move, snap, element, stillWanted),
      priority: JOB_PRIORITY.AUTO_SHOP,
      key: `${keyPrefix}:${moveKey(move)}`,
    };
  }

  private clickAction(move: MarketMove, snap: MarketSnapshot, element: () => Element | null, stillWanted: () => boolean): MarketClickAction {
    const readGood = (id: number) => () => this.game.getMarketSnapshot()?.goods.find((g) => g.id === id)?.stock ?? NaN;

    if (move.kind === 'broker') {
      return new MarketClickAction({
        label: 'hire a stockbroker',
        element,
        read: () => this.game.getMarketSnapshot()?.brokers ?? NaN,
        stillWanted,
        hudTarget: 'hiring a stockbroker',
        onResult: (changed, _before, after) => {
          if (!changed) return this.block(3000, 'hiring a broker did not work');
          this.log.log('stock broker', `hired broker #${after}`, { price: Math.round(snap.brokerPrice), why: move.why });
        },
      });
    }

    const g = move.good;
    // the game's own formulas, with the market as it is at the click (the price holds for the
    // whole tick; the highest raw CpS may have grown since planning)
    const now = () => this.game.getMarketSnapshot() || snap;

    if (move.kind === 'sell') {
      return new MarketClickAction({
        label: `sell ${g.symbol}`,
        element,
        read: readGood(g.id),
        stillWanted,
        hudTarget: `selling ${g.symbol} at $${g.val.toFixed(2)}`,
        onResult: (changed, before, after) => {
          if (!changed) return this.block(3000, `selling ${g.symbol} did not work`);

          const units = before - after;
          const cookies = g.val * units * now().cookiesPerDollar;
          const profit = this.stats.recordStockSell(g.id, units, cookies);
          this.runtime.marketPeaks.delete(g.id);
          this.log.log('stock sell', `${units}x ${g.symbol} at $${g.val.toFixed(2)}`, {
            units,
            price: g.val,
            cookies: Math.round(cookies),
            profit: profit == null ? undefined : Math.round(profit),
            why: move.why,
          });

          if (profit != null && profit > 0) sayYay(`Sold ${g.symbol} for a profit, stonks ^w^`);
        },
      });
    }

    return new MarketClickAction({
      label: `buy ${g.symbol}`,
      element,
      read: readGood(g.id),
      stillWanted,
      hudTarget: `buying ${g.symbol} at $${g.val.toFixed(2)}`,
      onResult: (changed, before, after) => {
        if (!changed) return this.block(3000, `buying ${g.symbol} did not work`);

        const units = after - before;
        const m = now();
        const cost = g.val * m.overhead * units * m.cookiesPerDollar;
        this.runtime.marketPeaks.set(g.id, g.val);
        this.stats.recordStockBuy(g.id, units, cost);
        this.log.log('stock buy', `${units}x ${g.symbol} at $${g.val.toFixed(2)}`, {
          units,
          price: g.val,
          cost: Math.round(cost),
          why: move.why,
        });
      },
    });
  }

  private block(ms: number, why: string): void {
    this.runtime.marketBlockUntil = Date.now() + ms;
    this.log.log('stock market', `paused: ${why}`);
    sayCant(`Wanted to play the stock market, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }

  /** What the paw's held units would gain (+) or lose (-) if sold now, against what it paid. */
  unrealized(snap: MarketSnapshot): number {
    let sum = 0;

    for (const g of snap.goods) {
      const b = this.stats.stockBasisOf(g.id);
      if (!b) continue;
      const units = Math.min(b.units, g.stock);
      sum += units * g.val * snap.cookiesPerDollar - (b.cookies * units) / b.units;
    }

    return sum;
  }

  /** Text of the HUD row "Stock market" (STOCK-7), '' while the setting is off. */
  statusText(): string {
    if (!stockMarketEnabled(this.data.config)) return '';

    const snap = this.game.getMarketSnapshot();
    if (!snap) return this.view.level() === 0 ? 'locked (Bank level 0)' : 'loading...';

    const held = snap.goods.filter((g) => g.stock > 0);
    const move = this.plan(snap);
    const next = move
      ? move.kind === 'broker'
        ? 'next: hire a broker'
        : `next: ${move.kind} ${move.good.symbol}`
      : `next tick in ${autoFmtTime(snap.nextTickSec)}`;

    return [
      held.length ? `holding ${held.map((g) => g.symbol).join(', ')} (${formatShort(marketHoldingsValue(snap))} cookies)` : 'holding nothing',
      `paw made ${signedCookies(this.data.stats.stockProfit || 0)}`,
      ...(held.some((g) => this.stats.stockBasisOf(g.id)) ? [`unrealized ${signedCookies(this.unrealized(snap))}`] : []),
      `${snap.brokers} broker${snap.brokers === 1 ? '' : 's'}`,
      next,
    ].join('; ');
  }
}

/** "+1.2M cookies" / "-340K cookies". */
export function signedCookies(n: number): string {
  return `${n >= 0 ? '+' : ''}${formatShort(n)} cookies`;
}

function moveKey(m: MarketMove): string {
  return m.kind === 'broker' ? 'broker' : `${m.kind}:${m.good.id}:${m.button}`;
}

function sameMove(a: MarketMove, b: MarketMove): boolean {
  return moveKey(a) === moveKey(b);
}
