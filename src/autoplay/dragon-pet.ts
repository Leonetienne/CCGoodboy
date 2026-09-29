import { sayCant, sayYay } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import { DragonPetAction } from '../actions/dragon-pet';
import { DragonClickAction } from '../actions/krumblor';
import { getSpecialPopupClose, specialTabPoint } from '../game/dragon-dom';
import type { IGameAdapter } from '../game/game-adapter';
import { elementCenter } from '../game/grimoire-dom';
import { getWrinklerCanvas } from '../game/wrinkler-dom';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import { DRAGON_DROPS, nextPetStep, PET_THE_DRAGON, type DragonPetState, type DragonPetStep } from './dragon-pet-strategy';

/** A step whose element doesn't show up for this long pauses the module. */
const STUCK_MS = 5000;
/** Pets without a drop (1 in 20 each: 0.3% chance to get none in 120) before petting pauses:
 * something is off, e.g. the pets don't reach the game. */
const PET_GIVE_UP = 120;

/** Pets Krumblor for his drops (DRAGON-PET-*): with "Pet the dragon" and the dragon at level
 * 8 or more, the paw opens the dragon's popup through its tab on the left canvas and pets his
 * picture until the quarter hour's drop (Dragon scale, claw, fang or teddy bear) lands in the
 * store, then closes the popup again. Only while that drop is still missing; once all four are
 * owned or in the store it never touches the dragon again. With or without auto play (its own
 * setting, "Pet Krumblor for dragon drops"); auto play buys the drops like any upgrade. One
 * step per scheduler tick, re-derived from the live game each time (nextPetStep). */
export class DragonPetter {
  /** Pets since the last drop (PET_GIVE_UP). */
  private petsWithoutDrop = 0;

  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly stats: StatsRecorder,
    private readonly log: LogStore,
    private readonly shoppingInterrupted: () => boolean,
  ) {}

  /** Allowed right now: the setting on, not paused, the AUTO-7 safety gates clear. */
  private allowed(): boolean {
    if (this.data.config.petDragon === false) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;
    if (Date.now() < this.runtime.petBlockUntil) return false;

    return !this.shoppingInterrupted();
  }

  /** Drops neither owned nor waiting in the store. */
  private missing(): string[] {
    return DRAGON_DROPS.filter((name) => {
      const up = this.game.getUpgradeByName(name);
      return !!up && !up.bought && !up.unlocked;
    });
  }

  /** The live game as nextPetStep() sees it. */
  state(): DragonPetState {
    const menuOpen = this.game.getSpecialTab() === 'dragon';
    if (!menuOpen) this.runtime.petMenuOurs = false;

    return {
      hasPet: this.game.hasUpgrade(PET_THE_DRAGON),
      dragonLevel: this.game.getDragonLevel(),
      order: this.game.getDragonDropOrder(),
      missing: this.missing(),
      now: new Date(),
      menuOpen,
      menuOurs: this.runtime.petMenuOurs,
    };
  }

  /** The next step while allowed, else null. */
  step(): DragonPetStep | null {
    return this.allowed() ? nextPetStep(this.state()) : null;
  }

  /** Something for the paw to do (the scheduler, PendingWork and hammering use it). */
  pending(): boolean {
    const s = this.step();
    return !!s && s.kind !== 'wait' && s.kind !== 'done';
  }

  /** The next single step as a job, or null. */
  job(): JobRequest | null {
    const s = this.step();
    if (!s || s.kind === 'wait' || s.kind === 'done') return null;

    const req = this.jobFor(s);

    if (req) {
      this.runtime.petStuckSince = 0;
    } else if (!this.runtime.petStuckSince) {
      this.runtime.petStuckSince = Date.now();
    } else if (Date.now() - this.runtime.petStuckSince > STUCK_MS) {
      this.runtime.petStuckSince = 0;
      this.block(10000, `I can't find what to click for "${s.kind}"`);
    }

    return req;
  }

  private jobFor(s: DragonPetStep): JobRequest | null {
    const stillWanted = () => {
      const now = this.step();
      return !!now && now.kind === s.kind;
    };
    const req = (action: DragonClickAction | DragonPetAction): JobRequest => ({ action, priority: JOB_PRIORITY.AUTO_SHOP, key: `dragon-pet:${s.kind}` });

    switch (s.kind) {
      case 'open-menu': {
        const tabs = this.game.getSpecialTabs();
        const point = () => specialTabPoint(tabs, 'dragon');
        if (!point()) return null;

        return req(
          new DragonClickAction({
            label: 'open Krumblor',
            target: "Krumblor's tab (to pet him)",
            point,
            el: getWrinklerCanvas,
            stillWanted,
            worked: () => this.game.getSpecialTab() === 'dragon',
            onResult: (ok) => {
              if (ok) this.runtime.petMenuOurs = true;
              else this.block(3000, "Krumblor's tab did not open");
            },
            mood: 'dragon-pet',
          }),
        );
      }

      case 'pet': {
        const drop = s.drop;
        const dropped = () => {
          const up = this.game.getUpgradeByName(drop);
          return !!up && !!(up.unlocked || up.bought);
        };

        return req(
          new DragonPetAction({
            drop,
            stillWanted,
            dropped,
            rate: () => Number(this.data.config.clickFrenzyCps) || 8,
            onDone: (pets, got) => this.petted(drop, pets, got),
          }),
        );
      }

      case 'close-menu': {
        if (!elementCenter(getSpecialPopupClose())) return null;

        return req(
          new DragonClickAction({
            label: 'close Krumblor',
            target: "Krumblor's x",
            point: () => elementCenter(getSpecialPopupClose()),
            el: getSpecialPopupClose,
            stillWanted,
            worked: () => this.game.getSpecialTab() !== 'dragon',
            onResult: (ok) => {
              if (ok) this.runtime.petMenuOurs = false;
              else this.block(3000, "Krumblor's popup did not close");
            },
            mood: 'dragon-pet',
          }),
        );
      }
    }

    return null;
  }

  /** A burst of pets is over (DRAGON-PET-3): count and announce a drop, pause after too many
   * pets without one. */
  private petted(drop: string, pets: number, got: boolean): void {
    if (got) {
      this.petsWithoutDrop = 0;
      this.stats.recordDragonDrop();
      this.log.log('dragon pet', `Krumblor dropped ${drop}`, { drop });
      sayYay(`Petted Krumblor and he dropped a ${drop}!! good dragon ^w^`);
      return;
    }

    this.petsWithoutDrop += pets;

    if (this.petsWithoutDrop >= PET_GIVE_UP) {
      this.petsWithoutDrop = 0;
      this.block(60000, `he dropped nothing after ${PET_GIVE_UP} pets`);
    }
  }

  private block(ms: number, why: string): void {
    this.runtime.petBlockUntil = Date.now() + ms;
    this.log.log('dragon pet', `paused: ${why}`);
    sayCant(`Wanted to pet Krumblor, but ${why}, trying again in ${Math.round(ms / 1000)}s :c`);
  }
}
