/** A live golden/wrath cookie shimmer, as exposed by Game.shimmers. */
export interface GameShimmer {
  id: number;
  type: string;
  popped?: boolean;
  force?: string;
  forceObj?: { type?: string };
  wrath?: number;
  life?: number;
  dur?: number;
  l: Element | null;
}

/** One entry of Game.buffs, before it's been shaped into a CpsBuff. */
export interface RawBuff {
  name?: string;
  dname?: string;
  multCpS?: number;
  multClick?: number;
  time?: number;
}

/** A buff that multiplies CpS, shaped for display/decision logic. */
export interface CpsBuff {
  key: string;
  name: string;
  mult: number;
  time: number;
}

/** The Grimoire (Wizard tower) minigame object. Spell objects are passed back into
 * getSpellCost() opaquely, so they're left untyped. */
export interface GrimoireMinigame {
  spells?: Record<string, unknown>;
  getSpellCost?: (spell: unknown) => number;
  magic?: number;
  magicM?: number;
  spellsCastTotal?: number;
}

/** A building (Game.Objects entry: Cursor, Grandma, Wizard tower, ...). */
export interface GameBuilding {
  name: string;
  locked?: boolean;
  price?: number;
  amount?: number;
  /** Building level (bought with sugar lumps); Wizard tower level >= 1 unlocks the Grimoire. */
  level?: number;
  /** Truthy while the building's minigame is shown ("View Grimoire" toggled on). */
  onMinigame?: boolean | number;
  storedCps?: number;
  storedTotalCps?: number;
  id?: number;
  plural?: string;
  buy(n: number): void;
  /** Sells `n` (gives back 25%, x2 with Earth Shatterer). Unlike buy(), ignores the store's
   * buy/sell mode. */
  sell?(n: number, bypass?: number): void;
  /** What buying `n` more would cost right now. */
  getSumPrice?(n: number): number;
}

/** An upgrade (Game.Upgrades entry / a Game.UpgradesInStore row). */
export interface GameUpgrade {
  name: string;
  desc?: string;
  bought?: boolean | number;
  pool?: string;
  /** +power% CpS of a cookie upgrade; a function for a few (heart biscuits: 2, 3 with Starlove). */
  power?: number | ((up: GameUpgrade) => number);
  basePrice?: number;
  getPrice?: () => number;
  /** `bypass` skips the upgrade's confirmation prompt (e.g. One mind), exactly like the
   * prompt's own "Yes" button does. */
  buy: (bypass?: number) => void;
  buildingTie1?: GameBuilding | null;
  buildingTie2?: GameBuilding | null;
  buildingTie?: GameBuilding | null;
}

/** One slot of Game.wrinklers. `phase` 0 = empty slot, 1 = crawling in, 2 = attached and
 * digesting. `x`/`y` are the anchor on #backgroundLeftCanvas (canvas pixels, near the big
 * cookie); `r` is the angle around the cookie in degrees. `type` 1 = shiny. */
export interface GameWrinkler {
  id: number;
  phase: number;
  sucked: number;
  hp?: number;
  type?: number;
  close?: number;
  x: number;
  y: number;
  r: number;
}

/** A heavenly upgrade (Game.PrestigeUpgrades, pool 'prestige'), shaped for ascension planning
 * (ASC-*). `parents` are names; `canBePurchased` is the game's own flag from its last
 * BuildAscendTree() (shown in the tree and every parent bought). */
export interface HeavenlyUpgradeInfo {
  id: number;
  name: string;
  price: number;
  bought: boolean;
  parents: string[];
  canBePurchased: boolean;
}

/** One good of the Bank's stock market minigame (STOCK-*), shaped by the game adapter from
 * `M.goodsById`. Prices are in "$", i.e. seconds of the highest raw CpS this ascension. */
export interface MarketGood {
  id: number;
  symbol: string;
  /** Shown (the building it is tied to was ever owned this ascension, `me.active`). */
  active: boolean;
  /** Current price (`me.val`). */
  val: number;
  /** Price history, newest first, up to 65 ticks (`me.vals`, what the graph shows). */
  vals: number[];
  stock: number;
  /** Warehouse space (`M.getGoodMaxStock(me)`). */
  maxStock: number;
  /** The price the good drifts back to (`M.getRestingVal(id)`: 10 + 10 id + Bank level - 1). */
  restingVal: number;
  /** Price per unit at the last purchase, without the overhead (`me.prev`, 0 if never bought). */
  lastBuyVal: number;
  /** 0: no trade this tick, 1: bought this tick (can't sell), 2: sold this tick (can't buy). */
  last: number;
}

/** The whole stock market as the trader sees it (STOCK-*). */
export interface MarketSnapshot {
  goods: MarketGood[];
  /** Market ticks since load (`M.ticks`): one per minute. */
  ticks: number;
  /** Seconds until the next tick. */
  nextTickSec: number;
  brokers: number;
  maxBrokers: number;
  /** A broker's price in cookies (20 minutes of the highest raw CpS). */
  brokerPrice: number;
  /** Buying costs price x this (1 + 20% x 0.95^brokers). */
  overhead: number;
  /** Cookies per $ (`Game.cookiesPsRawHighest`). */
  cookiesPerDollar: number;
  /** Profits so far in $ (`M.profit`, the game's own "Profits" line). */
  profit: number;
}

/** One unlocked tile of the Farm's garden (GARDEN-*), shaped by the game adapter from
 * `M.plot[y][x]` = [plant id + 1, age]. */
export interface GardenTile {
  x: number;
  y: number;
  /** The plant's key (`M.plantsById[id].key`: 'bakerWheat', 'meddleweed', ...), null if empty. */
  plant: string | null;
  /** 0-100; the plant dies at 100 (unless immortal). */
  age: number;
  /** Age from which it is mature (`me.mature`): only then does a harvest pay out, unlock its
   * seed and count. */
  mature: number;
  /** It may die on the next garden tick (the game's own "dying" look: age + the most it can
   * age in one tick >= 100). Never for an immortal plant. */
  dying: boolean;
  immortal: boolean;
}

/** One seed of the garden's seed list. */
export interface GardenSeed {
  id: number;
  key: string;
  name: string;
  /** In the seed log (can be planted). */
  unlocked: boolean;
  plantable: boolean;
  /** Planting cost right now (`M.getCost(me)`: max(its minimum, buffed CpS x its minutes)). */
  cost: number;
}

/** The whole garden as the gardener sees it (GARDEN-*). */
export interface GardenSnapshot {
  /** Only the tiles the Farm's level has unlocked. */
  tiles: GardenTile[];
  seeds: GardenSeed[];
  /** Current soil id (`M.soil`: 0 dirt, 1 fertilizer, 2 clay, 3 pebbles, 4 wood chips). */
  soil: number;
  /** Soils in id order with the farms each needs (`me.req`). */
  soils: Array<{ id: number; key: string; name: string; req: number }>;
  /** Seconds until the soil may be changed again (0 = now). */
  soilCooldownSec: number;
  /** The player froze the garden (`M.freeze`). */
  frozen: boolean;
  /** Seed id selected for planting (`M.seedSelected`, -1 = none). */
  seedSelected: number;
  nextTickSec: number;
  /** Farms owned (soils need 50/100/200/300 of them). */
  farms: number;
  /** The garden's CpS multiplier right now (`M.effs.cps`: 1.05 = +5%; 1 while frozen). */
  cpsMult: number;
}
