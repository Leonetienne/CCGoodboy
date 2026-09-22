import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { BackgroundClock } from './background-clock';

/** A (practically silent) AudioContext. Firefox does not throttle the timers of a tab that
 * contains one, which keeps the GAME's own loop running at full speed in the background.
 * Browsers only let audio start after a click on the page, so it waits for the first real
 * click. */
export class KeepAliveController {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
  ) {}

  init(): void {
    const ka = this.runtime.keepAlive;

    if (this.data.config.keepAlive === false) {
      this.stop();
      return;
    }

    if (ka.ctx) return;

    const AC = window.AudioContext || (window as any).webkitAudioContext;

    if (!AC) {
      ka.state = 'not supported';
      return;
    }

    try {
      const ctx: AudioContext = new AC();
      const gain = ctx.createGain();
      const osc = ctx.createOscillator();

      gain.gain.value = 0.0002; // about -74 dBFS at 40 Hz: inaudible, but not digital silence
      osc.type = 'sine';
      osc.frequency.value = 40;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      ka.ctx = ctx;

      if (!ka.listening) {
        ka.listening = true;

        (['pointerdown', 'keydown', 'click', 'touchstart'] as const).forEach((type) =>
          window.addEventListener(type, this.resume, true),
        );
      }

      this.resume({ isTrusted: true } as Event);
    } catch (_e) {
      ka.state = 'failed';
    }
  }

  /** Resumes the keep-alive audio (only real user input counts, not the bot's own synthetic
   * events). */
  resume = (e: Event | { isTrusted?: boolean } | null | undefined): void => {
    const ka = this.runtime.keepAlive;

    if (!ka.ctx || !e || e.isTrusted === false) return;

    if (ka.ctx.state === 'suspended') {
      ka.ctx.resume().catch(() => {});
    }
  };

  stop(): void {
    const ka = this.runtime.keepAlive;

    if (ka.ctx) {
      try {
        ka.ctx.close();
      } catch (_e) {
        /* ignore */
      }
    }

    ka.ctx = null;
    ka.state = 'off';
  }
}

/** Text of the HUD row "Background": timer source and keep-alive state. */
export function backgroundStatusText(clock: BackgroundClock, runtime: RuntimeState, data: PersistedData): string {
  const ka = runtime.keepAlive;

  let audio = 'off';

  if (data.config.keepAlive !== false) {
    audio = !ka.ctx ? ka.state : ka.ctx.state === 'running' ? 'running' : 'waiting for a click on the page';
  }

  const timers = clock.isOk ? 'worker' : clock.isFailed ? 'page (no worker)' : 'page (starting)';

  return `timers: ${timers} | keep-alive: ${audio}`;
}
