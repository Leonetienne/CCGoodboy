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
