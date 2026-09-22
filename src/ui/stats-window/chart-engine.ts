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

/** Hand-picked, clearly different line colours that all read well on the dark chart
 * background. Hashed pastel hues bunched up in yellow for most effect names. */
export const CHART_PALETTE = [
  '#ffd84d', // gold
  '#5ee6a8', // mint
  '#ff6b8b', // coral
  '#8f7bff', // violet
  '#4fc3ff', // sky
  '#ff9f45', // orange
  '#ff8fd8', // pink
  '#c6f36b', // lime
  '#2ee6d0', // teal
  '#f2f2f2', // white
  '#c79a6e', // tan
  '#d9b3ff', // lilac
] as const;

/** Fixed colour per known series, so an effect keeps its colour whatever else is on the
 * chart. Every golden cookie effect the bot can catch has its own palette entry. */
const SERIES_COLORS: Record<string, string> = {
  Frenzy: CHART_PALETTE[0],
  Lucky: CHART_PALETTE[1],
  'Click Frenzy': CHART_PALETTE[2],
  'Cookie Chain': CHART_PALETTE[3],
  'Cookie Storm': CHART_PALETTE[4],
  'Cookie Storm Drop': CHART_PALETTE[5],
  'Building Special': CHART_PALETTE[6],
  'Dragon Harvest': CHART_PALETTE[7],
  Dragonflight: CHART_PALETTE[8],
  Sweet: CHART_PALETTE[9],
  Blab: CHART_PALETTE[10],
  'Everything Must Go': CHART_PALETTE[11],
  'FTHOF casts': CHART_PALETTE[3],
  'Grimoire refills': CHART_PALETTE[4],
};

/** Chart colour for a series name: its fixed colour, or a stable palette pick for an
 * unknown name. */
export function chartColor(name: string): string {
  return SERIES_COLORS[name] || CHART_PALETTE[hashHue(name) % CHART_PALETTE.length]!;
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

/** What the mouse points at: the highlighted series, and the hour under the mouse (-1 for a
 * legend entry, which highlights without a label). */
export interface ChartHover {
  names: string[];
  index: number;
}

/** Where drawChartBase put things, in CSS px, for hover hit-testing. */
export interface ChartLayout {
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  maxY: number;
  count: number;
  legend: { name: string; x: number; y: number; w: number; h: number }[];
}

/** CSS px position of value v at hour index i. */
function chartPoint(layout: ChartLayout, i: number, v: number): { x: number; y: number } {
  return {
    x: layout.left + (layout.count <= 1 ? 0 : (i / (layout.count - 1)) * layout.plotW),
    y: layout.top + layout.plotH - (v / layout.maxY) * layout.plotH,
  };
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Which series the mouse at (mx, my) points at: a legend entry, or every line within
 * `tolerance` px of the closest one (lines often lie on top of each other, e.g. at 0). */
export function chartHitTest(layout: ChartLayout, series: ChartSeries[], mx: number, my: number, tolerance = 8): ChartHover | null {
  for (const l of layout.legend) {
    if (mx >= l.x && mx <= l.x + l.w && my >= l.y && my <= l.y + l.h) {
      return { names: [l.name], index: -1 };
    }
  }

  if (mx < layout.left - tolerance || mx > layout.left + layout.plotW + tolerance || !layout.count) {
    return null;
  }

  const dists = series.map((s) => {
    let best = Infinity;

    for (let i = 0; i < s.values.length; i++) {
      const a = chartPoint(layout, i, s.values[i]!);
      const b = i + 1 < s.values.length ? chartPoint(layout, i + 1, s.values[i + 1]!) : a;
      best = Math.min(best, segmentDistance(mx, my, a.x, a.y, b.x, b.y));
    }

    return best;
  });

  const min = Math.min(...dists);

  if (!(min <= tolerance)) {
    return null;
  }

  const index = layout.count <= 1 ? 0 : Math.round(((mx - layout.left) / layout.plotW) * (layout.count - 1));

  return {
    names: series.filter((_s, i) => dists[i]! <= min + 1).map((s) => s.name),
    index: Math.max(0, Math.min(layout.count - 1, index)),
  };
}

/** Generic hourly chart: axes, grid, one line per series, legend. With `hover`, the hovered
 * series are drawn bold on top of the faded rest, with a label for the hovered hour. */
export function drawChartBase(
  canvas: HTMLCanvasElement,
  series: ChartSeries[],
  title: string,
  hours: number[],
  hover: ChartHover | null = null,
): ChartLayout {
  const { ctx, w, h } = prepareCanvas(canvas);

  const margin = { left: 45, right: 16, top: 34, bottom: 34 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;
  const hovered = new Set(hover ? hover.names : []);

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

  const layout: ChartLayout = { left: margin.left, top: margin.top, plotW, plotH, maxY, count: hours.length, legend: [] };

  // Hovered lines last, so they sit on top.
  const ordered = [...series.filter((s) => !hovered.has(s.name)), ...series.filter((s) => hovered.has(s.name))];

  for (const s of ordered) {
    const isHovered = hovered.has(s.name);

    ctx.globalAlpha = hovered.size && !isHovered ? 0.25 : 1;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = isHovered ? 3.2 : 1.8;
    ctx.setLineDash([]);
    ctx.beginPath();

    s.values.forEach((v, i) => {
      const p = chartPoint(layout, i, v);

      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });

    ctx.stroke();
  }

  ctx.globalAlpha = 1;

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

    ctx.globalAlpha = hovered.size && !hovered.has(s.name) ? 0.4 : 1;
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, ly + 2, 10, 3);

    ctx.fillStyle = '#ffe6f4';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(s.name, lx + 14, ly);

    layout.legend.push({ name: s.name, x: lx, y: ly - 2, w: labelW - 8, h: 13 });
    lx += labelW;
  }

  ctx.globalAlpha = 1;

  if (hover && hover.index >= 0 && hover.index < hours.length) {
    drawHoverLabel(ctx, layout, series.filter((s) => hovered.has(s.name)), hours[hover.index]!, hover.index, w);
  }

  if (!series.length) {
    ctx.fillStyle = '#c9a6e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '12px Consolas, monospace';
    ctx.fillText(`No ${title} data yet`, margin.left + plotW / 2, margin.top + plotH / 2);
  }

  return layout;
}

/** The hover label: a dot on each hovered line at the hovered hour, and a small box with the
 * hour and each hovered series' count. */
function drawHoverLabel(ctx: CanvasRenderingContext2D, layout: ChartLayout, hovered: ChartSeries[], hour: number, index: number, w: number): void {
  if (!hovered.length) {
    return;
  }

  const d = new Date(hour);
  const lines = [`${String(d.getHours()).padStart(2, '0')}:00`, ...hovered.map((s) => `${s.name}: ${s.values[index] || 0}`)];
  const x0 = chartPoint(layout, index, 0).x;

  for (const s of hovered) {
    const p = chartPoint(layout, index, s.values[index] || 0);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = '11px Consolas, monospace';
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const boxH = lines.length * 15 + 8;
  const topY = Math.min(...hovered.map((s) => chartPoint(layout, index, s.values[index] || 0).y));
  let bx = x0 + 12;

  if (bx + boxW > w - 4) {
    bx = x0 - 12 - boxW;
  }

  const by = Math.max(layout.top + 2, Math.min(topY - boxH / 2, layout.top + layout.plotH - boxH - 2));

  ctx.fillStyle = 'rgba(20,10,32,.92)';
  ctx.strokeStyle = '#6b4a86';
  ctx.lineWidth = 1;
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeRect(bx, by, boxW, boxH);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? '#c9a6e6' : hovered[i - 1]!.color;
    ctx.fillText(line, bx + 8, by + 5 + i * 15);
  });
}
