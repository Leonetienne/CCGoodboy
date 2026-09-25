import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import type { HeavenlyUpgradeInfo } from '../game/types';
import { drawRect, type LooseRectLike } from '../rendering/overlay-canvas';
import { formatNum, formatShort } from '../ui/format';
import type { CursorPoint } from '../core/runtime-state';
import { compactLine, heavenScreenLines, planLines, type AscensionPlanner } from './ascension';
import type { AscensionPlan, AscensionVerdict } from './ascension-strategy';
import { LUCKY_UPGRADES, type HeavenlyShopPlan } from './heavenly-shopping';

const VERDICT_COLOR: Record<AscensionVerdict, string> = {
  ascend: 'rgba(255,215,90,.98)',
  waiting: 'rgba(255,170,80,.95)',
  'too-small': 'rgba(196,170,255,.7)',
  growing: 'rgba(150,215,255,.95)',
  'no-gain': 'rgba(196,170,255,.7)',
};

const LUCKY_COLOR = 'rgba(255,215,90,.98)';
const BUYABLE_COLOR = 'rgba(120,230,140,.98)';
const PRICEY_COLOR = 'rgba(255,170,80,.95)';
const GHOST_COLOR = 'rgba(255,110,110,.8)';
const OWNED_COLOR = 'rgba(196,170,255,.5)';
const PLANNED_COLOR = 'rgba(255,143,207,.98)';

/** The Legacy card (ASC-6): the same lines as the HUD row (planLines, ASC-5), then the Paw
 * line (ASC-11). */
export function legacyLabelLines(p: AscensionPlan, botLine = ''): string[] {
  return botLine ? [...planLines(p), botLine] : planLines(p);
}

/** ASC-6/ASC-7: the Legacy button with the level after ascending and the plan, or on the
 * ascension screen every heavenly upgrade's hitbox plus the Reincarnate button. `botLine`:
 * what the bot does about it (ASC-11), '' for none. */
export function drawAscensionOverlay(
  ctx: CanvasRenderingContext2D,
  game: IGameAdapter,
  planner: AscensionPlanner,
  botLine: string,
  mouse: CursorPoint | null,
): void {
  if (game.onAscendScreen()) {
    drawHeavenlyTree(ctx, game, planner.shoppingNow(), botLine);
    return;
  }

  if (game.isAscending()) return;

  const r = visibleRect(document.getElementById('legacyButton'));
  const p = r ? planner.plan() : null;
  if (!r || !p) return;

  // The game shows its own tooltip over the Legacy button: get out of its way while hovered.
  if (mouse && inside(mouse, r, 0)) {
    lastCard = null;
    return;
  }

  const color = VERDICT_COLOR[p.verdict];

  if (p.verdict === 'ascend') drawRect(ctx, r, color, 3);
  else drawRect(ctx, r, color, 2, [5, 4]);

  // Collapsed to the level after ascending; the full card while the real mouse is over the
  // card itself (the canvas takes no mouse events, so this uses the tracked real mouse
  // position; the open card covers where the collapsed one was, so it stays open while the
  // mouse is on it). Right-anchored to the Legacy frame so it grows to the left, never into
  // the store.
  const open = !!mouse && !!lastCard && inside(mouse, lastCard, 4);
  const lines = open ? legacyLabelLines(p, botLine) : [compactLine(p)];

  lastCard = drawLabel(ctx, lines, r, color, 'right');
}

/** Where the Legacy card was drawn last frame (collapsed or open): hovering it opens it. */
let lastCard: LooseRectLike | null = null;

function inside(pt: CursorPoint, r: LooseRectLike, pad: number): boolean {
  return pt.x >= r.left - pad && pt.x <= r.left + r.width + pad && pt.y >= r.top - pad && pt.y <= r.top + r.height + pad;
}

function drawHeavenlyTree(ctx: CanvasRenderingContext2D, game: IGameAdapter, shop: HeavenlyShopPlan | null, botLine: string): void {
  const chips = game.getHeavenlyChips();
  const order = new Map((shop ? shop.items : []).map((item, i) => [item.name, i + 1]));

  for (const up of game.getHeavenlyUpgrades()) {
    const r = visibleRect(document.getElementById(`heavenlyUpgrade${up.id}`));
    if (!r) continue;

    // On the shopping list (ASC-9): a thick pink box and its place in the buying order.
    const planned = order.get(up.name);
    const { color, width, dash } = planned ? { color: PLANNED_COLOR, width: 3, dash: undefined } : heavenlyStyle(up, chips);

    drawRect(ctx, r, color, width, dash);
    if (planned) drawTag(ctx, String(planned), r.left + r.width / 2, r.top - 9, color);

    if (!up.bought) {
      const lucky = LUCKY_UPGRADES.find((l) => l.name === up.name);
      const text = lucky && !up.canBePurchased ? `${lucky.sevens}x 7` : formatShort(up.price);
      drawTag(ctx, text, r.left + r.width / 2, r.bottom + 9, color);
    }
  }

  const reincarnate = visibleRect(document.getElementById('ascendButton'));

  if (reincarnate) {
    drawRect(ctx, reincarnate, OWNED_COLOR, 2, [5, 4]);
    const lines = [...(shop ? heavenScreenLines(shop, chips) : [`you have ${formatNum(chips)} chips`]), ...(botLine ? [botLine] : [])];
    drawLabel(ctx, lines, reincarnate, shop && shop.items.length ? PLANNED_COLOR : OWNED_COLOR);
  }
}

/** Box style of one heavenly upgrade: owned, lucky, buyable now, too pricey, or not
 * available (a parent missing, or a lucky one without enough 7s). */
export function heavenlyStyle(up: HeavenlyUpgradeInfo, chips: number): { color: string; width: number; dash?: number[] } {
  if (up.bought) return { color: OWNED_COLOR, width: 1 };

  const lucky = LUCKY_UPGRADES.some((l) => l.name === up.name);
  const affordable = up.price <= chips;

  if (lucky) return up.canBePurchased && affordable ? { color: LUCKY_COLOR, width: 3 } : { color: LUCKY_COLOR, width: 2, dash: [4, 3] };
  if (!up.canBePurchased) return { color: GHOST_COLOR, width: 1, dash: [3, 3] };
  if (affordable) return { color: BUYABLE_COLOR, width: 2 };

  return { color: PRICEY_COLOR, width: 1.6, dash: [4, 3] };
}

/** Small outlined text centred at (x, y). */
function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.save();
  ctx.font = 'bold 11px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(40,15,55,.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A few lines on a dark plum card right under `r` (above it if there's no room below), kept
 * inside the window: centred on `r`, or with its right edge on `r`'s right edge. */
function drawLabel(ctx: CanvasRenderingContext2D, lines: string[], r: LooseRectLike, color: string, align: 'center' | 'right' = 'center'): LooseRectLike {
  const lineH = 15;
  const pad = 6;

  ctx.save();
  ctx.font = 'bold 12px Consolas, monospace';

  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lineH + pad * 2 - 3;

  const want = align === 'right' ? r.left + r.width - w : r.left + r.width / 2 - w / 2;
  const x = Math.max(4, Math.min(window.innerWidth - w - 4, want));
  const below = r.top + r.height + 8;
  const y = below + h <= window.innerHeight - 4 ? below : Math.max(4, r.top - 8 - h);

  ctx.fillStyle = 'rgba(40,15,55,.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, 8);
  else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.fillStyle = i === 0 ? color : '#ffe6f5';
    ctx.fillText(line, x + pad, y + pad + i * lineH);
  });

  ctx.restore();

  return { left: x, top: y, width: w, height: h };
}
