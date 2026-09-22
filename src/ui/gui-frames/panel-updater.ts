import type { PersistedData } from '../../core/persisted-data';
import type { RuntimeState } from '../../core/runtime-state';
import type { IGameAdapter } from '../../game/game-adapter';
import { getFthofCost } from '../../game/grimoire';
import type { GoldenCookieModel } from '../../game/golden-cookie-model';
import type { HurryMode } from '../../game/hurry-mode';
import type { BackgroundClock } from '../../input/background-clock';
import type { ClickTiming } from '../../input/human-click';
import { backgroundStatusText, type KeepAliveController } from '../../input/keep-alive';
import type { AutoPlayEngine } from '../../autoplay/shopping';
import type { GoldenQueue } from '../../hunting/golden-queue';
import { escapeHtml, formatNum, moodText, targetText } from '../format';

/** Refreshes the HUD every 200ms: Mood (+ hurry note), Chasing, Shinies waiting, Click Frenzy,
 * Buffies, Grimoire (mana, cost, lumps, refill state), LOCK_A, Click cooldown, statistics,
 * button labels. */
export class PanelUpdater {
  constructor(
    private readonly panel: HTMLElement,
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly goldenCookieModel: GoldenCookieModel,
    private readonly goldenQueue: GoldenQueue,
    private readonly clickTiming: ClickTiming,
    private readonly hurryMode: HurryMode,
    private readonly autoPlay: AutoPlayEngine,
    private readonly clock: BackgroundClock,
    private readonly keepAlive: KeepAliveController,
  ) {}

  update(): void {
    if (!this.panel || !this.game.isPresent()) {
      return;
    }

    const el = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

    const shimmers = this.goldenCookieModel.getGoldenShimmers();
    const queue = this.goldenQueue.build(shimmers.good);
    const buffs = this.game.positiveCpsBuffs();
    const M = this.game.getGrimoire();
    const cost = getFthofCost(M);
    const cooldown = Math.max(0, this.clickTiming.getClickDelayMs() - (Date.now() - this.runtime.lastClickAt));

    this.panel.classList.toggle('paused', !this.runtime.running);

    const urgency = this.hurryMode.urgencyFactor();

    el('ccsb-state')!.textContent = this.runtime.running
      ? moodText(this.runtime.currentAction) + (urgency < 1 ? ` [storm/chain: hurry x${urgency}]` : '')
      : 'paused (napping) zzz';

    el('ccsb-target')!.textContent = targetText(this.runtime.currentTarget);

    el('ccsb-queue')!.textContent = `${queue.length} ready / ${shimmers.pending.length} fading in / ${shimmers.wrath.length} yucky (wrath)`;

    el('ccsb-cf')!.textContent = this.game.clickFrenzyActive() ? 'ON (shinies still come first :3)' : 'off';

    el('ccsb-buffs')!.textContent = buffs.length ? buffs.map((b) => `${b.name} x${formatNum(b.mult)}`).join(', ') : 'none yet';

    el('ccsb-magic')!.textContent = M
      ? `${formatNum(M.magic)} / ${formatNum(M.magicM)}; FTHOF ${formatNum(cost)}; lumps ${formatNum(this.game.getLumps())}; refill ${this.game.canRefillLump() ? 'ready' : 'cooldown'}`
      : 'unavailable';

    el('ccsb-lock')!.textContent = this.runtime.lockA ? 'LOCKED' : 'OPEN';

    el('ccsb-cooldown')!.textContent = cooldown > 0 ? `${Math.ceil(cooldown)} ms` : 'ready :3';

    el('ccsb-pause')!.textContent = this.runtime.running ? 'Pause :3' : 'Resume :3';

    if (this.data.config.autoPlay === true) {
      this.autoPlay.evaluate(false);
    }

    el('ccsb-auto')!.textContent = this.autoPlay.statusText();

    el('ccsb-bg')!.textContent = backgroundStatusText(this.clock, this.runtime, this.data);

    const autoBtn = el('ccsb-auto-toggle')!;
    autoBtn.textContent = this.data.config.autoPlay === true ? 'Auto play ON ^w^' : 'Auto play :3';
    autoBtn.classList.toggle('active', this.data.config.autoPlay === true);

    const hammerBtn = el('ccsb-hammer')!;
    hammerBtn.textContent = this.runtime.hammer ? 'Hammer ON ^w^' : 'Hammer cookie :3';
    hammerBtn.classList.toggle('active', this.runtime.hammer);

    const stats = el('ccsb-stats')!;

    const kinds = Object.entries(this.data.stats.byKind).sort((a, b) => b[1] - a[1]);

    stats.innerHTML = [
      `<span>Golden cookies :3</span><b>${this.data.stats.totalGolden}</b>`,
      ...kinds.map(([kind, count]) => `<span style="padding-left:8px;color:#e7c6ff">${escapeHtml(kind)}</span><span>${count}</span>`),
      `<span>FTHOF casts ^w^</span><b>${this.data.stats.fthofCasts}</b>`,
      `<span>Grimoire refills :3</span><b>${this.data.stats.grimoireRefills}</b>`,
      ...(this.data.config.autoPlay === true ? [`<span>Auto purchases ^w^</span><b>${this.data.stats.autoBuys || 0}</b>`] : []),
    ].join('');
  }
}
