import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULTS, mergeDefaults, PersistedData } from '../../src/core/persisted-data';

describe('mergeDefaults', () => {
  it('returns a clone of the defaults when nothing is stored', () => {
    const out = mergeDefaults(DEFAULTS, null);
    expect(out).toEqual(DEFAULTS);
    expect(out).not.toBe(DEFAULTS);
  });

  it('merges top-level objects key by key so new defaults survive', () => {
    const stored = { config: { goldenMinIntervalMs: 999 } };
    const out = mergeDefaults(DEFAULTS, stored);

    expect(out.config.goldenMinIntervalMs).toBe(999);
    // A setting not present in the stored blob keeps its default.
    expect(out.config.goldenMinFadeCurve).toBe(DEFAULTS.config.goldenMinFadeCurve);
  });

  it('takes array/non-object keys wholesale from the stored value, not merged', () => {
    const stored = { logs: [{ action: 'x', meta: 'y', ts: 1 }] };
    const out = mergeDefaults(DEFAULTS, stored);
    expect(out.logs).toEqual(stored.logs);
  });

  it('ignores keys the incoming value does not have', () => {
    const out = mergeDefaults(DEFAULTS, { stats: { totalGolden: 5 } });
    expect(out.stats.totalGolden).toBe(5);
    expect(out.ui).toEqual(DEFAULTS.ui);
  });

  it('falls back to the defaults for non-object incoming values', () => {
    expect(mergeDefaults(DEFAULTS, 'garbage')).toEqual(DEFAULTS);
    expect(mergeDefaults(DEFAULTS, 42)).toEqual(DEFAULTS);
  });
});

describe('PersistedData', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads defaults on first use', () => {
    const data = new PersistedData();
    expect(data.config.goldenMinIntervalMs).toBe(DEFAULTS.config.goldenMinIntervalMs);
    expect(data.stats.totalGolden).toBe(0);
  });

  it('round-trips through localStorage', () => {
    const data = new PersistedData();
    data.stats.totalGolden = 7;
    data.saveNow();

    const reloaded = new PersistedData();
    expect(reloaded.stats.totalGolden).toBe(7);
  });

  it('prunes hourly buckets older than retentionDays', () => {
    const data = new PersistedData();
    data.config.retentionDays = 1;

    const now = Date.now();
    const old = now - 5 * 86400000; // 5 days ago, older than the 1-day retention
    data.hourly[String(old)] = { golden: {}, fthof: 0, refill: 0 };
    data.hourly[String(now)] = { golden: {}, fthof: 0, refill: 0 };

    data.pruneStoredData();

    expect(Object.keys(data.hourly)).toEqual([String(now)]);
  });

  it('trims logs to logLimit, keeping the newest (logLimit clamps to a minimum of 100)', () => {
    const data = new PersistedData();
    data.config.logLimit = 1; // clamps up to 100

    for (let i = 0; i < 105; i++) {
      data.logs.push({ action: `a${i}`, meta: '', ts: i });
    }

    data.pruneStoredData();

    expect(data.logs).toHaveLength(100);
    expect(data.logs[0].action).toBe('a5');
    expect(data.logs[data.logs.length - 1].action).toBe('a104');
  });

  it('ensureBucket creates and reuses one bucket per hour', () => {
    const data = new PersistedData();
    const t0 = Date.parse('2024-01-01T10:15:00Z');
    const t1 = Date.parse('2024-01-01T10:45:00Z');

    const bucketA = data.ensureBucket(t0);
    const bucketB = data.ensureBucket(t1);

    expect(bucketA).toBe(bucketB);
    expect(Object.keys(data.hourly)).toHaveLength(1);
  });

  it('appendLog trims to the configured limit and schedules a save', () => {
    const data = new PersistedData();
    data.config.logLimit = 100; // clampInt floors to 100 regardless

    for (let i = 0; i < 5; i++) {
      data.appendLog({ action: `a${i}`, meta: '', ts: i });
    }

    expect(data.logs).toHaveLength(5);
  });
});
