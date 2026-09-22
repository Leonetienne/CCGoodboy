import { AutoHammer } from './autoplay/auto-hammer';
import { AutoPlayEngine } from './autoplay/shopping';
import { VERSION } from './core/constants';
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
import { Scheduler } from './scheduler/scheduler';
import { LogStore } from './stats/log';
import { StatsRecorder } from './stats/stats';

// Entry point / composition root. Modules land here phase by phase as the
// legacy/cc-bot.original.js monolith gets ported (see AGENTS.md).
//
// Phase 5 (current): every module from phases 1-4 is wired into one object
// graph, including the scheduler and its priority table, so the bot is
// functionally complete end to end. What's still missing is Phase 6: the
// UI (panel, settings, graphs, logs, debug tools, overlay rendering) and
// the lifecycle bootstrap (waitForGame -> start() -> the 25ms scheduler
// loop, keep-alive init, teardown). Until that lands, the object graph
// below is built and typechecked, but never started.

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

void keepAlive;
void scheduler;

console.log(`CC Good Boy ${VERSION}: full object graph wired, lifecycle/UI not yet migrated.`);
