import type { RuntimeState } from '../core/runtime-state';
import { visibleRect } from '../game/dom-geometry';
import { getFthofCost, getFthofSpell } from '../game/grimoire';
import type { IGameAdapter } from '../game/game-adapter';
import type { GrimoireMinigame } from '../game/types';
import type { CursorController } from '../input/cursor-controller';
import type { ClickTiming } from '../input/human-click';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';

export type GrimoireActionKind = 'fthof' | 'refill';

/** The real Grimoire DOM control for an action. */
export function getGrimoireControl(kind: GrimoireActionKind, M: GrimoireMinigame | null): Element | null {
  if (kind === 'fthof') {
    const spell = getFthofSpell(M) as { id?: number } | null;
    return spell && spell.id != null ? document.getElementById(`grimoireSpell${spell.id}`) : null;
  }

  if (kind === 'refill') {
    return document.getElementById('grimoireLumpRefill');
  }

  return null;
}

/** Element used as the paw's movement target: the real control when visible, otherwise the
 * HUD dock chip (FTHOF / REFILL). */
export function getActionVisualElement(kind: GrimoireActionKind, M: GrimoireMinigame | null): Element | null {
  const real = getGrimoireControl(kind, M);

  if (visibleRect(real)) {
    return real;
  }

  if (kind === 'fthof') {
    return document.getElementById('ccsb-dock-fthof');
  }

  if (kind === 'refill') {
    return document.getElementById('ccsb-dock-refill');
  }

  return null;
}

/** Centre of a visible element. */
export function elementCenter(el: Element | null): { x: number; y: number; rect: DOMRect } | null {
  const rect = visibleRect(el);
  if (!rect) return null;

  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect };
}

/** Grimoire/mana management: casting Force the Hand of Fate and refilling mana with a sugar
 * lump. */
export class FthofActions {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly clickTiming: ClickTiming,
    private readonly cursorController: CursorController,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  /** A FTHOF cast or lump refill is waiting for its turn (the same conditions the scheduler
   * uses). */
  fthofOrRefillPending(): boolean {
    const M = this.game.getGrimoire();
    if (!M) return false;

    const buffs = this.game.positiveCpsBuffs();

    if (!this.game.cpsBuffOutlastsClickFrenzy(buffs)) {
      return false;
    }

    const cost = getFthofCost(M);

    if (buffs.length >= 1 && (M.magic ?? 0) >= cost) {
      return true;
    }

    return buffs.length >= 2 && (M.magic ?? 0) < cost && !this.runtime.lockA && !this.runtime.refillInFlight;
  }

  /** Cast Force the Hand of Fate (task). Preconditions checked, then: click delay, move to
   * the spell button, pre-click pause, re-check everything (golden ready? frenzy? buffs?
   * mana?), click, verify via M.spellsCastTotal, record stats/log. */
  async castFthof(): Promise<void> {
    const M = this.game.getGrimoire();
    const spell = getFthofSpell(M);

    if (!M || !spell || this.game.clickFrenzyActive() || this.hasGoodGolden()) {
      return;
    }

    const cost = getFthofCost(M);

    if ((M.magic ?? 0) < cost || !this.game.cpsBuffOutlastsClickFrenzy()) {
      return;
    }

    this.runtime.currentAction = 'fthof';
    this.runtime.currentTarget = 'Force the Hand of Fate';

    // Global click delay, BEFORE moving.
    if (!(await this.clickTiming.waitForClickGap(true))) {
      return;
    }

    const control = getGrimoireControl('fthof', M);
    const visual = getActionVisualElement('fthof', M);
    const p = elementCenter(visual);

    if (!control || !control.isConnected) {
      return;
    }

    if (p) {
      const moved = await this.cursorController.moveCursorTo(p.x, p.y, true);
      if (!moved) return;
    }

    // Extra pause after arriving.
    if (!(await this.clickTiming.waitPreClick(true))) {
      return;
    }

    if (this.game.clickFrenzyActive() || this.hasGoodGolden()) {
      return;
    }

    if (!this.game.cpsBuffOutlastsClickFrenzy() || (M.magic ?? 0) < getFthofCost(M)) {
      return;
    }

    const beforeTotal = Number(M.spellsCastTotal) || 0;
    const point = p || { x: this.runtime.cursor.x, y: this.runtime.cursor.y };

    await this.clickTiming.humanClick(control, point.x, point.y);

    const casted = (Number(M.spellsCastTotal) || 0) > beforeTotal;

    if (casted) {
      this.stats.recordFthof();
      this.log.log('cast fthof', 'force the hand of fate', { cost });
    }
  }

  /** Refill mana with a sugar lump (task). Preconditions checked; temporarily disables the
   * game's 'ask before spending lumps' prompt, clicks the refill button, verifies (lumps down
   * or mana up), then sets LOCK_A and records stats/log. */
  async refillGrimoire(): Promise<void> {
    const M = this.game.getGrimoire();

    if (!M || this.runtime.refillInFlight || this.game.clickFrenzyActive() || this.hasGoodGolden()) {
      return;
    }

    const cost = getFthofCost(M);
    const buffs = this.game.positiveCpsBuffs();

    if (buffs.length < 2 || !this.game.cpsBuffOutlastsClickFrenzy(buffs) || (M.magic ?? 0) >= cost || this.runtime.lockA) {
      return;
    }

    if (!this.game.canRefillLump() || this.game.getLumps() < 1) {
      return;
    }

    this.runtime.currentAction = 'grimoire-refill';
    this.runtime.currentTarget = 'Grimoire refill';

    // Global click delay, BEFORE moving.
    if (!(await this.clickTiming.waitForClickGap(true))) {
      return;
    }

    const control = getGrimoireControl('refill', M);
    const visual = getActionVisualElement('refill', M);
    const p = elementCenter(visual);

    if (!control || !control.isConnected) {
      return;
    }

    if (p) {
      const moved = await this.cursorController.moveCursorTo(p.x, p.y, true);
      if (!moved) return;
    }

    // Extra pause after arriving.
    if (!(await this.clickTiming.waitPreClick(true))) {
      return;
    }

    if (this.game.clickFrenzyActive() || this.hasGoodGolden()) {
      return;
    }

    if (
      this.game.positiveCpsBuffs().length < 2 ||
      !this.game.cpsBuffOutlastsClickFrenzy() ||
      (M.magic ?? 0) >= getFthofCost(M) ||
      this.runtime.lockA
    ) {
      return;
    }

    if (!this.game.canRefillLump() || this.game.getLumps() < 1) {
      return;
    }

    this.runtime.refillInFlight = true;

    let didRefill = false;
    const beforeLumps = this.game.getLumps();
    const beforeMagic = Number(M.magic) || 0;
    const oldAskLumps = this.game.getAskLumpsPref();

    try {
      this.game.setAskLumpsPref(0);

      const point = p || { x: this.runtime.cursor.x, y: this.runtime.cursor.y };
      await this.clickTiming.humanClick(control, point.x, point.y);

      didRefill = this.game.getLumps() < beforeLumps || (Number(M.magic) || 0) > beforeMagic + 1;
    } finally {
      this.game.setAskLumpsPref(oldAskLumps);
      this.runtime.refillInFlight = false;
    }

    if (didRefill) {
      this.runtime.lockA = true;

      this.stats.recordRefill();
      this.log.log('refill grimoire', 'sugar lump', { cpsBuffCount: buffs.length });
      this.log.log('lock A', `refill used at ${buffs.length} cps buffs`);
    }
  }
}
