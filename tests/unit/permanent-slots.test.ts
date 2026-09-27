import { describe, expect, it } from 'vitest';
import { isFingersUpgrade, isMouseUpgrade, nextSlotTask, permanentSlotGoals, PERMANENT_SLOTS } from '../../src/autoplay/permanent-slots';
import { nextAscensionStep, type AscendSlot, type AscendState } from '../../src/autoplay/ascension-steps';
import type { HeavenlyUpgradeInfo, PermanentCandidate, PermanentSlotInfo } from '../../src/game/types';

const cand = (id: number, name: string, price: number, kitten = false): PermanentCandidate => ({ id, name, price, kitten });

const CANDIDATES = [
  cand(1, 'Kitten helpers', 9e6, true),
  cand(2, 'Kitten workers', 9e9, true),
  cand(3, 'Kitten engineers', 9e12, true),
  cand(4, 'Thousand fingers', 1e5),
  cand(5, 'Million fingers', 1e7),
  cand(6, 'Lucky day', 7.77e8),
  cand(7, 'Serendipity', 7.77e10),
  cand(8, 'Plastic mouse', 5e4),
  cand(9, 'Iron mouse', 5e6),
  cand(10, 'Five-finger discount', 1), // not a fingers upgrade
];

function slots(bought: number): HeavenlyUpgradeInfo[] {
  return PERMANENT_SLOTS.map((name, i) => ({ id: 100 + i, name, price: 1, bought: i < bought, parents: [], canBePurchased: true }));
}

function info(over: Partial<PermanentSlotInfo> = {}): PermanentSlotInfo {
  return { slots: [-1, -1, -1, -1, -1], selecting: -1, candidates: CANDIDATES, ...over };
}

describe('permanent upgrade slots (ASC-16)', () => {
  it('recognises the series', () => {
    expect(isFingersUpgrade('Thousand fingers')).toBe(true);
    expect(isFingersUpgrade('Decillion fingers')).toBe(true);
    expect(isFingersUpgrade('Five-finger discount')).toBe(false);
    expect(isMouseUpgrade('Omniplast mouse')).toBe(true);
  });

  it('wants the priciest kitten, fingers, golden upgrade, second kitten and mouse', () => {
    expect(permanentSlotGoals(CANDIDATES).map((c) => c?.name)).toEqual(['Kitten engineers', 'Million fingers', 'Serendipity', 'Kitten workers', 'Iron mouse']);
    expect(permanentSlotGoals([])).toEqual([null, null, null, null, null]);
  });

  it('fills the first bought slot that does not hold its goal', () => {
    expect(nextSlotTask(info(), slots(0))).toBeNull();
    expect(nextSlotTask(info(), slots(3))).toMatchObject({ index: 0, crateId: 100, want: 3, wantName: 'Kitten engineers' });
    expect(nextSlotTask(info({ slots: [3, -1, -1, -1, -1] }), slots(3))).toMatchObject({ index: 1, want: 5 });
    expect(nextSlotTask(info({ slots: [3, 5, 7, -1, -1] }), slots(3))).toBeNull();
    // a slot holding something else is reassigned
    expect(nextSlotTask(info({ slots: [1, 5, 7, -1, -1] }), slots(3))).toMatchObject({ index: 0, want: 3 });
  });

  it('leaves a goal that sits in another slot until that slot gives it up, and skipped slots alone', () => {
    // slot II holds the kitten slot I wants: slot II goes first
    expect(nextSlotTask(info({ slots: [-1, 3, -1, -1, -1] }), slots(3))).toMatchObject({ index: 1, want: 5 });
    expect(nextSlotTask(info(), slots(3), new Set(['Permanent upgrade slot I']))).toMatchObject({ index: 1 });
  });
});

describe('nextAscensionStep with permanent slots (ASC-16)', () => {
  const slot = (over: Partial<AscendSlot> = {}): AscendSlot => ({ crateId: 100, name: 'Permanent upgrade slot I', clickable: true, want: 3, wantName: 'Kitten engineers', selecting: -1, pickVisible: true, ...over });
  const state = (over: Partial<AscendState> = {}): AscendState => ({ committed: false, want: false, ours: true, prompt: '', intro: false, onScreen: true, wrinklers: [], stocks: [], dump: null, toBuy: [], ...over });

  it('fills the slots after the shopping list, before reincarnating', () => {
    expect(nextAscensionStep(state({ toBuy: [{ id: 1, name: 'A', clickable: true }], slot: slot() }))).toEqual({ kind: 'buy', id: 1, name: 'A' });
    expect(nextAscensionStep(state({ slot: slot() }))).toEqual({ kind: 'open-slot', id: 100, name: 'Permanent upgrade slot I' });
    expect(nextAscensionStep(state({ slot: slot({ clickable: false }) }))).toEqual({ kind: 'pan', id: 100, name: 'Permanent upgrade slot I' });
    expect(nextAscensionStep(state({ slot: null }))).toEqual({ kind: 'reincarnate' });
  });

  it('scrolls to, picks and confirms the goal in its prompt', () => {
    const p = { prompt: 'PickPermaUpgrade' };
    expect(nextAscensionStep(state({ ...p, slot: slot({ pickVisible: false }) }))).toEqual({ kind: 'scroll-slot', id: 3, name: 'Kitten engineers' });
    expect(nextAscensionStep(state({ ...p, slot: slot() }))).toEqual({ kind: 'pick-slot', id: 3, name: 'Kitten engineers' });
    expect(nextAscensionStep(state({ ...p, slot: slot({ selecting: 3 }) }))).toEqual({ kind: 'confirm-slot', id: 3, name: 'Kitten engineers' });
    expect(nextAscensionStep(state({ ...p, slot: null }))).toEqual({ kind: 'cancel-slot' });
    expect(nextAscensionStep(state({ ...p, ours: false, slot: slot() }))).toEqual({ kind: 'wait' });
  });
});
