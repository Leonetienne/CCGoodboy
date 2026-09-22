import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { chartColor, getChartHours, hashHue } from '../../src/ui/stats-window/chart-engine';

describe('hashHue / chartColor', () => {
  it('is deterministic for the same string', () => {
    expect(hashHue('Frenzy')).toBe(hashHue('Frenzy'));
    expect(chartColor('Frenzy')).toBe(chartColor('Frenzy'));
  });

  it('stays within a valid hue range', () => {
    for (const name of ['Frenzy', 'Lucky', 'Cookie Storm Drop', '']) {
      const hue = hashHue(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('formats as an hsl() string', () => {
    expect(chartColor('Lucky')).toMatch(/^hsl\(\d+, 88%, 76%\)$/);
  });
});

describe('getChartHours', () => {
  beforeEach(() => localStorage.clear());

  it('returns exactly `chartHours` hour-aligned timestamps, ending at the current hour', () => {
    const data = new PersistedData();
    data.config.chartHours = 6;

    const hours = getChartHours(data);

    expect(hours).toHaveLength(6);

    for (const h of hours) {
      expect(h % 3600000).toBe(0); // hour-aligned
    }

    // strictly increasing, one hour apart
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i]! - hours[i - 1]!).toBe(3600000);
    }
  });

  it('clamps chartHours to 6..720', () => {
    const data = new PersistedData();

    data.config.chartHours = 1;
    expect(getChartHours(data)).toHaveLength(6);

    data.config.chartHours = 10000;
    expect(getChartHours(data)).toHaveLength(720);
  });
});
