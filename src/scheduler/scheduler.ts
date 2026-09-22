import type { BotStateMachine } from '../core/state-machine';
import type { RuntimeState } from '../core/runtime-state';
import type { BuffLockTracker } from '../game/buffs-lock';
import type { IGameAdapter } from '../game/game-adapter';
import type { GoldenCookieModel } from '../game/golden-cookie-model';
import type { GoldenQueue } from '../hunting/golden-queue';
import type { LogStore } from '../stats/log';
import { selectTask, type PriorityDeps } from './priority';

export type SchedulerDeps = Omit<PriorityDeps, 'queue' | 'buffs'>;

/** The heart of the bot; runs every 25ms (see lifecycle/bootstrap.ts). If nothing is running
 * it picks ONE task by priority (see priority.ts) and runs it to completion before picking
 * another. Also logs each wrath cookie once. When a task ends, the paw ponders where it
 * stopped (idleStay). A task that throws is logged and never stops the bot. */
export class Scheduler {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly buffLockTracker: BuffLockTracker,
    private readonly goldenCookieModel: GoldenCookieModel,
    private readonly goldenQueue: GoldenQueue,
    private readonly stateMachine: BotStateMachine,
    private readonly deps: SchedulerDeps,
  ) {}

  tick(): void {
    if (this.runtime.destroyed || !this.runtime.running || this.runtime.actionInProgress || !this.game.isPresent() || !this.game.isReady()) {
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

    const queue = this.goldenQueue.build(shimmers.good);
    const task = selectTask({ ...this.deps, queue, buffs });

    // The dance is only for the moment right after the catch.
    if (task?.name !== 'happy-dance') {
      this.runtime.danceQueued = false;
    }

    if (!task) {
      this.stateMachine.transitionTo('idle', 'none');
      return;
    }

    this.runtime.actionInProgress = true;

    Promise.resolve()
      .then(task.run)
      .catch((err: unknown) => {
        console.error('[CC Good Boy] action failed:', err);
        this.log.log('error', String(err && (err as Error).message ? (err as Error).message : err));
      })
      .finally(() => {
        this.runtime.actionInProgress = false;

        // After real work, ponder right where it stopped.
        if (task.name !== 'idle-wander') {
          this.runtime.idleStay = true;
          this.runtime.nextIdleAt = Math.max(this.runtime.nextIdleAt, Date.now() + 250);
        }

        if (this.runtime.running) {
          this.stateMachine.transitionTo('idle', 'none');
        }
      });
  }
}
