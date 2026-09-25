import { VERSION } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { GrimoireView } from '../hunting/grimoire-view';
import type { AutoPlayEngine } from '../autoplay/shopping';
import type { WrinklerPopper } from '../autoplay/wrinkler-popper';
import type { AscensionPlanner } from '../autoplay/ascension';
import type { AscensionRunner } from '../autoplay/ascension-runner';
import type { IncomeTracker } from '../autoplay/income-tracker';
import type { IGameAdapter } from '../game/game-adapter';
import type { StockTrader } from '../market/stock-trader';
import type { GoldenCookieModel } from '../game/golden-cookie-model';
import type { HurryMode } from '../game/hurry-mode';
import type { GoldenQueue } from '../hunting/golden-queue';
import type { BackgroundClock } from '../input/background-clock';
import type { ClickTiming } from '../input/human-click';
import type { KeepAliveController } from '../input/keep-alive';
import { resizeOverlayCanvas } from '../rendering/overlay-canvas';
import type { LogStore } from '../stats/log';
import { DebugPanel, DebugTools } from './debug/debug-tools';
import type { UpdateChecker } from '../lifecycle/update-check';
import { createPanelElement } from './gui-frames/panel-dom';
import { applyFramePosition, applyPanelPosition, setupFrameDrag, setupPanelDrag } from './gui-frames/panel-drag';
import { PanelUpdater } from './gui-frames/panel-updater';
import { SettingsPanel, updateRangeReadout } from './settings/settings-panel';
import { applyFrameOpacity, injectStyles } from './styles';
import { GraphsPanel } from './stats-window/graphs-panel';
import { LogsPanel } from './stats-window/logs-panel';

export interface UiRootDeps {
  runtime: RuntimeState;
  data: PersistedData;
  game: IGameAdapter;
  log: LogStore;
  goldenCookieModel: GoldenCookieModel;
  goldenQueue: GoldenQueue;
  clickTiming: ClickTiming;
  hurryMode: HurryMode;
  autoPlay: AutoPlayEngine;
  wrinklerPopper: WrinklerPopper;
  grimoireView: GrimoireView;
  clock: BackgroundClock;
  keepAlive: KeepAliveController;
  incomeTracker: IncomeTracker;
  ascension: AscensionPlanner;
  ascensionRunner: AscensionRunner;
  stockTrader: StockTrader;
  updateChecker: UpdateChecker;
}

/** Builds the whole interface once at start: overlay canvas, HUD panel, graphs/logs/debug
 * modals, settings inputs and every event handler (minimize, pause, hammer, toggles, export,
 * debug). Element ids all start with 'ccsb-'. */
export class UiRoot {
  readonly overlayCanvas: HTMLCanvasElement;
  readonly overlayCtx: CanvasRenderingContext2D;
  readonly panel: HTMLDivElement;
  readonly graphsPanel: GraphsPanel;
  readonly logsPanel: LogsPanel;
  readonly debugTools: DebugTools;
  readonly debugPanel: DebugPanel;
  readonly panelUpdater: PanelUpdater;
  readonly settingsPanel: SettingsPanel;

  private readonly deps: UiRootDeps;

  constructor(deps: UiRootDeps) {
    this.deps = deps;
    const { runtime, data, game, log, goldenCookieModel, goldenQueue, clickTiming, hurryMode, autoPlay, wrinklerPopper, grimoireView, clock, keepAlive, incomeTracker, ascension, ascensionRunner } = deps;

    injectStyles();
    applyFrameOpacity(data.config.frameOpacity ?? 0.95);

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.id = 'ccsb-overlay';
    document.body.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d')!;

    this.panel = createPanelElement(VERSION);
    document.body.appendChild(this.panel);

    this.graphsPanel = new GraphsPanel(data);
    document.body.appendChild(this.graphsPanel.element);

    this.logsPanel = new LogsPanel(data);
    document.body.appendChild(this.logsPanel.element);

    this.debugTools = new DebugTools(runtime, game, grimoireView, wrinklerPopper, deps.updateChecker);
    this.debugPanel = new DebugPanel(this.debugTools);
    document.body.appendChild(this.debugPanel.element);

    this.panelUpdater = new PanelUpdater(this.panel, runtime, data, game, goldenCookieModel, goldenQueue, clickTiming, hurryMode, autoPlay, wrinklerPopper, ascension, ascensionRunner, deps.stockTrader, clock, keepAlive);

    this.settingsPanel = new SettingsPanel(this.panel, data, runtime, keepAlive, () => {
      applyFrameOpacity(data.config.frameOpacity);

      if (this.graphsPanel.isOpen) {
        this.graphsPanel.draw();
      }
    });

    this.panel.classList.toggle('minimized', !!data.ui.minimized);
    document.getElementById('ccsb-minimize')!.textContent = data.ui.minimized ? '+' : '−';
    document.getElementById('ccsb-settings')!.classList.toggle('open', !!data.ui.settingsOpen);

    // Settings are staged: editing only marks them "unsaved". They are validated, applied and
    // stored on Save.
    for (const input of Array.from(this.panel.querySelectorAll<HTMLInputElement>('[data-setting]'))) {
      const key = input.dataset.setting!;
      const configValue = (data.config as unknown as Record<string, unknown>)[key];
      input.value = String(configValue);

      if (input.type === 'range') {
        updateRangeReadout(this.panel, key, Number(configValue));
        input.addEventListener('input', () => updateRangeReadout(this.panel, key, Number(input.value)));
      }

      input.addEventListener('input', () => this.settingsPanel.setDirty(true));
      input.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          this.settingsPanel.save();
        }
      });
    }

    const bindCheckbox = (id: string, checked: boolean) => {
      const box = document.getElementById(id) as HTMLInputElement;
      box.checked = checked;
      box.addEventListener('change', () => this.settingsPanel.setDirty(true));
      return box;
    };

    bindCheckbox('ccsb-visuals', !!data.config.visuals);
    bindCheckbox('ccsb-idle-wander', data.config.idleWander !== false);
    bindCheckbox('ccsb-buyvalue', data.config.showBuyValue !== false);
    bindCheckbox('ccsb-keepalive', data.config.keepAlive !== false);
    bindCheckbox('ccsb-grimoire-fthof', data.config.grimoireFthof !== false);
    bindCheckbox('ccsb-spend-lumps', data.config.spendLumps !== false);
    bindCheckbox('ccsb-stock-market', data.config.stockMarket !== false);
    bindCheckbox('ccsb-auto-hammer', data.config.autoHammer !== false);
    bindCheckbox('ccsb-auto-grandmapocalypse', data.config.autoGrandmapocalypse !== false);
    bindCheckbox('ccsb-auto-pop-wrinklers', data.config.autoPopWrinklers !== false);
    bindCheckbox('ccsb-auto-krumblor', data.config.autoKrumblor !== false);
    bindCheckbox('ccsb-ascend-overlay', data.config.showAscendOverlay !== false);
    bindCheckbox('ccsb-auto-ascend', data.config.autoAscend !== false);

    autoPlay.applyVisibility();

    bindCheckbox('ccsb-auto-dry', data.config.autoDryRun === true);

    document.getElementById('ccsb-auto-toggle')!.addEventListener('click', () => {
      autoPlay.setAutoPlay(data.config.autoPlay !== true);
      this.panelUpdater.update();
    });

    document.getElementById('ccsb-save-settings')!.addEventListener('click', () => this.settingsPanel.save());

    document.getElementById('ccsb-minimize')!.addEventListener('click', () => {
      data.ui.minimized = !data.ui.minimized;
      this.panel.classList.toggle('minimized', data.ui.minimized);
      document.getElementById('ccsb-minimize')!.textContent = data.ui.minimized ? '+' : '−';
      applyPanelPosition(this.panel, data);
      data.scheduleSave();
    });

    document.getElementById('ccsb-pause')!.addEventListener('click', () => {
      runtime.running = !runtime.running;
      log.log(runtime.running ? 'bot resumed' : 'bot paused', 'manual');
      this.panelUpdater.update();
    });

    document.getElementById('ccsb-hammer')!.addEventListener('click', () => {
      runtime.hammer = !runtime.hammer;

      if (runtime.hammer) {
        runtime.nextBigClickAt = Date.now();
      } else {
        // ponder where the paw stopped
        runtime.idleStay = true;
      }

      log.log('hammer cookie', runtime.hammer ? 'on' : 'off');
      this.panelUpdater.update();
    });

    document.getElementById('ccsb-toggle-settings')!.addEventListener('click', () => {
      data.ui.settingsOpen = !data.ui.settingsOpen;
      document.getElementById('ccsb-settings')!.classList.toggle('open', data.ui.settingsOpen);
      data.scheduleSave();
    });

    document.getElementById('ccsb-toggle-graphs')!.addEventListener('click', () => this.graphsPanel.toggle());
    document.getElementById('ccsb-close-graphs')!.addEventListener('click', () => this.graphsPanel.toggle());

    document.getElementById('ccsb-toggle-logs')!.addEventListener('click', () => this.logsPanel.toggle());
    document.getElementById('ccsb-close-logs')!.addEventListener('click', () => this.logsPanel.toggle());

    document.getElementById('ccsb-toggle-debug')!.addEventListener('click', () => this.debugPanel.toggle());
    document.getElementById('ccsb-close-debug')!.addEventListener('click', () => this.debugPanel.toggle());

    this.debugPanel.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      const b = target && target.closest ? (target.closest('[data-debug]') as HTMLElement | null) : null;

      if (b) {
        this.debugPanel.run(Number(b.dataset.debug), log);
      }
    });

    document.getElementById('ccsb-log-filter')!.addEventListener('input', () => this.logsPanel.render());
    document.getElementById('ccsb-export-json')!.addEventListener('click', () => this.logsPanel.export('json'));
    document.getElementById('ccsb-export-csv')!.addEventListener('click', () => this.logsPanel.export('csv'));

    this.panelUpdater.update();
    resizeOverlayCanvas(this.overlayCanvas, this.overlayCtx);

    setupPanelDrag(this.panel, data, () => data.scheduleSave());
    applyPanelPosition(this.panel, data);

    setupFrameDrag(this.graphsPanel.element, data, { posKey: 'graphsPos', header: this.graphsPanel.element.querySelector('.ccsb-modal-head') }, () => data.scheduleSave());
    setupFrameDrag(this.logsPanel.element, data, { posKey: 'logsPos', header: this.logsPanel.element.querySelector('.ccsb-modal-head') }, () => data.scheduleSave());
    setupFrameDrag(this.debugPanel.element, data, { posKey: 'debugPos', header: this.debugPanel.element.querySelector('.ccsb-modal-head') }, () => data.scheduleSave());

    this.applyFramePositions();

    window.addEventListener('resize', this.onResizeOverlay);
    window.addEventListener('resize', this.onResizePanel);
  }

  private applyFramePositions = (): void => {
    const { data } = this.deps;

    applyPanelPosition(this.panel, data);
    applyFramePosition(this.graphsPanel.element, data, { posKey: 'graphsPos', header: this.graphsPanel.element.querySelector('.ccsb-modal-head') });
    applyFramePosition(this.logsPanel.element, data, { posKey: 'logsPos', header: this.logsPanel.element.querySelector('.ccsb-modal-head') });
    applyFramePosition(this.debugPanel.element, data, { posKey: 'debugPos', header: this.debugPanel.element.querySelector('.ccsb-modal-head') });
  };

  private onResizeOverlay = (): void => {
    resizeOverlayCanvas(this.overlayCanvas, this.overlayCtx);
  };

  private onResizePanel = (): void => {
    this.applyFramePositions();
  };

  /** Removes the resize listeners this UiRoot added and every DOM element it created. The rest
   * of teardown (timers, keep-alive, the worker clock, beforeunload, mouse-sync) belongs to
   * lifecycle/bootstrap.ts. */
  destroy(): void {
    window.removeEventListener('resize', this.onResizeOverlay);
    window.removeEventListener('resize', this.onResizePanel);

    for (const id of ['ccsb-panel', 'ccsb-graphs', 'ccsb-logs', 'ccsb-debug', 'ccsb-overlay', 'ccsb-style']) {
      document.getElementById(id)?.remove();
    }
  }
}
