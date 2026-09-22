import type { PersistedData } from '../core/persisted-data';

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

  recordWrinklerPop(): void {
    this.data.stats.wrinklersPopped = (this.data.stats.wrinklersPopped || 0) + 1;
    this.data.scheduleSave();
  }

  recordAutoBuy(): void {
    this.data.stats.autoBuys += 1;
    this.data.scheduleSave();
  }
}
