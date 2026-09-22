import type { PersistedData } from '../../core/persisted-data';
import {
  chartColor,
  chartHitTest,
  drawChartBase,
  getChartHours,
  type ChartHover,
  type ChartLayout,
  type ChartSeries,
} from './chart-engine';

/** What a chart last drew, so hovering can redraw it without rebuilding the series. */
interface ChartState {
  series: ChartSeries[];
  hours: number[];
  title: string;
  layout: ChartLayout | null;
  hover: ChartHover | null;
}

function graphsBodyHtml(): string {
  return `
<div class="ccsb-modal-head">
    <strong>CC Good Boy :3 hourly action graphs</strong>
    <button class="ccsb-btn" id="ccsb-close-graphs">Close :3</button>
</div>
<div>Golden-cookie clicks / hour by effect</div>
<canvas class="ccsb-chart" id="ccsb-golden-chart"></canvas>
<div>Grimoire actions / hour</div>
<canvas class="ccsb-chart" id="ccsb-grimoire-chart"></canvas>`;
}

/** The hourly action-graphs window: one chart of golden-cookie clicks per effect, one of FTHOF
 * casts / Grimoire refills. */
export class GraphsPanel {
  readonly element: HTMLDivElement;
  private readonly charts = new Map<HTMLCanvasElement, ChartState>();

  constructor(private readonly data: PersistedData) {
    this.element = document.createElement('div');
    this.element.id = 'ccsb-graphs';
    this.element.innerHTML = graphsBodyHtml();

    this.element.querySelectorAll<HTMLCanvasElement>('canvas.ccsb-chart').forEach((canvas) => {
      canvas.addEventListener('mousemove', (e) => this.onHover(canvas, e));
      canvas.addEventListener('mouseleave', () => this.setHover(canvas, null));
    });
  }

  /** Highlights the line (or legend entry) under the mouse and labels its hour. */
  private onHover(canvas: HTMLCanvasElement, e: MouseEvent): void {
    const state = this.charts.get(canvas);

    if (!state || !state.layout) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    this.setHover(canvas, chartHitTest(state.layout, state.series, e.clientX - rect.left, e.clientY - rect.top));
  }

  private setHover(canvas: HTMLCanvasElement, hover: ChartHover | null): void {
    const state = this.charts.get(canvas);

    if (!state || JSON.stringify(state.hover) === JSON.stringify(hover)) {
      return;
    }

    state.hover = hover;
    canvas.style.cursor = hover ? 'pointer' : '';
    this.render(canvas);
  }

  /** Draws a chart with its new data, keeping whatever the mouse is hovering. */
  private drawChart(canvas: HTMLCanvasElement, series: ChartSeries[], title: string, hours: number[]): void {
    const prev = this.charts.get(canvas);
    this.charts.set(canvas, { series, hours, title, layout: null, hover: prev ? prev.hover : null });
    this.render(canvas);
  }

  private render(canvas: HTMLCanvasElement): void {
    const state = this.charts.get(canvas)!;
    state.layout = drawChartBase(canvas, state.series, state.title, state.hours, state.hover);
  }

  /** Shows/hides the charts window (draws on open). */
  toggle(): void {
    const showing = this.element.style.display === 'block';
    this.element.style.display = showing ? 'none' : 'block';

    if (!showing) {
      this.draw();
    }
  }

  get isOpen(): boolean {
    return this.element.style.display === 'block';
  }

  /** Redraws both charts if the charts window is open. */
  draw(): void {
    if (this.element.style.display === 'none') {
      return;
    }

    this.drawGoldenGraph(document.getElementById('ccsb-golden-chart') as HTMLCanvasElement);
    this.drawGrimoireGraph(document.getElementById('ccsb-grimoire-chart') as HTMLCanvasElement);
  }

  /** Chart of golden-cookie clicks per hour, one series per effect. */
  private drawGoldenGraph(canvas: HTMLCanvasElement): void {
    const hours = getChartHours(this.data);
    const kinds = new Set<string>();

    for (const h of hours) {
      const bucket = this.data.hourly[String(h)];

      if (bucket && bucket.golden) {
        Object.keys(bucket.golden).forEach((k) => kinds.add(k));
      }
    }

    const series: ChartSeries[] = Array.from(kinds)
      .sort()
      .map((kind) => ({
        name: kind,
        color: chartColor(kind),
        values: hours.map((h) => (this.data.hourly[String(h)] && this.data.hourly[String(h)]!.golden && this.data.hourly[String(h)]!.golden[kind]) || 0),
      }));

    this.drawChart(canvas, series, 'golden-cookie', hours);
  }

  /** Chart of FTHOF casts and Grimoire refills per hour. */
  private drawGrimoireGraph(canvas: HTMLCanvasElement): void {
    const hours = getChartHours(this.data);

    const series: ChartSeries[] = [
      {
        name: 'FTHOF casts',
        color: chartColor('FTHOF casts'),
        values: hours.map((h) => (this.data.hourly[String(h)] && this.data.hourly[String(h)]!.fthof) || 0),
      },
      {
        name: 'Grimoire refills',
        color: chartColor('Grimoire refills'),
        values: hours.map((h) => (this.data.hourly[String(h)] && this.data.hourly[String(h)]!.refill) || 0),
      },
    ];

    this.drawChart(canvas, series, 'Grimoire', hours);
  }
}
