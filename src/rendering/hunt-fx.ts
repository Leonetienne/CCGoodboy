import type { CursorPoint } from '../core/runtime-state';
import type { RawBuff } from '../game/types';

/** One thing that happened while hunting, handed from the catching action to the show
 * (FX-3/FX-4). Queued on RuntimeState.huntFxEvents and drained by HuntFx every frame. */
export interface HuntFxEvent {
  kind: 'catch' | 'miss';
  x: number;
  y: number;
  /** Pretty effect name ('Lucky', 'Click Frenzy', 'Reindeer', ...), '' for a miss. */
  label: string;
  reindeer: boolean;
  /** A cookie storm drop: a small burst only, no judgement text and no flash. */
  small: boolean;
  /** performance.now() when it happened. */
  t: number;
}

/** A catchable shimmer on screen, as the show sees it. */
export interface HuntFxTarget {
  id: number;
  x: number;
  y: number;
  /** Half the larger side of its box. */
  r: number;
  reindeer: boolean;
}

/** What the show needs to know each frame (FX-1). */
export interface HuntFxFrame {
  now: number;
  /** The queued good shimmers in route order (their index is the osu! number). */
  queue: HuntFxTarget[];
  /** Still fading in, with their fade curve 0..1. */
  pending: Array<HuntFxTarget & { curve: number }>;
  /** Date.now() when each good shimmer became ready (GC-4). */
  readyAt: Map<number, number>;
  /** How long from ready to the click, roughly (click delay + pre-click pause + a trip). */
  leadMs: number;
  cursor: CursorPoint;
  storm: boolean;
  chain: number;
  /** prefers-reduced-motion: no flashes, no sweeping beams (FX-6). */
  reducedMotion: boolean;
  /** The CpS multiplier of every active buff together (FX-4, `buffMultiplier()`). */
  multiplier: number;
}

/** Longest the queue of unseen events may grow (e.g. while the overlay is off). */
export const HUNT_FX_MAX_EVENTS = 32;
/** Events older than this when drawn (a background tab coming back) are dropped. */
export const HUNT_FX_EVENT_MAX_AGE_MS = 1000;
/** Most particles alive at once (FX-7). */
export const HUNT_FX_MAX_PARTICLES = 500;
/** Two screen flashes are at least this far apart: never more than ~3 a second (FX-6). */
export const HUNT_FX_FLASH_GAP_MS = 350;
/** The combo counter resets silently after this long without a catch (FX-4). */
export const HUNT_FX_COMBO_RESET_MS = 60000;
/** How long the multiplier counter stays after a catch or a change (FX-4); the last second
 * it fades out. */
export const HUNT_FX_MULT_SHOW_MS = 8000;
/** The light show keeps glowing this long after the last catch. */
const AFTERGLOW_MS = 2500;
/** Beat of the light show's pulse (140 BPM). */
const BEAT_MS = 60000 / 140;

/** osu!-like combo colours in the UI-7 palette: pink, baby blue, lavender, gold. */
const COMBO_HUES = [325, 200, 265, 45];

/** Queues an event for the show, dropping the oldest beyond HUNT_FX_MAX_EVENTS. */
export function pushHuntFxEvent(queue: HuntFxEvent[], ev: HuntFxEvent): void {
  queue.push(ev);

  while (queue.length > HUNT_FX_MAX_EVENTS) {
    queue.shift();
  }
}

/** osu! approach circle: its radius as a multiple of the hit circle's, from 3.5 at the moment
 * the cookie became ready down to 1 when the paw should be there (FX-2). */
export function approachScale(readyAt: number, leadMs: number, now: number): number {
  const p = leadMs > 0 ? Math.min(1, Math.max(0, (now - readyAt) / leadMs)) : 1;
  return 1 + 2.5 * (1 - p);
}

/** The judgement text shown on a catch (FX-3). */
export function judgementText(label: string, reindeer: boolean): string {
  if (reindeer) return 'HO HO HO!!';

  const name = (label || '').trim();
  if (!name || name.toLowerCase() === 'unknown') return 'GEWD!!';

  const bangs = /click frenzy|elder frenzy|dragonflight|cookie chain|cookie storm$/i.test(name) ? '!!!' : '!!';
  return name.toUpperCase() + bangs;
}

/** FX-4: the CpS multiplier of every active buff together (Frenzy 7, Frenzy + Building
 * special 7 × N, Clot 0.5, ...): the product of each buff's `multCpS`. 1 without buffs. */
export function buffMultiplier(buffs: Record<string, RawBuff> | null | undefined): number {
  let m = 1;

  for (const k of Object.keys(buffs || {})) {
    const v = Number(buffs![k]?.multCpS);
    if (Number.isFinite(v) && v > 0) m *= v;
  }

  return m;
}

/** The multiplier as the counter shows it: "7x", "0.5x", "1,666x", "1.2e+9x". */
export function multiplierText(m: number): string {
  if (!Number.isFinite(m)) return '?x';
  if (m >= 1e9) return m.toExponential(1) + 'x';
  if (m >= 100) return Math.round(m).toLocaleString('en-US') + 'x';
  return String(Math.round(m * 100) / 100) + 'x';
}

/** Hue for the n-th thing in a combo (0-based). */
export function comboHue(n: number): number {
  return COMBO_HUES[((n % COMBO_HUES.length) + COMBO_HUES.length) % COMBO_HUES.length]!;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  hue: number;
  size: number;
  kind: 'spark' | 'snow' | 'star';
  spin: number;
}

interface Ring {
  x: number;
  y: number;
  born: number;
  life: number;
  maxR: number;
  hue: number;
  width: number;
}

interface FloatText {
  x: number;
  y: number;
  born: number;
  life: number;
  text: string;
  sub: string;
  hue: number;
  miss: boolean;
}

/** The over-the-top hunting show (FX-*): an osu!-style layer on the overlay canvas while
 * golden cookies or reindeer are around. Purely cosmetic: it reads what the bot is doing and
 * never touches the game. Everything it draws multiplies the overlay opacity (UI-9). */
export class HuntFx {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  private trail: Array<{ x: number; y: number; t: number }> = [];
  private heat = 0;
  private lastFrame = 0;
  private lastCatchAt = -1e9;
  private lastFlashAt = -1e9;
  private flash: { x: number; y: number; at: number; hue: number } | null = null;
  /** The multiplier last shown and when it changed (the counter bumps then). */
  private shownMult = 1;
  private multBumpAt = -1e9;
  combo = 0;
  maxCombo = 0;

  /** Particles alive right now (for tests). */
  get particleCount(): number {
    return this.particles.length;
  }

  /** Takes the queued events: stale ones (older than HUNT_FX_EVENT_MAX_AGE_MS) are dropped
   * without a show. Empties the queue. */
  consume(queue: HuntFxEvent[], now: number): void {
    const events = queue.splice(0, queue.length);

    for (const ev of events) {
      if (now - ev.t > HUNT_FX_EVENT_MAX_AGE_MS) continue;

      if (ev.kind === 'catch') this.onCatch(ev, now);
      else this.onMiss(ev, now);
    }
  }

  private onCatch(ev: HuntFxEvent, now: number): void {
    if (now - this.lastCatchAt > HUNT_FX_COMBO_RESET_MS) {
      this.combo = 0;
    }

    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.lastCatchAt = now;

    const hue = comboHue(this.combo - 1);

    if (ev.small) {
      this.burst(now, ev.x, ev.y, 10, hue, 'spark', 220);
      this.rings.push({ x: ev.x, y: ev.y, born: now, life: 320, maxR: 46, hue, width: 3 });
      return;
    }

    this.burst(now, ev.x, ev.y, 42, hue, ev.reindeer ? 'snow' : 'spark', 520);
    this.burst(now, ev.x, ev.y, 8, 50, 'star', 260);
    this.rings.push({ x: ev.x, y: ev.y, born: now, life: 480, maxR: 110, hue, width: 6 });
    this.rings.push({ x: ev.x, y: ev.y, born: now + 90, life: 560, maxR: 170, hue: (hue + 60) % 360, width: 3 });
    this.texts.push({ x: ev.x, y: ev.y - 34, born: now, life: 1100, text: '300', sub: judgementText(ev.label, ev.reindeer), hue, miss: false });

    if (now - this.lastFlashAt >= HUNT_FX_FLASH_GAP_MS) {
      this.lastFlashAt = now;
      this.flash = { x: ev.x, y: ev.y, at: now, hue };
    }
  }

  private onMiss(ev: HuntFxEvent, now: number): void {
    this.texts.push({ x: ev.x, y: ev.y - 20, born: now, life: 900, text: 'X', sub: 'MISS', hue: 0, miss: true });
    this.combo = 0;
  }

  private burst(now: number, x: number, y: number, n: number, hue: number, kind: Particle['kind'], speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const v = speed * (0.35 + Math.random() * 0.75);

      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.25,
        born: now,
        life: 500 + Math.random() * 600,
        hue: kind === 'snow' ? 195 + Math.random() * 30 : (hue + Math.random() * 90 - 45 + 360) % 360,
        size: kind === 'star' ? 7 + Math.random() * 5 : 2 + Math.random() * 3.5,
        kind,
        spin: Math.random() * Math.PI * 2,
      });
    }

    if (this.particles.length > HUNT_FX_MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - HUNT_FX_MAX_PARTICLES);
    }
  }

  /** Advances the simulation to `now` (ms, performance.now()). */
  step(now: number, active: boolean, hurry: boolean): void {
    const dt = this.lastFrame ? Math.min(50, Math.max(0, now - this.lastFrame)) / 1000 : 0;
    this.lastFrame = now;

    const want = active || now - this.lastCatchAt < AFTERGLOW_MS ? (hurry ? 1.5 : 1) : 0;
    this.heat += (want - this.heat) * (1 - Math.exp(-dt / (want > this.heat ? 0.18 : 0.6)));
    if (this.heat < 0.003 && want === 0) this.heat = 0;

    this.particles = this.particles.filter((p) => now - p.born < p.life);

    for (const p of this.particles) {
      const drag = p.kind === 'snow' ? 2.2 : 3.2;
      p.vx *= Math.exp(-drag * dt);
      p.vy = p.vy * Math.exp(-drag * dt) + (p.kind === 'snow' ? 60 : 420) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 6;
    }

    this.rings = this.rings.filter((r) => now - r.born < r.life);
    this.texts = this.texts.filter((t) => now - t.born < t.life);

    if (this.flash && now - this.flash.at > 180) this.flash = null;
    if (now - this.lastCatchAt > HUNT_FX_COMBO_RESET_MS) this.combo = 0;
  }

  /** True while there is anything at all to draw. */
  busy(now: number): boolean {
    return this.heat > 0 || this.particles.length > 0 || this.rings.length > 0 || this.texts.length > 0;
  }

  /** The layer under the hitboxes: light show, follow points, approach circles (FX-1/FX-2). */
  drawBack(ctx: CanvasRenderingContext2D, f: HuntFxFrame): void {
    const base = ctx.globalAlpha;
    const heat = Math.min(1.5, this.heat);

    if (heat > 0.01) {
      this.drawLightShow(ctx, f, heat, base);
    }

    this.drawFollowPoints(ctx, f, base);
    this.drawPending(ctx, f, base);
    this.drawApproach(ctx, f, base);

    ctx.globalAlpha = base;
  }

  /** The layer over everything but the paw: trail, bursts, judgements, multiplier, banner (FX-3..5). */
  drawFront(ctx: CanvasRenderingContext2D, f: HuntFxFrame): void {
    const base = ctx.globalAlpha;
    const now = f.now;

    this.drawTrail(ctx, f, base);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const r of this.rings) {
      const k = (now - r.born) / r.life;
      if (k < 0) continue;

      const e = 1 - Math.pow(1 - k, 3);
      ctx.globalAlpha = base * (1 - k) * 0.9;
      ctx.strokeStyle = `hsl(${r.hue},100%,70%)`;
      ctx.lineWidth = r.width * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + e * r.maxR, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const p of this.particles) {
      const k = (now - p.born) / p.life;
      ctx.globalAlpha = base * Math.max(0, 1 - k);
      ctx.fillStyle = p.kind === 'snow' ? `hsl(${p.hue},80%,92%)` : `hsl(${p.hue},100%,68%)`;

      if (p.kind === 'star') {
        drawStar(ctx, p.x, p.y, p.size * (1 - k * 0.5), p.spin);
      } else if (p.kind === 'snow') {
        drawSnowflake(ctx, p.x, p.y, p.size + 2, p.spin, `hsl(${p.hue},80%,92%)`);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this.flash && !f.reducedMotion) {
      const k = (now - this.flash.at) / 180;
      const g = ctx.createRadialGradient(this.flash.x, this.flash.y, 0, this.flash.x, this.flash.y, Math.max(window.innerWidth, window.innerHeight));
      g.addColorStop(0, `hsla(${this.flash.hue},100%,85%,${0.22 * (1 - k)})`);
      g.addColorStop(1, 'hsla(0,0%,100%,0)');
      ctx.globalAlpha = base;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }

    ctx.restore();

    this.drawTexts(ctx, now, base);
    this.drawMultiplier(ctx, f, base);
    this.drawBanner(ctx, f, base);

    ctx.globalAlpha = base;
  }

  private drawLightShow(ctx: CanvasRenderingContext2D, f: HuntFxFrame, heat: number, base: number): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const t = f.now;
    const beat = 0.5 + 0.5 * Math.cos(((t % BEAT_MS) / BEAT_MS) * Math.PI * 2);
    const hueShift = (t / 20) % 360;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Edge glow pulsing on the beat, hue cycling.
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'hsla(0,0%,0%,0)');
    vg.addColorStop(1, `hsla(${hueShift},100%,60%,${(0.1 + 0.08 * beat) * Math.min(1, heat)})`);
    ctx.globalAlpha = base;
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // Sweeping spotlights from the bottom corners and the top (not with reduced motion).
    if (!f.reducedMotion) {
      const beams = heat > 1.05 ? 6 : 4;

      for (let i = 0; i < beams; i++) {
        const fromLeft = i % 2 === 0;
        const ox = i < 4 ? (fromLeft ? 0 : W) : W / 2;
        const oy = i < 4 ? (i < 2 ? H : 0) : i === 4 ? H : 0;
        const baseAngle = Math.atan2(H / 2 - oy, W / 2 - ox);
        const sweep = Math.sin(t / (1300 + i * 170) + i * 1.7) * (heat > 1.05 ? 0.75 : 0.5);
        const a = baseAngle + sweep;
        const len = Math.hypot(W, H);
        const spread = 0.07 + 0.03 * beat;
        const hue = (hueShift + i * 67) % 360;

        const g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
        g.addColorStop(0, `hsla(${hue},100%,70%,${0.16 * Math.min(1, heat)})`);
        g.addColorStop(1, `hsla(${hue},100%,70%,0)`);

        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
        ctx.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len);
        ctx.closePath();
        ctx.fill();
      }
    }

    // A soft spotlight on every cookie waiting to be caught.
    for (const q of f.queue) {
      const R = q.r * 3.2 + 10 * beat;
      const g = ctx.createRadialGradient(q.x, q.y, q.r * 0.4, q.x, q.y, R);
      g.addColorStop(0, `hsla(${q.reindeer ? 200 : 48},100%,75%,${0.28 * Math.min(1, heat)})`);
      g.addColorStop(1, 'hsla(0,0%,100%,0)');
      ctx.fillStyle = g;
      ctx.fillRect(q.x - R, q.y - R, R * 2, R * 2);
    }

    ctx.restore();
  }

  /** osu! follow points: little chevrons drifting from the paw along the planned route. */
  private drawFollowPoints(ctx: CanvasRenderingContext2D, f: HuntFxFrame, base: number): void {
    if (!f.queue.length) return;

    const pts = [{ x: f.cursor.x, y: f.cursor.y }, ...f.queue];
    const phase = (f.now / 600) % 1;

    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';

    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s]!;
      const b = pts[s + 1]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 60) continue;

      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const step = 36;
      const n = Math.floor((d - 40) / step);

      for (let i = 0; i < n; i++) {
        const u = (20 + (i + phase) * step) / d;
        if (u > 1 - 20 / d) break;

        const x = a.x + (b.x - a.x) * u;
        const y = a.y + (b.y - a.y) * u;
        const fade = Math.sin(Math.PI * u);

        ctx.globalAlpha = base * 0.85 * fade;
        ctx.strokeStyle = `hsl(${comboHue(s)},100%,78%)`;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(ang - 0.6) * 6, y - Math.sin(ang - 0.6) * 6);
        ctx.lineTo(x, y);
        ctx.lineTo(x - Math.cos(ang + 0.6) * 6, y - Math.sin(ang + 0.6) * 6);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /** Pending (fading-in) cookies: a spinning dotted ring that fills up with the fade. */
  private drawPending(ctx: CanvasRenderingContext2D, f: HuntFxFrame, base: number): void {
    ctx.save();
    ctx.lineWidth = 3;

    for (const p of f.pending) {
      const R = p.r + 14;
      const spin = f.now / 400;

      ctx.globalAlpha = base * 0.5;
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = 'hsl(265,100%,85%)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, spin, spin + Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = base * 0.9;
      ctx.setLineDash([]);
      ctx.strokeStyle = 'hsl(265,100%,80%)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, p.curve)));
      ctx.stroke();
    }

    ctx.restore();
  }

  /** Hit circles with their route number and shrinking approach circles (FX-2). */
  private drawApproach(ctx: CanvasRenderingContext2D, f: HuntFxFrame, base: number): void {
    const readyNow = Date.now();

    f.queue.forEach((q, i) => {
      const hue = q.reindeer ? 200 : comboHue(this.combo + i);
      const R = q.r + 10;
      const readyAt = f.readyAt.get(q.id) ?? readyNow;
      const scale = approachScale(readyAt, f.leadMs, readyNow);
      const arrived = scale <= 1.001;
      const beat = arrived ? 0.5 + 0.5 * Math.sin(f.now / 90) : 0;

      ctx.save();

      // hit circle
      ctx.globalAlpha = base * 0.32;
      ctx.fillStyle = `hsl(${hue},100%,62%)`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = base;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.shadowColor = `hsl(${hue},100%,65%)`;
      ctx.shadowBlur = 14;
      ctx.stroke();

      // approach circle
      ctx.lineWidth = arrived ? 2 + 3 * beat : 3;
      ctx.strokeStyle = `hsl(${hue},100%,${arrived ? 75 + 15 * beat : 72}%)`;
      ctx.globalAlpha = base * Math.min(1, 0.35 + (3.5 - scale) / 2.5);
      ctx.beginPath();
      ctx.arc(q.x, q.y, R * scale + (arrived ? 4 * beat : 0), 0, Math.PI * 2);
      ctx.stroke();

      // route number (the same as over the GC-2 box), osu! style, in the middle of the circle
      ctx.shadowBlur = 0;
      ctx.globalAlpha = base * 0.9;
      ctx.font = `bold ${Math.round(Math.max(16, Math.min(34, R * 0.8)))}px "Comic Sans MS", "Trebuchet MS", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(40,10,60,.85)';
      ctx.strokeText(String(i), q.x, q.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i), q.x, q.y);

      ctx.restore();
    });
  }

  /** Rainbow glow trail behind the paw while the show is on. */
  private drawTrail(ctx: CanvasRenderingContext2D, f: HuntFxFrame, base: number): void {
    const now = f.now;
    const last = this.trail[this.trail.length - 1];

    if (this.heat > 0.05 && (!last || Math.hypot(last.x - f.cursor.x, last.y - f.cursor.y) > 2)) {
      this.trail.push({ x: f.cursor.x, y: f.cursor.y, t: now });
    }

    this.trail = this.trail.filter((p) => now - p.t < 260).slice(-40);
    if (this.trail.length < 2) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let i = 1; i < this.trail.length; i++) {
      const p = this.trail[i]!;
      const q = this.trail[i - 1]!;
      const k = 1 - (now - p.t) / 260;

      ctx.globalAlpha = base * k * 0.8 * Math.min(1, this.heat);
      ctx.strokeStyle = `hsl(${(now / 4 + i * 12) % 360},100%,70%)`;
      ctx.lineWidth = 2 + 8 * k;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawTexts(ctx: CanvasRenderingContext2D, now: number, base: number): void {
    for (const t of this.texts) {
      const k = (now - t.born) / t.life;
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.7 : 1.3 - Math.min(0.3, (k - 0.12) * 1.5);
      const y = t.y - k * 40;

      ctx.save();
      ctx.globalAlpha = base * (k > 0.7 ? (1 - k) / 0.3 : 1);
      ctx.translate(t.x, y);
      ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      ctx.font = 'bold 30px "Comic Sans MS", "Trebuchet MS", sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(40,10,60,.9)';
      ctx.fillStyle = t.miss ? 'hsl(0,100%,62%)' : `hsl(${t.hue},100%,72%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 16;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillText(t.text, 0, 0);

      if (t.sub) {
        ctx.font = 'bold 15px "Comic Sans MS", "Trebuchet MS", sans-serif';
        ctx.lineWidth = 4;
        ctx.fillStyle = t.miss ? 'hsl(0,100%,80%)' : `hsl(${(now / 3) % 360},100%,78%)`;
        ctx.strokeText(t.sub, 0, 24);
        ctx.fillText(t.sub, 0, 24);
      }

      ctx.restore();
    }
  }

  /** FX-4: the buffs' total CpS multiplier bottom left, where osu! shows its combo ("7x"
   * during a Frenzy): gold above 1, red below 1 (Clot). Pops up for a moment after a catch or
   * when it changes, then fades out; hidden at 1. */
  private drawMultiplier(ctx: CanvasRenderingContext2D, f: HuntFxFrame, base: number): void {
    const now = f.now;
    const m = f.multiplier;

    if (Math.abs(m - this.shownMult) > 1e-9) {
      this.shownMult = m;
      this.multBumpAt = now;
    }

    if (!Number.isFinite(m) || Math.abs(m - 1) < 1e-9) return;

    const since = now - Math.max(this.lastCatchAt, this.multBumpAt);
    if (since >= HUNT_FX_MULT_SHOW_MS) return;

    const fade = Math.min(1, (HUNT_FX_MULT_SHOW_MS - since) / 1000);

    const bumpK = Math.max(0, 1 - (now - this.multBumpAt) / 220);
    const scale = 1 + 0.4 * bumpK;
    const debuff = m < 1;

    ctx.save();
    ctx.globalAlpha = base * fade;
    ctx.translate(24, window.innerHeight - 30);
    ctx.scale(scale, scale);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 54px "Comic Sans MS", "Trebuchet MS", sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(40,10,60,.9)';
    ctx.fillStyle = debuff ? 'hsl(0,100%,62%)' : `hsl(${45 + 10 * Math.sin(now / 250)},100%,${68 + 8 * bumpK}%)`;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 20 + 20 * bumpK;
    ctx.strokeText(multiplierText(m), 0, 0);
    ctx.fillText(multiplierText(m), 0, 0);
    ctx.restore();
  }

  /** Rainbow banner during a cookie storm or chain. */
  private drawBanner(ctx: CanvasRenderingContext2D, f: HuntFxFrame, base: number): void {
    const text = f.storm ? 'COOKIE STORM!!!' : f.chain > 0 ? `COOKIE CHAIN x${f.chain}!!` : '';
    if (!text) return;

    const W = window.innerWidth;
    const wob = Math.sin(f.now / 140) * 0.06;

    ctx.save();
    ctx.globalAlpha = base * 0.95;
    ctx.translate(W / 2, 70);
    ctx.rotate(wob);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px "Comic Sans MS", "Trebuchet MS", sans-serif';

    const w = ctx.measureText(text).width || 300;
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    const shift = (f.now / 8) % 360;

    for (let i = 0; i <= 6; i++) {
      g.addColorStop(i / 6, `hsl(${(shift + i * 60) % 360},100%,70%)`);
    }

    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(40,10,60,.9)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = g;
    ctx.shadowColor = `hsl(${shift},100%,70%)`;
    ctx.shadowBlur = 24;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  ctx.beginPath();

  for (let i = 0; i < 10; i++) {
    const a = rot + (Math.PI * i) / 5;
    const rr = i % 2 === 0 ? r : r * 0.42;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;

    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }

  ctx.closePath();
  ctx.fill();
}

function drawSnowflake(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();

  for (let i = 0; i < 3; i++) {
    const a = rot + (Math.PI * i) / 3;
    ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }

  ctx.stroke();
  ctx.restore();
}
