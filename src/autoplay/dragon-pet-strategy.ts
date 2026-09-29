/** Petting Krumblor (DRAGON-PET-*), the pure part. With the heavenly upgrade "Pet the dragon"
 * a click on the dragon's picture in its popup (Game.ClickSpecialPic, main.js 2.058) has, from
 * dragonLevel 8 on, a 1 in 20 chance to unlock one of four upgrades into the store. Which one
 * is fixed by the clock: the four are shuffled with a per-save seed, and the current quarter
 * hour picks one (minutes / 60 x 4). A drop already owned or unlocked gives nothing, so petting
 * only makes sense while the current quarter hour's drop is still missing. */

/** The game's drop list (Game.ClickSpecialPic), before its seeded shuffle. */
export const DRAGON_DROPS = ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear'];
/** The heavenly upgrade that makes the dragon pettable. */
export const PET_THE_DRAGON = 'Pet the dragon';
/** Drops only come from this dragonLevel on (the pet itself works from 4). */
export const DRAGON_PET_MIN_LEVEL = 8;

/** The drop the current quarter hour offers (order = the save's shuffled drop list). */
export function dragonDropAt(order: string[], date: Date): string | null {
  if (!order.length) return null;
  return order[Math.floor((date.getMinutes() / 60) * order.length)] ?? null;
}

/** Seconds until the next window whose drop is in `wanted` starts (0 if the current one's
 * is), or null when none is wanted. */
export function nextDropWindowSec(order: string[], date: Date, wanted: readonly string[]): number | null {
  if (!order.length) return null;

  const windowSec = 3600 / order.length;
  const inHour = date.getMinutes() * 60 + date.getSeconds();
  const at = Math.floor(inHour / windowSec);

  for (let k = 0; k < order.length; k++) {
    const drop = order[(at + k) % order.length]!;
    if (wanted.includes(drop)) return k === 0 ? 0 : Math.max(0, (at + k) * windowSec - inHour);
  }

  return null;
}

export interface DragonPetState {
  /** "Pet the dragon" is owned. */
  hasPet: boolean;
  dragonLevel: number;
  /** The save's shuffled drop order (null: unknown). */
  order: string[] | null;
  /** Drops neither owned nor unlocked (waiting in the store). */
  missing: string[];
  now: Date;
  /** The dragon's popup is open (Game.specialTab === 'dragon'). */
  menuOpen: boolean;
  /** ... and the paw opened it for petting (so the paw closes it again). */
  menuOurs: boolean;
}

export type DragonPetStep =
  | { kind: 'open-menu'; drop: string }
  | { kind: 'pet'; drop: string }
  | { kind: 'close-menu' }
  | { kind: 'wait'; why: string; inSec: number }
  | { kind: 'done'; why: string };

/** The next step: open the popup and pet while the current quarter hour's drop is missing;
 * otherwise put the popup the paw opened away again and wait for the next window with a
 * missing drop, or stop for good once all four are owned or in the store. */
export function nextPetStep(s: DragonPetState): DragonPetStep {
  const settle = (step: DragonPetStep): DragonPetStep => (s.menuOpen && s.menuOurs ? { kind: 'close-menu' } : step);

  if (!s.hasPet) return settle({ kind: 'done', why: 'no "Pet the dragon" yet' });
  if (!s.missing.length) return settle({ kind: 'done', why: 'Krumblor has nothing left to drop' });
  if (s.dragonLevel < DRAGON_PET_MIN_LEVEL) return settle({ kind: 'done', why: `Krumblor drops things from level ${DRAGON_PET_MIN_LEVEL} on` });
  if (!s.order) return settle({ kind: 'done', why: "I don't know Krumblor's drops" });

  const drop = dragonDropAt(s.order, s.now);

  if (!drop || !s.missing.includes(drop)) {
    const inSec = nextDropWindowSec(s.order, s.now, s.missing) ?? 900;
    return settle({ kind: 'wait', why: `${drop || 'this drop'} is already mine`, inSec });
  }

  return s.menuOpen ? { kind: 'pet', drop } : { kind: 'open-menu', drop };
}
