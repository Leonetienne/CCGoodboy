import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { WrinklerPopAction } from '../actions/wrinkler-pop';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import type { AutoPlayEngine } from './shopping';
import { matureWrinklers, pickWrinklersToPop, stashOf, type MatureWrinkler, type WrinklerPopPlan, type WrinklerView } from './wrinkler-strategy';

/** Auto play: pops mature wrinklers when auto play needs their cookies for a purchase
 * (WRINK-2..6). Planning is throttled to once a second; the plan names the fewest mature
 * wrinklers (fattest first) that make auto play's next purchase affordable, and each job pops
 * ONE of them, so the scheduler can preempt between pops. */
export class WrinklerPopper {
  constructor(
    private readonly runtime: RuntimeState,
    private readonly data: PersistedData,
    private readonly game: IGameAdapter,
    private readonly log: LogStore,
    private readonly stats: StatsRecorder,
    private readonly autoPlay: AutoPlayEngine,
  ) {}

  /** Every wrinkler slot as the strategy sees it. */
  views(): WrinklerView[] {
    return this.game
      .getWrinklers()
      .filter((w) => !!w)
      .map((w) => ({ id: Number(w.id), sucked: Number(w.sucked) || 0, attached: w.phase === 2, shiny: w.type === 1 }));
  }

  /** The mature, normal, attached wrinklers (fattest first). */
  mature(): MatureWrinkler[] {
    return matureWrinklers({
      wrinklers: this.views(),
      popMult: this.game.getWrinklerPopMult(false),
      cookiesPs: Number(this.game.getCookiesPs()) || 0,
      cpsSucked: this.game.getCpsSucked(),
      spawnChance: this.game.getWrinklerSpawnChance(),
      fps: this.game.getFps() || 30,
      maturity: Math.max(1, Number(this.data.config.autoWrinklerMaturity) || 5),
    });
  }

  /** The "Pop a wrinkler" debug tool is waiting for its pop. */
  private forced(): boolean {
    return Date.now() < this.runtime.wrinklerForcePopUntil;
  }

  /** Popping allowed right now: auto play and popping on (or a forced debug pop), not paused
   * after a failure, the AUTO-7 safety gates clear, and no CpS buff running (wrinklers digest
   * the buffed CpS, so that is exactly when they must stay attached). */
  private allowed(): boolean {
    if (!this.forced() && (this.data.config.autoPlay !== true || this.data.config.autoPopWrinklers === false)) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;

    const now = Date.now();
    if (now < this.runtime.wrinklerBlockUntil || now < this.runtime.autoBlockUntil) return false;

    return !this.autoPlay.shoppingInterrupted() && this.game.positiveCpsBuffs().length === 0;
  }

  /** The current pop plan (re-planned at most once a second), or null. A forced debug pop
   * plans the fattest attached normal wrinkler, skipping WRINK-2/3 (maturity, a purchase
   * needing it). */
  plan(): WrinklerPopPlan | null {
    if (!this.allowed()) return null;

    const now = Date.now();
    if (now < this.runtime.wrinklerNextEvalAt) return this.runtime.wrinklerPlan;

    this.runtime.wrinklerNextEvalAt = now + 1000;
    this.runtime.wrinklerPlan = null;

    if (this.forced()) {
      const w = this.fattestNormal();

      if (w) {
        this.runtime.wrinklerPlan = { ids: [w.id], yield: w.sucked * this.game.getWrinklerPopMult(false), forName: 'debug tool', cost: 0 };
      } else {
        this.runtime.wrinklerForcePopUntil = 0;
      }

      return this.runtime.wrinklerPlan;
    }

    try {
      const mature = this.mature();
      if (!mature.length) return null;

      const r = this.autoPlay.decideWithExtraBank(stashOf(mature));
      const buy = r && r.decision.buy;
      if (!r || !buy) return null;

      const picked = pickWrinklersToPop(mature, buy.cost - (r.ctx.bank - r.ctx.reserve));
      if (!picked) return null;

      this.runtime.wrinklerPlan = { ids: picked.map((w) => w.id), yield: stashOf(picked), forName: buy.name, cost: buy.cost };
    } catch (e) {
      this.block(30000, String(e && (e as Error).message ? (e as Error).message : e));
    }

    return this.runtime.wrinklerPlan;
  }

  /** A pop is due (the scheduler, PendingWork and hammering use it). A dry run only logs. */
  pending(): boolean {
    return this.data.config.autoDryRun !== true && this.plan() != null;
  }

  /** Job that pops the fattest wrinkler of the plan, or null. */
  job(): JobRequest | null {
    const plan = this.plan();
    if (!plan) return null;

    if (this.data.config.autoDryRun === true) {
      const now = Date.now();
      const last = this.runtime.autoWouldLog.get('wrinkler pop') || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set('wrinkler pop', now);
        this.log.log('auto play (dry run)', `would pop ${plan.ids.length} wrinkler(s) for ${plan.forName}`, { yield: plan.yield, cost: plan.cost });
      }

      return null;
    }

    const id = plan.ids[0]!;

    const action = new WrinklerPopAction(
      id,
      this.game,
      () => !this.allowed(),
      (popped, gained) => {
        this.runtime.wrinklerNextEvalAt = 0;
        this.runtime.autoNextEvalAt = 0;
        this.runtime.wrinklerForcePopUntil = 0;

        if (popped) {
          this.stats.recordWrinklerPop();
          this.log.log('pop wrinkler', `for ${plan.forName}`, { id, gained: Math.round(gained), cost: Math.round(plan.cost) });
        } else {
          this.block(3000, 'wrinkler did not pop');
        }
      },
    );

    return { action, priority: JOB_PRIORITY.AUTO_SHOP, key: `wrinkler-pop:${id}` };
  }

  /** The fattest attached normal (non-shiny) wrinkler. */
  private fattestNormal(): WrinklerView | null {
    return this.views()
      .filter((x) => x.attached && !x.shiny)
      .sort((a, b) => b.sucked - a.sucked)[0] || null;
  }

  /** Debug tool "Pop a wrinkler" (DBG-14): forces ONE pop through the real runtime path —
   * plan() -> the scheduler's tier 5 -> job() -> WrinklerPopAction -> the normal result
   * handling — for the fattest attached normal wrinkler. Only WRINK-2/3 (maturity, a purchase
   * needing it) and the auto play switches are skipped; the WRINK-4 safety gates still hold it
   * back (golden cookie, Click Frenzy, a CpS buff, ...), for up to 30s. Dry run only logs. */
  debugPopWrinkler(): string {
    const w = this.fattestNormal();

    if (!w) {
      throw new Error('no normal wrinkler is attached (a spawned one takes ~10s to crawl in)');
    }

    this.runtime.wrinklerForcePopUntil = Date.now() + 30000;
    this.runtime.wrinklerNextEvalAt = 0;

    return `wrinkler ${w.id} gets popped as soon as nothing more important is going on (30s) owo`;
  }

  /** HUD row "Wrinklers": attached/max, what they hold, how many are mature. */
  statusText(): string {
    const views = this.views();
    const attached = views.filter((w) => w.attached);
    const wrath = this.game.getElderWrath();

    if (!attached.length) {
      return wrath > 0 ? `none yet (stage ${wrath}, they're coming owo)` : 'none (grandmas are calm)';
    }

    const holding = attached.reduce((s, w) => s + w.sucked * this.game.getWrinklerPopMult(w.shiny), 0);
    const shiny = attached.some((w) => w.shiny) ? ', 1 shiny ^w^' : '';

    return `${attached.length}/${this.game.getWrinklersMax()} attached, holding ~${formatShort(holding)} (${this.mature().length} mature${shiny})`;
  }

  private block(ms: number, why: string): void {
    this.runtime.wrinklerBlockUntil = Date.now() + ms;
    this.log.log('pop wrinkler', `paused: ${why}`);
  }
}

/** 1.2e15 style for the HUD (wrinkler stashes are huge numbers). */
function formatShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 1e6) return String(Math.round(n));

  return n.toExponential(2).replace('e+', 'e');
}
