// Pure: the next step of an automatic ascension (ASC-10), re-derived from the live game every
// scheduler tick, so a preempted step is simply picked up again.

export interface AscendCrate {
  id: number;
  name: string;
  /** On screen with room around it: the paw can click it. */
  clickable: boolean;
}

export interface AscendState {
  /** ASC-12: a target level is locked and the routine runs (pop, sell, spend, hold, ascend). */
  committed: boolean;
  /** The locked target level is there (the real level is inside its window): ascend now. */
  want: boolean;
  /** The bot started this ascension (clicked Legacy); it only ever touches its own. */
  ours: boolean;
  /** Id of the open prompt ('Ascend', 'Reincarnate', ...), '' if none. */
  prompt: string;
  /** The ascend animation is running. */
  intro: boolean;
  /** On the ascension screen. */
  onScreen: boolean;
  /** What is still to do before the target (empty once the routine's preparation is done):
   * attached wrinklers the paw can poke, fattest first (ascending would lose their cookies). */
  wrinklers: number[];
  /** Stock market goods still held (ASC-13): the ascension throws the market away. */
  stocks: number[];
  /** The cheapest count achievement the bank still pays for (ASC-13), or null. */
  dump: { name: string; id: number; target: number; count: number } | null;
  /** The rest of the shopping list, in buying order (ascension screen only). */
  toBuy: AscendCrate[];
}

export type AscendStep =
  | { kind: 'pop-wrinkler'; id: number }
  | { kind: 'sell-stock'; id: number }
  | { kind: 'dump'; id: number; name: string; target: number; count: number }
  | { kind: 'hold' }
  | { kind: 'open-legacy' }
  | { kind: 'confirm-ascend' }
  | { kind: 'cancel-ascend' }
  | { kind: 'intro' }
  | { kind: 'pan'; id: number; name: string }
  | { kind: 'buy'; id: number; name: string }
  | { kind: 'reincarnate' }
  | { kind: 'confirm-reincarnate' }
  | { kind: 'wait' };

/** ASC-10/12: once a target level is locked, pop every wrinkler, sell every stock and spend
 * the bank on achievements (ASC-13), then hold still at Legacy until the level is there; then
 * click Legacy (whatever is left of the preparation is dropped: the level comes first),
 * confirm "Ascend", sit out the animation, buy the shopping list crate by crate (dragging the
 * tree to each one first), click Reincarnate and confirm. Anything the bot did not start
 * itself (a prompt, an ascension) is left alone. */
export function nextAscensionStep(s: AscendState): AscendStep {
  if (s.prompt) {
    if (!s.ours) return { kind: 'wait' };
    // Its own "Ascend" prompt, but the moment passed (a golden cookie, a buff): cancel it.
    if (s.prompt === 'Ascend') return s.want ? { kind: 'confirm-ascend' } : { kind: 'cancel-ascend' };
    if (s.prompt === 'Reincarnate') return { kind: 'confirm-reincarnate' };
    return { kind: 'wait' };
  }

  if (s.intro) return s.ours ? { kind: 'intro' } : { kind: 'wait' };

  if (s.onScreen) {
    if (!s.ours) return { kind: 'wait' };

    const next = s.toBuy[0];
    if (next) return next.clickable ? { kind: 'buy', id: next.id, name: next.name } : { kind: 'pan', id: next.id, name: next.name };

    return { kind: 'reincarnate' };
  }

  if (!s.committed) return { kind: 'wait' };
  if (s.want) return { kind: 'open-legacy' };
  // the wrinklers first, so their cookies fund the achievements too
  if (s.wrinklers.length) return { kind: 'pop-wrinkler', id: s.wrinklers[0]! };
  if (s.stocks.length) return { kind: 'sell-stock', id: s.stocks[0]! };
  if (s.dump) return { kind: 'dump', ...s.dump };

  return { kind: 'hold' };
}
