import { DRAGON_CURSOR_AURA, DRAGONFLIGHT_AURA, RADIANT_APPETITE_AURA } from '../game/dragon-dom';

/** Krumblor (KRUMB-*), the pure part: which ONE step comes next. Mirrors Game.dragonLevels in
 * main.js 2.058: levels 0-4 are paid in cookies (1M, 2M, 4M, 8M, 16M: "Chip it" x3, "Hatch
 * it", "Train Breath of Milk"), each level 5-24 sacrifices 100 of one building
 * (Game.ObjectsById[level - 5]: cursors ... You), level 25 ("Bake dragon cookie") 50 of every
 * building, level 26 ("Train secondary aura") 200 of every building, and at level 27 the
 * dragon is fully trained with a second aura slot. Aura `id` is known from level `id + 4`.
 *
 * The dragon is trained in three stages (KRUMB-1), each unlocked by the run: 1 Dragon Cursor
 * (level 6) as soon as there is a dragon, 2 Dragonflight (level 14) once the run owns 150
 * shipments, 3 fully trained (level 27, Radiant Appetite + Dragonflight) once it owns 220
 * "You". The auras are independent of the stage: the dragon wears the best of Radiant
 * Appetite > Dragonflight > Dragon Cursor it knows, one per slot (KRUMB-5). */

/** Dragon levels paid in cookies; level `l` costs 1M x 2^l. */
export const DRAGON_COOKIE_LEVELS = 5;
/** The first level whose training sacrifices buildings (Dragon Cursor: 100 cursors). */
export const DRAGON_SACRIFICE_FIRST = 5;
/** Buildings each single-building sacrifice level takes. */
export const DRAGON_SACRIFICE = 100;
/** Game.ObjectsById order: the building level `DRAGON_SACRIFICE_FIRST + i` sacrifices. */
export const DRAGON_SACRIFICE_BUILDINGS = [
  'Cursor',
  'Grandma',
  'Farm',
  'Mine',
  'Factory',
  'Bank',
  'Temple',
  'Wizard tower',
  'Shipment',
  'Alchemy lab',
  'Portal',
  'Time machine',
  'Antimatter condenser',
  'Prism',
  'Chancemaker',
  'Fractal engine',
  'Javascript console',
  'Idleverse',
  'Cortex baker',
  'You',
];
/** The levels that sacrifice N of EVERY building: "Bake dragon cookie", "Train secondary aura". */
export const DRAGON_ALL_SACRIFICES: Record<number, number> = { 25: 50, 26: 200 };
/** Fully trained: two aura slots. */
export const DRAGON_FULL_LEVEL = 27;

export type KrumblorStage = 1 | 2 | 3;

/** The level each stage trains the dragon to: it then knows Dragon Cursor, Dragonflight, and
 * everything with two slots. */
export const KRUMBLOR_STAGE_LEVEL: Record<KrumblorStage, number> = {
  1: DRAGON_CURSOR_AURA + 4,
  2: DRAGONFLIGHT_AURA + 4,
  3: DRAGON_FULL_LEVEL,
};
/** Stage 2 starts once the run owns this many shipments, stage 3 this many "You". */
export const KRUMBLOR_STAGE2_SHIPMENTS = 150;
export const KRUMBLOR_STAGE3_YOU = 220;

/** The auras the bot puts on, best first; any other aura is the player's and stays. */
export const KRUMBLOR_AURAS = [RADIANT_APPETITE_AURA, DRAGONFLIGHT_AURA, DRAGON_CURSOR_AURA];

/** The stage the run's buildings unlock right now (the trainer latches the highest one per
 * run, since the sacrifices drop the counts again). */
export function krumblorStageFor(shipments: number, you: number): KrumblorStage {
  if (you >= KRUMBLOR_STAGE3_YOU) return 3;
  if (shipments >= KRUMBLOR_STAGE2_SHIPMENTS) return 2;
  return 1;
}

/** Cookie cost of training the dragon from `level` (levels 0-4 only). */
export function dragonCookieCost(level: number): number {
  return 1e6 * Math.pow(2, level);
}

/** What training from `level` sacrifices: building id (Game.ObjectsById) -> how many. Empty
 * for a level paid in cookies or the fully trained dragon. */
export function dragonSacrificePlan(level: number): Map<number, number> {
  const plan = new Map<number, number>();
  const all = DRAGON_ALL_SACRIFICES[level];

  if (all) {
    DRAGON_SACRIFICE_BUILDINGS.forEach((_n, id) => plan.set(id, all));
  } else {
    const id = level - DRAGON_SACRIFICE_FIRST;
    if (id >= 0 && id < DRAGON_SACRIFICE_BUILDINGS.length) plan.set(id, DRAGON_SACRIFICE);
  }

  return plan;
}

/** What training every level in [from, end) sacrifices together: building id -> how many. */
export function dragonBatchNeeds(from: number, end: number): Map<number, number> {
  const needs = new Map<number, number>();

  for (let level = from; level < end; level++) {
    for (const [id, n] of dragonSacrificePlan(level)) needs.set(id, (needs.get(id) || 0) + n);
  }

  return needs;
}

/** A building as the sacrifice / rebuy steps see it. */
export interface KrumblorBuilding {
  /** Its Game.ObjectsById id (= index into DRAGON_SACRIFICE_BUILDINGS). */
  id: number;
  owned: number;
  /** What buying `n` more costs right now. */
  costOf: (n: number) => number;
}

/** Copies sold before a batch of sacrifices, to be bought back once it is over. */
export interface KrumblorRebuy {
  id: number;
  n: number;
}

export interface KrumblorState {
  eggBought: boolean;
  /** "A crumbly egg" is unlocked and sits in the store. */
  eggInStore: boolean;
  eggCost: number;
  dragonLevel: number;
  /** Aura ids in slot 0 / slot 1 (0 = No aura). */
  auras: [number, number];
  /** How far this run trains the dragon (KRUMBLOR_STAGE_LEVEL). */
  stage: KrumblorStage;
  /** The level the batch of sacrifices under way ends at (it started selling or training),
   * or null. */
  batchEnd: number | null;
  /** The aura highlighted in the open picker (Game.SelectingDragonAura). */
  selectingAura: number;
  /** The dragon's popup is open (Game.specialTab === 'dragon'). */
  menuOpen: boolean;
  /** ... and the paw opened it (so the paw closes it again). */
  menuOurs: boolean;
  /** The "Set your dragon's aura" prompt the PAW opened is up. */
  pickerOurs: boolean;
  /** Every building the game has (a missing one can't be sacrificed). */
  buildings: KrumblorBuilding[];
  /** Copies sold before the batch, still to be bought back. */
  rebuy: KrumblorRebuy[];
  /** Bank minus the auto play reserve (AUTO-6). */
  spendable: number;
  /** Cookies that could be raised for a batch without a loss (KRUMB-2): the stock market's
   * wins (every good above what it cost, STOCK-9) and the mature wrinklers (WRINK-2). */
  funds: { stocks: number; wrinklers: number };
}

export type KrumblorStep =
  | { kind: 'buy-egg'; cost: number }
  | { kind: 'open-menu'; end?: number }
  | { kind: 'train'; level: number; end?: number }
  | { kind: 'sell-buildings'; id: number; n: number; end: number }
  | { kind: 'buy-buildings'; id: number; n: number; restore: boolean }
  | { kind: 'open-aura'; slot: 0 | 1; aura: number }
  | { kind: 'pick-aura'; slot: 0 | 1; aura: number }
  | { kind: 'confirm-aura'; slot: 0 | 1; aura: number }
  | { kind: 'close-menu' }
  | { kind: 'raise-funds'; cost: number; stocks: number; wrinklers: number; end: number }
  | { kind: 'wait'; why: string }
  | { kind: 'done'; why: string };

/** The next aura to put on, or null. Slots holding "No aura" or one of the bot's auras are
 * the bot's to fill (slot 1 only exists at level 27); the best known bot auras go into them,
 * one each, and an aura the player picked is never replaced. */
export function nextAuraGoal(dragonLevel: number, auras: [number, number]): { slot: 0 | 1; aura: number } | null {
  const slots: (0 | 1)[] = dragonLevel >= DRAGON_FULL_LEVEL ? [0, 1] : [0];
  const managed = slots.filter((slot) => auras[slot] === 0 || KRUMBLOR_AURAS.includes(auras[slot]));
  const want = KRUMBLOR_AURAS.filter((a) => dragonLevel >= a + 4).slice(0, managed.length);

  const aura = want.find((a) => !auras.includes(a));
  const slot = managed.find((sl) => !want.includes(auras[sl]));

  return aura === undefined || slot === undefined ? null : { slot, aura };
}

/** What buying every missing copy for the batch [from, end) costs (Infinity when a building
 * isn't in the game). */
export function krumblorBatchCost(s: KrumblorState, from: number, end: number): number {
  const byId = new Map(s.buildings.map((b) => [b.id, b]));
  let cost = 0;

  for (const [id, need] of dragonBatchNeeds(from, end)) {
    const b = byId.get(id);
    if (!b) return Infinity;
    if (b.owned < need) cost += b.costOf(need - b.owned);
  }

  return cost;
}

/** The longest batch of sacrifice levels [from, end) (end <= target) whose missing buildings
 * `budget` pays for together; 0 if not even the first level's. */
export function krumblorBatchEnd(s: KrumblorState, from: number, target: number, budget: number): number {
  let best = 0;

  for (let end = from + 1; end <= target; end++) {
    if (!(krumblorBatchCost(s, from, end) <= budget)) return best;
    best = end;
  }

  return best;
}

/** The next step. Cookie costs (the egg, the egg levels, buildings bought for a sacrifice)
 * are paid from the bank as long as the reserve (AUTO-6) stays.
 *
 * Sacrifices go in batches (KRUMB-2): the longest run of the stage's next levels whose
 * missing buildings the bank pays for is picked, and a batch never starts before it does.
 * When the stock market's wins and the mature wrinklers would pay for a longer one (or any at
 * all), those are raised first. Then the missing buildings are bought, every copy above
 * what the whole batch takes is sold (you get 25% of the priciest ones back), the dragon is
 * trained through the batch level after level (taking the cheapest copies), and only after
 * the batch (and any batch right behind it) the sold copies are bought back, all of them, at
 * the cheapest prices. Auras go
 * on between batches only: switching one costs a copy of the highest building, which a batch
 * may still need. */
export function nextKrumblorStep(s: KrumblorState): KrumblorStep {
  const affordable = (cost: number) => cost <= s.spendable;
  const goal = nextAuraGoal(s.dragonLevel, s.auras);

  if (s.pickerOurs) {
    if (!goal) return { kind: 'wait', why: 'nothing to pick' };

    return s.selectingAura === goal.aura ? { kind: 'confirm-aura', ...goal } : { kind: 'pick-aura', ...goal };
  }

  // Idle or waiting: put the popup the paw opened away again.
  const settle = (step: KrumblorStep): KrumblorStep => (s.menuOpen && s.menuOurs ? { kind: 'close-menu' } : step);

  if (!s.eggBought) {
    if (!s.eggInStore) return settle({ kind: 'done', why: 'no crumbly egg in the store yet' });

    return affordable(s.eggCost) ? { kind: 'buy-egg', cost: s.eggCost } : settle({ kind: 'wait', why: 'saving for the crumbly egg' });
  }

  const byId = new Map(s.buildings.map((b) => [b.id, b]));
  const levelReady = (level: number) => [...dragonSacrificePlan(level)].every(([id, n]) => (byId.get(id)?.owned ?? 0) >= n);

  // A batch under way: sell what it doesn't take, then train through it. (One that can't go
  // on, e.g. the player sold a building it needs, is over.)
  if (s.batchEnd !== null && s.dragonLevel < s.batchEnd && levelReady(s.dragonLevel)) {
    return runBatch(s, s.dragonLevel, s.batchEnd, byId);
  }

  const target = KRUMBLOR_STAGE_LEVEL[s.stage];
  const training = s.dragonLevel >= DRAGON_COOKIE_LEVELS && s.dragonLevel < target;
  const end = training ? krumblorBatchEnd(s, s.dragonLevel, target, s.spendable) : 0;
  const extra = Math.max(0, s.funds.stocks) + Math.max(0, s.funds.wrinklers);
  const endFunded = training && extra > 0 ? krumblorBatchEnd(s, s.dragonLevel, target, s.spendable + extra) : 0;

  // Between batches: buy back what the last one sold, then put on the best auras. When the
  // next batch can start right away the rebuy waits for it: whatever it sold again would
  // only come back at 25%.
  const back = s.rebuy.find((r) => r.n > 0);
  if (back && !end) return { kind: 'buy-buildings', id: back.id, n: back.n, restore: true };

  if (goal && !back) return s.menuOpen ? { kind: 'open-aura', ...goal } : { kind: 'open-menu' };

  if (s.dragonLevel >= target) return settle({ kind: 'done', why: `stage ${s.stage} done` });

  if (s.dragonLevel < DRAGON_COOKIE_LEVELS) {
    if (!affordable(dragonCookieCost(s.dragonLevel))) return settle({ kind: 'wait', why: `saving for dragon level ${s.dragonLevel + 1}` });

    return s.menuOpen ? { kind: 'train', level: s.dragonLevel } : { kind: 'open-menu' };
  }

  // Stocks and wrinklers would pay for a longer batch: cash them in first (stocks first, they
  // lose nothing; wrinklers only for what is still missing).
  if (endFunded > end) {
    const cost = krumblorBatchCost(s, s.dragonLevel, endFunded);
    const stocks = Math.max(0, s.funds.stocks);
    const wrinklers = Math.max(0, cost - s.spendable - stocks);

    return settle({ kind: 'raise-funds', cost, stocks, wrinklers, end: endFunded });
  }

  // The next batch: only the copies it is short of are bought, the rest sold down to what it
  // takes, then it starts.
  if (!end) {
    const short = [...dragonSacrificePlan(s.dragonLevel)].find(([id, n]) => (byId.get(id)?.owned ?? 0) < n);
    const what = short ? `${short[1] - (byId.get(short[0])?.owned ?? 0)} more ${DRAGON_SACRIFICE_BUILDINGS[short[0]]}` : 'the next sacrifice';

    return settle({ kind: 'wait', why: `saving for ${what} (dragon level ${s.dragonLevel + 1})` });
  }

  for (const [id, need] of dragonBatchNeeds(s.dragonLevel, end)) {
    const b = byId.get(id)!;
    if (b.owned < need) return { kind: 'buy-buildings', id, n: need - b.owned, restore: false };
  }

  return runBatch(s, s.dragonLevel, end, byId);
}

/** Inside a batch [from, end): open the popup, sell every copy above what the rest of the
 * batch takes, then train the next level. */
function runBatch(s: KrumblorState, from: number, end: number, byId: Map<number, KrumblorBuilding>): KrumblorStep {
  if (!s.menuOpen) return { kind: 'open-menu', end };

  for (const [id, need] of dragonBatchNeeds(from, end)) {
    const owned = byId.get(id)?.owned ?? 0;
    if (owned > need) return { kind: 'sell-buildings', id, n: owned - need, end };
  }

  return { kind: 'train', level: from, end };
}

/** The aura names the log uses. */
export function auraName(id: number): string {
  return id === RADIANT_APPETITE_AURA ? 'Radiant Appetite' : id === DRAGONFLIGHT_AURA ? 'Dragonflight' : id === DRAGON_CURSOR_AURA ? 'Dragon Cursor' : `aura ${id}`;
}
