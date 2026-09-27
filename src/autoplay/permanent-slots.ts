import type { HeavenlyUpgradeInfo, PermanentCandidate, PermanentSlotInfo } from '../game/types';
import { AUTO_GOLDEN_UPGRADES } from './valuation-tables';

// Pure: what goes into the permanent upgrade slots (ASC-16). On the ascension screen the paw
// clicks a bought slot's crate, picks the upgrade in the "Pick an upgrade to make permanent"
// prompt and confirms; the next run starts with that upgrade owned.

/** The slot upgrades in the heavenly tree, slot I first (main.js 2.058). */
export const PERMANENT_SLOTS: readonly string[] = [
  'Permanent upgrade slot I',
  'Permanent upgrade slot II',
  'Permanent upgrade slot III',
  'Permanent upgrade slot IV',
  'Permanent upgrade slot V',
];

/** The "x fingers" series (Thousand fingers ... Decillion fingers and beyond). */
export function isFingersUpgrade(name: string): boolean {
  return /^(Thousand|[A-Z][a-z]*illion) fingers$/.test(name);
}

/** The mouse series ("Clicking gains +1% of your CpS": Plastic mouse ... Omniplast mouse). */
export function isMouseUpgrade(name: string): boolean {
  return /^[A-Z][a-z]+ mouse$/.test(name);
}

/** Store golden cookie upgrades (Lucky day, Serendipity, Get lucky, ...). */
export function isGoldenUpgrade(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(AUTO_GOLDEN_UPGRADES, name);
}

/** The priciest match, skipping `rank` pricier ones (0: the priciest). */
function priciest(list: PermanentCandidate[], match: (c: PermanentCandidate) => boolean, rank = 0): PermanentCandidate | null {
  return list.filter(match).sort((a, b) => b.price - a.price || a.id - b.id)[rank] ?? null;
}

/** What each slot should hold, slot I first (null: nothing of that kind was bought last run):
 * I the priciest kitten, II the priciest "x fingers", III the priciest golden cookie upgrade,
 * IV the second priciest kitten, V the priciest mouse upgrade. */
export function permanentSlotGoals(candidates: PermanentCandidate[]): Array<PermanentCandidate | null> {
  const kitten = (c: PermanentCandidate) => c.kitten;

  return [
    priciest(candidates, kitten),
    priciest(candidates, (c) => isFingersUpgrade(c.name)),
    priciest(candidates, (c) => isGoldenUpgrade(c.name)),
    priciest(candidates, kitten, 1),
    priciest(candidates, (c) => isMouseUpgrade(c.name)),
  ];
}

export interface SlotTask {
  /** 0 = slot I. */
  index: number;
  /** The slot upgrade's id (its crate in the tree) and name. */
  crateId: number;
  name: string;
  /** The upgrade it should hold. */
  want: number;
  wantName: string;
}

/** ASC-16: the first bought slot that doesn't hold its goal yet (null: all done). A goal
 * sitting in another slot is left for that slot to give up first (the game offers nothing
 * that is in another slot); slots in `skip` are left alone. */
export function nextSlotTask(info: PermanentSlotInfo, heavenly: HeavenlyUpgradeInfo[], skip: ReadonlySet<string> = new Set()): SlotTask | null {
  const goals = permanentSlotGoals(info.candidates);

  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i];
    const slot = heavenly.find((u) => u.name === PERMANENT_SLOTS[i]);
    if (!goal || !slot || !slot.bought || skip.has(slot.name)) continue;

    const held = info.slots[i] ?? -1;
    if (held === goal.id) continue;
    if (info.slots.some((id, j) => j !== i && id === goal.id)) continue;

    return { index: i, crateId: slot.id, name: slot.name, want: goal.id, wantName: goal.name };
  }

  return null;
}
