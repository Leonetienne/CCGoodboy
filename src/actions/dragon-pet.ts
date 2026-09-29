import type { CursorAction, CursorJobContext } from '../cursor/types';
import { visibleRect } from '../game/dom-geometry';
import { getDragonPic } from '../game/dragon-dom';

/** Most pets in one job; the scheduler hands out the next job on a later tick. */
export const PET_BURST = 40;

export interface DragonPetParams {
  drop: string;
  /** Still worth petting (the drop is missing, nothing more important came up). */
  stillWanted: () => boolean;
  /** The drop landed in the store. */
  dropped: () => boolean;
  /** Pets per second (the Click Frenzy rate, CF-1). */
  rate: () => number;
  /** How the burst ended: the pets it took and whether the drop came. */
  onDone: (pets: number, dropped: boolean) => void;
}

/** A random point in the middle of the dragon's picture (its sprite fills the inner 70%). */
function petPoint(): { x: number; y: number } | null {
  const r = visibleRect(getDragonPic());
  if (!r) return null;

  return {
    x: r.left + r.width * (0.35 + Math.random() * 0.3),
    y: r.top + r.height * (0.35 + Math.random() * 0.3),
  };
}

/** Pets Krumblor (DRAGON-PET-2): real synthetic clicks on #specialPic (NFR-8 a), a few px
 * apart, at the Click Frenzy rate with its wiggle, until the drop comes, it is no longer
 * wanted, a higher priority job wants the paw, or PET_BURST pets are done. */
export class DragonPetAction implements CursorAction {
  readonly label = 'pet Krumblor';
  readonly hud: { action: string; target: string };

  constructor(private readonly p: DragonPetParams) {
    this.hud = { action: 'dragon-pet', target: `petting Krumblor for a ${p.drop}` };
  }

  target(): { x: number; y: number } | null {
    return petPoint();
  }

  abortIf(): boolean {
    return !this.p.stillWanted() || !getDragonPic();
  }

  async cursor_at_position(ctx: CursorJobContext): Promise<void> {
    let pets = 0;

    while (pets < PET_BURST && !this.p.dropped()) {
      if (ctx.abortRequested() || this.abortIf()) break;

      const el = getDragonPic();
      if (!el) break;

      if (pets > 0) {
        const pt = petPoint();
        if (pt) ctx.cursor.setPosition(pt.x, pt.y);
      }

      await ctx.clickTiming.humanClick(el, ctx.runtime.cursor.x, ctx.runtime.cursor.y);
      pets++;

      const interval = 1000 / Math.max(0.2, this.p.rate());
      const jitter = Math.min(Math.max(0, Number(ctx.data.config.clickFrenzyJitterMs) || 0), interval * 0.6);
      await ctx.clock.sleep(Math.max(20, interval + (Math.random() * 2 - 1) * jitter));
    }

    this.p.onDone(pets, this.p.dropped());
  }
}
