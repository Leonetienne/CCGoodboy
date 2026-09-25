import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import { drawRect } from '../rendering/overlay-canvas';
import { autoStoreElement, buyRankColor, type AutoPlayEngine } from './shopping';
import type { Decision, DecisionRow } from './strategy';

/** The overlay's rank per option, 0 (worst on offer) to 1 (best), following what the bot
 * wants to buy (BUY-2): the tick's pick and every preferred option (the Bingo center, golden
 * upgrades, the cursor doublers, Wizard towers below their target, AUTO-4 B) rank 1; the rest
 * by payback on a log scale among themselves, so a preferred option with a slow payback
 * doesn't squash their scale. Pure. */
export function buyValueRanks(d: Pick<Decision, 'rows' | 'buy'>): Map<DecisionRow, number> {
  const wanted = (row: DecisionRow) => row.c === d.buy || (row.c.pref ?? 0) > 0;
  const logPb = (row: DecisionRow) => Math.log(Math.max(row.payback, 0.001));

  const rest = d.rows.filter((row) => !wanted(row)).map(logPb);
  const best = Math.min(...rest);
  const worst = Math.max(...rest);
  const span = worst - best;

  const ranks = new Map<DecisionRow, number>();

  for (const row of d.rows) {
    ranks.set(row, wanted(row) || !(span > 0) ? 1 : Math.max(0, Math.min(1, (worst - logPb(row)) / span)));
  }

  return ranks;
}

/** Draws the "how good is a buy" bounding box on every purchase option (on by default, works
 * without auto play): colour = how much the bot wants it RELATIVE TO THE OTHERS on offer right
 * now (buyValueRanks(): its pick and preferred options green, the rest red = worst payback to
 * green = best), so it re-ranks itself as the store changes. Ranked on a LOG scale: paybacks
 * span orders of magnitude (seconds to days), and a single very bad option would otherwise
 * squash every other option into looking equally "best" on a linear scale. */
export function drawBuyValueOverlay(ctx: CanvasRenderingContext2D, game: IGameAdapter, autoPlay: AutoPlayEngine): void {
  const snap = autoPlay.buyValueSnapshot();

  if (!snap || !snap.decision.rows.length) return;

  const ranks = buyValueRanks(snap.decision);

  for (const row of snap.decision.rows) {
    const el = autoStoreElement(game, row.c);
    const r = el ? visibleRect(el) : null;

    if (!r) continue;

    // 0 = worst on offer, 1 = what the bot wants most
    const rank = ranks.get(row) ?? 0;
    const color = buyRankColor(rank);

    // The intended next purchase gets a solid, much thicker box: the imminent buy (affordable
    // now, about to be clicked) and/or what is being saved up for.
    if (row.c === snap.decision.buy || row.c === snap.decision.save) {
      drawRect(ctx, r, color, 5);
    } else {
      drawRect(ctx, r, color, 1.6, [4, 3]);
    }

    // Score 0 (worst on offer) to 100 (what the bot wants most), centred IN the box so it can never
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
