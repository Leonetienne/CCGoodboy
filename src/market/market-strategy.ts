import type { MarketButton } from '../game/market-dom';
import type { MarketGood, MarketSnapshot } from '../game/types';

// Pure trading logic for the Bank's stock market (STOCK-*): no DOM, no game. Tuned on a
// faithful port of the game's own M.tick() (minigameMarket.js 2.058), simulated over
// hundreds of thousands of market ticks at Bank levels 1 and 10 with 20% and 3% overhead.
//
// What the simulation showed about the market:
//  - every good wanders far from its resting value (10 + 10 id + Bank level - 1): Cereals,
//    resting at $10, spends a quarter of the time under $7 and a quarter above $50, the
//    last goods, resting at $180, swing between ~$40 and ~$200;
//  - the bottom is soft (below $5 the price is pulled back up), so a cheap good hardly
//    falls further, while the top is where the big trends end;
//  - measured against R = resting value + 10, buying at <= 0.3 R right after the price
//    turned up again, and selling once it has been at >= 0.7 R and then fell 5% from its
//    peak (never below what it cost), earned the most per cookie tied up: roughly 1-1.6x
//    the invested cookies back PER HOUR of holding, ~2.6 round trips per good per day.
//    Higher buy thresholds earn a little more per warehouse slot but tie up 2-3x the
//    cookies; waiting for higher tops sits on the stock too long.

/** Buy at or below this share of the reference price... */
export const MARKET_BUY_SHARE = 0.3;
/** ...sell once the price has been at or above this share of it... */
export const MARKET_SELL_SHARE = 0.7;
/** ...and has fallen this much from its peak since (a trailing stop: ride the rise, get
 * out when it turns). */
export const MARKET_TRAILING_STOP = 0.05;
/** A tick-to-tick rise ($) that counts as "turned up". */
export const MARKET_UPTICK = 0.01;
/** A buy is only worth the paw's trip for at least this many units (or the whole free
 * warehouse space, if less). */
export const MARKET_MIN_BUY_UNITS = 10;
/** A broker is hired when the overhead it saves on this many full warehouse refills (at
 * the buy threshold) pays for it. */
export const MARKET_BROKER_ROUNDS = 3;

/** The price a good is measured against: its resting value + 10. */
export function marketReference(g: MarketGood): number {
  return g.restingVal + 10;
}

export function marketBuyBelow(g: MarketGood): number {
  return MARKET_BUY_SHARE * marketReference(g);
}

export function marketSellAbove(g: MarketGood): number {
  return MARKET_SELL_SHARE * marketReference(g);
}

/** The price one tick ago (the graph's previous point), or the current price if unknown. */
function previousVal(g: MarketGood): number {
  return g.vals.length >= 2 ? g.vals[1]! : g.val;
}

/** Is the price low (at or below the buy threshold) and turning up (higher than one tick
 * ago), so it is not still falling? */
export function marketLowAndTurning(g: MarketGood): boolean {
  return g.val <= marketBuyBelow(g) && g.val > previousVal(g) + MARKET_UPTICK;
}

/** What one unit cost including the overhead: the last purchase price x the overhead now
 * (the game remembers the price, not what was paid). 0 when unknown. */
export function marketPaid(g: MarketGood, overhead: number): number {
  return g.lastBuyVal > 0 ? g.lastBuyVal * overhead : 0;
}

/** Sell now? The price has peaked at or above the sell threshold since the buy (`peak`),
 * has fallen at least the trailing stop from there, and still beats what it cost. */
export function marketShouldSell(g: MarketGood, peak: number, overhead: number): boolean {
  if (!(g.stock > 0)) return false;

  const top = Math.max(peak, g.val);
  return top >= marketSellAbove(g) && g.val <= top * (1 - MARKET_TRAILING_STOP) && g.val > marketPaid(g, overhead);
}

/** Cookies the trader may still put into stocks: holdings may be at most `maxShare` of the
 * bank + holdings (valued at today's prices), and never more than the bank. */
export function marketBudget(snap: MarketSnapshot, bank: number, maxShare: number): number {
  const held = marketHoldingsValue(snap);
  return Math.max(0, Math.min(bank, maxShare * (bank + held) - held));
}

/** Today's value of everything in the warehouses, in cookies. */
export function marketHoldingsValue(snap: MarketSnapshot): number {
  return snap.goods.reduce((sum, g) => sum + g.stock * g.val, 0) * snap.cookiesPerDollar;
}

/** Is hiring one more broker worth it? The overhead it saves on MARKET_BROKER_ROUNDS
 * refills of every active warehouse at the buy threshold must pay for it. */
export function marketBrokerWorth(snap: MarketSnapshot): boolean {
  if (!(snap.brokers < snap.maxBrokers) || !(snap.cookiesPerDollar > 0)) return false;

  const refill = snap.goods.filter((g) => g.active).reduce((sum, g) => sum + g.maxStock * marketBuyBelow(g), 0);
  const saved = 0.2 * Math.pow(0.95, snap.brokers) * 0.05; // overhead now - overhead with one more
  return saved * refill * MARKET_BROKER_ROUNDS * snap.cookiesPerDollar >= snap.brokerPrice;
}

/** The button that buys closest to `units` without buying more: Max when that fills the
 * warehouse, else the biggest of 100/10/1 that fits. */
export function marketBuyButton(units: number, free: number): MarketButton | null {
  if (units < 1 || free < 1) return null;
  if (units >= free) return 'Max';
  if (units >= 100) return '100';
  if (units >= 10) return '10';
  return '1';
}

export type MarketMove =
  | { kind: 'sell'; good: MarketGood; button: MarketButton; why: string }
  | { kind: 'buy'; good: MarketGood; button: MarketButton; units: number; why: string }
  | { kind: 'broker'; why: string };

/** The next single trade, re-derived from the live market every time (so a preempted click
 * is simply planned again):
 *   1. sell a good whose rise is over (all of it, one click);
 *   2. hire a broker when it pays for itself (and the budget allows);
 *   3. buy a low good that turned up, best upside first, as much as the budget and the
 *      warehouse allow (Max, else 100/10/1 per click).
 * `peaks` = the highest price seen per good id since the trader saw it held. `bank` and
 * `maxShare` set the budget (marketBudget). Null = nothing to do this tick. */
export function planMarketMove(snap: MarketSnapshot, peaks: ReadonlyMap<number, number>, bank: number, maxShare: number): MarketMove | null {
  const goods = snap.goods.filter((g) => g.active);

  for (const g of goods) {
    if (g.last === 1) continue; // bought this tick: the game refuses a sale
    if (marketShouldSell(g, peaks.get(g.id) ?? g.val, snap.overhead)) {
      return { kind: 'sell', good: g, button: '-All', why: `$${g.val.toFixed(2)}, fell from its $${Math.max(peaks.get(g.id) ?? 0, g.val).toFixed(2)} peak` };
    }
  }

  if (!(snap.cookiesPerDollar > 0)) return null;

  const budget = marketBudget(snap, bank, maxShare);

  const buys = goods
    .filter((g) => g.last !== 2 && g.stock < g.maxStock && marketLowAndTurning(g))
    .sort((a, b) => upside(b) - upside(a) || a.id - b.id);

  if (buys.length && marketBrokerWorth(snap) && snap.brokerPrice <= budget) {
    return { kind: 'broker', why: `saves ${(0.2 * Math.pow(0.95, snap.brokers) * 5).toFixed(2)}% overhead on every buy` };
  }

  for (const g of buys) {
    const unitCost = g.val * snap.overhead * snap.cookiesPerDollar;
    const free = g.maxStock - g.stock;
    const units = Math.min(free, Math.floor(budget / unitCost));
    if (units < Math.min(free, MARKET_MIN_BUY_UNITS)) continue;

    const button = marketBuyButton(units, free);
    if (!button) continue;

    return {
      kind: 'buy',
      good: g,
      button,
      units: button === 'Max' ? free : Number(button),
      why: `$${g.val.toFixed(2)} (buy below $${marketBuyBelow(g).toFixed(2)}) and turning up`,
    };
  }

  return null;
}

/** How far the price may rise, relative to what it costs now: the sell threshold / price. */
function upside(g: MarketGood): number {
  return marketSellAbove(g) / Math.max(g.val, 0.01);
}

/** A held good's peak since it was bought, from the graph alone (after a reload the trader
 * didn't watch it): the highest price since the price was last at or below what it was
 * bought at. */
export function marketPeakFromHistory(g: MarketGood): number {
  let peak = g.val;

  for (const v of g.vals) {
    if (g.lastBuyVal > 0 && v <= g.lastBuyVal) break;
    peak = Math.max(peak, v);
  }

  return peak;
}
