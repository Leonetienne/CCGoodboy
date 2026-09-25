import { sayOops } from './console-voice';
import { STORAGE_KEY, VERSION, clampInt, hourKey } from './constants';

export interface Config {
  goldenMinIntervalMs: number;
  goldenMinFadeCurve: number;
  preClickDelayMs: number;
  idleWander: boolean;
  idleSpeedPxPerSec: number;
  happyDanceMs: number;
  hammerStepPx: number;
  panicFactor: number;
  clickFrenzyCps: number;
  clickFrenzyJitterMs: number;
  cursorSpeedPxPerSec: number;
  visuals: boolean;
  chartHours: number;
  retentionDays: number;
  logLimit: number;
  showBuyValue: boolean;
  frameOpacity: number;
  overlayOpacity: number;
  keepAlive: boolean;
  grimoireFthof: boolean;
  spendLumps: boolean;
  stockMarket: boolean;
  stockMaxShare: number;
  ascendLuckyWaitSec: number;
  ascendMinBoost: number;
  ascendShopWaitSec: number;
  ascendShopWaitShare: number;
  showAscendOverlay: boolean;
  autoAscend: boolean;
  ascendDumpBank: boolean;
  autoPlay: boolean;
  autoDryRun: boolean;
  autoInsignificantSec: number;
  autoGoodFactor: number;
  autoBiggerImpact: number;
  autoReachSec: number;
  autoReserveSec: number;
  autoWizardTowerTarget: number;
  autoHammer: boolean;
  autoHammerMinShare: number;
  autoProbeIntervalSec: number;
  autoProbeSec: number;
  autoGrandmapocalypse: boolean;
  autoPopWrinklers: boolean;
  autoWrinklerMaturity: number;
  autoKrumblor: boolean;
}

export interface Stats {
  totalGolden: number;
  byKind: Record<string, number>;
  fthofCasts: number;
  grimoireRefills: number;
  lumpHarvests: number;
  autoBuys: number;
  wrinklersPopped: number;
  ascensions: number;
  stockTrades: number;
  /** Cookies the paw made (+) or lost (-) on the stock market: every sale against what the
   * bot paid for the units sold (STOCK-6). */
  stockProfit: number;
  /** Per good id: units the bot bought and still holds, and what it paid for them (cookies,
   * overhead included). */
  stockBasis: Record<string, StockBasis>;
}

export interface StockBasis {
  units: number;
  cookies: number;
}

export interface HourlyBucket {
  golden: Record<string, number>;
  fthof: number;
  refill: number;
}

export interface LogEntry {
  action: string;
  meta: string;
  ts: number;
  extra?: Record<string, unknown>;
}

export interface UiState {
  minimized: boolean;
  panelPos: { left: number; top: number } | null;
  settingsOpen: boolean;
  graphsPos: { left: number; top: number } | null;
  logsPos: { left: number; top: number } | null;
  debugPos: { left: number; top: number } | null;
}

export interface PersistedState {
  /** Script version that last saved this state ('' until the first save). */
  version: string;
  config: Config;
  stats: Stats;
  hourly: Record<string, HourlyBucket>;
  logs: LogEntry[];
  ui: UiState;
}

/** Reference for every setting (label, range, meaning) lives in AGENTS.md. */
export const DEFAULTS: PersistedState = {
  version: '',
  config: {
    goldenMinIntervalMs: 200,
    goldenMinFadeCurve: 0.55,
    preClickDelayMs: 100,
    idleWander: true,
    idleSpeedPxPerSec: 320,
    happyDanceMs: 2200,
    hammerStepPx: 3,
    panicFactor: 0.2,
    clickFrenzyCps: 8,
    clickFrenzyJitterMs: 30,
    cursorSpeedPxPerSec: 4200,
    visuals: true,
    chartHours: 48,
    retentionDays: 30,
    logLimit: 10000,
    showBuyValue: true,
    frameOpacity: 0.95,
    overlayOpacity: 1,
    keepAlive: true,
    grimoireFthof: true,
    spendLumps: true,
    stockMarket: true,
    stockMaxShare: 0.5,
    ascendLuckyWaitSec: 86400,
    ascendMinBoost: 2,
    ascendShopWaitSec: 21600,
    ascendShopWaitShare: 0.1,
    showAscendOverlay: true,
    autoAscend: true,
    ascendDumpBank: true,
    autoPlay: false,
    autoDryRun: false,
    autoInsignificantSec: 60,
    autoGoodFactor: 1.2,
    autoBiggerImpact: 3,
    autoReachSec: 1800,
    autoReserveSec: 0,
    autoWizardTowerTarget: 57,
    autoHammer: true,
    autoHammerMinShare: 0.05,
    autoProbeIntervalSec: 300,
    autoProbeSec: 10,
    autoGrandmapocalypse: true,
    autoPopWrinklers: true,
    autoWrinklerMaturity: 5,
    autoKrumblor: true,
  },
  stats: {
    totalGolden: 0,
    byKind: {},
    fthofCasts: 0,
    grimoireRefills: 0,
    lumpHarvests: 0,
    autoBuys: 0,
    wrinklersPopped: 0,
    ascensions: 0,
    stockTrades: 0,
    stockProfit: 0,
    stockBasis: {},
  },
  hourly: {},
  logs: [],
  ui: {
    minimized: false,
    panelPos: null,
    settingsOpen: false,
    graphsPos: null,
    logsPos: null,
    debugPos: null,
  },
};

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** Merges a stored/incoming state over the defaults. Top-level objects (config, stats, ui)
 * are merged key by key so newly added defaults survive; other keys (hourly, logs) are taken
 * as stored, whole. Only one level deep on purpose, matching the original bot's contract. */
export function mergeDefaults(base: PersistedState, incoming: unknown): PersistedState {
  const out = clone(base) as unknown as Record<string, unknown>;
  if (!incoming || typeof incoming !== 'object') {
    return out as unknown as PersistedState;
  }

  const incomingObj = incoming as Record<string, unknown>;

  for (const key of Object.keys(out)) {
    if (incomingObj[key] === undefined) continue;

    const current = out[key];
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      out[key] = Object.assign({}, current as object, incomingObj[key] as object);
    } else {
      out[key] = incomingObj[key];
    }
  }

  return out as unknown as PersistedState;
}

function loadStoredState(): PersistedState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return mergeDefaults(DEFAULTS, parsed);
  } catch (e) {
    sayOops('Wanted to remember my settings, but I couldn\'t load them :c', e);
    return clone(DEFAULTS);
  }
}

/** Owns the persisted state (config, stats, hourly, logs, ui): loading, debounced saving and
 * pruning. Everything else (stats recording, log appending) is a separate class that takes a
 * PersistedData instance rather than reaching into localStorage itself. */
export class PersistedData {
  private state: PersistedState;
  private saveTimer = 0;
  /** Version that saved the state found at load, or null for a fresh install. Differs from
   * VERSION right after an update. */
  readonly previousVersion: string | null;

  constructor() {
    this.state = loadStoredState();
    this.previousVersion = this.state.version || null;
    this.state.version = VERSION;
  }

  get config(): Config {
    return this.state.config;
  }

  get stats(): Stats {
    return this.state.stats;
  }

  get hourly(): Record<string, HourlyBucket> {
    return this.state.hourly;
  }

  get logs(): LogEntry[] {
    return this.state.logs;
  }

  get ui(): UiState {
    return this.state.ui;
  }

  scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = 0;
    }

    this.pruneStoredData();

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      sayOops('Wanted to save my stuff, but I couldn\'t :c', e);
    }
  }

  /** Drops hourly buckets older than 'History retention days' and trims the log to
   * 'Log entries to keep' (oldest first). */
  pruneStoredData(): void {
    const cutoff = Date.now() - Math.max(1, Number(this.state.config.retentionDays) || 30) * 86400000;

    for (const key of Object.keys(this.state.hourly)) {
      if (Number(key) < cutoff) {
        delete this.state.hourly[key];
      }
    }

    const limit = clampInt(this.state.config.logLimit, 100, 50000, 10000);
    if (this.state.logs.length > limit) {
      this.state.logs = this.state.logs.slice(-limit);
    }
  }

  /** Gets (creating if needed) the hourly statistics bucket for a timestamp. */
  ensureBucket(tsMs: number): HourlyBucket {
    const key = String(hourKey(tsMs));

    if (!this.state.hourly[key]) {
      this.state.hourly[key] = { golden: {}, fthof: 0, refill: 0 };
    }

    return this.state.hourly[key];
  }

  /** Appends a log entry, trims to the configured limit, and schedules a save. */
  appendLog(entry: LogEntry): void {
    this.state.logs.push(entry);

    const limit = clampInt(this.state.config.logLimit, 100, 50000, 10000);
    if (this.state.logs.length > limit) {
      this.state.logs.splice(0, this.state.logs.length - limit);
    }

    this.scheduleSave();
  }
}
