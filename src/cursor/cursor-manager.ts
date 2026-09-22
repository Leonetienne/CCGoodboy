import type { CursorPoint, RuntimeState } from '../core/runtime-state';
import type { PersistedData } from '../core/persisted-data';
import type { IGameAdapter } from '../game/game-adapter';
import type { HurryMode } from '../game/hurry-mode';
import type { BackgroundClock } from '../input/background-clock';
import type { MoveCursorOpts } from '../input/cursor-controller';
import {
  JOB_PRIORITY,
  type CursorAction,
  type CursorClickTiming,
  type CursorJob,
  type CursorJobContext,
  type CursorJobOutcome,
  type CursorMover,
  type EnqueueOpts,
} from './types';

/** Owns the priority queue of cursor jobs and is the only component that drives cursor
 * motion. Every job runs the same way: optional pre-travel step / click gap, travel (speed
 * from the job or config/hurry), optional pre-click pause, then the action's
 * `cursor_at_position`. A higher-priority job preempts a running lower-priority one, and the
 * cursor stays wherever the last job left it. */
export class CursorManager {
  private queue: CursorJob[] = [];
  private byId = new Map<number, CursorJob>();
  private byKey = new Map<string, CursorJob>();
  private completions = new Map<number, (outcome: CursorJobOutcome) => void>();
  private nextId = 1;
  private runningJob: CursorJob | null = null;
  private preemptedJob: CursorJob | null = null;
  private processing = false;
  private destroyed = false;

  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly hurry: HurryMode,
    private readonly clock: BackgroundClock,
    private readonly mover: CursorMover,
    private readonly timing: CursorClickTiming,
    private readonly onError: (err: unknown) => void = (err) => console.error('[CC Good Boy] action failed:', err),
  ) {}

  get currentJob(): CursorJob | null {
    return this.runningJob;
  }

  hasPendingJobs(): boolean {
    return this.queue.length > 0 || this.runningJob !== null;
  }

  isIdle(): boolean {
    return !this.hasPendingJobs();
  }

  /** True when a queued or running job has a priority numerically lower than `priority`
   * (i.e. is more important). Used by PendingWork/actions to yield without knowing the
   * whole SCHED-1 table. */
  hasJobsAbove(priority: number): boolean {
    if (this.runningJob && this.runningJob.priority < priority) return true;
    return this.queue.some((job) => job.priority < priority);
  }

  /** Enqueues an action instance. Returns the existing job when a job with the same dedup
   * key is already queued/running. */
  enqueue(action: CursorAction, opts: EnqueueOpts = {}): CursorJob {
    if (this.destroyed) {
      return {
        id: -1,
        action,
        priority: opts.priority ?? JOB_PRIORITY.IDLE,
        label: action.label,
        key: opts.key,
        dueAt: opts.dueAt ?? 0,
        state: 'cancelled',
        done: Promise.resolve('cancelled'),
      };
    }

    if (opts.key && this.byKey.has(opts.key)) {
      return this.byKey.get(opts.key)!;
    }

    let resolveDone: (outcome: CursorJobOutcome) => void = () => {};
    const done = new Promise<CursorJobOutcome>((resolve) => {
      resolveDone = resolve;
    });

    const job: CursorJob = {
      id: this.nextId++,
      action,
      priority: opts.priority ?? JOB_PRIORITY.IDLE,
      label: action.label,
      key: opts.key,
      dueAt: opts.dueAt ?? 0,
      state: 'queued',
      done,
    };

    this.byId.set(job.id, job);
    if (job.key) this.byKey.set(job.key, job);
    this.completions.set(job.id, resolveDone);

    this.insertSorted(job);
    this.considerPreemption(job);
    this.kick();

    return job;
  }

  /** Enqueues an action and resolves once its job settles. Interim helper for modules that
   * still run as scheduler tasks; later phases replace this with fire-and-forget enqueues. */
  enqueueAndWait(action: CursorAction, opts: EnqueueOpts = {}): Promise<CursorJobOutcome> {
    return this.enqueue(action, opts).done;
  }

  /** Convenience for the operator's `createAction(myActionClass(x, y), 'foobar')` style.
   * Clones the action (prototype + own props preserved) with a new label, then enqueues it.
   * The original action is not mutated. */
  createAction(action: CursorAction, label: string, opts?: EnqueueOpts): CursorJob {
    const clone = Object.create(Object.getPrototypeOf(action)) as CursorAction;
    Object.assign(clone, action, { label });
    return this.enqueue(clone, opts);
  }

  /** Cancels a queued job, or asks a running one to abort at its next check. */
  cancel(keyOrId: string | number): void {
    const job = typeof keyOrId === 'string' ? this.byKey.get(keyOrId) : this.byId.get(keyOrId);
    if (!job) return;

    job.state = 'cancelled';

    if (this.runningJob === job) {
      // The running job's abort predicate sees job.state === 'cancelled' and returns true.
      // Its completion promise is resolved by execute()'s finally.
      return;
    }

    const idx = this.queue.indexOf(job);
    if (idx >= 0) this.queue.splice(idx, 1);

    this.settle(job, 'cancelled');
  }

  has(keyOrId: string | number): boolean {
    return typeof keyOrId === 'string' ? this.byKey.has(keyOrId) : this.byId.has(keyOrId);
  }

  /** Resolves once the queue is empty and no job is running (test/teardown helper). */
  async waitUntilIdle(): Promise<void> {
    while (this.hasPendingJobs() && !this.destroyed) {
      await this.clock.sleep(5);
    }
  }

  /** Aborts everything and stops processing. */
  destroy(): void {
    this.destroyed = true;

    const jobs = this.queue.splice(0);
    if (this.runningJob) jobs.push(this.runningJob);

    for (const job of jobs) {
      job.state = 'cancelled';
      this.settle(job, 'cancelled');
    }

    this.byId.clear();
    this.byKey.clear();
    this.completions.clear();
    this.runningJob = null;
    this.preemptedJob = null;
  }

  private insertSorted(job: CursorJob): void {
    let i = 0;

    while (i < this.queue.length) {
      const other = this.queue[i]!;

      if (job.priority < other.priority) break;
      if (job.priority === other.priority && job.dueAt < other.dueAt) break;
      if (job.priority === other.priority && job.dueAt === other.dueAt && job.id < other.id) break;

      i++;
    }

    this.queue.splice(i, 0, job);
  }

  private considerPreemption(job: CursorJob): void {
    if (this.runningJob && job.priority < this.runningJob.priority) {
      this.preemptedJob = this.runningJob;
    }
  }

  private kick(): void {
    if (this.processing || this.destroyed) return;
    this.processing = true;
    // Defer to a microtask so several jobs enqueued in the same tick are ordered by
    // priority BEFORE any of them starts running.
    void Promise.resolve().then(() => this.drain());
  }

  private async drain(): Promise<void> {
    try {
      while (!this.destroyed) {
        const job = this.queue[0] ?? null;
        if (!job) break;

        const waitMs = job.dueAt - Date.now();
        if (waitMs > 0) {
          // Wake in small steps so a newly enqueued higher-priority job is seen quickly.
          await this.clock.sleep(Math.min(25, Math.max(1, waitMs)));
          continue;
        }

        this.queue.shift();
        this.runningJob = job;

        try {
          await this.execute(job);
        } catch (err) {
          this.onError(err);
        }

        // After real work (anything above idle), ponder right where the job stopped
        // (SCHED-3), exactly like the old scheduler's task .finally() did.
        if (job.priority < JOB_PRIORITY.IDLE) {
          this.runtime.idleStay = true;
          this.runtime.nextIdleAt = Math.max(this.runtime.nextIdleAt, Date.now() + 250);
        }

        this.runningJob = null;
        this.preemptedJob = null;
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.processing = false;

      if (!this.destroyed && this.queue.length === 0 && !this.runningJob) {
        this.runtime.currentAction = 'idle';
        this.runtime.currentTarget = 'none';
      }
    }
  }

  private async execute(job: CursorJob): Promise<void> {
    const action = job.action;
    const ctx = this.makeContext(job);
    const abort = this.makeAbort(job, action, ctx);

    job.state = 'running';

    if (action.hud) {
      this.runtime.currentAction = action.hud.action;
      this.runtime.currentTarget = action.hud.target;
    }

    try {
      if (action.beforeMove) {
        const ok = await action.beforeMove(ctx);
        if (!ok || abort()) {
          job.state = 'cancelled';
          return;
        }
      } else if (action.waitClickGap !== false) {
        const ok = await this.timing.waitForClickGap(action.abortOnGolden !== false, abort);
        if (!ok || abort()) {
          job.state = 'cancelled';
          return;
        }
      }

      const hasTarget = action.target != null;
      const pos = this.resolveTarget(action.target, action);

      if (hasTarget && !pos) {
        job.state = 'cancelled';
        return;
      }

      const travelOpts: MoveCursorOpts = { abortIf: abort };
      if (action.moveSpeed != null) travelOpts.speed = action.moveSpeed;
      if (action.moveMaxMs != null) travelOpts.maxMs = action.moveMaxMs;

      if (pos) {
        const ok = await this.mover.moveCursorTo(pos.x, pos.y, action.abortOnGolden !== false, travelOpts);
        if (!ok || abort()) {
          job.state = 'cancelled';
          return;
        }
      }

      if (action.preClickPause !== false) {
        const ok = await this.timing.waitPreClick(action.abortOnGolden !== false, abort);
        if (!ok || abort()) {
          job.state = 'cancelled';
          return;
        }
      }

      if (action.reacquire && pos) {
        const pos2 = this.resolveTarget(action.target, action);

        if (pos2 && Math.hypot(pos2.x - pos.x, pos2.y - pos.y) > 0.5) {
          const ok = await this.mover.moveCursorTo(pos2.x, pos2.y, action.abortOnGolden !== false, travelOpts);
          if (!ok || abort()) {
            job.state = 'cancelled';
            return;
          }
        }
      }

      if (abort()) {
        job.state = 'cancelled';
        return;
      }

      await action.cursor_at_position(ctx);
    } catch (err) {
      this.onError(err);
      job.state = 'done';
    } finally {
      if (this.preemptedJob === job) {
        job.state = 'cancelled';
      }

      if (job.state === 'running') {
        job.state = 'done';
      }

      this.settle(job, job.state === 'done' ? 'done' : 'cancelled');
    }
  }

  private settle(job: CursorJob, outcome: CursorJobOutcome): void {
    const resolve = this.completions.get(job.id);
    if (resolve) resolve(outcome);
    this.completions.delete(job.id);

    this.byId.delete(job.id);
    if (job.key) this.byKey.delete(job.key);
  }

  private makeContext(job: CursorJob): CursorJobContext {
    return {
      runtime: this.runtime,
      data: this.data,
      game: this.game,
      hurry: this.hurry,
      clock: this.clock,
      cursor: this.mover,
      clickTiming: this.timing,
      enqueue: (action, opts) => this.enqueue(action, opts),
      abortRequested: () => job.state === 'cancelled' || this.preemptedJob === job,
    };
  }

  private makeAbort(job: CursorJob, action: CursorAction, ctx: CursorJobContext): () => boolean {
    return () => {
      if (this.destroyed || !this.runtime.running) return true;
      if (job.state === 'cancelled') return true;
      if (this.preemptedJob === job) return true;

      if (action.abortIf) {
        try {
          return !!action.abortIf(ctx);
        } catch {
          return true;
        }
      }

      return false;
    };
  }

  private resolveTarget(target: CursorAction['target'], action: CursorAction): CursorPoint | null {
    if (target == null) return null;

    if (typeof target === 'function') {
      try {
        // Bind the action as `this` so class-method targets (e.g. GoldenCookieAction.target)
        // can read their own fields instead of throwing and silently cancelling the job.
        return target.call(action);
      } catch {
        return null;
      }
    }

    return target;
  }
}
