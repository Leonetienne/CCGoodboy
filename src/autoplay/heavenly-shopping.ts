import type { HeavenlyUpgradeInfo } from '../game/types';

// Pure heavenly shopping list (ASC-9): which heavenly upgrades an ascension at a given level
// buys, and up to which level the run should go on so the chips pay for them.

/** The lucky heavenly upgrades and how many 7s the prestige level must contain for each to show
 * up in the ascension tree (their `showIf` in the game's main.js counts the 7s anywhere in the
 * number, `(Game.prestige+'').split('7').length-1`). Highest tier first. */
export const LUCKY_UPGRADES: ReadonlyArray<{ name: string; sevens: number }> = [
  { name: 'Lucky payout', sevens: 4 },
  { name: 'Lucky number', sevens: 2 },
  { name: 'Lucky digit', sevens: 1 },
];

/** How far nextLevelWithSevens() looks ahead. Four 7s are always found within 10^5 levels
 * (the last five digits cycle through x7777), so this is only a safety net. */
const MAX_LEVEL_SEARCH = 200000;

/** How many 7s a prestige level contains, exactly like the game's showIf reads it. */
export function countSevens(level: number): number {
  return String(level).split('7').length - 1;
}

/** Smallest whole level >= `from` containing at least `sevens` 7s (null if none within the
 * search window). */
export function nextLevelWithSevens(from: number, sevens: number): number | null {
  const start = Math.max(0, Math.ceil(from));

  for (let level = start; level <= start + MAX_LEVEL_SEARCH; level++) {
    if (countSevens(level) >= sevens) return level;
  }

  return null;
}

/** What the bot wants from the heavenly tree, most wanted first (ASC-9). Parents are bought
 * along with a wish (missingChain), so e.g. Kitten angels drags in Twin Gates and
 * Angels .. Dominions. Left out on purpose: things the bot cannot use (permanent upgrade slots
 * need an upgrade picked; the golden switch turns golden cookies off; the shimmering veil,
 * season switcher and sugar frenzy are switches; cosmetics; the gifting/ticker/dragon petting
 * extras). Names as in the game's main.js 2.058. */
export const HEAVENLY_PRIORITY: readonly string[] = [
  'Legacy',
  'Heavenly cookies',
  'How to bake your dragon',
  'Heavenly luck',
  'Tin of british tea biscuits',
  'Box of macarons',
  'Box of brand biscuits',
  'Tin of butter cookies',
  'Starter kit',
  'Persistent memory',
  'Lasting fortune',
  'Lucky digit',
  'Starter kitchen',
  'Decisive fate',
  'Kitten angels',
  'Unholy bait',
  'Halo gloves',
  'Lucky number',
  'Divine discount',
  'Divine sales',
  'Synergies Vol. I',
  'Divine bakeries',
  'Elder spice',
  'Sacrilegious corruption',
  'Five-finger discount',
  'Synergies Vol. II',
  'Wrinkly cookies',
  'Distilled essence of redoubled luck',
  'Lucky payout',
  'Stevia Caelestis',
  'Sugar baking',
  'Diabetica Daemonicus',
  'Aura gloves',
  'Sugar crystal cookies',
  'Kitten wages',
  'Cat ladies',
  'Luminous gloves',
  'Milkhelp&reg; lactose intolerance relief tablets',
  'Box of maybe cookies',
  'Box of not cookies',
  'Box of pastries',
];

export interface HeavenlyShopInput {
  heavenly: HeavenlyUpgradeInfo[];
  /** Game.prestige: the level owned now. */
  prestige: number;
  /** Game.heavenlyChips: unspent chips now. */
  heavenlyChips: number;
  /** The lowest level the ascension may happen at. */
  fromLevel: number;
  /** Seconds until the run reaches `level` (0 at or below the pending level). */
  etaTo: (level: number) => number;
  /** How long the run may go on for an ordinary wish (setting). */
  shopWaitSec: number;
  /** At most this many levels above fromLevel for ordinary wishes (a share of the levels the
   * ascension gains anyway; Infinity: no cap). Lucky wishes only mind their time budget. */
  maxExtraLevels?: number;
  /** How long the run may go on for a lucky upgrade's level (setting). */
  luckyWaitSec: number;
  priority?: readonly string[];
}

export interface ShopItem {
  name: string;
  price: number;
}

export interface ShopWish {
  name: string;
  /** Chips for it and its parents not on the list yet. */
  cost: number;
  /** The level it would need (null: no level with enough 7s found). */
  level: number | null;
  etaSec: number;
}

export interface HeavenlyShopPlan {
  /** The level to ascend at: the lowest one >= fromLevel where the chips pay for `items` and
   * every lucky upgrade on it shows up. */
  level: number;
  /** Seconds until the run reaches `level` (0 once there). */
  etaSec: number;
  /** What to buy there, in buying order (parents first). */
  items: ShopItem[];
  cost: number;
  /** Chips after ascending at `level` (before buying). */
  chipsAt: number;
  /** The wish that pushed `level` above fromLevel last (what the run waits for), or null. */
  waitFor: string | null;
  /** The first ordinary wish the bot does NOT wait for (too far off); its chips are kept for
   * it, so nothing below it on the list is bought either. */
  next: ShopWish | null;
  /** Lucky upgrades left out because their level is too far off. */
  skippedLucky: ShopWish[];
  /** How many 7s `level` must contain for the lucky upgrades on the list (0: none on it). */
  sevens: number;
}

/** The parents-first chain of `name` minus what is owned or already taken; null if unknown. */
function missingChain(name: string, byName: Map<string, HeavenlyUpgradeInfo>, taken: Set<string>): HeavenlyUpgradeInfo[] | null {
  const out: HeavenlyUpgradeInfo[] = [];
  const seen = new Set<string>();

  const visit = (n: string): boolean => {
    if (seen.has(n) || taken.has(n)) return true;
    seen.add(n);

    const up = byName.get(n);
    if (!up) return false;
    if (up.bought) return true;
    if (!up.parents.every(visit)) return false;

    out.push(up);
    return true;
  };

  return visit(name) ? out : null;
}

const SEVENS = new Map(LUCKY_UPGRADES.map((l) => [l.name, l.sevens]));

/** ASC-9: walks the priority list and takes each wish (with its missing parents) as long as the
 * run reaches a level that pays for everything taken so far within the wait budget (a lucky
 * wish also needs its 7s, within the lucky budget). An ordinary wish that is too far off ends
 * the list (its chips are saved for it); a lucky one is just skipped. */
export function planHeavenlyShopping(input: HeavenlyShopInput): HeavenlyShopPlan {
  const byName = new Map(input.heavenly.map((u) => [u.name, u]));
  const taken = new Set<string>();
  const items: ShopItem[] = [];
  const skippedLucky: ShopWish[] = [];

  let level = input.fromLevel;
  let sevens = 0;
  let cost = 0;
  let waitFor: string | null = null;
  let next: ShopWish | null = null;

  for (const name of input.priority ?? HEAVENLY_PRIORITY) {
    const chain = missingChain(name, byName, taken);
    if (!chain || !chain.length) continue;

    const chainCost = chain.reduce((sum, u) => sum + u.price, 0);
    const chainSevens = Math.max(0, ...chain.map((u) => SEVENS.get(u.name) ?? 0));
    const needSevens = Math.max(sevens, chainSevens);

    // 1 chip per level: chips at L = heavenlyChips + (L - prestige).
    const chipsLevel = Math.ceil(input.prestige + cost + chainCost - input.heavenlyChips);
    let at: number | null = Math.max(level, chipsLevel);
    if (needSevens > 0) at = nextLevelWithSevens(at, needSevens);

    const lucky = chainSevens > sevens;
    const etaSec = at == null ? Infinity : input.etaTo(at);
    // Worth waiting for: no extra level at all, or within the time budget and, for an ordinary
    // wish, only a few chips short (the extra levels a small share of what the ascension gains).
    const fewShort = lucky || at == null || at - input.fromLevel <= (input.maxExtraLevels ?? Infinity);
    const ok = at != null && (at === level || (fewShort && etaSec <= (lucky ? input.luckyWaitSec : input.shopWaitSec)));

    if (!ok) {
      const wish = { name, cost: chainCost, level: at, etaSec };
      if (lucky) {
        skippedLucky.push(wish);
        continue;
      }
      next = wish;
      break;
    }

    if (at! > level) waitFor = name;
    level = at!;
    sevens = needSevens;
    cost += chainCost;

    for (const u of chain) {
      taken.add(u.name);
      items.push({ name: u.name, price: u.price });
    }
  }

  return {
    level,
    etaSec: input.etaTo(level),
    items,
    cost,
    chipsAt: input.heavenlyChips + (level - input.prestige),
    waitFor,
    next,
    skippedLucky,
    sevens,
  };
}
