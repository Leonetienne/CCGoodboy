/** Names the auto player must NEVER buy: the grandma research center and everything that
 * starts or feeds the Grandmapocalypse. (The auto player only ever considers upgrades it can
 * classify, see autoUpgradeGain(); this list is an extra hard stop.) */
export const AUTO_BLOCKED_NAMES = new Set([
  'Bingo center/Research facility',
  'One mind',
  'Communal brainsweep',
  'Elder Pact',
  'Elder Pledge',
  'Elder Covenant',
  'Revoke Elder Covenant',
]);

/** Name pattern that is blocked as well (covers spelling variants of the research center). */
export const AUTO_BLOCKED_RE = /bingo center|research (center|centre|facility)/i;

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

/** Preference tiers for candidates the auto player should buy before ordinary ones.
 * Higher = more preferred. Wizard towers below their target are TOP priority (they are bought
 * for mana, not CpS payback); golden cookie upgrades are preferred too. */
export const AUTO_PREF_GOLDEN = 1;
export const AUTO_PREF_WIZARD = 2;

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
