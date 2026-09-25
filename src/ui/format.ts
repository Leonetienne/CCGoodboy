/** Escapes text for safe use in innerHTML. */
export function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Formats a number for the HUD (thousands separators, one decimal for small values). */
export function formatNum(n: unknown): string {
  const v = Number(n);

  if (!Number.isFinite(v)) {
    return '—';
  }

  if (Math.abs(v) >= 1000) {
    return Math.round(v).toLocaleString();
  }

  return (Math.round(v * 10) / 10).toString();
}

/** Suffixes of formatShort(): thousand, million, billion, trillion, quadrillion, ... */
const SHORT_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Compact number for tight overlay labels ("777", "77.8K", "77.8M"); 3 significant digits. */
export function formatShort(n: unknown): string {
  const v = Number(n);

  if (!Number.isFinite(v)) {
    return '—';
  }

  let tier = 0;
  let x = Math.abs(v);

  while (x >= 999.5 && tier < SHORT_SUFFIXES.length - 1) {
    x /= 1000;
    tier++;
  }

  const digits = tier === 0 || x >= 100 ? 0 : x >= 10 ? 1 : 2;
  const text = Number(x.toFixed(digits)).toString();

  return (v < 0 ? '-' : '') + text + SHORT_SUFFIXES[tier];
}

/** Display-only cute wording for the internal action names (the names themselves stay
 * untouched). */
export function moodText(action: string): string {
  const map: Record<string, string> = {
    idle: 'idle :3 waiting for shinies',
    'idle-play': 'playing around :3',
    hammer: 'hammering the cookie owo',
    'auto-shop': 'shopping ^w^',
    'happy-dance': 'happy dance ^w^',
    'bored-click': 'bored, poking the cookie owo',
    'golden-cookie': 'grabbing a shiny ^w^',
    'click-frenzy': 'click frenzy zoomies :3',
    fthof: 'casting FTHOF ^w^',
    'grimoire-refill': 'refilling the grimoire :3',
    'lump-harvest': 'harvesting a ripe sugar lump :3',
    'buildings-view': 'tidying up the view :3',
    'grimoire-unlock': 'unlocking the grimoire ^w^',
    'wrinkler-pop': 'popping a wrinkler owo',
    krumblor: 'training Krumblor ^w^',
    santa: 'evolving Santa ho ho ^w^',
    ascend: 'ascending to cookie heaven ^w^',
    'stock-market': 'playing the stock market, stonks ^w^',
    'bank-unlock': 'unlocking the stock market ^w^',
    garden: 'gardening, dirty paws :3',
    'farm-unlock': 'unlocking the garden ^w^',
  };

  return map[action] || action;
}

/** Display wording for the current target. */
export function targetText(target: string): string {
  const map: Record<string, string> = {
    none: 'nothing yet',
    'good golden cookie': 'a good golden cookie',
    'big cookie': 'the big cookie',
  };

  return map[target] || target;
}
