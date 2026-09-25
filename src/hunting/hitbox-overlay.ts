import { looseRect, visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import type { GoldenCookieModel, GoldenShimmers } from '../game/golden-cookie-model';
import { getFthofSpell } from '../game/grimoire';
import { drawRect } from '../rendering/overlay-canvas';
import type { CursorPoint } from '../core/runtime-state';
import type { GoldenQueue, GoldenQueueItem } from './golden-queue';

export interface HitboxOverlayDeps {
  game: IGameAdapter;
  goldenCookieModel: GoldenCookieModel;
  goldenQueue: GoldenQueue;
  cursor: CursorPoint;
}

/** What the overlay draws this frame: the classified shimmers and the planned route. */
export interface HuntSnapshot {
  shimmers: GoldenShimmers;
  queue: GoldenQueueItem[];
}

/** Classifies the live shimmers and plans the route once per frame, shared by the hitboxes
 * and the hunting show (FX-*). */
export function collectHunt(deps: HitboxOverlayDeps): HuntSnapshot {
  const shimmers = deps.goldenCookieModel.getGoldenShimmers();
  return { shimmers, queue: deps.goldenQueue.build(shimmers.good) };
}

/** Draws the golden-cookie hunting layer of the overlay: the planned route (dashed pink),
 * ready cookies (pink numbered boxes), pending cookies (dashed lavender + fade %), wrath
 * cookies (dashed red), a ring on the big cookie during Click Frenzy, and the real Grimoire
 * buttons. */
export function drawHitboxes(ctx: CanvasRenderingContext2D, deps: HitboxOverlayDeps, hunt: HuntSnapshot = collectHunt(deps)): void {
  const { game, cursor } = deps;
  const { shimmers, queue } = hunt;

  // Planned route in pink.
  if (queue.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,143,207,.85)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(cursor.x, cursor.y);

    for (const item of queue) {
      ctx.lineTo(item.pos.x, item.pos.y);
    }

    ctx.stroke();
    ctx.restore();
  }

  // Good cookies: pink hitboxes + numbers.
  queue.forEach((item, index) => {
    const r = visibleRect(item.shimmer.l);
    if (!r) return;

    drawRect(ctx, r, 'rgba(255,143,207,.98)', 2);

    ctx.save();
    ctx.font = 'bold 18px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(60,20,80,.9)';
    ctx.strokeText(String(index), r.left + r.width / 2, r.top - 10);
    ctx.fillStyle = 'rgb(255,143,207)';
    ctx.fillText(String(index), r.left + r.width / 2, r.top - 10);
    ctx.restore();
  });

  // Golden cookies still fading in: highlighted at once, but not queued (and never clicked)
  // until they pass the threshold.
  for (const item of shimmers.pending) {
    const r = looseRect(item.shimmer.l, 34);
    if (!r) continue;

    drawRect(ctx, r, 'rgba(196,170,255,.95)', 2, [3, 3]);

    const label = Math.round(item.curve * 100) + '%';

    ctx.save();
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(60,20,80,.9)';
    ctx.strokeText(label, r.left + r.width / 2, r.top - 8);
    ctx.fillStyle = 'rgb(196,170,255)';
    ctx.fillText(label, r.left + r.width / 2, r.top - 8);
    ctx.restore();
  }

  // Wrath cookies: red + dashed, never clicked.
  for (const shimmer of shimmers.wrath) {
    const r = looseRect(shimmer.l, 34);
    if (r) {
      drawRect(ctx, r, 'rgba(255,70,70,.95)', 2, [6, 4]);
    }
  }

  // Big cookie: baby blue during Click Frenzy.
  if (game.clickFrenzyActive()) {
    const big = document.getElementById('bigCookie');
    const r = visibleRect(big);

    if (r) {
      ctx.save();
      ctx.strokeStyle = 'rgba(150,215,255,.98)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Real Grimoire controls: baby blue.
  const M = game.getGrimoire();

  if (M) {
    const spell = getFthofSpell(M) as { id?: number } | null;
    const f = spell && spell.id != null ? visibleRect(document.getElementById(`grimoireSpell${spell.id}`)) : null;
    const refill = visibleRect(document.getElementById('grimoireLumpRefill'));

    if (f) {
      drawRect(ctx, f, 'rgba(150,215,255,.98)', 2);
    }

    if (refill) {
      drawRect(ctx, refill, 'rgba(150,215,255,.98)', 2);
    }
  }
}
