import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import type { IGameAdapter } from '../game/game-adapter';
import { gardenEnabled } from '../garden/gardener';
import type { MinigameView } from '../hunting/minigame-view';
import type { LogStore } from '../stats/log';
import { MinigameUnlocker } from './minigame-unlock';

/** Auto play: unlocks the garden (AUTO-17) with one sugar lump on Farm level 1, only while
 * "Tend the garden" is on (GARDEN-1). The only lump the garden ever gets: the Farm is never
 * levelled further. */
export class FarmUnlocker extends MinigameUnlocker {
  constructor(runtime: RuntimeState, data: PersistedData, game: IGameAdapter, log: LogStore, view: MinigameView, shoppingInterrupted: () => boolean) {
    super(runtime, data, game, log, view, shoppingInterrupted, {
      what: 'the garden',
      levelText: 'Farm level 1 (garden)',
      logAction: 'auto farm unlock',
      keyPrefix: 'farm-unlock',
      enabled: gardenEnabled,
      blockField: 'farmUnlockBlockUntil',
    });
  }
}
