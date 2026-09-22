import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { visibleRect } from '../game/dom-geometry';
import { randomPointInBigCookie } from '../hunting/click-big-cookie';
import type { BackgroundClock } from '../input/background-clock';
import type { CursorController, MoveCursorOpts } from '../input/cursor-controller';
import { dispatchMove } from '../input/dispatch';
import type { ClickTiming } from '../input/human-click';
import type { PendingWork } from './pending-work';

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

/** While nothing else needs doing, the paw ponders around: it drifts, visits things on
 * screen, wiggles, and sometimes clicks the big cookie out of boredom. It never clicks
 * anything except the big cookie, and anything important interrupts it right away. */
export class IdleBehavior {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly cursorController: CursorController,
    private readonly clickTiming: ClickTiming,
    private readonly clock: BackgroundClock,
    private readonly pendingWork: PendingWork,
  ) {}

  /** Setting 'Paw idle speed' (default 320px/s, 60..2000). */
  getIdleSpeed(): number {
    return clamp(Number(this.data.config.idleSpeedPxPerSec) || 320, 60, 2000);
  }

  /** Options for moveCursorTo() during idle play: slow speed, up to 6s per move, abort on
   * real work. */
  idleMoveOpts(extra?: Partial<MoveCursorOpts>): MoveCursorOpts {
    return { speed: this.getIdleSpeed(), maxMs: 6000, abortIf: () => this.pendingWork.isPending(), ...extra };
  }

  /** Short interruptible pause between idle clicks. */
  idleDwell(minMs: number, maxMs: number): Promise<boolean> {
    return this.clickTiming.waitUntil(Date.now() + minMs + Math.random() * (maxMs - minMs), true, () => this.pendingWork.isPending());
  }

  /** Very slow figure-eights (lemniscate) around the current position with a bit of hand
   * jitter and a slow drift of the centre, so the paw never sits perfectly still. Eases in so
   * it starts exactly where it is. Runs for holdMs or until real work is pending. */
  ponder(holdMs: number): Promise<boolean> {
    const TAU = Math.PI * 2;
    const cx0 = this.runtime.cursor.x;
    const cy0 = this.runtime.cursor.y;

    const amp = randBetween(11, 24);
    const rot = Math.random() * Math.PI;
    const period = randBetween(9000, 16000); // ms per eight

    const ph = [0, 1, 2, 3, 4, 5].map(() => Math.random() * TAU);

    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const startTs = performance.now();
    const endAt = startTs + holdMs;

    return new Promise<boolean>((resolve) => {
      const frame = (ts: number) => {
        if (this.runtime.destroyed || !this.runtime.running || this.pendingWork.isPending()) {
          resolve(false);
          return;
        }

        if (ts >= endAt) {
          resolve(true);
          return;
        }

        const t = ts - startTs;

        // ease everything in so it starts exactly where it is
        const k = Math.min(1, t / 1500);

        // slightly uneven pace, so the eights look hand-drawn
        const theta = (TAU * t) / period + 0.35 * (Math.sin((TAU * t) / (period * 1.7) + ph[0]!) - Math.sin(ph[0]!));
        const a = amp * (1 + 0.18 * Math.sin((TAU * t) / (period * 2.3) + ph[1]!));

        // figure eight (lemniscate of Gerono)
        const ex = a * Math.sin(theta);
        const ey = a * 0.9 * Math.sin(theta) * Math.cos(theta);

        const rx = ex * cosR - ey * sinR;
        const ry = ex * sinR + ey * cosR;

        // slow drift of the centre + fine jitter
        const drx = 3 * (Math.sin((TAU * t) / (period * 3.1) + ph[2]!) - Math.sin(ph[2]!));
        const dry = 3 * (Math.sin((TAU * t) / (period * 2.7) + ph[3]!) - Math.sin(ph[3]!));

        const jx = 0.6 * Math.sin(t / 173 + ph[4]!) + 0.4 * Math.sin(t / 61 + ph[5]!);
        const jy = 0.6 * Math.sin(t / 149 + ph[5]!) + 0.4 * Math.sin(t / 53 + ph[4]!);

        this.runtime.cursor.x = clamp(cx0 + k * (rx + drx + jx), 2, window.innerWidth - 2);
        this.runtime.cursor.y = clamp(cy0 + k * (ry + dry + jy), 2, window.innerHeight - 2);

        dispatchMove(this.runtime, this.runtime.cursor.x, this.runtime.cursor.y);

        this.clock.nextFrame(frame);
      };

      this.clock.nextFrame(frame);
    });
  }

  /** Ponders for a random time in [minMs, maxMs] and shows it in the HUD ('drawing eights'). */
  idleHold(minMs: number, maxMs: number): Promise<boolean> {
    this.runtime.currentAction = 'idle-play';
    this.runtime.currentTarget = 'drawing eights';

    return this.ponder(randBetween(minMs, maxMs));
  }

  /** Arcs over to something on screen (look only), then ponders there. */
  async idleVisit(): Promise<void> {
    const spot = pickIdleSpot();
    if (!spot) return;

    this.runtime.currentAction = 'idle-play';
    this.runtime.currentTarget = `sniffing ${spot.label}`;

    if (!(await this.cursorController.moveCursorTo(spot.x, spot.y, true, this.idleMoveOpts()))) {
      return;
    }

    await this.idleHold(IDLE_HOLD_MS[0], IDLE_HOLD_MS[1]);
  }

  /** Drifts to a random spot on screen, then ponders there. */
  async idleDrift(): Promise<void> {
    this.runtime.currentAction = 'idle-play';
    this.runtime.currentTarget = 'drifting about';

    const x = window.innerWidth * (0.1 + Math.random() * 0.8);
    const y = window.innerHeight * (0.12 + Math.random() * 0.76);

    if (!(await this.cursorController.moveCursorTo(x, y, true, this.idleMoveOpts()))) {
      return;
    }

    await this.idleHold(IDLE_HOLD_MS[0], IDLE_HOLD_MS[1]);
  }

  /** Sometimes the paw gets bored and pokes the big cookie 1-3 times (then ponders). Uses the
   * same click delay and pre-click pause as every other click; interruptible. */
  async idleBoredClick(): Promise<void> {
    const clicks = 1 + Math.floor(Math.random() * 3);

    for (let i = 0; i < clicks; i++) {
      if (this.pendingWork.isPending()) {
        return;
      }

      this.runtime.currentAction = 'bored-click';
      this.runtime.currentTarget = 'the big cookie';

      if (!(await this.clickTiming.waitForClickGap(true, () => this.pendingWork.isPending()))) {
        return;
      }

      const point = randomPointInBigCookie();
      if (!point) return;

      if (!(await this.cursorController.moveCursorTo(point.x, point.y, true, this.idleMoveOpts()))) {
        return;
      }

      if (!(await this.clickTiming.waitPreClick(true, () => this.pendingWork.isPending()))) {
        return;
      }

      if (this.pendingWork.isPending() || !point.el.isConnected) {
        return;
      }

      await this.clickTiming.humanClick(point.el, point.x, point.y);

      if (i < clicks - 1 && !(await this.idleDwell(350, 1100))) {
        return;
      }
    }

    await this.idleHold(5000, 12000);
  }

  /** Idle task: one activity per call (22% bored clicks, 53% visit, 25% drift), or - right
   * after real work - ponder in place first. Always ends with a short gap before the next
   * call. */
  async idleWander(): Promise<void> {
    this.runtime.currentAction = 'idle-play';
    this.runtime.currentTarget = 'nothing yet';

    try {
      if (this.runtime.idleStay) {
        // Right after real work: stay put and ponder first.
        this.runtime.idleStay = false;
        await this.idleHold(5000, 12000);
        return;
      }

      const roll = Math.random();

      if (roll < 0.22) {
        await this.idleBoredClick();
      } else if (roll < 0.75) {
        await this.idleVisit();
      } else {
        await this.idleDrift();
      }
    } finally {
      this.runtime.nextIdleAt = Date.now() + 150;
    }
  }
}
