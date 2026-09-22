import type { PersistedData } from '../../core/persisted-data';
import type { RuntimeState } from '../../core/runtime-state';
import type { IGameAdapter } from '../../game/game-adapter';
import { autoCollect } from '../../autoplay/collector';
import type { IncomeTracker } from '../../autoplay/income-tracker';
import { autoDecide } from '../../autoplay/strategy';
import { AUTO_BLOCKED_NAMES, AUTO_BLOCKED_RE, AUTO_NON_STORE_POOLS, autoStripHtml } from '../../autoplay/valuation-tables';
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
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly incomeTracker: IncomeTracker,
    private readonly log: LogStore,
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
      { label: 'Auto play: explain store (log)', run: () => this.explainStore() },
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

  /** Lists every upgrade currently in the store with what the auto player makes of it (type,
   * cost, estimated CpS gain, payback, or why it is ignored). Written to the log
   * ('auto explain') and the console; the status line shows a summary. Use it to find out why
   * something is not bought. */
  private explainStore(): string {
    const g = autoCollect(this.game, this.data, this.runtime, this.incomeTracker);

    if ('skip' in g) return `cannot plan: ${g.skip}`;

    const store = this.game.getUpgradesInStore();
    const byName = new Map(g.cands.map((c) => [c.name, c]));
    const decision = autoDecide(g.cands, g.ctx);

    let known = 0;
    const rows: Array<{ name: string; status: string }> = [];

    for (const up of store) {
      const c = byName.get(up.name);
      let status: string;

      if (c) {
        known++;
        status = `${c.type}: cost ${Math.round(c.cost)}, +${c.dCps.toFixed(2)} CpS, payback ${Math.round(c.cost / c.dCps)}s`;
      } else if (AUTO_BLOCKED_NAMES.has(up.name) || AUTO_BLOCKED_RE.test(String(up.name))) {
        status = 'blocked on purpose';
      } else if (AUTO_NON_STORE_POOLS.has(up.pool ?? '')) {
        status = `ignored (pool ${up.pool})`;
      } else {
        status = `NOT RECOGNISED - ${autoStripHtml(up.desc).slice(0, 110)}`;
      }

      rows.push({ name: up.name, status });
      this.log.log('auto explain', up.name, { status });
    }

    if (window.console && console.table) console.table(rows);

    return `${store.length} store upgrades, ${known} recognised. Decision now: ${
      decision.buy ? 'buy ' + decision.buy.name : decision.save ? 'save for ' + decision.save.name : decision.note || 'nothing'
    }. Details in the log (action "auto explain").`;
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
    this.setStatus(ok ? msg : `failed: ${msg}`, ok);
  }
}
