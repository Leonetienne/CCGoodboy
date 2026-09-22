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
}

/** An upgrade (Game.Upgrades entry / a Game.UpgradesInStore row). */
export interface GameUpgrade {
  name: string;
  desc?: string;
  bought?: boolean | number;
  pool?: string;
  power?: number;
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
