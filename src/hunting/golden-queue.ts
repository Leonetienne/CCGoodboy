import { shimmerCenter } from '../game/dom-geometry';
import type { RuntimeState } from '../core/runtime-state';
import type { GameShimmer } from '../game/types';
import { planRoute } from '../routing/route-planner';

export interface GoldenQueueItem {
  shimmer: GameShimmer;
  pos: { x: number; y: number; rect: DOMRect };
}

/** The order in which the ready cookies get collected. The plan is cached in
 * runtime.route and only recomputed when the set (or position) of cookies changes or the
 * paw moved more than 80px, because this is asked for many times per frame (overlay, panel,
 * scheduler). */
export class GoldenQueue {
  constructor(private readonly runtime: RuntimeState) {}

  build(goodShimmers: GameShimmer[]): GoldenQueueItem[] {
    const items = goodShimmers
      .map((shimmer) => ({ shimmer, pos: shimmerCenter(shimmer) }))
      .filter((item): item is GoldenQueueItem => !!item.pos);

    if (items.length <= 1) {
      return items;
    }

    const key = items
      .map((it) => `${it.shimmer.id}@${Math.round(it.pos.x / 4)},${Math.round(it.pos.y / 4)}`)
      .sort()
      .join('|');

    const cur = { x: this.runtime.cursor.x, y: this.runtime.cursor.y };
    const r = this.runtime.route;

    if (!r || r.key !== key || Math.hypot(cur.x - r.from.x, cur.y - r.from.y) > 80) {
      const order = planRoute(
        cur,
        items.map((it) => it.pos),
      );

      this.runtime.route = {
        key,
        from: cur,
        ids: order.map((i) => items[i]!.shimmer.id),
      };
    }

    const byId = new Map(items.map((it) => [it.shimmer.id, it]));
    const out = this.runtime.route!.ids.map((id) => byId.get(id as number)).filter((it): it is GoldenQueueItem => !!it);

    return out.length === items.length ? out : items;
  }
}
