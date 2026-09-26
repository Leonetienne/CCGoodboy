/** Names the auto player must NEVER buy, whatever the settings: everything that leads the
 * Grandmapocalypse past stage 1 (Exotic nuts starts the research of Communal brainsweep =
 * stage 2, Elder Pact = stage 3) and the pledge/covenant switches. autoBuy() refuses them too,
 * as a second guard (WRINK-1). */
export const AUTO_ESCALATION_NAMES = new Set([
  'Exotic nuts',
  'Communal brainsweep',
  'Elder Pact',
  'Elder Pledge',
  'Elder Covenant',
  'Revoke Elder Covenant',
]);

/** Name pattern of the grandma research center (covers spelling variants). Only bought as
 * part of AUTO_RESEARCH, i.e. only with `autoGrandmapocalypse` on. */
export const AUTO_BLOCKED_RE = /bingo center|research (center|centre|facility)/i;

/** Gain model of one research upgrade: `grandma` multiplies Grandma CpS by `x`, `cps` adds
 * `pct`% to all production, `oneMind` gives every grandma +0.02 base CpS per grandma. */
export type ResearchGain = { kind: 'grandma'; x: number } | { kind: 'cps'; pct: number } | { kind: 'oneMind' };

/** The grandma research chain up to Grandmapocalypse stage 1 (WRINK-1), in the order the game
 * unlocks it (one every 30 min of research). Only bought with `autoGrandmapocalypse` on; One
 * mind starts stage 1 (wrinklers) and is the end of it: Exotic nuts, the step after it, leads
 * on to stage 2 and is never bought (AUTO_ESCALATION_NAMES). */
export const AUTO_RESEARCH: Record<string, ResearchGain> = {
  'Bingo center/Research facility': { kind: 'grandma', x: 4 },
  'Specialized chocolate chips': { kind: 'cps', pct: 1 },
  'Designer cocoa beans': { kind: 'cps', pct: 2 },
  'Ritual rolling pins': { kind: 'grandma', x: 2 },
  'Underworld ovens': { kind: 'cps', pct: 3 },
  'One mind': { kind: 'oneMind' },
};

/** The steps to stage 1, in order. Up to One mind a step is valued as part of the whole
 * project (grandmapocalypse-valuation.ts). */
export const AUTO_STAGE1_CHAIN = [
  'Bingo center/Research facility',
  'Specialized chocolate chips',
  'Designer cocoa beans',
  'Ritual rolling pins',
  'Underworld ovens',
  'One mind',
];

/** Upgrades that ask "are you sure?" when bought normally; autoBuy() confirms them like the
 * prompt's "Yes" button (buy with bypass). */
export const AUTO_CONFIRM_BYPASS = new Set(['One mind']);

/** Golden cookie upgrades the auto player may buy, with the assumed extra CpS they are worth,
 * as a share of the current CpS. These are ESTIMATES (a golden cookie upgrade does not add CpS
 * directly): frequency/duration upgrades matter a lot to a bot that catches every cookie, the
 * "+1%" ones very little. */
export const AUTO_GOLDEN_UPGRADES: Record<string, number> = {
  'Lucky day': 0.2,
  Serendipity: 0.2,
  'Get lucky': 0.12,
  'Lasting fortune': 0.04,
  'Lucky digit': 0.01,
  'Lucky number': 0.01,
  'Lucky payout': 0.01,
  'Green yeast digestives': 0.01,
};

/** Store upgrades that unlock the prestige level's CpS bonus ("Unlocks N% of the potential of
 * your prestige level"), with the share of the potential each one adds (Game.GetHeavenlyMultiplier,
 * 2.058): CpS x (1 + prestige x 1% x sum of owned shares). */
export const AUTO_HEAVENLY_UNLOCKS: Record<string, number> = {
  'Heavenly chip secret': 0.05,
  'Heavenly cookie stand': 0.2,
  'Heavenly bakery': 0.25,
  'Heavenly confectionery': 0.25,
  'Heavenly key': 0.25,
};

/** AUTO-19: once auto play buys this upgrade (the last prestige unlock, right after an
 * ascension), the big cookie is hammered for AUTO_KICK_MS, so the handmade cookies unlock the
 * clicking upgrades early. */
export const AUTO_KICK_UPGRADE = 'Heavenly key';
export const AUTO_KICK_MS = 10_000;

/** Upgrade pools that are never store purchases for the auto player (research, switches,
 * debug and heavenly upgrades). */
export const AUTO_NON_STORE_POOLS = new Set(['tech', 'toggle', 'debug', 'prestige', 'prestigeDecor']);

/** Kitten upgrades and their milk factor: each one multiplies ALL production by
 * 1 + milkProgress x factor. Unknown "Kitten ..." names use 0.1. */
export const AUTO_KITTEN_POWER: Record<string, number> = {
  'kitten helpers': 0.1,
  'kitten workers': 0.125,
  'kitten engineers': 0.15,
  'kitten overseers': 0.175,
  'kitten managers': 0.2,
  'kitten accountants': 0.2,
  'kitten specialists': 0.2,
  'kitten experts': 0.2,
  'kitten consultants': 0.2,
  'kitten assistants to the regional manager': 0.175,
  'kitten marketeers': 0.15,
  'kitten analysts': 0.125,
  'kitten executives': 0.115,
  'kitten admins': 0.11,
  'kitten strategists': 0.105,
};

/** Upper limits per building for the auto player: it never buys more than this many of them.
 * 57 Wizard towers is the sweet spot for mana, more only makes spells pricier. The wizard
 * target is exposed as the setting `autoWizardTowerTarget`; this constant is only the fallback
 * default. */
export const AUTO_BUILDING_CAPS: Record<string, number> = { 'Wizard tower': 57 };

/** Buy order (AUTO-4): a cost at or below this share of the spendable bank counts as this
 * share, so such "pocket money" purchases are ordered by CpS gain instead of payback. */
export const AUTO_TRIVIAL_BANK_SHARE = 0.01;

/** Preference tiers for candidates the auto player should buy before ordinary ones (AUTO-4 B).
 * Higher = more preferred: golden, click power and kitten upgrades (AUTO_PREF_TYPES, plus the
 * rare Easter eggs and Santa's gifts) first, then the Bingo center (WRINK-1: it starts the
 * research chain, and every minute it waits pushes the ~8h until the wrinklers pay out back by
 * a minute), then Wizard towers below their target (bought for mana, not CpS payback). */
export const AUTO_PREF_WIZARD = 1;
export const AUTO_PREF_BINGO = 2;
export const AUTO_PREF_GOLDEN = 3;
/** Upgrade types preferred like golden cookie upgrades (AUTO-4 B): the click power ones
 * (cursor doublers, the fingers series, the mouse series), which every Click Frenzy multiplies
 * x777, and the kittens, whose milk bonus their CpS estimate undersells. */
export const AUTO_PREF_TYPES: ReadonlySet<string> = new Set(['golden', 'cursor', 'fingers', 'click', 'kitten']);
export const AUTO_BINGO_CENTER = 'Bingo center/Research facility';

/** The "fingers" series of cursor upgrades: [name, value, kind]. 'Thousand fingers' ADDS 0.1
 * cookies per non-cursor building to the mouse and every cursor; each further one MULTIPLIES
 * that bonus. */
export const AUTO_FINGER_STEPS: Array<[string, number, 'add' | 'mul']> = [
  ['Thousand fingers', 0.1, 'add'],
  ['Million fingers', 5, 'mul'],
  ['Billion fingers', 10, 'mul'],
  ['Trillion fingers', 20, 'mul'],
  ['Quadrillion fingers', 20, 'mul'],
  ['Quintillion fingers', 20, 'mul'],
  ['Sextillion fingers', 20, 'mul'],
  ['Septillion fingers', 20, 'mul'],
  ['Octillion fingers', 20, 'mul'],
  ['Nonillion fingers', 20, 'mul'],
];

/** The upgrades that double the click power ("The mouse and cursors are twice as efficient"). */
export const AUTO_CURSOR_DOUBLERS = ['Reinforced index finger', 'Carpal tunnel prevention cream', 'Ambidextrous'];

/** Plain lowercase text of a game description (HTML tags removed). */
export function autoStripHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Clicking is worth more than its plain rate: during a Click Frenzy (x777 click power, and
 * the paw hammers every one, CF-1) a click is worth 777 normal ones. A golden cookie turns into
 * one ~4% of the time (the game's 10% chance to join a list of ~2-3 effects), every ~10 min
 * (halved by Lucky day and by Serendipity), so clicks are worth 1 + 776 x that share of time;
 * never less than AUTO_CLICK_VALUE_MIN (the bot's own FTHOF casts add more Click Frenzies on
 * top). Used for everything valued by clicking: cursor doublers, fingers, mouse upgrades, and
 * the kittens' boost through the mouse upgrades (AUTO-3). */
export const AUTO_CLICK_FRENZY_CHANCE = 0.04;
export const AUTO_GOLDEN_INTERVAL_SEC = 600;
export const AUTO_CLICK_VALUE_MIN = 7;
