import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import { visibleRect } from '../game/dom-geometry';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { MoveCursorOpts } from '../input/cursor-controller';
import { randomPointInBigCookie } from './hammer';
import { PonderAction } from './ponder';

/** Things the paw likes to look at while idle (CSS selector, label, weight). Look only, never
 * clicked. */
export const IDLE_SPOTS = [
  { sel: '#bigCookie', label: 'the big cookie', w: 3 },
  { sel: '#products .product', label: 'a building', w: 4 },
  { sel: '#upgrades .upgrade', label: 'an upgrade', w: 3 },
  { sel: '#comments', label: 'the news ticker', w: 1 },
  { sel: '#cookies', label: 'the cookie counter', w: 1 },
];

/** How long the paw stays around one spot (pondering) before it picks somewhere else
 * [min, max] ms. */
export const IDLE_HOLD_MS: [number, number] = [14000, 34000];

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Setting 'Paw idle speed' (default 320px/s, 60..2000). */
export function getIdleSpeed(data: PersistedData): number {
  return clamp(Number(data.config.idleSpeedPxPerSec) || 320, 60, 2000);
}

/** A random spot on some visible thing on the page (weighted), or null. */
export function pickIdleSpot(): { label: string; x: number; y: number } | null {
  const groups: Array<{ spot: (typeof IDLE_SPOTS)[number]; els: Element[] }> = [];

  for (const spot of IDLE_SPOTS) {
    const els = Array.from(document.querySelectorAll(spot.sel)).filter((el) => visibleRect(el));

    if (els.length) {
      groups.push({ spot, els });
    }
  }

  if (!groups.length) {
    return null;
  }

  let roll = Math.random() * groups.reduce((a, g) => a + g.spot.w, 0);
  let group = groups[groups.length - 1]!;

  for (const g of groups) {
    roll -= g.spot.w;

    if (roll <= 0) {
      group = g;
      break;
    }
  }

  const el = group.els[Math.floor(Math.random() * group.els.length)]!;
  const r = visibleRect(el);

  if (!r) return null;

  return {
    label: group.spot.label,
    x: r.left + r.width * (0.25 + Math.random() * 0.5),
    y: r.top + r.height * (0.25 + Math.random() * 0.5),
  };
}

/** One continuous idle job: ponder in place after real work, or roll between a bored click,
 * a look-only visit and a random drift, then always end with a short gap. All cursor motion
 * goes through the ctx.cursor primitives (which the CursorManager owns), so the action never
 * writes runtime.cursor itself. */
export class IdleWanderAction implements CursorAction {
  readonly label = 'idle wander';
  readonly target = null;
  readonly waitClickGap = false;
  readonly preClickPause = false;
  readonly hud = { action: 'idle-play', target: 'nothing yet' };

  constructor(private readonly pending: () => boolean) {}

  private stop(ctx: CursorJobContext): boolean {
    return ctx.abortRequested() || this.pending();
  }

  private hold(ctx: CursorJobContext, minMs: number, maxMs: number): Promise<void> {
    return new PonderAction(randBetween(minMs, maxMs), () => this.stop(ctx), {
      fleeSpeed: getIdleSpeed(ctx.data),
    }).cursor_at_position(ctx);
  }

  private idleTravelOpts(ctx: CursorJobContext): MoveCursorOpts {
    return { speed: getIdleSpeed(ctx.data), maxMs: 6000, abortIf: () => this.stop(ctx) };
  }

  private async visit(ctx: CursorJobContext): Promise<void> {
    const spot = pickIdleSpot();
    if (!spot) return;

    ctx.runtime.currentAction = 'idle-play';
    ctx.runtime.currentTarget = `sniffing ${spot.label}`;

    if (!(await ctx.cursor.moveCursorTo(spot.x, spot.y, true, this.idleTravelOpts(ctx)))) {
      return;
    }

    await this.hold(ctx, IDLE_HOLD_MS[0], IDLE_HOLD_MS[1]);
  }

  private async drift(ctx: CursorJobContext): Promise<void> {
    ctx.runtime.currentAction = 'idle-play';
    ctx.runtime.currentTarget = 'drifting about';

    const x = window.innerWidth * (0.1 + Math.random() * 0.8);
    const y = window.innerHeight * (0.12 + Math.random() * 0.76);

    if (!(await ctx.cursor.moveCursorTo(x, y, true, this.idleTravelOpts(ctx)))) {
      return;
    }

    await this.hold(ctx, IDLE_HOLD_MS[0], IDLE_HOLD_MS[1]);
  }

  private async boredClick(ctx: CursorJobContext): Promise<void> {
    const clicks = 1 + Math.floor(Math.random() * 3);

    for (let i = 0; i < clicks; i++) {
      if (this.stop(ctx)) return;

      ctx.runtime.currentAction = 'bored-click';
      ctx.runtime.currentTarget = 'the big cookie';

      if (!(await ctx.clickTiming.waitForClickGap(true, () => this.stop(ctx)))) {
        return;
      }

      const point = randomPointInBigCookie();
      if (!point) return;

      if (!(await ctx.cursor.moveCursorTo(point.x, point.y, true, this.idleTravelOpts(ctx)))) {
        return;
      }

      if (!(await ctx.clickTiming.waitPreClick(true, () => this.stop(ctx)))) {
        return;
      }

      if (this.stop(ctx) || !point.el.isConnected) {
        return;
      }

      await ctx.clickTiming.humanClick(point.el, point.x, point.y);

      if (i < clicks - 1 && !(await ctx.clickTiming.waitUntil(Date.now() + 350 + Math.random() * 750, true, () => this.stop(ctx)))) {
        return;
      }
    }

    await this.hold(ctx, 5000, 12000);
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const runtime = ctx.runtime;
    runtime.currentAction = 'idle-play';
    runtime.currentTarget = 'nothing yet';

    try {
      if (runtime.idleStay) {
        // Right after real work: stay put and ponder first.
        runtime.idleStay = false;
        await this.hold(ctx, 5000, 12000);
        return;
      }

      const roll = Math.random();

      if (roll < 0.22) {
        await this.boredClick(ctx);
      } else if (roll < 0.75) {
        await this.visit(ctx);
      } else {
        await this.drift(ctx);
      }
    } finally {
      runtime.nextIdleAt = Date.now() + 150;
    }
  }
}
