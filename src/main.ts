import { AscensionPlanner } from './autoplay/ascension';
import { AscensionRunner } from './autoplay/ascension-runner';
import { AutoHammer } from './autoplay/auto-hammer';
import { BankUnlocker } from './autoplay/bank-unlock';
import { FarmUnlocker } from './autoplay/farm-unlock';
import { GrimoireUnlocker } from './autoplay/grimoire-unlock';
import { IncomeTracker } from './autoplay/income-tracker';
import { KrumblorTrainer } from './autoplay/krumblor';
import { SantaTrainer } from './autoplay/santa';
import { ButterBiscuitHunter } from './autoplay/butter-biscuit';
import { AutoPlayEngine } from './autoplay/shopping';
import { WrinklerPopper } from './autoplay/wrinkler-popper';
import { PersistedData } from './core/persisted-data';
import { RuntimeState } from './core/runtime-state';
import { BotStateMachine } from './core/state-machine';
import { BuffLockTracker } from './game/buffs-lock';
import { GameAdapter } from './game/game-adapter';
import { GoldenCookieModel } from './game/golden-cookie-model';
import { HurryMode } from './game/hurry-mode';
import { buffComboActive, ClickBigCookieTask } from './hunting/click-big-cookie';
import { ClickGoldenTask } from './hunting/click-golden';
import { BuildingsViewNavigator } from './hunting/buildings-view';
import { FthofActions } from './hunting/fthof';
import { GrimoireView } from './hunting/grimoire-view';
import { GoldenQueue } from './hunting/golden-queue';
import { danceEligible, HappyDance } from './hunting/happy-dance';
import { LumpHarvestActions } from './hunting/lump-harvest';
import { IdleBehavior } from './idle/idle-behavior';
import { StockTrader } from './market/stock-trader';
import { Gardener } from './garden/gardener';
import { PendingWork } from './idle/pending-work';
import { BackgroundClock } from './input/background-clock';
import { CursorController } from './input/cursor-controller';
import { ClickTiming, hasGoodGolden } from './input/human-click';
import { KeepAliveController } from './input/keep-alive';
import { CursorManager } from './cursor/cursor-manager';
import { JOB_PRIORITY, type JobRequest } from './cursor/types';
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
const cursorManager = new CursorManager(runtime, data, game, hurryMode, clock, cursorController, clickTiming);
const goldenQueue = new GoldenQueue(runtime);

const incomeTracker = new IncomeTracker(runtime, game);

const autoHammer = new AutoHammer(runtime, data, game, log);
const hammerActive = () => autoHammer.hammerActive() || buffComboActive(game);

const enqueueJob = (req: JobRequest) => cursorManager.enqueue(req.action, { priority: req.priority, key: req.key, dueAt: req.dueAt });
const buildingsView = new BuildingsViewNavigator(runtime, game, isGoodGoldenReady);
const grimoireView = new GrimoireView(runtime, game, log, buildingsView, enqueueJob);

const fthof = new FthofActions(runtime, game, stats, log, isGoodGoldenReady, grimoireView, data);
const fthofOrRefillPending = () => fthof.fthofOrRefillPending();

const lumpHarvest = new LumpHarvestActions(runtime, game, stats, log, isGoodGoldenReady);
const lumpHarvestPending = () => lumpHarvest.pending();

const autoPlay = new AutoPlayEngine(
  runtime,
  data,
  game,
  log,
  stats,
  incomeTracker,
  isGoodGoldenReady,
  () => hurryMode.cookieStormActive(),
  () => hurryMode.cookieChainActive(),
  fthofOrRefillPending,
);
const grimoireUnlock = new GrimoireUnlocker(runtime, data, game, log, grimoireView, () => autoPlay.shoppingInterrupted());
// The stock market (STOCK-*): its own setting, not tied to auto play; unlocked by auto play
// (AUTO-16) through the same Bank MinigameView.
const stockTrader = StockTrader.create(runtime, data, game, log, stats, buildingsView, () => autoPlay.shoppingInterrupted());
const bankUnlock = new BankUnlocker(runtime, data, game, log, stockTrader.view, () => autoPlay.shoppingInterrupted());
// The garden (GARDEN-*): its own setting, not tied to auto play; unlocked by auto play
// (AUTO-17) through the same Farm MinigameView. It never spends a lump otherwise.
const gardener = Gardener.create(runtime, data, game, log, stats, buildingsView, () => autoPlay.shoppingInterrupted());
const farmUnlock = new FarmUnlocker(runtime, data, game, log, gardener.view, () => autoPlay.shoppingInterrupted());
const krumblor = new KrumblorTrainer(runtime, data, game, log, () => autoPlay.shoppingInterrupted());
const santa = new SantaTrainer(runtime, data, game, log, () => autoPlay.shoppingInterrupted());
const butterBiscuit = new ButterBiscuitHunter(runtime, data, game, log, () => autoPlay.shoppingInterrupted());
const ascension = new AscensionPlanner(data, game);
const wrinklerPopper = new WrinklerPopper(runtime, data, game, log, stats, autoPlay);
const ascensionRunner = new AscensionRunner(runtime, data, game, log, stats, ascension, () => autoPlay.shoppingInterrupted(), stockTrader);
stockTrader.holdBuys = () => ascensionRunner.armed();
// STOCK-4: a smaller stock budget while auto play saves up for a purchase.
stockTrader.saving = () => data.config.autoPlay === true && !!(runtime.autoPlan && runtime.autoPlan.save);
ascension.leadSec = () => ascensionRunner.leadSec();
// Buying the Heavenly key starts the auto hammer's kick-off (AUTO-19).
autoPlay.onKickUpgrade = () => autoHammer.startKick();
// Anything at the auto-shop tier that wants to run right now (the buildings-view recipe or a
// debug goal, an ascension, the Grimoire, stock market or garden unlock, a Krumblor or Santa
// step, a butter biscuit top-up, a stock trade, a garden step, a wrinkler pop, a due purchase): it interrupts
// hammering and idle play at once (AUTO-8), except during the kick-off, which outranks all
// but the buildings-view recipe.
const autoShopReady = () =>
  grimoireView.pending() ||
  (!autoHammer.kicking() &&
    (ascensionRunner.pending() ||
      grimoireUnlock.pending() ||
      bankUnlock.pending() ||
      farmUnlock.pending() ||
      krumblor.pending() ||
      santa.pending() ||
      butterBiscuit.pending() ||
      stockTrader.pending() ||
      gardener.pending() ||
      wrinklerPopper.pending() ||
      autoPlay.shopReady()));

const pendingWork = new PendingWork(game, isGoodGoldenReady, hammerActive, fthofOrRefillPending, lumpHarvestPending, autoShopReady, cursorManager);

const clickGolden = new ClickGoldenTask(runtime, game, stats, log, () =>
  danceEligible(data, game, () => hurryMode.cookieChainActive(), () => pendingWork.isPending()),
);

const clickBigCookie = new ClickBigCookieTask(
  data,
  game,
  log,
  hammerActive,
  isGoodGoldenReady,
  fthofOrRefillPending,
  autoShopReady,
);

const happyDance = new HappyDance(
  data,
  game,
  () => hurryMode.cookieChainActive(),
  () => pendingWork.isPendingAbove(JOB_PRIORITY.HAPPY_DANCE),
);

const idleBehavior = new IdleBehavior(pendingWork);

const stateMachine = new BotStateMachine(runtime);

const scheduler = new Scheduler(runtime, game, log, buffLock, goldenCookieModel, goldenQueue, stateMachine, cursorManager, {
  runtime,
  data,
  game,
  clickGolden,
  clickBigCookie,
  fthof,
  lumpHarvest,
  grimoireView,
  ascension: ascensionRunner,
  grimoireUnlock,
  bankUnlock,
  farmUnlock,
  krumblor,
  santa,
  butterBiscuit,
  stockTrader,
  gardener,
  autoPlay,
  wrinklerPopper,
  happyDance,
  idleBehavior,
  hammerActive,
  hammerKick: () => autoHammer.kicking(),
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
  wrinklerPopper,
  grimoireView,
  incomeTracker,
  ascension,
  ascensionRunner,
  stockTrader,
  gardener,
});

waitForGame(bootstrap);
