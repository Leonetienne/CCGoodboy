import { VERSION } from './core/constants';
import { PersistedData } from './core/persisted-data';
import { RuntimeState } from './core/runtime-state';
import { BuffLockTracker } from './game/buffs-lock';
import { GameAdapter } from './game/game-adapter';
import { GoldenCookieModel } from './game/golden-cookie-model';
import { HurryMode } from './game/hurry-mode';
import { LogStore } from './stats/log';
import { StatsRecorder } from './stats/stats';

// Entry point / composition root. Modules land here phase by phase as the
// legacy/cc-bot.original.js monolith gets ported (see AGENTS.md).
//
// Phase 1 (current): core state, persistence, game adapter, golden-cookie
// model and stats/logging are wired up. Scheduler, actions, idle, auto
// play and UI are not ported yet, so the bot does not run.

const data = new PersistedData();
const runtime = new RuntimeState();
const game = new GameAdapter();
const hurryMode = new HurryMode(game, data);
const log = new LogStore(data);
const stats = new StatsRecorder(data);
const buffLock = new BuffLockTracker(game, runtime, log);
const goldenCookieModel = new GoldenCookieModel(game, data, hurryMode, runtime);

void stats;
void buffLock;
void goldenCookieModel;

console.log(`CC Good Boy ${VERSION}: core layer online, bot not yet migrated.`);
