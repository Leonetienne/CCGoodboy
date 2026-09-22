import { AutoHammer } from './autoplay/auto-hammer';
import { IncomeTracker } from './autoplay/income-tracker';
import { AutoPlayEngine } from './autoplay/shopping';
import { PersistedData } from './core/persisted-data';
import { RuntimeState } from './core/runtime-state';
import { BotStateMachine } from './core/state-machine';
import { BuffLockTracker } from './game/buffs-lock';
import { GameAdapter } from './game/game-adapter';
import { GoldenCookieModel } from './game/golden-cookie-model';
import { HurryMode } from './game/hurry-mode';
import { ClickBigCookieTask } from './hunting/click-big-cookie';
import { ClickGoldenTask } from './hunting/click-golden';
import { FthofActions } from './hunting/fthof';
import { GoldenQueue } from './hunting/golden-queue';
import { danceEligible, HappyDance } from './hunting/happy-dance';
import { IdleBehavior } from './idle/idle-behavior';
import { PendingWork } from './idle/pending-work';
import { BackgroundClock } from './input/background-clock';
import { CursorController } from './input/cursor-controller';
import { ClickTiming, hasGoodGolden } from './input/human-click';
import { KeepAliveController } from './input/keep-alive';
import { Bootstrap, waitForGame } from './lifecycle/bootstrap';
import { Scheduler } from './scheduler/scheduler';
import { LogStore } from './stats/log';
import { StatsRecorder } from './stats/stats';

// Entry point / composition root. See AGENTS.md for the full module map and
// the manual test plan. This file wires every module from core/game/stats/
// input/routing/hunting/idle/autoplay/scheduler/ui/rendering into one
// object graph, then hands it to lifecycle/bootstrap.ts, which waits for
// Cookie Clicker to be ready and starts the bot exactly like the original
// monolith's waitForGame()/start() did.

const data = new PersistedData();
const runtime = new RuntimeState();
const game = new GameAdapter();
const hurryMode = new HurryMode(game, data);
const log = new LogStore(data);
const stats = new StatsRecorder(data);
const buffLock = new BuffLockTracker(game, runtime, log);
const goldenCookieModel = new GoldenCookieModel(game, data, hurryMode, runtime);

const clock = new BackgroundClock();
const keepAlive = new KeepAliveController(runtime, data);
const isGoodGoldenReady = () => hasGoodGolden(goldenCookieModel);
const cursorController = new CursorController(runtime, data, hurryMode, clock, isGoodGoldenReady);
const clickTiming = new ClickTiming(runtime, data, hurryMode, clock, isGoodGoldenReady);
const goldenQueue = new GoldenQueue(runtime);

const incomeTracker = new IncomeTracker(runtime, game);

const autoHammer = new AutoHammer(runtime, data, game, log);
const hammerActive = () => autoHammer.hammerActive();

const fthof = new FthofActions(runtime, game, clickTiming, cursorController, stats, log, isGoodGoldenReady);
const fthofOrRefillPending = () => fthof.fthofOrRefillPending();

const autoPlay = new AutoPlayEngine(
  runtime,
  data,
  game,
  log,
  stats,
  cursorController,
  clock,
  incomeTracker,
  isGoodGoldenReady,
  () => hurryMode.cookieStormActive(),
  () => hurryMode.cookieChainActive(),
  fthofOrRefillPending,
);
const autoShopReady = () => autoPlay.shopReady();

const pendingWork = new PendingWork(game, isGoodGoldenReady, hammerActive, fthofOrRefillPending, autoShopReady);

const clickGolden = new ClickGoldenTask(runtime, game, clickTiming, cursorController, stats, log, () =>
  danceEligible(data, game, () => hurryMode.cookieChainActive(), () => pendingWork.isPending()),
);

const clickBigCookie = new ClickBigCookieTask(
  runtime,
  data,
  game,
  clickTiming,
  cursorController,
  log,
  hammerActive,
  isGoodGoldenReady,
  fthofOrRefillPending,
  autoShopReady,
);

const happyDance = new HappyDance(
  runtime,
  data,
  game,
  clock,
  () => hurryMode.cookieChainActive(),
  () => pendingWork.isPending(),
);

const idleBehavior = new IdleBehavior(runtime, data, cursorController, clickTiming, clock, pendingWork);

const stateMachine = new BotStateMachine(runtime);

const scheduler = new Scheduler(runtime, game, log, buffLock, goldenCookieModel, goldenQueue, stateMachine, {
  runtime,
  data,
  game,
  clickGolden,
  clickBigCookie,
  fthof,
  autoPlay,
  happyDance,
  idleBehavior,
  hammerActive,
});

const bootstrap = new Bootstrap({
  runtime,
  data,
  game,
  log,
  clock,
  keepAlive,
  scheduler,
  goldenCookieModel,
  goldenQueue,
  clickTiming,
  hurryMode,
  autoPlay,
  incomeTracker,
});

waitForGame(bootstrap);
