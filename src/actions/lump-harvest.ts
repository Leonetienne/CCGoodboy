import type { RuntimeState } from '../core/runtime-state';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { getLumpControl, lumpCenter } from '../game/lump-dom';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';

/** One-shot job that harvests a ripe sugar lump by clicking `#lumps`. Re-checks ripeness right
 * before the click (mirrors FT-4/FT-5 for FTHOF/refill), so it aborts if a golden cookie
 * appears, a Click Frenzy starts, or the lump stops being ripe (already harvested elsewhere, or
 * the game's own overripe auto-harvest beat the paw to it) before it gets there. */
export class LumpHarvestAction implements CursorAction {
  readonly label = 'harvest sugar lump';
  readonly hud = { action: 'lump-harvest', target: 'Sugar lump' };

  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  target(): { x: number; y: number } {
    return lumpCenter() || { x: this.runtime.cursor.x, y: this.runtime.cursor.y };
  }

  abortIf(): boolean {
    const control = getLumpControl();
    if (!control || !control.isConnected) return true;
    if (this.game.clickFrenzyActive() || this.hasGoodGolden()) return true;

    return !this.game.isLumpRipe();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const control = getLumpControl();
    if (!control || !control.isConnected) return;

    const beforeLumps = ctx.game.getLumps();
    const point = { x: ctx.runtime.cursor.x, y: ctx.runtime.cursor.y };

    await ctx.clickTiming.humanClick(control, point.x, point.y);

    if (ctx.game.getLumps() > beforeLumps) {
      this.stats.recordLumpHarvest();
      this.log.log('harvest sugar lump', 'ripe', { lumps: ctx.game.getLumps() });
    }
  }
}
