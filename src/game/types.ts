/** A live golden/wrath cookie shimmer, as exposed by Game.shimmers. */
export interface GameShimmer {
  id: number;
  type: string;
  popped?: boolean;
  force?: string;
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
}
