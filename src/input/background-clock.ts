export type TimerHandle = number | { native: number };

export interface IntervalHandle {
  stop: boolean;
  id: TimerHandle | null;
}

/** Timers that browsers do not throttle in background tabs. Browsers throttle timers of the
 * PAGE in background tabs, but not those of a Web Worker, so a tiny worker relays our
 * setTimeout calls. Falls back to the normal (throttled) timer until the worker has proven
 * itself with a self-test, or forever if workers aren't usable at all. */
export class BackgroundClock {
  private worker: Worker | null = null;
  private ok = false;
  private failed = false;
  private seq = 0;
  private cbs = new Map<number, () => void>();

  get isOk(): boolean {
    return this.ok;
  }

  get isFailed(): boolean {
    return this.failed;
  }

  /** Creates the timer worker and runs a self-test (a 20ms timeout must come back within 2s). */
  init(): void {
    if (this.worker || this.failed) return;

    try {
      const code = 'self.onmessage=function(e){var d=e.data;' + 'setTimeout(function(){self.postMessage(d.id)},d.ms)};';

      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const w = new Worker(url);

      try {
        URL.revokeObjectURL(url);
      } catch (_e) {
        /* ignore */
      }

      w.onmessage = (e: MessageEvent) => {
        const fn = this.cbs.get(e.data);
        if (!fn) return;

        this.cbs.delete(e.data);

        try {
          fn();
        } catch (err) {
          console.error('[CC Good Boy] timer error', err);
        }
      };

      w.onerror = () => {
        this.ok = false;
        this.failed = true;
      };

      this.worker = w;

      // self-test: only trust the worker once it has answered
      const id = ++this.seq;
      this.cbs.set(id, () => {
        this.ok = true;
      });

      w.postMessage({ id, ms: 20 });
    } catch (_e) {
      this.failed = true;
    }
  }

  /** setTimeout that is not throttled in background tabs (worker clock), or the normal one
   * while the worker is not (yet) usable. */
  setTimeout(fn: () => void, ms: number): TimerHandle {
    if (this.ok && this.worker) {
      const id = ++this.seq;
      this.cbs.set(id, fn);
      this.worker.postMessage({ id, ms });
      return id;
    }

    return { native: window.setTimeout(fn, ms) };
  }

  /** Cancels a setTimeout() handle. */
  clear(h: TimerHandle | null | undefined): void {
    if (h == null) return;

    if (typeof h === 'object') {
      window.clearTimeout(h.native);
    } else {
      this.cbs.delete(h);
    }
  }

  /** Interval built from chained setTimeout()s (each run re-arms the next one). */
  every(fn: () => void, ms: number): IntervalHandle {
    const h: IntervalHandle = { stop: false, id: null };

    const tick = () => {
      if (h.stop) return;

      try {
        fn();
      } finally {
        if (!h.stop) h.id = this.setTimeout(tick, ms);
      }
    };

    h.id = this.setTimeout(tick, ms);
    return h;
  }

  /** Stops an every() interval. */
  stop(h: IntervalHandle | null | undefined): void {
    if (!h) return;
    h.stop = true;
    this.clear(h.id);
  }

  /** Next animation step for the paw: requestAnimationFrame when the page is drawn, but never
   * later than ~34ms; a hidden tab gets no animation frames, so a timer (unthrottled) steps
   * in. */
  nextFrame(cb: (t: number) => void): void {
    let done = false;
    let t: TimerHandle | null = null;

    const fire = () => {
      if (done) return;
      done = true;

      this.clear(t);
      cb(performance.now());
    };

    requestAnimationFrame(fire);
    t = this.setTimeout(fire, 34);
  }

  /** Promise that resolves after ms milliseconds (worker clock, so it is not throttled in
   * background tabs). */
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }
}
