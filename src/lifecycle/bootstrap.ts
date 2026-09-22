import { sayYay } from '../core/console-voice';
import { VERSION } from '../core/constants';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { GrimoireView } from '../hunting/grimoire-view';
import type { AutoPlayEngine } from '../autoplay/shopping';
import type { WrinklerPopper } from '../autoplay/wrinkler-popper';
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
  wrinklerPopper: WrinklerPopper;
  grimoireView: GrimoireView;
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

  /** Remembers the real human cursor position from trusted mousemove events. Synthetic bot
   * moves are ignored, so the paw never mistakes its own movement for the user's. */
  private trackUserMouse = (e: Event): void => {
    const me = e as MouseEvent;

    if (!isUserEvent(me) || this.deps.runtime.destroyed) {
      return;
    }

    this.deps.runtime.userMouse = { x: me.clientX, y: me.clientY };
  };

  /** Records trusted (real human) clicks with a small bounded history so the ponder action
   * can detect a click on the paw. Synthetic bot clicks are ignored. */
  private trackUserClick = (e: Event): void => {
    const me = e as MouseEvent;
    const clicks = this.deps.runtime.userClicks;

    if (!isUserEvent(me) || this.deps.runtime.destroyed) {
      return;
    }

    const now = performance.now();
    clicks.push({ x: me.clientX, y: me.clientY, t: now });

    const cutoff = now - 5000;
    while (clicks.length && clicks[0]!.t < cutoff) {
      clicks.shift();
    }
  };

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

    const { runtime, data, game, log, clock, keepAlive, scheduler, goldenCookieModel, goldenQueue, clickTiming, hurryMode, autoPlay, wrinklerPopper, grimoireView, incomeTracker } =
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
      wrinklerPopper,
      grimoireView,
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
    window.addEventListener('mousemove', this.trackUserMouse, true);
    window.addEventListener('click', this.trackUserClick, true);

    log.log('bot started', `v${VERSION}`);

    sayYay('Hiii, missed you!! Ready to catch cookies for you :3');
  }

  /** Stops everything and removes all elements/listeners (exposed on the API; useful for hot
   * reloading). */
  destroy(): void {
    const { runtime, clock, keepAlive } = this.deps;

    runtime.destroyed = true;
    runtime.running = false;

    USER_SYNC_EVENTS.forEach((type) => window.removeEventListener(type, this.syncGameMouseFromUser, true));
    window.removeEventListener('mousemove', this.trackUserMouse, true);
    window.removeEventListener('click', this.trackUserClick, true);

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

/** How long to wait after the game reports ready before the bot starts (LIFE-1). */
export const GAME_SETTLE_MS = 1000;

/** Polls every 500ms until the game object, its shimmer list and the big cookie exist, then
 * starts the bot GAME_SETTLE_MS later. */
export function waitForGame(bootstrap: Bootstrap): void {
  const Game = window.Game;

  if (!Game || !Game.ready || !Array.isArray(Game.shimmers) || !document.getElementById('bigCookie')) {
    setTimeout(() => waitForGame(bootstrap), 500);
    return;
  }

  // Game.ready flips before everything is loaded (minigame scripts such as the Grimoire come
  // in asynchronously), so let the page settle before doing anything (LIFE-1).
  setTimeout(() => bootstrap.start(), GAME_SETTLE_MS);
}
