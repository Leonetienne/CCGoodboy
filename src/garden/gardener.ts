import { sayCant, sayCantWhile, sayYay } from '../core/console-voice';
import type { Config, PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { GardenClickAction } from '../actions/garden';
import { MinigameUnlockAction } from '../actions/minigame-unlock';
import type { IGameAdapter } from '../game/game-adapter';
import { getGardenSeed, getGardenSoil, getGardenTile } from '../game/garden-dom';
import type { GardenSnapshot } from '../game/types';
import type { BuildingsViewNavigator } from '../hunting/buildings-view';
import { MinigameView, type MinigameInfo } from '../hunting/minigame-view';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import { autoFmtTime } from '../autoplay/shopping';
import { formatShort } from '../ui/format';
import { signedCookies } from '../market/stock-trader';
import { GARDEN_CROP, GARDEN_PAYOUT, gardenMoveKey, planGardenMove, type GardenContext, type GardenMove } from './garden-strategy';

/** The Farm's minigame, for MinigameView (GARDEN-*, AUTO-17). */
export const GARDEN_INFO: MinigameInfo = {
  building: 'Farm',
  buildingPlural: 'Farms',
  minigame: 'Garden',
  unlockAction: (id, stillWanted, readLevel, onResult) =>
    new MinigameUnlockAction(
      id,
      { label: 'unlock garden', hud: { action: 'farm-unlock', target: 'Farm level 1 (Garden)' } },
      stillWanted,
      readLevel,
      onResult,
    ),
};

/** GARDEN-1: the "Tend the garden" setting (on by default). */
export function gardenEnabled(config: Pick<Config, 'garden'>): boolean {
  return config.garden !== false;
}

/** Tends the Farm's garden (GARDEN-*): keeps the plot full of Baker's wheat, harvests plants
 * before they wither, weeds out pests and keeps the best soil, every step a real click on the
 * garden's own controls (GardenClickAction), one per scheduler tick, planned fresh from the
 * live garden each time (planGardenMove). Not tied to auto play: the setting "Tend the
 * garden" switches it; it never spends a sugar lump (auto play's AUTO-17 unlock aside). */
export class Gardener {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly stats: StatsRecorder,
    readonly view: MinigameView,
    private readonly interrupted: () => boolean,
  ) {}

  static create(
    runtime: RuntimeState,
    data: PersistedData,
    game: IGameAdapter,
    log: LogStore,
    stats: StatsRecorder,
    nav: BuildingsViewNavigator,
    interrupted: () => boolean,
  ): Gardener {
    return new Gardener(runtime, data, game, log, stats, new MinigameView(game, nav, GARDEN_INFO), interrupted);
  }

  private farmOwned(): boolean {
    const farm = this.view.building();
    return !!farm && (Number(farm.amount) || 0) >= 1;
  }

  /** The live garden when the paw may work in it right now (GARDEN-7 gates), else null. */
  private garden(): GardenSnapshot | null {
    if (!gardenEnabled(this.data.config)) {
      sayCantWhile('garden', null);
      return null;
    }

    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return null;

    const snap = this.game.getGardenSnapshot();

    const why = snap ? null : !this.farmOwned() ? 'no-farm' : this.view.level() === 0 ? 'locked' : null;
    sayCantWhile(
      'garden',
      why,
      why === 'locked'
        ? 'Wanted to tend the garden, but it isn\'t unlocked yet (Farm level 0) :c'
        : 'Wanted to tend the garden, but I have no Farm yet :c',
    );

    if (!snap) return null;
    if (Date.now() < this.runtime.gardenBlockUntil || this.interrupted()) return null;

    return snap;
  }

  /** GARDEN-10: adds the garden's passive CpS gain since the last sample to its profit: the
   * share of the real income (`Game.cookiesPs`, buffs included) that is the garden's bonus,
   * cps x (1 - 1/mult). Sampled at most once a second; a gap over 5s (a throttled tab, a
   * reload) counts as 5s, so a stall never inflates it. Counted whenever the setting is on
   * and the garden is loaded, also while the paw is paused. */
  track(now = Date.now()): void {
    const snap = gardenEnabled(this.data.config) ? this.game.getGardenSnapshot() : null;
    if (!snap) {
      this.runtime.gardenTrackedAt = 0;
      return;
    }

    const last = this.runtime.gardenTrackedAt;
    if (last > 0 && now - last < 1000) return;
    this.runtime.gardenTrackedAt = now;
    if (!(last > 0)) return;

    const cps = this.game.getCookiesPs();
    const mult = snap.cpsMult;
    if (!Number.isFinite(cps) || !(mult > 0)) return;

    const sec = Math.min(5, (now - last) / 1000);
    this.stats.recordGardenProfit(cps * (1 - 1 / mult) * sec);
  }

  private context(): GardenContext {
    const reserveSec = this.data.config.autoPlay === true ? Math.max(0, Number(this.data.config.autoReserveSec) || 0) : 0;
    const cps = this.game.getUnbuffedCps();

    return {
      spendable: this.game.getCookies() - reserveSec * (Number.isFinite(cps) ? cps : 0),
      buffed: this.game.positiveCpsBuffs().length > 0,
    };
  }

  private plan(snap: GardenSnapshot): GardenMove | null {
    return planGardenMove(snap, this.context());
  }

  /** Something to do in the garden right now (the scheduler, PendingWork and hammering use it). */
  pending(): boolean {
    const snap = this.garden();
    return !!(snap && this.plan(snap));
  }

  /** The next single step (getting the garden on screen, or one click) as a job, or null. */
  job(): JobRequest | null {
    const snap = this.garden();
    if (!snap) return null;

    const move = this.plan(snap);
    if (!move) return null;

    const key = gardenMoveKey(move);
    const stillWanted = () => {
      const now = this.garden();
      const again = now && this.plan(now);
      return !!again && gardenMoveKey(again) === key;
    };

    const element = () => elementFor(move);

    const step = this.view.nextStep({
      goal: 'open',
      priority: JOB_PRIORITY.AUTO_SHOP,
      keyPrefix: 'garden',
      abortIf: () => !stillWanted(),
      allowLevelUp: false,
      onFail: (why) => this.block(10000, why),
      focus: element,
      focusLabel: { label: 'scroll to the garden', hudTarget: 'the garden', key: 'scroll-garden' },
    });

    if (step.kind === 'blocked') this.block(10000, step.why);
    if (step.kind === 'job') return step.job;
    if (step.kind !== 'ready') return null;

    return {
      action: this.clickAction(move, element, stillWanted),
      priority: JOB_PRIORITY.AUTO_SHOP,
      key: `garden:${key}`,
    };
  }

  private clickAction(move: GardenMove, element: () => Element | null, stillWanted: () => boolean): GardenClickAction {
    const live = () => this.game.getGardenSnapshot();

    if (move.kind === 'soil') {
      return new GardenClickAction({
        label: `garden soil ${move.soil.key}`,
        element,
        read: () => String(live()?.soil ?? ''),
        stillWanted,
        hudTarget: `switching the soil to ${move.soil.name}`,
        onResult: (changed) => {
          if (!changed) return this.block(3000, `switching the soil to ${move.soil.name} did not work`);
          this.log.log('garden soil', `switched to ${move.soil.name}`, { why: move.why });
        },
      });
    }

    if (move.kind === 'select') {
      return new GardenClickAction({
        label: `garden select ${move.seed.key}`,
        element,
        read: () => String(live()?.seedSelected ?? ''),
        stillWanted,
        hudTarget: `picking a ${move.seed.name} seed`,
        onResult: (changed) => {
          if (!changed) this.block(3000, `picking the ${move.seed.name} seed did not work`);
        },
      });
    }

    const { x, y } = move.tile;
    const readTile = () => {
      const t = live()?.tiles.find((tile) => tile.x === x && tile.y === y);
      return t ? String(t.plant ?? '') : '?';
    };

    if (move.kind === 'plant') {
      // the price at the click (it follows the CpS, which may have moved since planning)
      let cost = move.seed.cost;

      return new GardenClickAction({
        label: `garden plant ${move.seed.key}`,
        element,
        read: readTile,
        stillWanted,
        beforeClick: () => {
          cost = live()?.seeds.find((s) => s.id === move.seed.id)?.cost ?? move.seed.cost;
        },
        hudTarget: `planting ${move.seed.name}`,
        onResult: (changed, _before, after) => {
          if (!changed || after !== move.seed.key) return this.block(3000, `planting ${move.seed.name} did not work`);
          this.stats.recordGardenPlant();
          this.stats.recordGardenProfit(-cost);
          this.log.log('garden plant', `${move.seed.name} at ${x},${y}`, { cost: Math.round(cost) });
        },
      });
    }

    // harvest / unearth: the same tile click; only a mature plant pays, unlocks its seed and counts
    const pays = move.kind === 'harvest' && GARDEN_PAYOUT.has(move.tile.plant ?? '') && move.tile.age >= move.tile.mature;
    let cookiesBefore = 0;
    let seedsBefore = new Set<string>();

    return new GardenClickAction({
      label: `garden ${move.kind} ${move.tile.plant}`,
      element,
      read: readTile,
      stillWanted,
      beforeClick: () => {
        cookiesBefore = this.game.getCookies();
        seedsBefore = unlockedSeeds(live());
      },
      hudTarget: `${move.kind === 'harvest' ? 'harvesting' : 'weeding out'} ${move.name}`,
      onResult: (changed) => {
        if (!changed) return this.block(3000, `${move.kind === 'harvest' ? 'harvesting' : 'weeding out'} ${move.name} did not work`);

        // only a mature payout crop pays; any other difference is just the CpS during the click
        const gained = pays ? this.game.getCookies() - cookiesBefore : 0;
        if (gained > 0) this.stats.recordGardenProfit(gained);
        const now = live();
        const found = (now?.seeds ?? []).filter((s) => s.unlocked && !seedsBefore.has(s.key)).map((s) => s.name);

        if (move.kind === 'harvest') this.stats.recordGardenHarvest();
        this.log.log(`garden ${move.kind}`, `${move.name} at ${x},${y}`, {
          why: move.why,
          cookies: gained > 0 ? Math.round(gained) : undefined,
          seed: found.length ? found.join(', ') : undefined,
        });

        for (const name of found) sayYay(`Found a new seed: ${name}!! ^w^`);
      },
    });
  }

  private block(ms: number, why: string): void {
    this.runtime.gardenBlockUntil = Date.now() + ms;
    this.log.log('garden', `paused: ${why}`);
    sayCant(`Wanted to tend the garden, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }

  /** Text of the HUD row "Garden" (GARDEN-8), '' while the setting is off. */
  statusText(): string {
    if (!gardenEnabled(this.data.config)) return '';

    const snap = this.game.getGardenSnapshot();
    if (!snap) return !this.farmOwned() ? 'no Farm yet' : this.view.level() === 0 ? 'locked (Farm level 0)' : 'loading...';
    if (snap.frozen) return 'frozen (the paw leaves it alone)';

    const crop = snap.seeds.find((s) => s.key === GARDEN_CROP);
    const planted = snap.tiles.filter((t) => t.plant != null).length;
    const soil = snap.soils.find((s) => s.id === snap.soil);
    const move = this.plan(snap);
    const next = move ? `next: ${moveText(move)}` : `next garden tick in ${autoFmtTime(snap.nextTickSec)}`;

    return [
      `${planted}/${snap.tiles.length} tiles planted`,
      `${snap.cpsMult >= 1 ? '+' : ''}${formatPct(snap.cpsMult - 1)} CpS`,
      `made ${signedCookies(this.data.stats.gardenProfit || 0)}`,
      ...(soil ? [`soil ${soil.name}`] : []),
      `${snap.seeds.filter((s) => s.unlocked).length}/${snap.seeds.length} seeds`,
      ...(crop && planted < snap.tiles.length ? [`seed ${formatShort(crop.cost)} cookies`] : []),
      next,
    ].join('; ');
  }
}

/** 0.0512 -> "5.1%". */
function formatPct(x: number): string {
  return `${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;
}

function elementFor(move: GardenMove): Element | null {
  switch (move.kind) {
    case 'soil':
      return getGardenSoil(move.soil.id);
    case 'select':
      return getGardenSeed(move.seed.id);
    default:
      return getGardenTile(move.tile.x, move.tile.y);
  }
}

function moveText(move: GardenMove): string {
  switch (move.kind) {
    case 'soil':
      return `soil ${move.soil.name}`;
    case 'select':
    case 'plant':
      return `plant ${move.seed.name}`;
    default:
      return `${move.kind} ${move.name} (${move.why})`;
  }
}

function unlockedSeeds(snap: GardenSnapshot | null): Set<string> {
  return new Set((snap?.seeds ?? []).filter((s) => s.unlocked).map((s) => s.key));
}
