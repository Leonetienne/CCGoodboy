import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import type { GameWrinkler } from '../game/types';
import { getWrinklerCanvas, wrinklerPoint } from '../game/wrinkler-dom';

/** The game re-checks which wrinkler is under its mouse only every 5th frame, so the paw
 * hovers this long before the first poke. */
const HOVER_MS = 260;
/** Pokes before giving up. A wrinkler has 2.1 hp, loses 0.75 per click and heals 0.04 per
 * frame, so 3 quick pokes pop it; the rest is slack for a slow (background) game loop. */
const MAX_POKES = 10;

/** One-shot job that pops one wrinkler by poking it like a human: the paw moves onto its
 * body, hovers, then clicks #backgroundLeftCanvas until it bursts (WRINK-5). Aborts when the
 * wrinkler is gone (popped elsewhere) or `shouldAbort` says something more important came up.
 * `onResult` gets whether it popped and how many cookies the bank gained. */
export class WrinklerPopAction implements CursorAction {
  readonly label = 'pop wrinkler';
  readonly hud = { action: 'wrinkler-pop', target: 'a fat wrinkler' };
  readonly reacquire = true;

  constructor(
    private readonly id: number,
    private readonly game: IGameAdapter,
    private readonly shouldAbort: () => boolean,
    private readonly onResult: (popped: boolean, gained: number) => void,
  ) {}

  private live(): GameWrinkler | null {
    const w = this.game.getWrinklers().find((x) => x && x.id === this.id);
    return w && w.phase === 2 ? w : null;
  }

  target(): { x: number; y: number } | null {
    const w = this.live();
    return w ? wrinklerPoint(w, this.game.getWrinklers()) : null;
  }

  abortIf(): boolean {
    return this.shouldAbort() || !this.live();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const canvas = getWrinklerCanvas();
    if (!canvas || !this.live()) return;

    const before = ctx.game.getCookies();

    await ctx.clock.sleep(HOVER_MS);

    for (let i = 0; i < MAX_POKES && this.live(); i++) {
      if (ctx.abortRequested()) return;

      await ctx.clickTiming.humanClick(canvas, ctx.runtime.cursor.x, ctx.runtime.cursor.y);
      await ctx.clock.sleep(90 + Math.random() * 40);
    }

    this.onResult(!this.live(), ctx.game.getCookies() - before);
  }
}
