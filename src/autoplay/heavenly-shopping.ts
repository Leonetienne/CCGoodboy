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

/** ASC-9: a lucky wish the run already waits for (`luckyKeepSevens`) keeps its place while its
 * ETA stays within this many times the lucky wait budget: the ETA comes from the measured
 * income, which swings with every golden cookie, so a wish right at the budget's edge would
 * otherwise drop out of the plan and the bot would ascend without it. */
export const LUCKY_KEEP_FACTOR = 2;

/** How far nextLevelWithSevens() looks ahead. Four 7s are always found within 10^5 levels
 * (the last five digits cycle through x7777), so this is only a safety net. */
const MAX_LEVEL_SEARCH = 200000;

/** How many 7s a prestige level contains, exactly like the game's showIf reads it. */
export function countSevens(level: number): number {
  return String(level).split('7').length - 1;
}

/** The 7s a level has at digit position `minDigit` and above (0 = the last digit): the digits
 * below it change too fast to aim at (ASC-15). */
export function countSevensFrom(level: number, minDigit: number): number {
  return countSevens(Math.floor(level / Math.pow(10, Math.max(0, minDigit))));
}

/** Smallest whole level >= `from` with at least `sevens` 7s at digit position `minDigit` and
 * above (null if none within the search window). Every level sharing those upper digits then
 * has the 7s too: a window of 10^minDigit levels. */
export function nextLevelWithSevens(from: number, sevens: number, minDigit = 0): number | null {
  const unit = Math.pow(10, Math.max(0, minDigit));
  const start = Math.max(0, Math.ceil(from));

  for (let q = Math.floor(start / unit); q <= Math.floor(start / unit) + MAX_LEVEL_SEARCH; q++) {
    if (countSevens(q) >= sevens) return Math.max(start, q * unit);
  }

  return null;
}

/** ASC-12: the last level from `level` on that still has `sevens` 7s: the rest of its block
 * of 10^minDigit levels sharing the upper digits, then level by level (Infinity when no 7s
 * are needed). `level` itself must have them. */
export function luckyWindowEnd(level: number, sevens: number, minDigit = 0): number {
  if (sevens <= 0) return Infinity;

  const unit = Math.pow(10, Math.max(0, minDigit));
  let last = countSevensFrom(level, minDigit) >= sevens ? (Math.floor(level / unit) + 1) * unit - 1 : level;
  const limit = last + 1000;
  while (last < limit && countSevens(last + 1) >= sevens) last++;
  return last;
}

/** ASC-12: the smallest level >= `from` with the 7s (at `minDigit` and above) whose window
 * still holds at least `minLevels` levels from there: a level near the end of its block is
 * skipped for the next block, so the paw is never left a few levels to click in. */
export function nextLuckyTarget(from: number, sevens: number, minDigit = 0, minLevels = 1): number | null {
  let at = nextLevelWithSevens(from, sevens, minDigit);

  for (let i = 0; at != null && i < 1000; i++) {
    const end = luckyWindowEnd(at, sevens, minDigit);
    if (end - at + 1 >= minLevels) return at;
    at = nextLevelWithSevens(end + 1, sevens, minDigit);
  }

  return null;
}

/** ASC-9: how much each heavenly upgrade is worth to the bot, hardcoded so it can be audited
 * in one place. Units: roughly "% of CpS for the rest of every later run" (a +10% CpS upgrade
 * is 10); what the bot can't use (switches it never flips, extra info, gifting) is 0, and so
 * is anything purely cosmetic. The planner takes the highest-value upgrade whose missing chain
 * the chips of this ascension pay for; a 0 is only ever bought as the parent of something
 * worth more that is affordable along with it. An upgrade missing from the table counts 0.
 * Names as in the game's main.js 2.058 (every one of its prestige upgrades is listed). */
export const HEAVENLY_VALUE: Readonly<Record<string, number>> = {
  // the tree itself and the big CpS multipliers
  Legacy: 1000,
  'Heavenly cookies': 10, // +10% CpS
  'Synergies Vol. I': 20, // unlocks the synergy upgrades
  'Synergies Vol. II': 20,
  'Sugar baking': 20, // +1% CpS per unspent lump (up to 100)
  'Kitten angels': 15, // a kitten upgrade
  'Wrinkly cookies': 12, // +10% CpS, wrinklers +10%
  'Sugar crystal cookies': 10, // +5% CpS, +1% per building level >= 10
  Heralds: 10, // +1% CpS per herald
  'How to bake your dragon': 30, // Krumblor (KRUMB-*): Radiant Appetite x2, Dragonflight
  // permanent upgrade slots (ASC-16: a kitten, fingers, a golden upgrade, a kitten, a mouse)
  'Permanent upgrade slot I': 15,
  'Permanent upgrade slot II': 10,
  'Permanent upgrade slot III': 5,
  'Permanent upgrade slot IV': 4,
  'Permanent upgrade slot V': 3,
  // cookie upgrades unlocked in the store
  'Tin of british tea biscuits': 4,
  'Box of macarons': 4,
  'Box of brand biscuits': 4,
  'Tin of butter cookies': 4,
  'Box of maybe cookies': 4,
  'Box of not cookies': 4,
  'Box of pastries': 4,
  'Fortune cookies': 3,
  // golden cookies
  'Heavenly luck': 5, // 5% more often
  'Lasting fortune': 5, // effects 10% longer
  'Decisive fate': 2, // stay 5% longer
  'Distilled essence of redoubled luck': 5, // 1% chance of two
  'Lucky digit': 2, // +1% prestige, golden effects
  'Lucky number': 2,
  'Lucky payout': 2,
  'Residual luck': 0, // only with the golden switch on
  'Golden switch': 0, // turns golden cookies off
  // wrinklers (WRINK-*)
  'Elder spice': 10, // +2 wrinkler slots
  'Unholy bait': 5, // wrinklers 5x more often
  'Sacrilegious corruption': 5, // +5% from popped wrinklers
  'Eye of the wrinkler': 0, // only shows what a wrinkler holds
  // kittens, grandmas, clicks
  'Kitten wages': 3, // kittens 10% cheaper
  'Cat ladies': 3, // grandmas +29% per kitten
  'Milkhelp&reg; lactose intolerance relief tablets': 3, // grandmas +5% per milk rank
  'Halo gloves': 3, // clicks +10%
  'Aura gloves': 3, // cursor levels boost clicks
  'Luminous gloves': 3,
  'Starter kit': 1, // 10 free cursors
  'Starter kitchen': 1, // 5 free grandmas
  // prices and research
  'Persistent memory': 4, // research 10x faster (WRINK-1)
  'Divine bakeries': 3, // cookie upgrades 5x cheaper
  'Five-finger discount': 2,
  'Divine discount': 1,
  'Divine sales': 1,
  // sugar lumps
  'Stevia Caelestis': 5, // ripen 1h sooner
  'Diabetica Daemonicus': 5, // mature 1h sooner
  'Sugar aging process': 5, // grandmas ripen lumps sooner
  'Sucralosia Inutilis': 2, // bifurcated lumps
  'Sugar craving': 1, // the sugar frenzy switch
  // offline production (the angels) and its duration (the demons)
  'Twin Gates of Transcendence': 1,
  Angels: 1,
  Archangels: 1,
  Virtues: 1,
  Dominions: 1,
  Cherubim: 1,
  Seraphim: 1,
  God: 1,
  Belphegor: 1,
  Mammon: 1,
  Abaddon: 1,
  Satan: 1,
  Asmodeus: 1,
  Beelzebub: 1,
  Lucifer: 1,
  Chimera: 2, // synergy upgrades 2% cheaper, more offline
  // seasons
  'Season switcher': 1,
  Starspawn: 1,
  Starsnow: 1,
  Starterror: 1,
  Starlove: 1,
  Startrade: 1,
  Keepsakes: 1,
  'Pet the dragon': 2, // dragon drops
  // the shimmering veil: a switch the bot never buys (its clicks would break it anyway)
  'Shimmering veil': 0,
  "Cosmic beginner's luck": 0.5, // random drops 5x more likely early in a run
  'Reinforced membrane': 0,
  'Delicate touch': 0,
  'Steadfast murmur': 0,
  'Glittering edge': 0,
  // the way to the Unshackled upgrades: nothing on their own
  'Inspired checklist': 0, // "Buy all"
  'Genius accounting': 0, // price info
  'Label printer': 0, // cosmetic
  // Unshackled: a tier and a building together make that building's tiered upgrades stronger
  'Unshackled cursors': 10,
  'Unshackled grandmas': 5,
  'Unshackled farms': 5,
  'Unshackled mines': 5,
  'Unshackled factories': 5,
  'Unshackled banks': 5,
  'Unshackled temples': 5,
  'Unshackled wizard towers': 5,
  'Unshackled shipments': 5,
  'Unshackled alchemy labs': 5,
  'Unshackled portals': 5,
  'Unshackled time machines': 5,
  'Unshackled antimatter condensers': 5,
  'Unshackled prisms': 5,
  'Unshackled chancemakers': 5,
  'Unshackled fractal engines': 5,
  'Unshackled javascript consoles': 5,
  'Unshackled idleverses': 5,
  'Unshackled cortex bakers': 5,
  'Unshackled You': 5,
  'Unshackled flavor': 5,
  'Unshackled berrylium': 5,
  'Unshackled blueberrylium': 5,
  'Unshackled chalcedhoney': 5,
  'Unshackled buttergold': 5,
  'Unshackled sugarmuck': 5,
  'Unshackled jetmint': 5,
  'Unshackled cherrysilver': 5,
  'Unshackled hazelrald': 5,
  'Unshackled mooncandy': 5,
  'Unshackled astrofudge': 5,
  'Unshackled alabascream': 5,
  'Unshackled iridyum': 5,
  'Unshackled glucosmium': 5,
  'Unshackled glimmeringue': 5,
  // no use to the bot, or purely cosmetic
  'Wrapping paper': 0,
  'Classic dairy selection': 0,
  'Fanciful dairy selection': 0,
  'Basic wallpaper assortment': 0,
  'Distinguished wallpaper assortment': 0,
  'Golden cookie alert sound': 0,
  'Sound test': 0,
};

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
  /** The lowest digit position the lucky 7s may sit at (ASC-15; 0 = the last digit). */
  luckyMinDigit?: number;
  /** A lucky level is only looked for from here on (ASC-12: the level the run reaches once the
   * routine before an ascension is done, so the 7s are still ahead when it starts). */
  luckyFromLevel?: number;
  /** The lucky level's window must still hold this many levels from the target on (ASC-12). */
  luckyMinLevels?: number;
  /** The most 7s a lucky wish this run already waited for needed: such a wish gets
   * LUCKY_KEEP_FACTOR x the lucky budget (hysteresis). 0: none. */
  luckyKeepSevens?: number;
  /** What each upgrade is worth (default: HEAVENLY_VALUE). */
  values?: Readonly<Record<string, number>>;
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
  /** The most valuable ordinary wish the bot does NOT wait for (too far off): what it saves
   * for next time. */
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

/** ASC-9: greedy by value. Every round it looks at each upgrade worth something (value > 0)
 * with its missing parents, and takes the one whose chain is worth the most (the chain's
 * values summed, cheaper first on a tie) among those the run pays for: at the level reached
 * so far, or at a higher one within the wait budget (an ordinary wish also only while the
 * extra levels stay few; a lucky one needs its 7s, within the lucky budget). Parents worth
 * nothing come only along with a wish that is affordable with them. Repeats until nothing
 * else fits. */
export function planHeavenlyShopping(input: HeavenlyShopInput): HeavenlyShopPlan {
  const values = input.values ?? HEAVENLY_VALUE;
  const valueOf = (name: string) => values[name] ?? 0;
  const byName = new Map(input.heavenly.map((u) => [u.name, u]));
  const taken = new Set<string>();
  const items: ShopItem[] = [];
  // Every wish's unbought ancestors, parents first, worked out once: a round only drops what
  // is taken already.
  const chains = new Map<string, HeavenlyUpgradeInfo[]>();
  for (const u of input.heavenly) {
    if (u.bought || valueOf(u.name) <= 0) continue;
    const chain = missingChain(u.name, byName, new Set());
    if (chain && chain.length) chains.set(u.name, chain);
  }
  const wishes = [...chains.keys()];

  let level = input.fromLevel;
  let sevens = 0;
  let cost = 0;
  let waitFor: string | null = null;

  interface Option {
    name: string;
    chain: HeavenlyUpgradeInfo[];
    chainCost: number;
    value: number;
    at: number | null;
    etaSec: number;
    lucky: boolean;
    needSevens: number;
    ok: boolean;
  }

  // Most options land on the same level: the lucky search runs once per level and 7s.
  const luckyCache = new Map<string, number | null>();
  const luckyTarget = (from: number, need: number): number | null => {
    const key = `${from}|${need}`;
    if (!luckyCache.has(key)) luckyCache.set(key, nextLuckyTarget(from, need, input.luckyMinDigit ?? 0, input.luckyMinLevels ?? 1));
    return luckyCache.get(key)!;
  };

  const option = (name: string): Option | null => {
    const chain = (chains.get(name) ?? []).filter((u) => !taken.has(u.name));
    if (!chain.length) return null;

    const chainCost = chain.reduce((sum, u) => sum + u.price, 0);
    const chainSevens = Math.max(0, ...chain.map((u) => SEVENS.get(u.name) ?? 0));
    const needSevens = Math.max(sevens, chainSevens);

    // 1 chip per level: chips at L = heavenlyChips + (L - prestige).
    const chipsLevel = Math.ceil(input.prestige + cost + chainCost - input.heavenlyChips);
    let at: number | null = Math.max(level, chipsLevel);
    if (needSevens > 0) at = luckyTarget(Math.max(at, input.luckyFromLevel ?? 0), needSevens);

    const lucky = chainSevens > sevens;
    const etaSec = at == null ? Infinity : input.etaTo(at);
    // Worth waiting for: no extra level at all, or within the time budget and, for an ordinary
    // wish, only a few chips short (the extra levels a small share of what the ascension gains).
    const fewShort = lucky || at == null || at - input.fromLevel <= (input.maxExtraLevels ?? Infinity);
    const luckyBudget = input.luckyWaitSec * (chainSevens <= (input.luckyKeepSevens ?? 0) ? LUCKY_KEEP_FACTOR : 1);
    const ok = at != null && (at === level || (fewShort && etaSec <= (lucky ? luckyBudget : input.shopWaitSec)));
    const value = chain.reduce((sum, u) => sum + valueOf(u.name), 0);

    return { name, chain, chainCost, value, at, etaSec, lucky, needSevens, ok };
  };

  const better = (a: Option, b: Option | null) => !b || a.value > b.value || (a.value === b.value && a.chainCost < b.chainCost);

  // A wish that needs more 7s and is too far off stays too far off: every later round only
  // raises the level and the cost. Dropped for the rest of the rounds (its 7s search is the
  // expensive part); still reported at the end.
  const outOfReach = new Set<string>();

  for (;;) {
    let best: Option | null = null;
    for (const name of wishes) {
      if (taken.has(name) || outOfReach.has(name)) continue;
      const o = option(name);
      if (o && !o.ok && o.lucky) outOfReach.add(name);
      if (o && o.ok && better(o, best)) best = o;
    }
    if (!best) break;

    if (best.at! > level) waitFor = best.name;
    level = best.at!;
    sevens = best.needSevens;
    cost += best.chainCost;

    for (const u of best.chain) {
      taken.add(u.name);
      items.push({ name: u.name, price: u.price });
    }
  }

  // What is left out: the most valuable ordinary wish (saved for next time) and the lucky
  // wishes whose 7s are too far off.
  let next: Option | null = null;
  const skippedLucky: ShopWish[] = [];
  for (const name of wishes) {
    if (taken.has(name)) continue;
    const o = option(name);
    if (!o) continue;
    if (o.lucky) skippedLucky.push({ name, cost: o.chainCost, level: o.at, etaSec: o.etaSec });
    else if (better(o, next)) next = o;
  }

  return {
    level,
    etaSec: input.etaTo(level),
    items,
    cost,
    chipsAt: input.heavenlyChips + (level - input.prestige),
    waitFor,
    next: next ? { name: next.name, cost: next.chainCost, level: next.at, etaSec: next.etaSec } : null,
    skippedLucky,
    sevens,
  };
}
