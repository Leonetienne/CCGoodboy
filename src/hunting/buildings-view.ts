import type { RuntimeState } from '../core/runtime-state';
import type { JobRequest } from '../cursor/types';
import { MenuButtonAction, ScrollIntoViewAction } from '../actions/buildings-view';
import { BUILDINGS_VIEW_RECIPE, laidOut } from '../game/buildings-view-dom';
import { visibleRect } from '../game/dom-geometry';
import type { IGameAdapter } from '../game/game-adapter';

/** What a "get X on screen" planner wants next: a job to run now, nothing left to do
 * (`ready`), nothing possible this tick (`wait`), or a dead end (`blocked`, with why). */
export type PrepStep = { kind: 'job'; job: JobRequest } | { kind: 'ready' } | { kind: 'wait' } | { kind: 'blocked'; why: string };

export interface BringIntoViewParams {
  /** The element that must end up on screen. */
  element: () => Element | null;
  /** What to scroll to instead while `element` is not laid out yet (e.g. its row). */
  fallback?: () => Element | null;
  priority: number;
  key: string;
  label: string;
  hudTarget: string;
  abortIf: () => boolean;
  /** Scrolling finished without getting the element on screen. */
  onFail: (why: string) => void;
}

/** Gets things in the middle column (#centerArea) in front of the paw, one step at a time:
 * (1) if a menu (Options/Stats/Info) covers the buildings, click Options once, then Stats
 * twice (idempotent, always ends on the buildings view; the remaining clicks live in
 * runtime.buildingsViewSteps so a preempted step is simply resumed); (2) if the element is
 * scrolled away, wheel-scroll the column to it. Shared by FTHOF prep (FT-8), the Grimoire
 * unlock (AUTO-13) and the debug tools (DBG-9..11). */
export class BuildingsViewNavigator {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  private interrupted(): boolean {
    return this.game.clickFrenzyActive() || this.hasGoodGolden();
  }

  /** The recipe is running (or waiting to resume) and nothing more important is going on. */
  recipePending(): boolean {
    return this.runtime.buildingsViewSteps.length > 0 && this.runtime.running && this.game.isReady() && !this.interrupted();
  }

  /** Debug tool: (re)start the recipe from whatever view is open. */
  restartRecipe(): void {
    this.runtime.buildingsViewSteps = [...BUILDINGS_VIEW_RECIPE];
    this.runtime.buildingsViewStartedAt = Date.now();
  }

  /** The next recipe click as a job, or null when the recipe is done. */
  recipeJob(priority: number): JobRequest | null {
    const steps = this.runtime.buildingsViewSteps;
    const id = steps[0];
    if (!id) return null;

    const index = BUILDINGS_VIEW_RECIPE.length - steps.length;

    return {
      action: new MenuButtonAction(
        this.runtime,
        id,
        () => this.interrupted(),
        () => {
          // only shift if this recipe is still the current one (the debug tool may restart it)
          if (this.runtime.buildingsViewSteps === steps) steps.shift();
        },
      ),
      priority,
      key: `buildings-view:${index}`,
    };
  }

  /** Step 1: get back to the buildings view. null = already there. */
  menuStep(priority: number): PrepStep | null {
    if (this.recipePending()) {
      const job = this.recipeJob(priority);
      if (job) return { kind: 'job', job };
    }

    if (this.game.getOnMenu() === '') return null;

    // refuse to loop: a page where the recipe doesn't work must not make the paw click
    // Options/Stats forever
    if (Date.now() - this.runtime.buildingsViewStartedAt < 5000) {
      return { kind: 'blocked', why: 'menu stays open after Options, Stats, Stats' };
    }

    this.restartRecipe();

    const job = this.recipeJob(priority);
    return job ? { kind: 'job', job } : { kind: 'wait' };
  }

  /** Steps 1 and 2 for one element: `ready` once it is on screen. */
  bringIntoView(p: BringIntoViewParams): PrepStep {
    const menu = this.menuStep(p.priority);
    if (menu) return menu;

    if (visibleRect(p.element())) return { kind: 'ready' };

    const scrollTo = laidOut(p.element()) ? p.element : p.fallback && laidOut(p.fallback()) ? p.fallback : null;
    if (!scrollTo) return { kind: 'blocked', why: `${p.hudTarget}: not found on the page` };

    return {
      kind: 'job',
      job: {
        action: this.scrollAction(scrollTo, p.label, p.hudTarget, p.abortIf, (inView) => {
          if (!inView) p.onFail(`${p.hudTarget}: could not scroll it into view`);
        }),
        priority: p.priority,
        key: p.key,
      },
    };
  }

  scrollAction(
    element: () => Element | null,
    label: string,
    hudTarget: string,
    abortIf: () => boolean = () => false,
    onDone?: (inView: boolean) => void,
  ): ScrollIntoViewAction {
    return new ScrollIntoViewAction({
      label,
      element,
      abortIf: () => this.interrupted() || abortIf(),
      onDone,
      hud: { action: 'buildings-view', target: `scrolling to ${hudTarget}` },
    });
  }
}
