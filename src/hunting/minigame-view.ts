import { MinigameButtonAction } from '../actions/buildings-view';
import type { CursorAction } from '../cursor/types';
import { getBuildingLevelButton, getBuildingRow, getMinigameButton, laidOut } from '../game/buildings-view-dom';
import type { IGameAdapter } from '../game/game-adapter';
import type { GameBuilding } from '../game/types';
import type { BuildingsViewNavigator, PrepStep } from './buildings-view';

/** The words a minigame's steps use (HUD, logs, blocked reasons). */
export interface MinigameInfo {
  /** Game.Objects key: 'Wizard tower', 'Bank'. */
  building: string;
  /** Plural for the HUD: 'Wizard towers', 'Banks'. */
  buildingPlural: string;
  /** 'Grimoire', 'Stock Market'. */
  minigame: string;
  /** The level 1 click (normally a MinigameUnlockAction with the minigame's own label/HUD). */
  unlockAction: (
    buildingId: number,
    stillWanted: () => boolean,
    readLevel: () => number,
    onResult: (leveled: boolean, level: number) => void,
  ) => CursorAction;
}

export interface MinigameStepParams {
  /** 'level': done once the building is level >= 1 (the minigame is unlocked).
   *  'open':  done once the minigame is open and `focus` is on screen. */
  goal: 'level' | 'open';
  priority: number;
  /** Dedup-key prefix for the jobs of this caller. */
  keyPrefix: string;
  /** The caller no longer wants this (checked by every job it hands out). */
  abortIf: () => boolean;
  /** May spend a sugar lump on level 1 when the building is still level 0. */
  allowLevelUp: boolean;
  /** Something failed asynchronously (a scroll that didn't reach the element). */
  onFail: (why: string) => void;
  onLevelResult?: (leveled: boolean, level: number) => void;
  /** goal 'open': the control that must end up on screen (the FTHOF spell, a trade button). */
  focus?: () => Element | null;
  /** goal 'open': how the scroll to `focus` is labelled and keyed (key suffix). */
  focusLabel?: { label: string; hudTarget: string; key: string };
}

/** Plans the way to a usable building minigame, one step per scheduler tick, re-derived
 * from the live page so a preempted step is simply picked up again:
 *   1. a menu covers the buildings          -> Options, Stats, Stats (BuildingsViewNavigator)
 *   2. no such building                     -> blocked
 *   3. level 0                              -> scroll to + click its "lvl" button (if allowed
 *                                              and a sugar lump is available), else blocked
 *   4. minigame closed                      -> scroll to + click "View <minigame>"
 *   5. minigame open, `focus` scrolled away -> scroll to it
 * Shared by the Grimoire (GrimoireView: FT-8, AUTO-13, DBG-11) and the stock market
 * (STOCK-*, AUTO-16). */
export class MinigameView {
  constructor(
    private readonly game: IGameAdapter,
    private readonly nav: BuildingsViewNavigator,
    readonly info: MinigameInfo,
  ) {}

  building(): GameBuilding | null {
    return this.game.getBuildingByName(this.info.building);
  }

  level(): number {
    const b = this.building();
    return b ? Number(b.level) || 0 : 0;
  }

  /** Is the minigame shown (its "View ..." toggle is on)? */
  isOpen(): boolean {
    const b = this.building();
    return !!(b && b.onMinigame);
  }

  nextStep(p: MinigameStepParams): PrepStep {
    const { building, buildingPlural, minigame } = this.info;

    const menu = this.nav.menuStep(p.priority);
    if (menu) return menu;

    const b = this.building();
    if (!b || b.id == null || !((Number(b.amount) || 0) >= 1)) {
      return { kind: 'blocked', why: `no ${building} bought` };
    }

    const id = Number(b.id);
    const row = () => getBuildingRow(id);
    const common = { priority: p.priority, abortIf: p.abortIf, onFail: p.onFail, fallback: row };

    if (this.level() === 0) {
      if (!p.allowLevelUp) return { kind: 'blocked', why: `${minigame} not unlocked (${building} level 0)` };
      if (!this.game.lumpsUnlocked() || this.game.getLumps() < 1) {
        return { kind: 'blocked', why: `no sugar lump to unlock the ${minigame} with` };
      }

      const view = this.nav.bringIntoView({
        ...common,
        element: () => getBuildingLevelButton(id),
        key: `${p.keyPrefix}:scroll-level`,
        label: `scroll to ${building} level`,
        hudTarget: `the ${building} level button`,
      });
      if (view.kind !== 'ready') return view;

      return {
        kind: 'job',
        job: {
          action: this.info.unlockAction(
            id,
            () => !p.abortIf() && this.level() === 0 && this.game.getLumps() >= 1,
            () => this.level(),
            (leveled, level) => (p.onLevelResult ? p.onLevelResult(leveled, level) : undefined),
          ),
          priority: p.priority,
          key: `${p.keyPrefix}:level`,
        },
      };
    }

    if (p.goal === 'level') return { kind: 'ready' };

    if (!this.isOpen()) {
      const view = this.nav.bringIntoView({
        ...common,
        element: () => getMinigameButton(id),
        key: `${p.keyPrefix}:scroll-towers`,
        label: `scroll to ${buildingPlural}`,
        hudTarget: `the ${buildingPlural}`,
      });
      if (view.kind !== 'ready') return view;

      return {
        kind: 'job',
        job: {
          action: new MinigameButtonAction(id, minigame, () => this.isOpen(), p.abortIf),
          priority: p.priority,
          key: `${p.keyPrefix}:open`,
        },
      };
    }

    // open, but the minigame may still be loading its controls
    const focus = p.focus || (() => null);
    if (!laidOut(focus())) return { kind: 'wait' };

    return this.nav.bringIntoView({
      ...common,
      element: focus,
      key: `${p.keyPrefix}:${p.focusLabel?.key ?? 'scroll-focus'}`,
      label: p.focusLabel?.label ?? `scroll to the ${minigame}`,
      hudTarget: p.focusLabel?.hudTarget ?? `the ${minigame}`,
    });
  }
}
