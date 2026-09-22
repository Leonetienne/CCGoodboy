/** localStorage key of the persisted state (settings, stats, logs, ui). The stored state
 * carries the version that wrote it, so an update can tell how old it is. */
export const STORAGE_KEY = 'ccGoodBoy';

/** Script version. Keep in sync with package.json and the userscript banner. */
export const VERSION = '4.10.14';

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Rounds and clamps; falls back when the input is not a finite number. */
export function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  let v = Math.round(Number(n));
  if (!Number.isFinite(v)) v = fallback;
  return clamp(v, min, max);
}

/** Current Unix time in whole seconds (log timestamps). */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Start of the hour (ms since epoch) containing tsMs; key of the hourly statistic buckets. */
export function hourKey(tsMs: number): number {
  return Math.floor(tsMs / 3600000) * 3600000;
}
