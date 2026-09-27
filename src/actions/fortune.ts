import { sayCant, sayYay } from '../core/console-voice';
import type { RuntimeState } from '../core/runtime-state';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { fortuneCenter, fortuneElement } from '../game/ticker-dom';
import type { TickerFortune } from '../game/types';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';

/** What a fortune gives, for the log and the console. */
export function fortuneText(f: TickerFortune): string {
  if (f.kind === 'upgrade') return f.name;
  return f.kind === 'golden' ? 'a golden cookie' : 'an hour of CpS';
}

/** One-shot job that clicks a fortune in the news ticker (FORTUNE-1). Re-checks right before
 * the click that the fortune is still there (the ticker moves on after ~10s), and gives way to
 * a golden cookie or a Click Frenzy like the lump harvest (FT-4 pattern). */
export class FortuneClickAction implements CursorAction {
  readonly label = 'click fortune';
  readonly hud = { action: 'fortune', target: 'Fortune cookie in the news' };

  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  target(): { x: number; y: number } {
    return fortuneCenter() || { x: this.runtime.cursor.x, y: this.runtime.cursor.y };
  }

  abortIf(): boolean {
    if (this.game.clickFrenzyActive() || this.hasGoodGolden()) return true;

    return !this.game.getTickerFortune() || !fortuneCenter();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const fortune = ctx.game.getTickerFortune();
    const el = fortuneElement();
    if (!fortune || !el || !el.isConnected) return;

    const point = { x: ctx.runtime.cursor.x, y: ctx.runtime.cursor.y };

    await ctx.clickTiming.humanClick(el, point.x, point.y);

    if (!ctx.game.getTickerFortune()) {
      this.stats.recordFortune();
      this.log.log('click fortune', fortuneText(fortune), { kind: fortune.kind });
      sayYay(`Cracked a fortune cookie: ${fortuneText(fortune)}!! ^w^`);
    } else {
      sayCant('Wanted to crack a fortune cookie in the news, but it didn\'t open :c');
    }
  }
}
