import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { IdleWanderAction } from '../actions/idle';
import type { PendingWork } from './pending-work';

export { IDLE_HOLD_MS, IDLE_SPOTS, getIdleSpeed, pickIdleSpot } from '../actions/idle';

/** Idle module: produces the single continuous IdleWanderAction job that owns the whole
 * idle roll (ponder-in-place after real work, bored clicks, look-only visits, drifts). The
 * action does its travel/click choreography through the ctx primitives the CursorManager
 * provides. */
export class IdleBehavior {
  constructor(private readonly pendingWork: PendingWork) {}

  idleJob(): JobRequest {
    return {
      action: new IdleWanderAction(() => this.pendingWork.isPendingAbove(JOB_PRIORITY.IDLE)),
      priority: JOB_PRIORITY.IDLE,
      key: 'idle-wander',
    };
  }
}
