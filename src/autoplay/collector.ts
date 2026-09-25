import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import type { GameBuilding, GameUpgrade } from '../game/types';
import { autoBuildingGain, autoFingerBonus, autoPerClick, autoUnbuffedCps } from './building-valuation';
import { EASTER_EGGS, easterEggGain } from './easter-eggs';
import type { IncomeTracker } from './income-tracker';
import { autoPrice, autoResearchCandidateGain, autoUpgradeGain } from './upgrade-classifier';
import {
  AUTO_BLOCKED_RE,
  AUTO_BUILDING_CAPS,
  AUTO_CURSOR_DOUBLERS,
  AUTO_ESCALATION_NAMES,
  AUTO_NON_STORE_POOLS,
  AUTO_PREF_GOLDEN,
  AUTO_PREF_WIZARD,
  AUTO_RESEARCH,
  autoStripHtml,
} from './valuation-tables';

export interface AutoConfig {
  insignificantSec: number;
  goodFactor: number;
  biggerImpact: number;
  reachSec: number;
}

export interface AutoCollectCtx {
  cps: number;
  mult: number;
  income: number;
  bank: number;
  reserve: number;
  cfg: AutoConfig;
  biscuitBase: number | null;
  cursor: GameBuilding | null;
  nonCursor: number;
  clicksPerSec: number;
  clickUnit: number;
}

export interface PurchaseCandidate {
  kind: 'building' | 'upgrade';
  type: string;
  name: string;
  obj: GameBuilding | GameUpgrade;
  cost: number;
  dCps: number;
  /** > 0 for candidates the bot should buy before ordinary ones (golden upgrades, Wizard
   * towers below their target). Higher = more preferred; Wizard towers use the top tier. */
  pref?: number;
}

export type CollectResult = { skip: string } | { cands: PurchaseCandidate[]; ctx: AutoCollectCtx };

function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Reads the game and lists every purchase option the auto player is allowed to consider. */
export function autoCollect(game: IGameAdapter, data: PersistedData, runtime: RuntimeState, incomeTracker: IncomeTracker): CollectResult {
  if (!game.isPresent() || !game.isReady()) {
    return { skip: 'game not ready' };
  }

  if (game.isAscending()) {
    return { skip: 'ascending' };
  }

  if (game.isPromptOpen()) {
    return { skip: 'a prompt is open' };
  }

  const cps = autoUnbuffedCps(game);

  if (!(cps >= 0)) {
    return { skip: 'CpS unknown' };
  }

  const objs = game.getBuildings();

  let raw = 0;
  for (const me of objs) {
    raw += Number(me && me.storedTotalCps) || 0;
  }

  const cfg: AutoConfig = {
    insignificantSec: Math.max(0, num(data.config.autoInsignificantSec, 60)),
    goodFactor: Math.max(1, num(data.config.autoGoodFactor, 1.2)),
    biggerImpact: Math.max(1, num(data.config.autoBiggerImpact, 3)),
    reachSec: Math.max(0, num(data.config.autoReachSec, 1800)),
  };

  // Attached wrinklers wither part of the CpS before it reaches the bank (their share only
  // comes back when they are popped, WRINK-*), so saving up takes that much longer.
  const withered = Math.min(1, Math.max(0, num(game.getCpsSucked(), 0)));

  const ctx: AutoCollectCtx = {
    cps,
    mult: raw > 0 ? cps / raw : 1,
    income: cps * (1 - withered) + incomeTracker.update(Date.now()),
    bank: num(game.getCookies(), 0),
    reserve: Math.max(0, num(data.config.autoReserveSec, 0)) * cps,
    cfg,
    biscuitBase: null,
    cursor: game.getBuildingByName('Cursor') || objs.find((o) => o && o.name === 'Cursor') || null,
    nonCursor: 0,
    // clicks per second the bot will click (the hammer rate), used to value clicking upgrades
    clicksPerSec: data.config.autoHammer !== false || runtime.hammer ? Math.max(0, num(data.config.clickFrenzyCps, 8)) : 0,
    clickUnit: 1,
  };

  for (const me of objs) {
    if (me && me.name !== 'Cursor') {
      ctx.nonCursor += Number(me.amount) || 0;
    }
  }

  // Cookies per "click unit": the click power is 2^(doubling upgrades) + fingers bonus x
  // non-cursor buildings + mouse % of CpS; the unit is 1 in the real game, and keeps the
  // estimates right if the game scales it. (Mouse upgrades are taken out first.)
  let doublers = 0;

  for (const nm of AUTO_CURSOR_DOUBLERS) {
    const doubler = game.getUpgradeByName(nm);
    if (doubler && doubler.bought) doublers++;
  }

  let mousePct = 0;

  for (const u of game.getUpgrades()) {
    if (u && u.bought) {
      const m = autoStripHtml(u.desc).match(/clicking gains\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*of your cps/);
      if (m) mousePct += Number(m[1]);
    }
  }

  const clickBase = autoPerClick(game) - (mousePct / 100) * (Number(game.getCookiesPs()) || 0);
  const clickDenom = Math.pow(2, doublers) + autoFingerBonus(game) * ctx.nonCursor;

  ctx.clickUnit = clickBase > 0 && clickDenom > 0 ? clickBase / clickDenom : 1;

  const cands: PurchaseCandidate[] = [];

  // Buildings (never while the store is in sell mode: buy() would SELL then).
  const caps: Record<string, number> = {
    ...AUTO_BUILDING_CAPS,
    'Wizard tower': Math.max(0, Math.floor(num(data.config.autoWizardTowerTarget, 57))),
  };

  if (game.getBuyMode() !== -1) {
    for (const me of objs) {
      if (!me || me.locked) continue;

      const cap = caps[me.name];
      if (cap != null && (Number(me.amount) || 0) >= cap) continue;

      const cost = Number(me.price);
      if (!(cost > 0)) continue;

      const gain = autoBuildingGain(game, me, ctx);

      if (gain > 0) {
        cands.push({
          kind: 'building',
          type: 'building',
          name: me.name,
          obj: me,
          cost,
          dCps: gain,
          pref: me.name === 'Wizard tower' ? AUTO_PREF_WIZARD : 0,
        });
      }
    }
  }

  // Grandmapocalypse stage 1 (WRINK-1): the research chain up to One mind, on by default.
  const grandmapocalypse = data.config.autoGrandmapocalypse !== false;
  const maturity = Math.max(1, num(data.config.autoWrinklerMaturity, 5));

  for (const up of game.getUpgradesInStore()) {
    if (!up || up.bought) continue;

    // Stage 2/3 and the pledge switches: never, whatever the settings.
    if (AUTO_ESCALATION_NAMES.has(up.name)) continue;

    if (Object.prototype.hasOwnProperty.call(AUTO_RESEARCH, up.name)) {
      if (!grandmapocalypse) continue;

      const gain = autoResearchCandidateGain(game, up, ctx, maturity);
      const cost = autoPrice(up);

      if (gain != null && gain > 0 && cost > 0) {
        cands.push({ kind: 'upgrade', type: 'research', name: up.name, obj: up, cost, dCps: gain, pref: 0 });
      }

      continue;
    }

    if (AUTO_BLOCKED_RE.test(String(up.name)) || AUTO_NON_STORE_POOLS.has(up.pool ?? '')) {
      continue;
    }

    // Easter eggs (EGG-*) have their own valuation.
    const g = EASTER_EGGS.has(up.name) ? easterEggGain(game, up, { ...ctx, maturity, reachSec: cfg.reachSec }) : autoUpgradeGain(game, up, ctx);
    if (!g || !(g.gain > 0)) continue;

    const cost = autoPrice(up);
    if (!(cost > 0)) continue;

    cands.push({
      kind: 'upgrade',
      type: g.type,
      name: up.name,
      obj: up,
      cost,
      dCps: g.gain,
      pref: (g as { pref?: number }).pref ?? (g.type === 'golden' ? AUTO_PREF_GOLDEN : 0),
    });
  }

  return { cands, ctx };
}
