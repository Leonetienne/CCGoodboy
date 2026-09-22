export interface LooseRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Sizes a full-window overlay canvas to the window (device-pixel aware) and resets its
 * transform so drawing coordinates stay in CSS pixels. */
export function resizeOverlayCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Strokes a rectangle outline (optionally dashed) around an element's rect. */
export function drawRect(ctx: CanvasRenderingContext2D, r: LooseRectLike, color: string, width?: number, dash?: number[]): void {
  ctx.save();

  ctx.strokeStyle = color;
  ctx.lineWidth = width || 2;

  if (dash) {
    ctx.setLineDash(dash);
  }

  ctx.strokeRect(Math.round(r.left) - 2, Math.round(r.top) - 2, Math.round(r.width) + 4, Math.round(r.height) + 4);

  ctx.restore();
}
