import { clamp } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import type { LogStore } from '../stats/log';
import { autoPerClick, autoUnbuffedCps } from './building-valuation';

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export interface ClickEstimate {
  rate: number;
  share: number;
}

/** AUTO HAMMER: in auto play mode the big cookie is hammered whenever that is much better
 * than idling, i.e. clicking would add at least 'Auto: hammer when clicks add >=' (default 5%)
 * of the CpS. At the very start (no CpS) that is always true, so the bot starts clicking on
 * its own. When hammering is not worth it, it still PROBES now and then: it hammers briefly,
 * measures the real cookies per second from clicking and updates the calibration factor of the
 * estimate. Re-evaluated at most once per second. */
export class AutoHammer {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
  ) {}

  /** Expected cookies per second from clicking while hammering, and how much that is compared
   * to the CpS ("share"). The estimate is (click value x clicks per second) x a calibration
   * factor that the probing keeps up to date. */
  clickEstimate(): ClickEstimate {
    const st = this.runtime.autoHammerState;
    const perClick = autoPerClick(this.game);

    const rate = perClick * Math.max(0, Number(this.data.config.clickFrenzyCps) || 8) * st.cal;
    const cps = autoUnbuffedCps(this.game);

    return { rate, share: rate / Math.max(Number.isFinite(cps) ? cps : 0, 0.1) };
  }

  /** Should the big cookie be hammered right now? */
  isActive(): boolean {
    if (this.data.config.autoPlay !== true || this.data.config.autoHammer === false || !this.game.isPresent() || !this.game.isReady()) {
      return false;
    }

    const st = this.runtime.autoHammerState;
    const now = Date.now();

    if (now < st.nextEvalAt) return st.on;

    st.nextEvalAt = now + 1000;

    try {
      const minShare = Math.max(0, num(this.data.config.autoHammerMinShare, 0.05));
      const probeEvery = Math.max(0, num(this.data.config.autoProbeIntervalSec, 300));
      const probeSec = clamp(num(this.data.config.autoProbeSec, 10), 2, 120);

      // finish a running probe: compare the measured clicking income with the expectation
      if (st.probeUntil && now >= st.probeUntil) {
        const secs = (now - st.probeT0) / 1000;
        const perClick = autoPerClick(this.game);
        const expected = perClick * Math.max(0, num(this.data.config.clickFrenzyCps, 8));
        const measured = secs > 0 ? (num(this.game.getHandmadeCookies(), 0) - st.probeH0) / secs : 0;

        if (expected > 0 && measured >= 0 && !this.game.clickFrenzyActive()) {
          st.cal = clamp(measured / expected, 0.25, 4);
        }

        st.probeUntil = 0;
      }

      const est = this.clickEstimate();
      st.share = est.share;

      const wanted = est.share >= minShare;

      if (!wanted && !st.probeUntil && probeEvery > 0 && now >= st.nextProbeAt && !this.game.clickFrenzyActive()) {
        st.probeUntil = now + probeSec * 1000;
        st.probeT0 = now;
        st.probeH0 = num(this.game.getHandmadeCookies(), 0);
        st.nextProbeAt = now + probeEvery * 1000;
      }

      const on = wanted || !!st.probeUntil;

      if (wanted !== st.wanted) {
        st.wanted = wanted;

        this.log.log(
          'auto hammer',
          wanted ? `on (clicks add ~${Math.round(est.share * 100)}% of CpS)` : 'off (clicking is not worth it now)',
        );
      }

      st.on = on;
    } catch (_e) {
      st.on = false;
    }

    return st.on;
  }

  /** Should the big cookie be hammered: the manual "Hammer cookie" button, or the auto
   * hammer. */
  hammerActive(): boolean {
    return this.runtime.hammer || this.isActive();
  }
}
