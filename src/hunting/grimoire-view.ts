import { sayCant } from '../core/console-voice';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { GrimoireUnlockAction } from '../actions/grimoire-unlock';
import { getBuildingRow, laidOut } from '../game/buildings-view-dom';
import type { IGameAdapter } from '../game/game-adapter';
import { getGrimoireControl } from '../game/grimoire-dom';
import type { GameBuilding } from '../game/types';
import type { LogStore } from '../stats/log';
import type { BuildingsViewNavigator, PrepStep } from './buildings-view';
import { MinigameView, type MinigameInfo } from './minigame-view';

const GRIMOIRE_INFO: MinigameInfo = {
  building: 'Wizard tower',
  buildingPlural: 'Wizard towers',
  minigame: 'Grimoire',
  unlockAction: (id, stillWanted, readLevel, onResult) => new GrimoireUnlockAction(id, stillWanted, readLevel, onResult),
};

/** How long the "Show grimoire" debug goal keeps trying before giving up. */
const SHOW_GRIMOIRE_GOAL_MS = 30000;

export interface GrimoireStepParams {
  /** 'level': done once the Wizard tower is level >= 1 (the Grimoire is unlocked).
   *  'open':  done once the Grimoire is open and its FTHOF spell button is on screen. */
  goal: 'level' | 'open';
  priority: number;
  /** Dedup-key prefix for the jobs of this caller. */
  keyPrefix: string;
  /** The caller no longer wants this (checked by every job it hands out). */
  abortIf: () => boolean;
  /** May spend a sugar lump on Wizard tower level 1 when it is still level 0. */
  allowLevelUp: boolean;
  /** Something failed asynchronously (a scroll that didn't reach the element). */
  onFail: (why: string) => void;
  onLevelResult?: (leveled: boolean, level: number) => void;
}

/** Plans the way to a usable Grimoire (a MinigameView for the Wizard tower), one step per
 * scheduler tick, re-derived from the live page so a preempted step is simply picked up again:
 *   1. a menu covers the buildings         -> Options, Stats, Stats (BuildingsViewNavigator)
 *   2. no Wizard tower                     -> blocked
 *   3. Wizard tower level 0                -> scroll to + click its "lvl" button (if allowed and
 *                                             a sugar lump is available), else blocked
 *   4. Grimoire closed                     -> scroll to + click "View Grimoire"
 *   5. Grimoire open, spells scrolled away -> scroll to the FTHOF spell
 * Used by FTHOF (FT-8), the Grimoire unlock (AUTO-13) and the "Show grimoire" debug tool
 * (DBG-11), which also runs through pending()/job() here. */
export class GrimoireView {
  private readonly view: MinigameView;

  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly nav: BuildingsViewNavigator,
    private readonly enqueue: (req: JobRequest) => void,
  ) {
    this.view = new MinigameView(game, nav, GRIMOIRE_INFO);
  }

  wizardTower(): GameBuilding | null {
    return this.view.building();
  }

  wizardLevel(): number {
    return this.view.level();
  }

  /** Is the Grimoire minigame shown (its "View Grimoire" toggle is on)? */
  isOpen(): boolean {
    return this.view.isOpen();
  }

  nextStep(p: GrimoireStepParams): PrepStep {
    return this.view.nextStep({
      ...p,
      focus: () => getGrimoireControl('fthof', this.game.getGrimoire()),
      focusLabel: { label: 'scroll to the Grimoire', hudTarget: 'the Grimoire', key: 'scroll-grimoire' },
    });
  }

  // ---- debug tools, and the scheduler tier that runs them (with the recipe) ----

  /** The buildings-view recipe or the "Show grimoire" goal has a step waiting. */
  pending(): boolean {
    return this.nav.recipePending() || this.showGoalActive();
  }

  job(): JobRequest | null {
    if (this.nav.recipePending()) return this.nav.recipeJob(JOB_PRIORITY.AUTO_SHOP);
    if (!this.showGoalActive()) return null;

    const step = this.nextStep({
      goal: 'open',
      priority: JOB_PRIORITY.AUTO_SHOP,
      keyPrefix: 'debug:show-grimoire',
      abortIf: () => !this.showGoalActive(),
      allowLevelUp: true,
      onFail: (why) => this.endShowGoal(false, why),
      onLevelResult: (leveled) => {
        if (leveled) this.log.log('debug tool', 'Show grimoire: Wizard tower level 1 (1 sugar lump)');
        else this.endShowGoal(false, 'level up did not happen');
      },
    });

    if (step.kind === 'job') return step.job;
    if (step.kind === 'ready') this.endShowGoal(true, 'Grimoire is open and on screen');
    if (step.kind === 'blocked') this.endShowGoal(false, step.why);

    return null;
  }

  /** Debug tool DBG-9. */
  debugShowBuildingsView(): string {
    this.nav.restartRecipe();
    return 'the paw is clicking Options, Stats, Stats';
  }

  /** Debug tool DBG-10: wheel-scroll #centerArea until the Wizard tower row is in view. */
  debugScrollToWizardTowers(): string {
    const wt = this.wizardTower();
    if (!wt || wt.id == null) throw new Error('Wizard tower not available');

    const id = Number(wt.id);
    if (!laidOut(getBuildingRow(id))) {
      throw new Error('Wizard tower row not shown (own one, and open the buildings view first)');
    }

    this.enqueue({
      action: this.nav.scrollAction(() => getBuildingRow(id), 'scroll to Wizard towers', 'the Wizard towers'),
      priority: JOB_PRIORITY.AUTO_SHOP,
      key: 'debug:scroll-wizard-tower',
    });

    return 'the paw is scrolling to the Wizard towers';
  }

  /** Debug tool DBG-11: buildings view -> Wizard towers in view -> Grimoire unlocked (spends a
   * lump if needed) -> "View Grimoire". Fails at once when there is no Wizard tower, or it is
   * still level 0 and there is no sugar lump to unlock it with. */
  debugShowGrimoire(): string {
    const wt = this.wizardTower();
    if (!wt || !((Number(wt.amount) || 0) >= 1)) throw new Error('no Wizard tower bought');

    if (this.wizardLevel() === 0 && (!this.game.lumpsUnlocked() || this.game.getLumps() < 1)) {
      throw new Error('Grimoire not unlocked yet and no sugar lump to unlock it with');
    }

    this.runtime.showGrimoireGoalUntil = Date.now() + SHOW_GRIMOIRE_GOAL_MS;

    return this.wizardLevel() === 0
      ? 'the paw is unlocking (1 sugar lump) and opening the Grimoire'
      : 'the paw is opening the Grimoire';
  }

  private showGoalActive(): boolean {
    if (!this.runtime.showGrimoireGoalUntil) return false;

    if (Date.now() >= this.runtime.showGrimoireGoalUntil) {
      this.endShowGoal(false, 'timed out');
      return false;
    }

    return this.runtime.running && this.game.isReady() && !this.game.clickFrenzyActive();
  }

  private endShowGoal(ok: boolean, why: string): void {
    this.runtime.showGrimoireGoalUntil = 0;
    this.log.log('debug tool', `Show grimoire: ${ok ? 'done' : 'failed'}`, ok ? { result: why } : { error: why });
    if (!ok) sayCant(`Wanted to show my Grimoire, but ${why} :c`);
  }
}
