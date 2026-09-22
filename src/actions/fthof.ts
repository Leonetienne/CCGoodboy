import { sayCant } from '../core/console-voice';
import type { RuntimeState } from '../core/runtime-state';
import type { CursorAction, CursorJobContext } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { getFthofCost, getFthofSpell, refillCanReachCost } from '../game/grimoire';
import { elementCenter, getActionVisualElement, getGrimoireControl } from '../game/grimoire-dom';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';

/** The click-at position for a Grimoire action: the visible real control, else (not on
 * screen) the current cursor position so the click still happens. */
function grimoireTarget(kind: 'fthof' | 'refill', runtime: RuntimeState, game: IGameAdapter): { x: number; y: number } {
  const p = elementCenter(getActionVisualElement(kind, game.getGrimoire()));
  return p || { x: runtime.cursor.x, y: runtime.cursor.y };
}

/** True when a FTHOF cast must not (or no longer) happen: no Grimoire/spell/control, a Click
 * Frenzy or ready golden cookie, too little mana, or no CpS buff that outlasts a Click Frenzy
 * (FT-1/FT-4). Shared by FthofAction and the FT-8 preparation steps. */
export function fthofCastBlocked(game: IGameAdapter, hasGoodGolden: () => boolean): boolean {
  const M = game.getGrimoire();
  const spell = getFthofSpell(M);
  if (!M || !spell) return true;

  const control = getGrimoireControl('fthof', M);
  if (!control || !control.isConnected) return true;

  if (game.clickFrenzyActive() || hasGoodGolden()) return true;

  const cost = getFthofCost(M);
  return (M.magic ?? 0) < cost || !game.cpsBuffOutlastsClickFrenzy();
}

/** One-shot job that casts Force the Hand of Fate. Preconditions are re-checked as the
 * abort predicate (FT-4), so the manager aborts if a golden cookie appears, a Click Frenzy
 * starts, or mana/buffs change before the click. */
export class FthofAction implements CursorAction {
  readonly label = 'cast fthof';
  readonly hud = { action: 'fthof', target: 'Force the Hand of Fate' };

  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  target(): { x: number; y: number } {
    return grimoireTarget('fthof', this.runtime, this.game);
  }

  abortIf(): boolean {
    return fthofCastBlocked(this.game, this.hasGoodGolden);
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const M = ctx.game.getGrimoire();
    const control = getGrimoireControl('fthof', M);
    if (!control || !control.isConnected) return;

    const beforeTotal = Number(M?.spellsCastTotal) || 0;
    const point = { x: ctx.runtime.cursor.x, y: ctx.runtime.cursor.y };

    await ctx.clickTiming.humanClick(control, point.x, point.y);

    const casted = (Number(M?.spellsCastTotal) || 0) > beforeTotal;

    if (casted) {
      this.stats.recordFthof();
      this.log.log('cast fthof', 'force the hand of fate', { cost: getFthofCost(M) });
    } else {
      sayCant('Wanted to cast Force the Hand of Fate, but the spell didn\'t go off :c');
    }
  }
}

/** One-shot job that spends a sugar lump to refill Grimoire mana. Same FT-4/FT-5 abort
 * semantics; the actual refill keeps the ask-lumps preference safe and then sets LOCK_A. */
export class RefillAction implements CursorAction {
  readonly label = 'refill grimoire';
  readonly hud = { action: 'grimoire-refill', target: 'Grimoire refill' };

  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly hasGoodGolden: () => boolean,
  ) {}

  target(): { x: number; y: number } {
    return grimoireTarget('refill', this.runtime, this.game);
  }

  abortIf(): boolean {
    const M = this.game.getGrimoire();
    if (!M) return true;

    const control = getGrimoireControl('refill', M);
    if (!control || !control.isConnected) return true;

    if (this.runtime.refillInFlight) return true;
    if (this.game.clickFrenzyActive() || this.hasGoodGolden()) return true;

    const cost = getFthofCost(M);
    const buffs = this.game.positiveCpsBuffs();

    if (buffs.length < 2 || !this.game.cpsBuffOutlastsClickFrenzy(buffs) || (M.magic ?? 0) >= cost || this.runtime.lockA) {
      return true;
    }

    if (!refillCanReachCost(M, cost)) return true;
    if (!this.game.canRefillLump() || this.game.getLumps() < 1) return true;

    return false;
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    const M = ctx.game.getGrimoire();
    const control = getGrimoireControl('refill', M);
    if (!control || !control.isConnected) return;

    this.runtime.refillInFlight = true;

    let didRefill = false;
    const beforeLumps = ctx.game.getLumps();
    const beforeMagic = Number(M?.magic) || 0;
    const oldAskLumps = ctx.game.getAskLumpsPref();

    try {
      ctx.game.setAskLumpsPref(0);

      const point = { x: ctx.runtime.cursor.x, y: ctx.runtime.cursor.y };
      await ctx.clickTiming.humanClick(control, point.x, point.y);

      didRefill = ctx.game.getLumps() < beforeLumps || (Number(M?.magic) || 0) > beforeMagic + 1;
    } finally {
      ctx.game.setAskLumpsPref(oldAskLumps);
      this.runtime.refillInFlight = false;
    }

    if (didRefill) {
      this.runtime.lockA = true;

      const buffCount = ctx.game.positiveCpsBuffs().length;

      this.stats.recordRefill();
      this.log.log('refill grimoire', 'sugar lump', { cpsBuffCount: buffCount });
      this.log.log('lock A', `refill used at ${buffCount} cps buffs`);
    } else {
      sayCant('Wanted to refill mana, but the sugar lump didn\'t get eaten :c');
    }
  }
}
