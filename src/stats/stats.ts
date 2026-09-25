import type { PersistedData, StockBasis } from '../core/persisted-data';

/** Counts golden cookies, FTHOF casts, refills and auto-buys into lifetime stats and the
 * hourly buckets that feed the charts. */
export class StatsRecorder {
  constructor(private readonly data: PersistedData) {}

  recordGolden(kind: string): void {
    const label = kind || 'Unknown';

    this.data.stats.totalGolden += 1;
    this.data.stats.byKind[label] = (this.data.stats.byKind[label] || 0) + 1;

    const bucket = this.data.ensureBucket(Date.now());
    bucket.golden[label] = (bucket.golden[label] || 0) + 1;

    this.data.scheduleSave();
  }

  recordFthof(): void {
    this.data.stats.fthofCasts += 1;
    this.data.ensureBucket(Date.now()).fthof += 1;
    this.data.scheduleSave();
  }

  recordRefill(): void {
    this.data.stats.grimoireRefills += 1;
    this.data.ensureBucket(Date.now()).refill += 1;
    this.data.scheduleSave();
  }

  recordLumpHarvest(): void {
    this.data.stats.lumpHarvests += 1;
    this.data.scheduleSave();
  }

  /** A stock purchase by the paw (STOCK-6): adds the units and what they cost (cookies,
   * overhead included) to that good's cost basis. */
  recordStockBuy(goodId: number, units: number, cookies: number): void {
    const b = this.stockBasis(goodId);
    b.units += units;
    b.cookies += cookies;
    this.countStockTrade();
  }

  /** A stock sale by the paw (STOCK-6): books the proceeds against the average cost of the
   * bot's units sold and returns that profit (cookies, negative = a loss), or null when none
   * of the units were the bot's (bought by hand: no known cost, not counted). */
  recordStockSell(goodId: number, units: number, cookies: number): number | null {
    const b = this.stockBasis(goodId);
    const mine = Math.min(units, b.units);
    let profit: number | null = null;

    if (mine > 0) {
      const cost = (b.cookies * mine) / b.units;
      profit = (cookies * mine) / units - cost;

      b.units -= mine;
      b.cookies -= cost;
      this.data.stats.stockProfit = (this.data.stats.stockProfit || 0) + profit;
    }

    if (!(b.units > 0)) delete this.data.stats.stockBasis[String(goodId)];
    this.countStockTrade();

    return profit;
  }

  /** Units that left the warehouse without the paw selling them (sold by hand, or the market
   * reset by an ascension) leave the cost basis unbooked: the basis never exceeds the stock. */
  reconcileStockBasis(stockById: ReadonlyMap<number, number>): void {
    const all = this.data.stats.stockBasis || {};

    for (const key of Object.keys(all)) {
      const b = all[key]!;
      const stock = Math.max(0, stockById.get(Number(key)) ?? 0);
      if (b.units <= stock) continue;

      if (stock <= 0) {
        delete all[key];
      } else {
        b.cookies = (b.cookies * stock) / b.units;
        b.units = stock;
      }

      this.data.scheduleSave();
    }
  }

  /** What the paw's held units cost (cookies), per good id. */
  stockBasisOf(goodId: number): StockBasis | null {
    return (this.data.stats.stockBasis || {})[String(goodId)] || null;
  }

  private stockBasis(goodId: number): StockBasis {
    if (!this.data.stats.stockBasis) this.data.stats.stockBasis = {};
    const key = String(goodId);
    return (this.data.stats.stockBasis[key] ??= { units: 0, cookies: 0 });
  }

  private countStockTrade(): void {
    this.data.stats.stockTrades = (this.data.stats.stockTrades || 0) + 1;
    this.data.scheduleSave();
  }

  recordWrinklerPop(): void {
    this.data.stats.wrinklersPopped = (this.data.stats.wrinklersPopped || 0) + 1;
    this.data.scheduleSave();
  }

  recordAscension(): void {
    this.data.stats.ascensions = (this.data.stats.ascensions || 0) + 1;
    this.data.scheduleSave();
  }

  recordAutoBuy(): void {
    this.data.stats.autoBuys += 1;
    this.data.scheduleSave();
  }
}
