import { VERSION } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { AutoPlayEngine } from '../autoplay/shopping';
import type { IncomeTracker } from '../autoplay/income-tracker';
import type { IGameAdapter } from '../game/game-adapter';
import type { GoldenCookieModel } from '../game/golden-cookie-model';
import type { HurryMode } from '../game/hurry-mode';
import type { GoldenQueue } from '../hunting/golden-queue';
import { dispatchMouse } from '../input/dispatch';
import type { BackgroundClock } from '../input/background-clock';
import type { ClickTiming } from '../input/human-click';
import type { KeepAliveController } from '../input/keep-alive';
import { PawCursor } from '../rendering/paw-cursor';
import type { Scheduler } from '../scheduler/scheduler';
import { OverlayLoop } from '../scheduler/overlay-loop';
import type { LogStore } from '../stats/log';
import { UiRoot } from '../ui/root';

export interface PublicApi {
  version: string;
  pause: () => void;
  resume: () => void;
  state: RuntimeState;
  clickFrenzySec: () => number;
  data: PersistedData;
  save: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    __CCSmartGoldenComboBot?: PublicApi;
  }
}

export interface BootstrapDeps {
  runtime: RuntimeState;
  data: PersistedData;
  game: IGameAdapter;
  log: LogStore;
  clock: BackgroundClock;
  keepAlive: KeepAliveController;
  scheduler: Scheduler;
  goldenCookieModel: GoldenCookieModel;
  goldenQueue: GoldenQueue;
  clickTiming: ClickTiming;
  hurryMode: HurryMode;
  autoPlay: AutoPlayEngine;
  incomeTracker: IncomeTracker;
}

/** The user mouse events that trigger syncGameMouseFromUser(). */
const USER_SYNC_EVENTS = ['mousedown', 'mouseup', 'click'] as const;

/** A real (trusted) event, as opposed to the bot's synthetic ones. */
function isUserEvent(e: Event | null | undefined): boolean {
  return !!e && e.isTrusted === true;
}

/** Starts the bot once the game is ready, and can stop it again. Owns the timers (scheduler
 * 25ms, panel 200ms, charts 2s, overlay per frame), the public API object, and the real-mouse
 * sync. */
export class Bootstrap {
  private uiRoot: UiRoot | null = null;
  private overlayLoop: OverlayLoop | null = null;
  private pawCursor: PawCursor | null = null;

  constructor(private readonly deps: BootstrapDeps) {}

  /** Before the game handles one of the USER's mouse events, tells it where the real mouse is
   * (the game reads Game.mouseX/Y for the floating click numbers) by re-sending a mousemove at
   * the event's coordinates. Otherwise a manual click would show its number wherever the paw
   * or the last bot click left those values. Runs in the capture phase on window, so it is
   * before the game's own handlers. */
  private syncGameMouseFromUser = (e: Event): void => {
    const me = e as MouseEvent;

    if (!isUserEvent(me) || !me.target || this.deps.runtime.destroyed) {
      return;
    }

    dispatchMouse(me.target as Element, 'mousemove', me.clientX, me.clientY, 0);
  };

  private saveNow = (): void => {
    this.deps.data.saveNow();
  };

  /** Refuses a second instance, exposes the API, builds the UI, loads the paw sprites, starts
   * the timers and installs the real-mouse sync and the unload save. */
  start(): void {
    if (window.__CCSmartGoldenComboBot) {
      console.warn('[CC Good Boy] Already running.');
      return;
    }

    const { runtime, data, game, log, clock, keepAlive, scheduler, goldenCookieModel, goldenQueue, clickTiming, hurryMode, autoPlay, incomeTracker } =
      this.deps;

    window.__CCSmartGoldenComboBot = {
      version: VERSION,
      pause: () => {
        runtime.running = false;
        this.uiRoot?.panelUpdater.update();
      },
      resume: () => {
        runtime.running = true;
        this.uiRoot?.panelUpdater.update();
      },
      state: runtime,
      clickFrenzySec: () => game.estimateClickFrenzySec(),
      data,
      save: () => data.saveNow(),
      destroy: () => this.destroy(),
    };

    this.uiRoot = new UiRoot({
      runtime,
      data,
      game,
      log,
      goldenCookieModel,
      goldenQueue,
      clickTiming,
      hurryMode,
      autoPlay,
      clock,
      keepAlive,
      incomeTracker,
    });

    this.pawCursor = new PawCursor(runtime);
    this.pawCursor.load();

    runtime.nextIdleAt = Date.now() + 1500;

    clock.init();
    keepAlive.init();

    runtime.schedulerTimer = clock.every(() => scheduler.tick(), 25);

    runtime.panelTimer = window.setInterval(() => this.uiRoot!.panelUpdater.update(), 200);

    runtime.graphTimer = window.setInterval(() => {
      if (this.uiRoot!.graphsPanel.isOpen) {
        this.uiRoot!.graphsPanel.draw();
      }
    }, 2000);

    this.overlayLoop = new OverlayLoop(runtime, data, this.uiRoot.overlayCtx, game, autoPlay, this.pawCursor, {
      game,
      goldenCookieModel,
      goldenQueue,
      cursor: runtime.cursor,
    });
    this.overlayLoop.start();

    window.addEventListener('beforeunload', this.saveNow);

    USER_SYNC_EVENTS.forEach((type) => window.addEventListener(type, this.syncGameMouseFromUser, true));

    log.log('bot started', `v${VERSION}`);

    console.log('[CC Good Boy] Loaded uwu. window.__CCSmartGoldenComboBot exposes pause/resume/state/data/destroy.');
  }

  /** Stops everything and removes all elements/listeners (exposed on the API; useful for hot
   * reloading). */
  destroy(): void {
    const { runtime, clock, keepAlive } = this.deps;

    runtime.destroyed = true;
    runtime.running = false;

    USER_SYNC_EVENTS.forEach((type) => window.removeEventListener(type, this.syncGameMouseFromUser, true));

    clock.stop(runtime.schedulerTimer || null);
    keepAlive.stop();
    clock.terminateWorker();

    clearInterval(runtime.panelTimer);
    clearInterval(runtime.graphTimer);

    if (runtime.drawRaf) {
      cancelAnimationFrame(runtime.drawRaf);
    }

    this.deps.data.saveNow();

    this.uiRoot?.destroy();

    window.removeEventListener('beforeunload', this.saveNow);

    delete window.__CCSmartGoldenComboBot;

    console.log('[CC Good Boy] Destroyed... bye bye :c');
  }
}

/** Polls every 500ms until the game object, its shimmer list and the big cookie exist, then
 * starts the bot. */
export function waitForGame(bootstrap: Bootstrap): void {
  const Game = window.Game;

  if (!Game || !Game.ready || !Array.isArray(Game.shimmers) || !document.getElementById('bigCookie')) {
    setTimeout(() => waitForGame(bootstrap), 500);
    return;
  }

  bootstrap.start();
}
