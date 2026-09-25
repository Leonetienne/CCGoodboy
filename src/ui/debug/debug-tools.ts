import { sayCant } from '../../core/console-voice';
import type { GrimoireView } from '../../hunting/grimoire-view';
import type { WrinklerPopper } from '../../autoplay/wrinkler-popper';
import type { RuntimeState } from '../../core/runtime-state';
import type { IGameAdapter } from '../../game/game-adapter';
import type { LogStore } from '../../stats/log';
import { escapeHtml, formatNum } from '../format';

export interface DebugTool {
  label: string;
  run: () => string;
}

/** Debug tools (cheats): for testing the hunter without waiting for cookies. They use the
 * game's own spawning code, e.g. new Game.shimmer('golden', ...) with a forced effect, exactly
 * like the game's own Force the Hand of Fate. */
export class DebugTools {
  readonly tools: DebugTool[];

  constructor(
    private readonly runtime: RuntimeState,
    private readonly game: IGameAdapter,
    private readonly buildingsNav: Pick<GrimoireView, 'debugShowBuildingsView' | 'debugScrollToWizardTowers' | 'debugShowGrimoire'>,
    private readonly wrinklers: Pick<WrinklerPopper, 'debugPopWrinkler'>,
  ) {
    this.tools = [
      { label: 'Spawn random Golden Cookie', run: () => this.spawnGolden('random golden cookie', {}) },
      { label: 'Spawn Wrath Cookie', run: () => this.spawnGolden('wrath cookie', { wrath: true }) },
      { label: 'Spawn Frenzy Cookie', run: () => this.spawnGolden('frenzy cookie', { force: 'frenzy' }) },
      { label: 'Spawn Click Frenzy Cookie', run: () => this.spawnGolden('click frenzy cookie', { force: 'click frenzy' }) },
      { label: 'Spawn Building Frenzy Cookie', run: () => this.spawnGolden('building frenzy cookie', { force: 'building special' }) },
      { label: 'Spawn Cookie Chain', run: () => this.spawnCookieChain() },
      { label: 'Spawn Cookie Storm', run: () => this.spawnGolden('cookie storm', { force: 'cookie storm' }) },
      { label: 'Spawn Lucky Cookie', run: () => this.spawnGolden('lucky cookie', { force: 'multiply cookies' }) },
      {
        label: 'Spawn Cookie Storm Drop',
        run: () => this.spawnGolden('cookie storm drop', { force: 'cookie storm drop', sizeMult: Math.random() * 0.75 + 0.25 }),
      },
      { label: 'Spawn Sweet Cookie (sugar lump)', run: () => this.spawnGolden('sweet cookie (sugar lump)', { force: 'free sugar lump' }) },
      {
        label: 'Spawn Elder Frenzy Cookie (wrath)',
        run: () => this.spawnGolden('elder frenzy cookie (wrath)', { wrath: true, force: 'blood frenzy' }),
      },
      { label: 'Grant 1 quadrillion cookies', run: () => this.grantCookies(1e15, '1 quadrillion cookies') },
      { label: 'Fill Up Mana', run: () => this.fillMana() },
      { label: 'Reset Filling Up Mana cooldown', run: () => this.resetRefillCooldown() },
      { label: 'Clear LOCK_A (bot refill lock)', run: () => this.clearLockA() },
      { label: 'Give 10 Sugar Lumps', run: () => this.giveLumps(10) },
      { label: 'Ripen growing sugar lump', run: () => this.ripenLump() },
      { label: 'Spawn reindeer', run: () => this.spawnReindeer() },
      { label: 'Spawn fed wrinklers (sets stage 1)', run: () => this.spawnFedWrinklers() },
      { label: 'Spawn a wrinkler', run: () => this.spawnWrinkler() },
      { label: 'Pop a wrinkler', run: () => this.wrinklers.debugPopWrinkler() },
      { label: 'Unlock crumblor', run: () => this.unlockKrumblor() },
      { label: 'Unlock all easter upgrades', run: () => this.unlockEasterEggs() },
      { label: 'Unlock all halloween upgrades', run: () => this.unlockHalloweenCookies() },
      { label: 'Unlock all christmas upgrades', run: () => this.unlockChristmasUpgrades() },
      { label: 'Show buildings view', run: () => this.buildingsNav.debugShowBuildingsView() },
      { label: 'Scroll to Wizard towers', run: () => this.buildingsNav.debugScrollToWizardTowers() },
      { label: 'Show grimoire', run: () => this.buildingsNav.debugShowGrimoire() },
    ];
  }

  private spawnGolden(label: string, spec: { wrath?: boolean; force?: string; sizeMult?: number }): string {
    const s = this.game.spawnGoldenShimmer({ wrath: spec.wrath });

    if (spec.force) {
      s.force = spec.force;
    }

    if (spec.sizeMult) {
      s.sizeMult = spec.sizeMult;
    }

    return `spawned: ${label}`;
  }

  /** DBG-19: one reindeer runs across the screen (any season); the paw catches it (XMAS-6). */
  private spawnReindeer(): string {
    this.game.spawnReindeer();
    return 'spawned: reindeer, the paw goes after it owo';
  }

  private spawnCookieChain(): string {
    this.game.spawnCookieChain();
    return 'spawned: cookie chain (real chain: spawn lead + forced chain cookie)';
  }

  private fillMana(): string {
    const M = this.game.getGrimoire();

    if (!M) {
      throw new Error('Grimoire not available (own a Wizard tower with its minigame first)');
    }

    const max = Number(M.magicM);

    if (!Number.isFinite(max)) {
      throw new Error('could not read the maximum mana');
    }

    M.magic = max;

    return `mana filled (${formatNum(max)})`;
  }

  private resetRefillCooldown(): string {
    const result = this.game.resetLumpRefillCooldown();

    return result === 'ready' ? 'refill cooldown reset: lump refill is ready' : 'refill cooldown removed (canRefillLump overridden until reload)';
  }

  private clearLockA(): string {
    const was = this.runtime.lockA;
    this.runtime.lockA = false;

    return was ? 'LOCK_A cleared' : 'LOCK_A was already open';
  }

  private grantCookies(n: number, label: string): string {
    this.game.earnCookies(n);
    return `granted ${label} (bank now ${formatNum(this.game.getCookies())})`;
  }

  private giveLumps(n: number): string {
    this.game.gainLumps(n);
    return `gave ${n} sugar lumps (now ${formatNum(this.game.getLumps())})`;
  }

  /** DBG-12: every empty slot gets an attached wrinkler that has digested 6 hours' worth, which
   * is mature at stage 1 with the default setting (5 x ~56 min respawn). */
  private spawnFedWrinklers(): string {
    const n = this.game.spawnFedWrinklers(6 * 3600);

    return n > 0 ? `spawned ${n} fed wrinklers (6h of digesting each)` : 'every wrinkler slot is already taken';
  }

  /** DBG-15: grants the heavenly upgrade "How to bake your dragon", so the crumbly egg
   * shows up in the store. */
  private unlockKrumblor(): string {
    return this.game.unlockKrumblor()
      ? '"How to bake your dragon" granted, a crumbly egg is in the store: with auto play on, the paw trains Krumblor owo'
      : '"How to bake your dragon" granted: the crumbly egg shows up once you have baked 1 million cookies';
  }

  /** DBG-16: puts every Easter egg (usually random golden cookie / wrinkler drops) in the
   * store. */
  private unlockEasterEggs(): string {
    const n = this.game.unlockEasterEggs();

    if (!n) {
      throw new Error('every Easter egg is already unlocked or bought');
    }

    return `${n} Easter eggs are in the store now: with auto play on, the paw buys them owo`;
  }

  /** DBG-17: puts every Halloween cookie (usually random wrinkler drops) in the store. */
  private unlockHalloweenCookies(): string {
    const n = this.game.unlockHalloweenCookies();

    if (!n) {
      throw new Error('every Halloween cookie is already unlocked or bought');
    }

    return `${n} Halloween cookies are in the store now: with auto play on, the paw buys them owo`;
  }

  /** DBG-18: puts every Christmas upgrade (the festive hat, Santa's gifts, the reindeer
   * biscuits, Santa's dominion) in the store. */
  private unlockChristmasUpgrades(): string {
    const n = this.game.unlockChristmasUpgrades();

    if (!n) {
      throw new Error('every Christmas upgrade is already unlocked or bought');
    }

    return `${n} Christmas upgrades are in the store now: with auto play on, the paw buys them and evolves Santa owo`;
  }

  /** DBG-13: one wrinkler crawls into the first free slot. */
  private spawnWrinkler(): string {
    const id = this.game.spawnWrinkler();
    return `wrinkler ${id} is crawling in (~10s) owo`;
  }

  private ripenLump(): string {
    this.game.ripenLump();
    return 'sugar lump is now ripe: the paw should harvest it shortly';
  }
}

function debugPanelBodyHtml(tools: DebugTool[]): string {
  return `
<div class="ccsb-modal-head">
    <strong>CC Good Boy :3 debug tools (cheats)</strong>
    <button class="ccsb-btn" id="ccsb-close-debug">Close :3</button>
</div>
<div class="ccsb-debug-note">For testing the hunter without waiting for cookies. These change your game, so use a test save.</div>
<div class="ccsb-debug-grid">${tools.map((t, i) => `<button class="ccsb-btn" data-debug="${i}">${escapeHtml(t.label)}</button>`).join('')}</div>
<div id="ccsb-debug-status">ready :3</div>`;
}

/** The Debug tools window: builds its DOM from a DebugTools instance's tool list, runs a tool
 * by index and shows its status. */
export class DebugPanel {
  readonly element: HTMLDivElement;

  constructor(private readonly debugTools: DebugTools) {
    this.element = document.createElement('div');
    this.element.id = 'ccsb-debug';
    this.element.innerHTML = debugPanelBodyHtml(debugTools.tools);
  }

  toggle(): void {
    this.element.style.display = this.element.style.display === 'block' ? 'none' : 'block';
  }

  private setStatus(text: string, ok: boolean): void {
    const el = document.getElementById('ccsb-debug-status');
    if (!el) return;

    el.textContent = text;
    el.classList.toggle('err', !ok);
  }

  /** Runs one debug tool by index, logs it ('debug tool') and shows its status. */
  run(i: number, log: LogStore): void {
    const tool = this.debugTools.tools[i];
    if (!tool) return;

    let ok = true;
    let msg = '';

    try {
      msg = tool.run();
    } catch (e) {
      ok = false;
      msg = String(e && (e as Error).message ? (e as Error).message : e);
    }

    log.log('debug tool', tool.label, ok ? undefined : { error: msg });
    if (!ok) sayCant(`Wanted to do "${tool.label}", but ${msg} :c`);
    this.setStatus(ok ? msg : `failed: ${msg}`, ok);
  }
}
