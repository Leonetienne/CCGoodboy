/** WHEN TO POP WRINKLERS (pure functions, no game access; WRINK-2..4).
 *
 * n attached wrinklers each digest n x 5% of CpS (n² x 5% together) and give it back x1.1
 * (plus upgrades) when popped, while the bank only gets CpS x (1 - n x 5%). The digested
 * cookies are useless until popped, but every pop empties a slot until a new wrinkler has
 * spawned and crawled in (the respawn time: ~56 min per slot at stage 1). So:
 *   - a wrinkler is only popped once it is MATURE: it has been digesting for at least
 *     `maturity` x the respawn time (default 5x, so its slot spends >= ~83% of the time
 *     digesting) — estimated from what it holds, sucked / (CpS x cpsSucked);
 *   - only when its cookies are needed for a purchase auto play would make if they were in
 *     the bank (the shopping engine asks autoDecide() with the mature stash added);
 *   - as few as possible, fattest first; never a shiny one (x3, rare: kept as a trophy that
 *     keeps growing). */

/** One wrinkler slot as the strategy sees it. */
export interface WrinklerView {
  id: number;
  /** Cookies digested so far (before the pop multiplier). */
  sucked: number;
  attached: boolean;
  shiny: boolean;
}

export interface WrinklerMaturityInput {
  wrinklers: WrinklerView[];
  /** Pop multiplier of a normal (non-shiny) wrinkler. */
  popMult: number;
  /** The game's full CpS (Game.cookiesPs, what wrinklers digest a share of). */
  cookiesPs: number;
  /** Share of CpS EACH attached wrinkler digests (Game.cpsSucked). */
  cpsSucked: number;
  /** Chance per game frame that an empty slot spawns a wrinkler. */
  spawnChance: number;
  fps: number;
  /** Pop only after digesting for this many respawn times. */
  maturity: number;
}

export interface MatureWrinkler {
  id: number;
  /** Cookies it gives when popped. */
  yield: number;
}

/** A decided pop: which wrinklers, and what for. */
export interface WrinklerPopPlan {
  ids: number[];
  yield: number;
  forName: string;
  cost: number;
}

/** Seconds until an empty slot is digesting again: the spawn wait (1 / chance per second)
 * plus the 10s the wrinkler takes to crawl in. Infinity when nothing respawns (calm
 * Grandmapocalypse): a pop then loses the slot for good. */
export function wrinklerRespawnSec(spawnChance: number, fps: number): number {
  if (!(spawnChance > 0) || !(fps > 0)) return Infinity;

  return 1 / (spawnChance * fps) + 10;
}

/** The mature, normal, attached wrinklers, fattest first. */
export function matureWrinklers(input: WrinklerMaturityInput): MatureWrinkler[] {
  const respawn = wrinklerRespawnSec(input.spawnChance, input.fps);
  const rate = input.cookiesPs * input.cpsSucked;

  if (!Number.isFinite(respawn) || !(rate > 0)) return [];

  const minAge = Math.max(0, input.maturity) * respawn;

  return input.wrinklers
    .filter((w) => w.attached && !w.shiny && w.sucked > 0 && w.sucked / rate >= minAge)
    .map((w) => ({ id: w.id, yield: w.sucked * input.popMult }))
    .sort((a, b) => b.yield - a.yield || a.id - b.id);
}

/** Total yield of a list of wrinklers. */
export function stashOf(mature: MatureWrinkler[]): number {
  return mature.reduce((s, w) => s + w.yield, 0);
}

/** The fewest mature wrinklers (fattest first) whose cookies cover `need`; null when nothing
 * is needed or they can't cover it. */
export function pickWrinklersToPop(mature: MatureWrinkler[], need: number): MatureWrinkler[] | null {
  if (!(need > 0)) return null;

  const picked: MatureWrinkler[] = [];
  let sum = 0;

  for (const w of mature) {
    picked.push(w);
    sum += w.yield;

    if (sum >= need) return picked;
  }

  return null;
}
