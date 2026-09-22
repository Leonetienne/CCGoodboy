import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';

/** Smoothed income from CLICKING (cookies per second, 20s time constant), from the growth of
 * Game.handmadeCookies. Together with CpS it is the income used to estimate how long saving up
 * takes. */
export class IncomeTracker {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
  ) {}

  update(now: number): number {
    const h = this.game.getHandmadeCookies();
    if (!Number.isFinite(h)) return 0;

    const st = this.runtime.autoHand || (this.runtime.autoHand = { t: now, v: h, rate: 0 });
    const dt = (now - st.t) / 1000;

    if (dt >= 0.5) {
      const inst = Math.max(0, (h - st.v) / dt);
      const a = 1 - Math.exp(-dt / 20);

      st.rate += (inst - st.rate) * a;
      st.t = now;
      st.v = h;
    }

    return st.rate;
  }
}
