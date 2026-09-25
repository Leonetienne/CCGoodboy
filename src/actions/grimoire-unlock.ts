import { MinigameUnlockAction } from './minigame-unlock';

/** One-shot job that clicks the Wizard tower's "lvl" button to spend a sugar lump on level 1,
 * which unlocks the Grimoire minigame (AUTO-13). See MinigameUnlockAction. */
export class GrimoireUnlockAction extends MinigameUnlockAction {
  constructor(
    buildingId: number,
    stillWanted: () => boolean,
    readLevel: () => number,
    onResult: (leveled: boolean, level: number) => void,
  ) {
    super(
      buildingId,
      { label: 'unlock grimoire', hud: { action: 'grimoire-unlock', target: 'Wizard tower level 1 (Grimoire)' } },
      stillWanted,
      readLevel,
      onResult,
    );
  }
}
