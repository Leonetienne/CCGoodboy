import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { MenuButtonAction, ScrollIntoViewAction } from '../actions/buildings-view';
import { GrimoireUnlockAction } from '../actions/grimoire-unlock';
import { BUILDINGS_VIEW_RECIPE, getBuildingLevelButton, getBuildingRow, laidOut } from '../game/buildings-view-dom';
import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';
import type { GameBuilding } from '../game/types';
import type { LogStore } from '../stats/log';

const WIZARD_TOWER = 'Wizard tower';

/** Auto play: unlocks the Grimoire (AUTO-13) by spending one sugar lump on Wizard tower
 * level 1 as soon as at least one Wizard tower and one sugar lump are available. Each tick it
 * hands the scheduler the NEXT single step, re-derived from the live page, so a preempted
 * step just gets picked up again:
 *   1. a menu (Options/Stats/Info) covers the buildings -> click Options, Stats, Stats
 *   2. the Wizard tower's level button is scrolled away -> wheel-scroll #centerArea to it
 *   3. otherwise                                         -> click the level button
 * The Options/Stats/Stats recipe is also what the "Show buildings view" debug tool runs; its
 * remaining clicks live in runtime.buildingsViewSteps so they survive preemption. */
export class GrimoireUnlocker {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly shoppingInterrupted: () => boolean,
    private readonly hasGoodGolden: () => boolean,
    private readonly enqueue: (req: JobRequest) => void,
  ) {}

  private wizardTower(): GameBuilding | null {
    return this.game.getBuildingByName(WIZARD_TOWER);
  }

  private wizardLevel(): number {
    const wt = this.wizardTower();
    return wt ? Number(wt.level) || 0 : 0;
  }

  /** The recipe is running (or waiting to resume) and nothing more important is going on. */
  private menuStepsPending(): boolean {
    return (
      this.runtime.buildingsViewSteps.length > 0 &&
      this.runtime.running &&
      this.game.isReady() &&
      !this.game.clickFrenzyActive() &&
      !this.hasGoodGolden()
    );
  }

  /** Auto play wants the Grimoire unlocked right now (AUTO-13): mode on, AUTO-7 safety gates
   * clear, >= 1 Wizard tower still at level 0, sugar lumps unlocked and >= 1 in stock. */
  wanted(): boolean {
    if (this.data.config.autoPlay !== true) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;
    if (Date.now() < this.runtime.grimoireUnlockBlockUntil) return false;
    if (this.shoppingInterrupted()) return false;

    const wt = this.wizardTower();
    if (!wt || !((Number(wt.amount) || 0) >= 1) || this.wizardLevel() !== 0) return false;

    return this.game.lumpsUnlocked() && this.game.getLumps() >= 1;
  }

  /** Something for this module to do (the scheduler, PendingWork and hammering use it). A
   * dry run only logs, so it never counts as pending. */
  pending(): boolean {
    return this.menuStepsPending() || (this.wanted() && this.data.config.autoDryRun !== true);
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    if (this.menuStepsPending()) return this.menuStepJob();
    if (!this.wanted()) return null;

    if (this.data.config.autoDryRun === true) {
      const now = Date.now();
      const last = this.runtime.autoWouldLog.get('grimoire unlock') || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set('grimoire unlock', now);
        this.log.log('auto play (dry run)', 'would unlock the Grimoire (Wizard tower level 1, 1 sugar lump)');
      }

      return null;
    }

    if (this.game.getOnMenu() !== '') {
      if (!this.startBuildingsViewRecipe()) {
        this.block(30000, 'menu stays open after Options, Stats, Stats');
        return null;
      }

      return this.menuStepJob();
    }

    const id = Number(this.wizardTower()!.id);
    const btn = getBuildingLevelButton(id);

    if (!visibleRect(btn)) {
      if (!laidOut(btn) || !laidOut(getBuildingRow(id))) {
        this.block(10000, 'Wizard tower level button not found');
        return null;
      }

      return {
        action: this.scrollAction(id, (inView) => {
          if (!inView) this.block(10000, 'could not scroll the Wizard tower level button into view');
        }),
        priority: JOB_PRIORITY.AUTO_SHOP,
        key: 'grimoire-unlock:scroll',
      };
    }

    return {
      action: new GrimoireUnlockAction(
        id,
        () => this.wanted(),
        () => this.wizardLevel(),
        (leveled, level) => {
          if (leveled) {
            this.runtime.lastAutoBuyAt = Date.now();
            this.log.log('auto grimoire unlock', 'Wizard tower level 1', { level, lumps: this.game.getLumps() });
          } else {
            this.block(3000, 'level up did not happen');
          }
        },
      ),
      priority: JOB_PRIORITY.AUTO_SHOP,
      key: 'grimoire-unlock:level',
    };
  }

  /** Debug tool: run the Options, Stats, Stats recipe with the paw, from whatever view is
   * open. */
  debugShowBuildingsView(): string {
    this.runtime.buildingsViewSteps = [...BUILDINGS_VIEW_RECIPE];
    this.runtime.buildingsViewStartedAt = Date.now();

    return 'the paw is clicking Options, Stats, Stats';
  }

  /** Debug tool: wheel-scroll #centerArea until the Wizard tower row is in view. */
  debugScrollToWizardTowers(): string {
    const wt = this.wizardTower();
    if (!wt || wt.id == null) throw new Error('Wizard tower not available');

    const id = Number(wt.id);
    if (!laidOut(getBuildingRow(id))) {
      throw new Error('Wizard tower row not shown (own one, and open the buildings view first)');
    }

    this.enqueue({
      action: this.scrollAction(id),
      priority: JOB_PRIORITY.AUTO_SHOP,
      key: 'debug:scroll-wizard-tower',
    });

    return 'the paw is scrolling to the Wizard towers';
  }

  private scrollAction(id: number, onDone?: (inView: boolean) => void): ScrollIntoViewAction {
    return new ScrollIntoViewAction({
      label: 'scroll to Wizard towers',
      // the level button when lumps are unlocked, else the whole row
      element: () => {
        const btn = getBuildingLevelButton(id);
        return laidOut(btn) ? btn : getBuildingRow(id);
      },
      abortIf: () => this.game.clickFrenzyActive() || this.hasGoodGolden(),
      onDone,
      hud: { action: 'buildings-view', target: 'scrolling to the Wizard towers' },
    });
  }

  /** Starts the recipe; refuses (false) if it was just run and the menu is still open, so a
   * page where it doesn't work can't make the paw click Options/Stats forever. */
  private startBuildingsViewRecipe(): boolean {
    const now = Date.now();
    if (now - this.runtime.buildingsViewStartedAt < 5000) return false;

    this.runtime.buildingsViewSteps = [...BUILDINGS_VIEW_RECIPE];
    this.runtime.buildingsViewStartedAt = now;

    return true;
  }

  private menuStepJob(): JobRequest | null {
    const steps = this.runtime.buildingsViewSteps;
    const id = steps[0];
    if (!id) return null;

    const index = BUILDINGS_VIEW_RECIPE.length - steps.length;

    return {
      action: new MenuButtonAction(
        this.runtime,
        id,
        () => this.game.clickFrenzyActive() || this.hasGoodGolden(),
        () => {
          // only shift if this step is still the head (the debug tool may have restarted it)
          if (this.runtime.buildingsViewSteps === steps) steps.shift();
        },
      ),
      priority: JOB_PRIORITY.AUTO_SHOP,
      key: `buildings-view:${index}`,
    };
  }

  private block(ms: number, why: string): void {
    this.runtime.grimoireUnlockBlockUntil = Date.now() + ms;
    this.log.log('auto grimoire unlock', `paused: ${why}`);
  }
}
