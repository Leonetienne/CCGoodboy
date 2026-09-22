import { clampInt, hourKey } from '../../core/constants';
import type { PersistedData } from '../../core/persisted-data';

/** Stable hue (0..359) for a string; gives each effect its own chart colour. */
export function hashHue(str: string): number {
  let h = 0;

  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }

  return Math.abs(h) % 360;
}

/** Pastel chart colour for a series name. */
export function chartColor(name: string): string {
  return `hsl(${hashHue(name)}, 88%, 76%)`;
}

/** Sizes and clears a chart canvas (device-pixel aware). */
export function prepareCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(300, canvas.clientWidth || 820);
  const cssH = Math.max(220, canvas.clientHeight || 300);

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  return { ctx, w: cssW, h: cssH };
}

/** The hourly bucket timestamps shown on the charts (setting 'Chart hours', default 48). */
export function getChartHours(data: PersistedData): number[] {
  const hours = clampInt(data.config.chartHours, 6, 720, 48);
  const end = hourKey(Date.now());
  const arr: number[] = [];

  for (let i = hours - 1; i >= 0; i--) {
    arr.push(end - i * 3600000);
  }

  return arr;
}

export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
}

/** Generic hourly chart: axes, grid, one line per series, legend. */
export function drawChartBase(canvas: HTMLCanvasElement, series: ChartSeries[], title: string, hours: number[]): void {
  const { ctx, w, h } = prepareCanvas(canvas);

  const margin = { left: 45, right: 16, top: 34, bottom: 34 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  let maxY = 1;

  for (const s of series) {
    for (const v of s.values) {
      maxY = Math.max(maxY, v);
    }
  }

  ctx.fillStyle = '#241534';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#6b4a86';
  ctx.lineWidth = 1;
  ctx.strokeRect(margin.left, margin.top, plotW, plotH);

  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#e7c6ff';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 4; i++) {
    const y = margin.top + (plotH * i) / 4;
    const val = Math.round(maxY * (1 - i / 4));

    ctx.fillText(String(val), margin.left - 6, y);

    ctx.strokeStyle = 'rgba(255,190,230,.12)';
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotW, y);
    ctx.stroke();
  }

  const tickEvery = Math.max(1, Math.ceil(hours.length / 8));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i < hours.length; i += tickEvery) {
    const x = margin.left + (hours.length <= 1 ? 0 : (i / (hours.length - 1)) * plotW);
    const d = new Date(hours[i]!);

    ctx.fillStyle = '#c9a6e6';
    ctx.fillText(`${String(d.getHours()).padStart(2, '0')}:00`, x, margin.top + plotH + 7);
  }

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([]);
    ctx.beginPath();

    s.values.forEach((v, i) => {
      const x = margin.left + (hours.length <= 1 ? 0 : (i / (hours.length - 1)) * plotW);
      const y = margin.top + plotH - (v / maxY) * plotH;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  // Legend.
  let lx = margin.left;
  let ly = 10;

  ctx.font = '10px Consolas, monospace';

  for (const s of series) {
    const labelW = ctx.measureText(s.name).width + 25;

    if (lx + labelW > w - 10) {
      lx = margin.left;
      ly += 13;
    }

    ctx.fillStyle = s.color;
    ctx.fillRect(lx, ly + 2, 10, 3);

    ctx.fillStyle = '#ffe6f4';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(s.name, lx + 14, ly);

    lx += labelW;
  }

  if (!series.length) {
    ctx.fillStyle = '#c9a6e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '12px Consolas, monospace';
    ctx.fillText(`No ${title} data yet`, margin.left + plotW / 2, margin.top + plotH / 2);
  }
}
