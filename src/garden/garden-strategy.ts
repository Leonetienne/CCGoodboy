import type { GardenSeed, GardenSnapshot, GardenTile } from '../game/types';

/** GARDEN-3: the crop the paw keeps the plot full of. Baker's wheat is known from the start,
 * costs one minute of CpS and gives +1% CpS each (+1.25% on clay) while alive. */
export const GARDEN_CROP = 'bakerWheat';

/** GARDEN-4: plants that hurt (brown mold -1% CpS, shriekbulb -2% and weaker neighbours) or
 * take over their neighbours (meddleweed, crumbspore, doughshroom). Unearthed at once once
 * their seed is known. */
export const GARDEN_PESTS: ReadonlySet<string> = new Set(['meddleweed', 'brownMold', 'shriekbulb', 'crumbspore', 'doughshroom']);

/** GARDEN-5: plants whose mature harvest pays cookies from the buffed CpS (capped by a share
 * of the bank): worth harvesting during a CpS buff rather than waiting for their end. */
export const GARDEN_PAYOUT: ReadonlySet<string> = new Set(['bakeberry', 'chocoroot', 'whiteChocoroot', 'queenbeet', 'duketater']);

/** GARDEN-6: the soil the paw keeps: clay (plant effects x1.25) once 100 farms allow it,
 * else dirt (x1). */
export const GARDEN_SOIL_PREFERENCE = ['clay', 'dirt'] as const;

export type GardenMove =
  | { kind: 'harvest'; tile: GardenTile; name: string; why: string }
  | { kind: 'unearth'; tile: GardenTile; name: string; why: string }
  | { kind: 'soil'; soil: { id: number; key: string; name: string }; why: string }
  | { kind: 'select'; seed: GardenSeed; why: string }
  | { kind: 'plant'; tile: GardenTile; seed: GardenSeed; why: string };

export interface GardenContext {
  /** Cookies the paw may spend on seeds (the bank minus auto play's reserve, AUTO-6). */
  spendable: number;
  /** A CpS buff is running: seeds cost more (their price follows the buffed CpS) and payout
   * crops pay more. */
  buffed: boolean;
}

/** The soil the garden should have, or null if none of the preferred ones is available. */
export function gardenSoilTarget(snap: GardenSnapshot): GardenSnapshot['soils'][number] | null {
  for (const key of GARDEN_SOIL_PREFERENCE) {
    const s = snap.soils.find((soil) => soil.key === key);
    if (s && snap.farms >= s.req) return s;
  }
  return null;
}

/** The next single thing the paw should do in the garden, or null (GARDEN-2..7), in this
 * order: harvest a mature plant whose seed is new, unearth a known pest, harvest a mature
 * plant about to die of old age (its seed chance and drops are only on a harvest), harvest a
 * mature payout crop during a CpS buff; then set the soil; then fill an empty tile with the
 * crop (select its seed, then click the tile), only with no CpS buff running and when the
 * seed is affordable. A frozen garden (the player's choice) is left alone. */
export function planGardenMove(snap: GardenSnapshot, ctx: GardenContext): GardenMove | null {
  if (snap.frozen) return null;

  const seedOf = (key: string) => snap.seeds.find((s) => s.key === key);
  const nameOf = (key: string) => seedOf(key)?.name ?? key;
  const planted = snap.tiles.filter((t) => t.plant != null);
  const isMature = (t: GardenTile) => t.age >= t.mature;

  const newSeed = planted.find((t) => isMature(t) && !seedOf(t.plant!)?.unlocked);
  if (newSeed) return { kind: 'harvest', tile: newSeed, name: nameOf(newSeed.plant!), why: 'a new seed' };

  const pest = planted.find((t) => GARDEN_PESTS.has(t.plant!) && seedOf(t.plant!)?.unlocked);
  if (pest) {
    const name = nameOf(pest.plant!);
    return isMature(pest) ? { kind: 'harvest', tile: pest, name, why: 'a pest' } : { kind: 'unearth', tile: pest, name, why: 'a pest' };
  }

  const dying = planted.find((t) => isMature(t) && t.dying);
  if (dying) return { kind: 'harvest', tile: dying, name: nameOf(dying.plant!), why: 'about to wither' };

  if (ctx.buffed) {
    const payout = planted.find((t) => isMature(t) && GARDEN_PAYOUT.has(t.plant!));
    if (payout) return { kind: 'harvest', tile: payout, name: nameOf(payout.plant!), why: 'pays out more during a buff' };
  }

  const soil = gardenSoilTarget(snap);
  if (soil && soil.id !== snap.soil && snap.soilCooldownSec <= 0) {
    return { kind: 'soil', soil, why: soil.key === 'clay' ? 'plant effects x1.25' : 'plant effects x1' };
  }

  const crop = seedOf(GARDEN_CROP);
  const empty = snap.tiles.find((t) => t.plant == null);
  if (!crop || !crop.unlocked || !crop.plantable || !empty || ctx.buffed || !(crop.cost <= ctx.spendable)) return null;

  if (snap.seedSelected !== crop.id) return { kind: 'select', seed: crop, why: 'to plant it' };
  return { kind: 'plant', tile: empty, seed: crop, why: 'an empty tile' };
}

/** A move's identity: the same move planned again is the same job (dedup, stillWanted). */
export function gardenMoveKey(m: GardenMove): string {
  switch (m.kind) {
    case 'soil':
      return `soil:${m.soil.id}`;
    case 'select':
      return `select:${m.seed.id}`;
    default:
      return `${m.kind}:${m.tile.x}-${m.tile.y}`;
  }
}
