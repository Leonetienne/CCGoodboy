import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import { drawRect } from '../rendering/overlay-canvas';
import { autoStoreElement, buyRankColor, type AutoPlayEngine } from './shopping';

/** Draws the "how good is a buy" bounding box on every purchase option (on by default, works
 * without auto play): colour = how good it is RELATIVE TO THE OTHERS on offer right now (red =
 * worst payback on offer, green = best), so it re-ranks itself as the store changes. Ranked on
 * a LOG scale: paybacks span orders of magnitude (seconds to days), and a single very bad
 * option would otherwise squash every other option into looking equally "best" on a linear
 * scale. */
export function drawBuyValueOverlay(ctx: CanvasRenderingContext2D, game: IGameAdapter, autoPlay: AutoPlayEngine): void {
  const snap = autoPlay.buyValueSnapshot();

  if (!snap || !snap.decision.rows.length) return;

  const logPaybacks = snap.decision.rows.map((row) => Math.log(Math.max(row.payback, 0.001)));
  const best = Math.min(...logPaybacks);
  const worst = Math.max(...logPaybacks);
  const span = worst - best;

  for (const row of snap.decision.rows) {
    const el = autoStoreElement(game, row.c);
    const r = el ? visibleRect(el) : null;

    if (!r) continue;

    // 0 = worst on offer, 1 = best on offer (lower payback is better)
    const rank = span > 0 ? Math.max(0, Math.min(1, (worst - Math.log(Math.max(row.payback, 0.001))) / span)) : 1;
    const color = buyRankColor(rank);

    drawRect(ctx, r, color, 1.6, [4, 3]);

    // Score 0 (worst on offer) to 100 (best on offer), centred IN the box so it can never
    // overlap a neighbour's number the way a label floating above it could.
    const score = Math.round(rank * 100);

    ctx.save();
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(40,15,55,.9)';
    ctx.strokeText(String(score), r.left + r.width / 2, r.top + r.height / 2);
    ctx.fillStyle = color;
    ctx.fillText(String(score), r.left + r.width / 2, r.top + r.height / 2);
    ctx.restore();
  }
}
