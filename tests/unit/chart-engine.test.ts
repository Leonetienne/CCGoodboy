import { beforeEach, describe, expect, it } from 'vitest';
import { PersistedData } from '../../src/core/persisted-data';
import { effectPrettyName } from '../../src/actions/golden-cookie';
import {
  CHART_PALETTE,
  chartColor,
  chartHitTest,
  getChartHours,
  hashHue,
  type ChartLayout,
  type ChartSeries,
} from '../../src/ui/stats-window/chart-engine';

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

  it('gives every golden cookie effect the bot can catch its own colour', () => {
    const good = ['frenzy', 'multiply cookies', 'click frenzy', 'chain cookie', 'cookie storm', 'cookie storm drop',
      'building special', 'dragon harvest', 'dragonflight', 'free sugar lump', 'blab', 'everything must go'];
    const colors = good.map((e) => chartColor(effectPrettyName(e)));

    expect(new Set(colors).size).toBe(good.length);
  });

  it('picks an unknown series a palette colour', () => {
    expect(CHART_PALETTE).toContain(chartColor('Some New Effect'));
  });
});

describe('chartHitTest', () => {
  // 3 hours over a 200 x 100 plot at (40, 30), maxY 10
  const layout: ChartLayout = {
    left: 40, top: 30, plotW: 200, plotH: 100, maxY: 10, count: 3,
    legend: [{ name: 'Lucky', x: 40, y: 8, w: 50, h: 13 }],
  };
  const series: ChartSeries[] = [
    { name: 'Frenzy', color: '#fff', values: [0, 10, 0] },
    { name: 'Lucky', color: '#fff', values: [0, 0, 0] },
    { name: 'Sweet', color: '#fff', values: [0, 0, 0] },
  ];

  it('names the line under the mouse and the nearest hour', () => {
    // Frenzy peaks at (140, 30)
    expect(chartHitTest(layout, series, 141, 33)).toEqual({ names: ['Frenzy'], index: 1 });
  });

  it('names every line when they lie on top of each other', () => {
    expect(chartHitTest(layout, series, 190, 129)).toEqual({ names: ['Lucky', 'Sweet'], index: 2 });
  });

  it('is null away from every line', () => {
    expect(chartHitTest(layout, series, 60, 60)).toBeNull();
  });

  it('highlights a series from its legend entry, without an hour', () => {
    expect(chartHitTest(layout, series, 50, 12)).toEqual({ names: ['Lucky'], index: -1 });
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
