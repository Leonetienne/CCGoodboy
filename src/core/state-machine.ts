import type { RuntimeState } from './runtime-state';

/** The bot's global state machine. States are exactly the values the original bot used for
 * `currentAction` ('idle', 'golden-cookie', 'click-frenzy', 'hammer', 'fthof',
 * 'grimoire-refill', 'auto-shop', 'happy-dance', 'idle-play', 'bored-click', ...) — every task
 * still sets its own state as it runs (see hunting/, idle/, autoplay/), but the ONE place that
 * decides "what should the bot be doing right now" is scheduler/priority.ts, and the ONE place
 * that applies that decision is here. */
export class BotStateMachine {
  constructor(private readonly runtime: RuntimeState) {}

  get action(): string {
    return this.runtime.currentAction;
  }

  get target(): string {
    return this.runtime.currentTarget;
  }

  transitionTo(action: string, target: string): void {
    this.runtime.currentAction = action;
    this.runtime.currentTarget = target;
  }
}
