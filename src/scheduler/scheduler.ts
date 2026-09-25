import type { BotStateMachine } from '../core/state-machine';
import type { RuntimeState } from '../core/runtime-state';
import type { BuffLockTracker } from '../game/buffs-lock';
import type { IGameAdapter } from '../game/game-adapter';
import type { GoldenCookieModel } from '../game/golden-cookie-model';
import type { GoldenQueue } from '../hunting/golden-queue';
import type { CursorManager } from '../cursor/cursor-manager';
import type { LogStore } from '../stats/log';
import { selectJobRequest, type PriorityDeps } from './priority';

export type SchedulerDeps = Omit<PriorityDeps, 'queue' | 'buffs'>;

/** The decision tick of the bot; runs every 25ms (see lifecycle/bootstrap.ts). It classifies
 * shimmers, logs each wrath cookie once, builds the golden queue, and enqueues ONE job by
 * priority (see priority.ts). The CursorManager owns execution from there: dedup keys prevent
 * duplicate jobs while one is queued/running, and higher-priority jobs preempt lower ones. */
export class Scheduler {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly buffLockTracker: BuffLockTracker,
    private readonly goldenCookieModel: GoldenCookieModel,
    private readonly goldenQueue: GoldenQueue,
    private readonly stateMachine: BotStateMachine,
    private readonly cursorManager: CursorManager,
    private readonly deps: SchedulerDeps,
  ) {}

  tick(): void {
    if (this.runtime.destroyed || !this.runtime.running || !this.game.isPresent() || !this.game.isReady()) {
      return;
    }

    // Right after a reincarnation the game is still rebuilding (ASC-10).
    if (Date.now() < this.runtime.settleUntil) {
      return;
    }

    const buffs = this.buffLockTracker.update();
    const shimmers = this.goldenCookieModel.getGoldenShimmers();

    // Log each wrath cookie once, but never queue it.
    for (const wrath of shimmers.wrath) {
      if (!this.runtime.seenWrath.has(wrath.id)) {
        this.runtime.seenWrath.add(wrath.id);
        this.log.log('ignore wrath cookie', 'wrath', { shimmerId: wrath.id });
      }
    }

    const aliveIds = new Set(
      this.game
        .getShimmers()
        .filter((s) => s && s.type === 'golden')
        .map((s) => s.id),
    );

    for (const id of Array.from(this.runtime.seenWrath)) {
      if (!aliveIds.has(id)) {
        this.runtime.seenWrath.delete(id);
      }
    }

    this.deps.fthof.reportBlockers(buffs);

    const queue = this.goldenQueue.build(shimmers.good);
    const job = selectJobRequest({ ...this.deps, queue, buffs });

    // The dance is only for the moment right after the catch.
    if (!job || job.key !== 'happy-dance') {
      this.runtime.danceQueued = false;
    }

    if (!job) {
      this.stateMachine.transitionTo('idle', 'none');
      return;
    }

    this.cursorManager.enqueue(job.action, { priority: job.priority, key: job.key, dueAt: job.dueAt });
  }
}
