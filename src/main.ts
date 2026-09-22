import { VERSION } from './core/constants';
import { PersistedData } from './core/persisted-data';
import { RuntimeState } from './core/runtime-state';
import { BuffLockTracker } from './game/buffs-lock';
import { GameAdapter } from './game/game-adapter';
import { GoldenCookieModel } from './game/golden-cookie-model';
import { HurryMode } from './game/hurry-mode';
import { BackgroundClock } from './input/background-clock';
import { CursorController } from './input/cursor-controller';
import { ClickTiming, hasGoodGolden } from './input/human-click';
import { KeepAliveController } from './input/keep-alive';
import { LogStore } from './stats/log';
import { StatsRecorder } from './stats/stats';

// Entry point / composition root. Modules land here phase by phase as the
// legacy/cc-bot.original.js monolith gets ported (see AGENTS.md).
//
// Phase 2 (current): core state, persistence, game adapter, golden-cookie
// model, stats/logging, background timers, keep-alive, cursor motion and
// click timing are wired up. Route planning is ported but not yet wired
// into a golden-cookie queue. Scheduler, actions, idle, auto play and UI
// are not ported yet, so the bot does not run.

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

void stats;
void buffLock;
void keepAlive;
void cursorController;
void clickTiming;

console.log(`CC Good Boy ${VERSION}: input layer online, bot not yet migrated.`);
