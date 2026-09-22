import pawOpenSvg from '../assets/paw-open.svg';
import pawClosedSvg from '../assets/paw-closed.svg';
import type { RuntimeState } from '../core/runtime-state';

const SPRITE_W = 892; // sprite size in its own units
const SPRITE_H = 1247;
const SPRITE_HX = 257; // click point (middle claw tip), after mirroring
const SPRITE_HY = 4;
const SPRITE_DRAW_H = 60; // on-screen height in css px

/** Click pulse: the paw shows the fist and shrinks to `scale` around its click point within
 * downMs, then springs back within upMs (~80ms in total). */
const CLICK_PULSE = { scale: 0.92, downMs: 25, upMs: 55 };

/** True from the press until the pulse is over (the fist is shown). */
export function clickPulseActive(pulseAt: number, now: number): boolean {
  const dt = now - pulseAt;
  return !!pulseAt && dt >= 0 && dt < CLICK_PULSE.downMs + CLICK_PULSE.upMs;
}

/** Scale factor of the click pulse at time `now` (1 when idle, CLICK_PULSE.scale at the
 * bottom). */
export function clickPulseScale(pulseAt: number, now: number): number {
  if (!pulseAt) return 1;

  const dt = now - pulseAt;

  if (dt < 0 || dt >= CLICK_PULSE.downMs + CLICK_PULSE.upMs) {
    return 1;
  }

  const k = dt < CLICK_PULSE.downMs ? dt / CLICK_PULSE.downMs : 1 - (dt - CLICK_PULSE.downMs) / CLICK_PULSE.upMs;

  return 1 - (1 - CLICK_PULSE.scale) * k;
}

/** The virtual paw cursor: rasterizes the open/closed SVG sprites once, leans into horizontal
 * movement, squishes on click, and falls back to a small hand-drawn paw until (or if) the
 * sprites are ready. */
export class PawCursor {
  private canvas: HTMLCanvasElement | null = null;
  private closedCanvas: HTMLCanvasElement | null = null;
  private loading = false;

  constructor(private readonly runtime: RuntimeState) {}

  /** Draws an SVG once into an offscreen canvas, mirrored so the paw faces left, and hands the
   * canvas to done(). */
  private rasterize(svg: string, done: (c: HTMLCanvasElement) => void): void {
    try {
      const img = new Image();

      img.onload = () => {
        try {
          const scale = Math.max(2, window.devicePixelRatio || 1);
          const ph = Math.round(SPRITE_DRAW_H * scale);
          const pw = Math.round((ph * SPRITE_W) / SPRITE_H);

          const c = document.createElement('canvas');
          c.width = pw;
          c.height = ph;

          const g = c.getContext('2d')!;

          // mirror: the paw faces left
          g.translate(pw, 0);
          g.scale(-1, 1);
          g.drawImage(img, 0, 0, pw, ph);

          done(c);
        } catch (e) {
          console.warn('[CC Good Boy] Could not prepare a paw sprite:', e);
        }
      };

      img.onerror = () => {
        console.warn('[CC Good Boy] A paw sprite failed to load.');
      };

      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (e) {
      console.warn('[CC Good Boy] Paw sprite error:', e);
    }
  }

  /** Rasterizes both paw sprites (open + closed) once at start. */
  load(): void {
    if (this.loading) return;
    this.loading = true;

    this.rasterize(pawOpenSvg, (c) => {
      this.canvas = c;
    });

    this.rasterize(pawClosedSvg, (c) => {
      this.closedCanvas = c;
    });
  }

  /** Leans into the direction of horizontal movement (smoothed, up to ~0.22rad), so the paw
   * never glides around perfectly upright. Updates runtime.lean once per frame. */
  updateLean(): void {
    const now = performance.now();

    const st = this.runtime.leanState || (this.runtime.leanState = { x: this.runtime.cursor.x, t: now });
    const dt = (now - st.t) / 1000;

    if (dt <= 0) return;

    const vx = (this.runtime.cursor.x - st.x) / dt;

    st.x = this.runtime.cursor.x;
    st.t = now;

    let target = 0;

    // ignore long gaps (e.g. hidden tab)
    if (dt < 0.25) {
      target = Math.sign(vx) * Math.min(1, Math.pow(Math.abs(vx) / 1800, 0.6)) * 0.22;
    }

    this.runtime.lean += (target - this.runtime.lean) * (1 - Math.exp(-dt / 0.09));
  }

  /** Draws the paw at (x, y) = its click point: translate, rotate (lean + dance tilt), scale
   * (click pulse), then the sprite twice (pink halo pass, dark drop-shadow pass). Uses the
   * fist while the click pulse runs. Falls back to a hand-drawn paw if the sprite isn't ready. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    if (!this.canvas) {
      this.drawFallback(ctx, x, y);
      return;
    }

    const h = SPRITE_DRAW_H;
    const w = (h * SPRITE_W) / SPRITE_H;

    // relative to the click point, so the paw can tilt around it
    const dx = -(SPRITE_HX / SPRITE_W) * w;
    const dy = -(SPRITE_HY / SPRITE_H) * h;

    // Canvas shadow sizes are in device pixels.
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.translate(x, y);

    const tilt = (this.runtime.cursorTilt || 0) + (this.runtime.lean || 0);

    if (tilt) {
      ctx.rotate(tilt);
    }

    const pulse = clickPulseScale(this.runtime.pulseAt, performance.now());

    if (pulse !== 1) {
      ctx.scale(pulse, pulse);
    }

    // the fist while the click pulse is running
    const sprite = clickPulseActive(this.runtime.pulseAt, performance.now()) && this.closedCanvas ? this.closedCanvas : this.canvas;

    // 1) strong pink halo: lifts the dark paw off dark backgrounds
    ctx.shadowColor = 'rgba(255,150,215,.95)';
    ctx.shadowBlur = 14 * dpr;
    ctx.drawImage(sprite, dx, dy, w, h);

    // 2) dark drop shadow: separates it from light backgrounds
    ctx.shadowColor = 'rgba(12,0,28,.85)';
    ctx.shadowBlur = 6 * dpr;
    ctx.shadowOffsetX = 3 * dpr;
    ctx.shadowOffsetY = 5 * dpr;
    ctx.drawImage(sprite, dx, dy, w, h);

    ctx.restore();
  }

  /** Small drawn paw, only used until (or if) the sprite is unavailable. */
  private drawFallback(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);

    const tilt = (this.runtime.cursorTilt || 0) + (this.runtime.lean || 0);

    if (tilt) {
      ctx.rotate(tilt);
    }

    const pulse = clickPulseScale(this.runtime.pulseAt, performance.now());

    if (pulse !== 1) {
      ctx.scale(pulse, pulse);
    }

    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#7a3f9d';
    ctx.fillStyle = '#ffb8de';
    ctx.shadowColor = 'rgba(255,120,190,.65)';
    ctx.shadowBlur = 6;

    const bean = (cx: number, cy: number, rx: number, ry: number, rot: number) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    // four toe beans
    bean(3.8, 9.4, 3, 3.9, -0.45);
    bean(9, 4.4, 3, 3.9, -0.15);
    bean(15.4, 4.4, 3, 3.9, 0.15);
    bean(20.6, 9.4, 3, 3.9, 0.45);

    // main pad
    bean(12.2, 18, 7.8, 6.3, 0);

    ctx.restore();
  }
}
