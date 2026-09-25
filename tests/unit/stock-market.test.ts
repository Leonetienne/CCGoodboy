import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketClickAction } from '../../src/actions/market';
import { MinigameButtonAction, ScrollIntoViewAction } from '../../src/actions/buildings-view';
import { MinigameUnlockAction } from '../../src/actions/minigame-unlock';
import { BankUnlocker } from '../../src/autoplay/bank-unlock';
import { PersistedData } from '../../src/core/persisted-data';
import { RuntimeState } from '../../src/core/runtime-state';
import { JOB_PRIORITY } from '../../src/cursor/types';
import type { GameBuilding, MarketGood, MarketSnapshot } from '../../src/game/types';
import { BuildingsViewNavigator } from '../../src/hunting/buildings-view';
import {
  marketBrokerWorth,
  marketBudget,
  marketBuyButton,
  marketLowAndTurning,
  marketPeakFromHistory,
  marketShouldSell,
  planMarketMove,
} from '../../src/market/market-strategy';
import { StockTrader } from '../../src/market/stock-trader';
import { StatsRecorder } from '../../src/stats/stats';
import { normalizeSetting } from '../../src/ui/settings/normalize-setting';
import { FakeGameAdapter } from './fakes/fake-game-adapter';

/** Cereals-like good: resting value 10, so the reference is 20, buy <= $6, sell >= $14. */
function good(over: Partial<MarketGood> = {}): MarketGood {
  return {
    id: 0,
    symbol: 'CRL',
    active: true,
    val: 5,
    vals: [5, 4],
    stock: 0,
    maxStock: 100,
    restingVal: 10,
    lastBuyVal: 0,
    last: 0,
    ...over,
  };
}

function snap(goods: MarketGood[], over: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    goods,
    ticks: 10,
    nextTickSec: 30,
    brokers: 0,
    maxBrokers: 0,
    brokerPrice: 1e12,
    overhead: 1.2,
    cookiesPerDollar: 1,
    profit: 0,
    ...over,
  };
}

describe('market strategy (STOCK-2..4)', () => {
  it('buys only a low price that turned up again', () => {
    expect(marketLowAndTurning(good({ val: 5, vals: [5, 4] }))).toBe(true);
    expect(marketLowAndTurning(good({ val: 5, vals: [5, 6] }))).toBe(false); // still falling
    expect(marketLowAndTurning(good({ val: 7, vals: [7, 6] }))).toBe(false); // above 0.3 x 20
  });

  it('sells after the peak passed the threshold and fell 5%, never at a loss', () => {
    const held = good({ stock: 50, lastBuyVal: 5, val: 15, vals: [15, 16] });
    expect(marketShouldSell(held, 16, 1.2)).toBe(true);
    expect(marketShouldSell(held, 15.5, 1.2)).toBe(false); // fell less than 5%
    expect(marketShouldSell(good({ stock: 50, lastBuyVal: 5, val: 12 }), 13, 1.2)).toBe(false); // peak below $14
    expect(marketShouldSell(good({ stock: 50, lastBuyVal: 14, val: 15 }), 20, 1.2)).toBe(false); // 15 < 14 x 1.2
    expect(marketShouldSell(good({ stock: 0, val: 15 }), 20, 1.2)).toBe(false);
  });

  it('takes the peak since the buy from the graph after a reload', () => {
    expect(marketPeakFromHistory(good({ val: 15, vals: [15, 17, 12, 4, 30], lastBuyVal: 5 }))).toBe(17);
  });

  it('keeps holdings at most the share of bank + holdings', () => {
    const s = snap([good({ stock: 100, val: 5 })]); // holdings 500 cookies
    expect(marketBudget(s, 1500, 0.5)).toBe(500); // 0.5 x 2000 - 500
    expect(marketBudget(s, 100, 0.5)).toBe(0);
    expect(marketBudget(snap([good()]), 1000, 1)).toBe(1000); // never more than the bank
  });

  it('picks Max only when it fills the warehouse, else the biggest fitting button', () => {
    expect(marketBuyButton(80, 80)).toBe('Max');
    expect(marketBuyButton(250, 400)).toBe('100');
    expect(marketBuyButton(42, 400)).toBe('10');
    expect(marketBuyButton(3, 400)).toBe('1');
    expect(marketBuyButton(0, 400)).toBeNull();
  });

  it('hires a broker only when its overhead savings pay for it', () => {
    const goods = [good({ maxStock: 1000 })]; // refill at $6 = $6000
    expect(marketBrokerWorth(snap(goods, { maxBrokers: 1, brokerPrice: 100 }))).toBe(true); // 0.01 x 6000 x 3 = 180
    expect(marketBrokerWorth(snap(goods, { maxBrokers: 1, brokerPrice: 200 }))).toBe(false);
    expect(marketBrokerWorth(snap(goods, { maxBrokers: 0, brokerPrice: 1 }))).toBe(false);
  });
});

describe('stockMaxShare setting', () => {
  it('defaults to 0.5 and clamps to 0-1', () => {
    expect(new PersistedData().config.stockMaxShare).toBe(0.5);
    expect(normalizeSetting('stockMaxShare', '2')).toBe(1);
    expect(normalizeSetting('stockMaxShare', '-1')).toBe(0);
    expect(normalizeSetting('stockMaxShare', '')).toBe(0.5);
  });
});

describe('planMarketMove', () => {
  it('sells before it buys', () => {
    const sell = good({ id: 1, symbol: 'CHC', restingVal: 20, stock: 10, lastBuyVal: 5, val: 19, vals: [19, 21] });
    const buy = good({ id: 0 });
    const move = planMarketMove(snap([buy, sell]), new Map([[1, 21]]), 1e6, 1);

    expect(move).toMatchObject({ kind: 'sell', button: '-All' });
    expect(move && move.kind !== 'broker' && move.good.id).toBe(1);
  });

  it('buys the best upside first, filling the warehouse with Max when the budget allows', () => {
    const cheap = good({ id: 0, val: 2, vals: [2, 1.5] }); // upside 14/2
    const dear = good({ id: 1, symbol: 'CHC', restingVal: 20, val: 8, vals: [8, 7] }); // 21/8
    const move = planMarketMove(snap([dear, cheap]), new Map(), 1e6, 1);

    expect(move).toMatchObject({ kind: 'buy', button: 'Max', units: 100 });
    expect(move && move.kind !== 'broker' && move.good.id).toBe(0);
  });

  it('buys in 100s/10s within a smaller budget, and not at all below the minimum', () => {
    // $5 x 1.2 = 6 cookies a unit
    expect(planMarketMove(snap([good({ maxStock: 1000 })]), new Map(), 1300, 1)).toMatchObject({ button: '100' });
    expect(planMarketMove(snap([good({ maxStock: 1000 })]), new Map(), 400, 1)).toMatchObject({ button: '10' });
    expect(planMarketMove(snap([good({ maxStock: 1000 })]), new Map(), 50, 1)).toBeNull(); // 8 units < 10
  });

  it('respects the game\'s one-way-per-tick rule and inactive goods', () => {
    expect(planMarketMove(snap([good({ last: 2 })]), new Map(), 1e6, 1)).toBeNull();
    expect(planMarketMove(snap([good({ active: false })]), new Map(), 1e6, 1)).toBeNull();

    const bought = good({ stock: 10, lastBuyVal: 5, val: 19, vals: [19, 21], last: 1 });
    expect(planMarketMove(snap([bought]), new Map([[0, 21]]), 1e6, 1)).toBeNull();
  });

  it('hires a worthwhile broker before buying', () => {
    const s = snap([good({ maxStock: 1000 })], { maxBrokers: 5, brokerPrice: 100 });
    expect(planMarketMove(s, new Map(), 1e6, 1)).toMatchObject({ kind: 'broker' });
  });
});

// ---- the trader and the Bank unlock against a minimal DOM ----

const RECT = { left: 100, top: 100, right: 160, bottom: 130, width: 60, height: 30, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;
const COLUMN = { ...RECT, top: 0, bottom: 700, height: 700, width: 800, right: 900 } as DOMRect;
const OFFSCREEN = { ...RECT, top: 5000, bottom: 5030, y: 5000 } as DOMRect;

function buildDom(buyRect: DOMRect = RECT): void {
  document.body.innerHTML = `
    <div id="prefsButton"></div><div id="statsButton"></div>
    <div id="centerArea"><div id="rows"><div id="row5">
      <div id="productLevel5">lvl 0</div><div id="productMinigameButton5">View Stock Market</div>
      <div id="bankGood-0_Max"></div><div id="bankGood-0_10"></div><div id="bankGood-0_-All"></div><div id="bankBrokersBuy"></div>
    </div></div></div>`;

  for (const el of Array.from(document.body.querySelectorAll('div'))) el.style.opacity = '1';

  const stub = (id: string, r: DOMRect) => {
    document.getElementById(id)!.getBoundingClientRect = () => r;
  };

  for (const id of ['prefsButton', 'statsButton', 'row5', 'productLevel5', 'productMinigameButton5', 'bankGood-0_10', 'bankGood-0_-All', 'bankBrokersBuy']) stub(id, RECT);
  stub('centerArea', COLUMN);
  stub('rows', COLUMN);
  stub('bankGood-0_Max', buyRect);
}

function setup() {
  const runtime = new RuntimeState();
  const data = new PersistedData();
  data.config.stockMarket = true;

  const game = new FakeGameAdapter();
  game.cookies = 1e6;
  game.lumpsOn = true;
  game.lumps = 1;

  const bank = { name: 'Bank', id: 5, amount: 1, level: 1, onMinigame: true, buy: () => {} } as GameBuilding;
  game.buildingsByName['Bank'] = bank;
  game.market = snap([good()]);

  const log = { log: vi.fn() };
  const stats = new StatsRecorder(data);
  let interrupted = false;

  const nav = new BuildingsViewNavigator(runtime, game, () => false);
  const trader = StockTrader.create(runtime, data, game, log as never, stats as never, nav, () => interrupted);
  const unlocker = new BankUnlocker(runtime, data, game, log as never, trader.view, () => interrupted);

  return { runtime, data, game, bank, log, stats, trader, unlocker, interrupt: (v: boolean) => (interrupted = v) };
}

beforeEach(() => buildDom());

describe('StockTrader (STOCK-*)', () => {
  it('is on by default, and does nothing while "Play the stock market" is off', () => {
    const s = setup();
    s.data.config.stockMarket = false;

    expect(new PersistedData().config.stockMarket).toBe(true);
    expect(s.trader.pending()).toBe(false);
    expect(s.trader.job()).toBeNull();
    expect(s.trader.statusText()).toBe('');
  });

  it('clicks the real Max button when a good is low and turning up', () => {
    const s = setup();
    expect(s.trader.pending()).toBe(true);

    const job = s.trader.job()!;
    expect(job.action).toBeInstanceOf(MarketClickAction);
    expect(job.priority).toBe(JOB_PRIORITY.AUTO_SHOP);
    expect(job.key).toBe('stock-market:buy:0:Max');
  });

  it('spends at most 10% of bank + stocks while auto play saves up (STOCK-4)', () => {
    const s = setup();
    s.game.cookies = 2000; // Max = 100 x $5 x 1.2 = 600 cookies

    expect(s.trader.job()!.key).toBe('stock-market:buy:0:Max'); // 50%: 1000 to spend

    s.trader.saving = () => true;
    expect(s.trader.job()!.key).toBe('stock-market:buy:0:10'); // 10%: 200 to spend, 33 units
    expect(s.trader.statusText()).toContain('budget 10% while shopping saves');

    s.game.market!.goods.push(good({ id: 1, symbol: 'CHC', restingVal: 20, stock: 50, val: 30, vals: [30, 30] })); // holds 1500
    expect(s.trader.pending()).toBe(false); // already above 10%, nothing more (and nothing sold for it)
  });

  it('scrolls to the button first, and opens a closed market', () => {
    buildDom(OFFSCREEN);
    let s = setup();
    expect(s.trader.job()!.action).toBeInstanceOf(ScrollIntoViewAction);

    buildDom();
    s = setup();
    s.bank.onMinigame = false;
    expect(s.trader.job()!.action).toBeInstanceOf(MinigameButtonAction);
  });

  it('respects the safety gates (golden cookie, Click Frenzy, prompt, ascension)', () => {
    const s = setup();
    s.interrupt(true);
    expect(s.trader.pending()).toBe(false);

    s.interrupt(false);
    s.game.promptOpen = true;
    expect(s.trader.pending()).toBe(false);

    s.game.promptOpen = false;
    s.game.ascending = true;
    expect(s.trader.pending()).toBe(false);
  });

  it('never unlocks the market by itself (no market = nothing to do)', () => {
    const s = setup();
    s.game.market = null;
    s.bank.level = 0;

    expect(s.trader.pending()).toBe(false);
    expect(s.trader.statusText()).toContain('locked');
  });

  it('logs and counts a trade the click made, and pauses when it did nothing', async () => {
    const s = setup();
    const action = s.trader.job()!.action as MarketClickAction;
    const el = document.getElementById('bankGood-0_Max')!;
    const ctx = {
      runtime: s.runtime,
      clickTiming: {
        humanClick: vi.fn().mockImplementation(async (target: Element) => {
          if (target === el) s.game.market!.goods[0]!.stock = 100;
          return true;
        }),
      },
    };

    await action.cursor_at_position(ctx as never);
    expect(s.data.stats.stockTrades).toBe(1);
    expect(s.data.stats.stockBasis['0']).toEqual({ units: 100, cookies: 600 }); // 100 x $5 x 1.2
    expect(s.log.log).toHaveBeenCalledWith('stock buy', '100x CRL at $5.00', expect.objectContaining({ units: 100, cost: 600 }));
    expect(s.runtime.marketPeaks.get(0)).toBe(5);

    s.game.market!.goods[0]!.stock = 0;
    const again = s.trader.job()!.action as MarketClickAction;
    ctx.clickTiming.humanClick = vi.fn().mockResolvedValue(true);
    await again.cursor_at_position(ctx as never);
    expect(s.runtime.marketBlockUntil).toBeGreaterThan(Date.now());
  });

  it('sells with the All button once the peak passed', () => {
    const s = setup();
    s.game.market = snap([good({ stock: 50, lastBuyVal: 5, val: 15, vals: [15, 17, 16, 10, 4] })]);

    expect(s.trader.job()!.key).toBe('stock-market:sell:0:-All'); // peak 17 from the graph
  });
});

describe('Pause investments and Cash stock market wins (STOCK-9)', () => {
  it('invests by default; paused it buys nothing but still sells', () => {
    const s = setup();
    expect(new PersistedData().config.stockInvest).toBe(true);

    s.trader.toggleInvest();
    expect(s.data.config.stockInvest).toBe(false);
    expect(s.trader.pending()).toBe(false); // the cheap good is not bought

    s.game.market = snap([good({ stock: 50, lastBuyVal: 5, val: 15, vals: [15, 17, 16, 10, 4] })]);
    expect(s.trader.job()!.key).toBe('stock-market:sell:0:-All');

    s.game.market = snap([good()], { maxBrokers: 5, brokerPrice: 1 });
    expect(s.trader.pending()).toBe(false); // no broker either
  });

  it('auto play always invests, and the button only shows without it on an unlocked market', () => {
    const s = setup();
    s.data.config.stockInvest = false;
    expect(s.trader.investButtonShown()).toBe(true);

    s.data.config.autoPlay = true;
    expect(s.trader.investButtonShown()).toBe(false);
    expect(s.trader.job()!.key).toBe('stock-market:buy:0:Max');

    s.data.config.autoPlay = false;
    s.game.market = null;
    expect(s.trader.investButtonShown()).toBe(false);
  });

  it('previews and sells every good that is not at a loss, then stops', () => {
    const s = setup();
    s.data.config.stockInvest = false;
    s.game.market = snap([
      good({ id: 0, stock: 50, lastBuyVal: 5, val: 7, vals: [7, 7] }), // 7 > 5 x 1.2: a win, not a peak sale yet
      good({ id: 1, symbol: 'CHC', stock: 10, lastBuyVal: 20, val: 21, vals: [21, 21] }), // 21 < 24: a loss
    ]);

    expect(s.trader.cashOutPreview()).toEqual({ shown: true, goods: ['CRL'], cookies: 350 });
    expect(s.trader.pending()).toBe(false);

    s.trader.toggleCashOut();
    expect(s.trader.cashingOut()).toBe(true);
    expect(s.trader.job()!.key).toBe('stock-market:sell:0:-All');

    s.game.market.goods[0]!.stock = 0;
    expect(s.trader.pending()).toBe(false);
    expect(s.trader.cashingOut()).toBe(false); // nothing left: done
    expect(s.log.log).toHaveBeenCalledWith('stock market', expect.stringContaining('cash out done'));
  });

  it('a second click stops cashing out', () => {
    const s = setup();
    s.trader.toggleCashOut();
    s.trader.toggleCashOut();
    expect(s.trader.cashingOut()).toBe(false);
  });
});

describe('BankUnlocker (AUTO-16)', () => {
  function locked() {
    const s = setup();
    s.data.config.autoPlay = true;
    s.bank.level = 0;
    s.game.market = null;
    return s;
  }

  it('spends a lump on Bank level 1 in auto play with the stock market on', () => {
    const s = locked();
    expect(s.unlocker.pending()).toBe(true);

    const job = s.unlocker.job()!;
    expect(job.action).toBeInstanceOf(MinigameUnlockAction);
    expect(job.key).toBe('bank-unlock:level');
    expect(job.action.hud).toEqual({ action: 'bank-unlock', target: 'Bank level 1 (Stock Market)' });
  });

  it('needs auto play, the stock market setting, lump spending and a lump', () => {
    let s = locked();
    s.data.config.autoPlay = false;
    expect(s.unlocker.wanted()).toBe(false);

    s = locked();
    s.data.config.stockMarket = false;
    expect(s.unlocker.wanted()).toBe(false);

    s = locked();
    s.data.config.spendLumps = false;
    expect(s.unlocker.wanted()).toBe(false);

    s = locked();
    s.game.lumps = 0;
    expect(s.unlocker.wanted()).toBe(false);

    s = locked();
    s.bank.level = 1;
    expect(s.unlocker.wanted()).toBe(false);
  });
});

describe('stock market profit (STOCK-6)', () => {
  function books() {
    const data = new PersistedData();
    return { data, stats: new StatsRecorder(data) };
  }

  it('books each sale against the average cost of the units sold', () => {
    const { data, stats } = books();
    stats.recordStockBuy(0, 100, 600);
    stats.recordStockBuy(0, 100, 1000); // average 8 a unit

    expect(stats.recordStockSell(0, 50, 1000)).toBe(600); // 1000 - 50 x 8
    expect(data.stats.stockProfit).toBe(600);
    expect(data.stats.stockBasis['0']).toEqual({ units: 150, cookies: 1200 });

    expect(stats.recordStockSell(0, 150, 900)).toBe(-300); // a loss counts too
    expect(data.stats.stockProfit).toBe(300);
    expect(data.stats.stockBasis['0']).toBeUndefined();
    expect(data.stats.stockTrades).toBe(4);
  });

  it('counts only the bot\'s own units of a sale', () => {
    const { data, stats } = books();
    stats.recordStockBuy(1, 10, 100);

    expect(stats.recordStockSell(1, 40, 800)).toBe(100); // 10 of the 40 were the bot's: 200 - 100
    expect(stats.recordStockSell(2, 5, 50)).toBeNull(); // bought by hand
    expect(data.stats.stockProfit).toBe(100);
  });

  it('drops the cost of units that left without the paw (sold by hand, ascension)', () => {
    const { data, stats } = books();
    stats.recordStockBuy(0, 100, 600);
    stats.recordStockBuy(1, 10, 100);

    stats.reconcileStockBasis(new Map([[0, 40], [1, 0]]));
    expect(data.stats.stockBasis).toEqual({ '0': { units: 40, cookies: 240 } });
    expect(data.stats.stockProfit).toBe(0);
  });

  it('shows what the paw made and what it holds would make now', () => {
    const s = setup();
    s.stats.recordStockBuy(0, 50, 250); // $5 a unit
    s.data.stats.stockProfit = 1500;
    s.game.market = snap([good({ stock: 50, val: 8, vals: [8, 9] })]);

    const text = s.trader.statusText();
    expect(text).toContain('paw made +1.5K cookies');
    expect(text).toContain('unrealized +150 cookies'); // 50 x 8 - 250
  });
});

describe('StockTrader and the ascension (ASC-13/14)', () => {
  it('holds new buys, but never sales, while the ascension is armed', () => {
    const s = setup();
    expect(s.trader.pending()).toBe(true); // the low, turning good would be bought
    s.trader.holdBuys = () => true;
    expect(s.trader.pending()).toBe(false);

    // a held good that peaked and fell is still sold
    s.game.market = snap([good({ stock: 50, val: 15, vals: [15, 16], lastBuyVal: 5 })]);
    s.runtime.marketPeaks.set(0, 16);
    expect(s.trader.pending()).toBe(true);
  });

  it('names the goods to sell before ascending and sells ALL of one', () => {
    const s = setup();
    s.game.market = snap([good({ id: 0, stock: 20 }), good({ id: 1, stock: 0 }), good({ id: 2, stock: 5, last: 1 })]);
    expect(s.trader.dumpableGoods()).toEqual([0]); // id 2 was bought this tick: the game won't sell it

    const job = s.trader.sellAllJob(0, () => true);
    expect(job).not.toBeNull();
    expect(job!.key!.startsWith('ascend:sell-stock')).toBe(true);
    expect(s.trader.sellAllJob(1, () => true)).toBeNull();

    s.data.config.stockMarket = false;
    expect(s.trader.dumpableGoods()).toEqual([]);
  });
});
