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
  /** Attached wrinklers to pop, fattest first (ascending would lose their cookies): while
   * committed, the routine's pops; before that, while the plan waits for a lucky level, the
   * pops that stay clear of it (ASC-12). */
  wrinklers: number[];
  /** Stock market goods still held (ASC-13): the ascension throws the market away. */
  stocks: number[];
  /** The cheapest count achievement the bank still pays for (ASC-13), or null. */
  dump: { name: string; id: number; target: number; count: number } | null;
  /** The rest of the shopping list, in buying order (ascension screen only). */
  toBuy: AscendCrate[];
  /** ASC-16: the next permanent upgrade slot to fill (ascension screen only), or null. */
  slot?: AscendSlot | null;
}

export interface AscendSlot {
  /** The slot's crate in the tree and its name. */
  crateId: number;
  name: string;
  /** The crate is on screen: the paw can click it (else the tree is dragged first). */
  clickable: boolean;
  /** The upgrade it should hold. */
  want: number;
  wantName: string;
  /** The upgrade picked in the open prompt (-1: none). */
  selecting: number;
  /** The wanted upgrade's crate in the open prompt is in view (else its list is scrolled). */
  pickVisible: boolean;
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
  | { kind: 'open-slot'; id: number; name: string }
  | { kind: 'scroll-slot'; id: number; name: string }
  | { kind: 'pick-slot'; id: number; name: string }
  | { kind: 'confirm-slot'; id: number; name: string }
  | { kind: 'cancel-slot' }
  | { kind: 'reincarnate' }
  | { kind: 'confirm-reincarnate' }
  | { kind: 'wait' };

/** ASC-10/12: once a target level is locked, pop every wrinkler, sell every stock and spend
 * the bank on achievements (ASC-13), then hold still at Legacy until the level is there; then
 * click Legacy (whatever is left of the preparation is dropped: the level comes first),
 * confirm "Ascend", sit out the animation, buy the shopping list crate by crate (dragging the
 * tree to each one first), fill the permanent upgrade slots (ASC-16), click Reincarnate
 * and confirm. Anything the bot did not start
 * itself (a prompt, an ascension) is left alone. */
export function nextAscensionStep(s: AscendState): AscendStep {
  if (s.prompt) {
    if (!s.ours) return { kind: 'wait' };
    // Its own "Ascend" prompt, but the moment passed (a golden cookie, a buff): cancel it.
    if (s.prompt === 'Ascend') return s.want ? { kind: 'confirm-ascend' } : { kind: 'cancel-ascend' };
    if (s.prompt === 'Reincarnate') return { kind: 'confirm-reincarnate' };
    // ASC-16: its own "Pick an upgrade to make permanent" prompt
    if (s.prompt === 'PickPermaUpgrade' && s.onScreen) {
      const t = s.slot;
      if (!t) return { kind: 'cancel-slot' };
      if (t.selecting === t.want) return { kind: 'confirm-slot', id: t.want, name: t.wantName };
      return t.pickVisible ? { kind: 'pick-slot', id: t.want, name: t.wantName } : { kind: 'scroll-slot', id: t.want, name: t.wantName };
    }
    return { kind: 'wait' };
  }

  if (s.intro) return s.ours ? { kind: 'intro' } : { kind: 'wait' };

  if (s.onScreen) {
    if (!s.ours) return { kind: 'wait' };

    const next = s.toBuy[0];
    if (next) return next.clickable ? { kind: 'buy', id: next.id, name: next.name } : { kind: 'pan', id: next.id, name: next.name };

    // ASC-16: then the permanent upgrade slots
    const slot = s.slot;
    if (slot) return slot.clickable ? { kind: 'open-slot', id: slot.crateId, name: slot.name } : { kind: 'pan', id: slot.crateId, name: slot.name };

    return { kind: 'reincarnate' };
  }

  // ASC-12: waiting for a lucky level, the wrinklers that can't overshoot it go first
  if (!s.committed) return s.wrinklers.length ? { kind: 'pop-wrinkler', id: s.wrinklers[0]! } : { kind: 'wait' };
  if (s.want) return { kind: 'open-legacy' };
  // the wrinklers first, so their cookies fund the achievements too
  if (s.wrinklers.length) return { kind: 'pop-wrinkler', id: s.wrinklers[0]! };
  if (s.stocks.length) return { kind: 'sell-stock', id: s.stocks[0]! };
  if (s.dump) return { kind: 'dump', ...s.dump };

  return { kind: 'hold' };
}
