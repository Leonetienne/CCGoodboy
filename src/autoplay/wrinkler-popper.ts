import { errText, sayCant, sayOops, sayYay } from '../core/console-voice';
import type { PersistedData } from '../core/persisted-data';
import type { RuntimeState } from '../core/runtime-state';
import { JOB_PRIORITY, type JobRequest } from '../cursor/types';
import type { IGameAdapter } from '../game/game-adapter';
import { WrinklerPopAction } from '../actions/wrinkler-pop';
import { wrinklerPokeCanvasPoint } from '../game/wrinkler-dom';
import type { LogStore } from '../stats/log';
import type { StatsRecorder } from '../stats/stats';
import { formatShort } from '../ui/format';
import type { AutoPlayEngine } from './shopping';
import { matureWrinklers, pickWrinklersToPop, POP_ALL_MS, popAllTargets, stashOf, type MatureWrinkler, type WrinklerPopPlan, type WrinklerView } from './wrinkler-strategy';

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

  /** WRINK-8: the "Pop all wrinklers" button is popping until runtime.wrinklerPopAllUntil;
   * ends by itself after POP_ALL_MS. */
  poppingAll(): boolean {
    if (!this.runtime.wrinklerPopAllUntil) return false;
    if (Date.now() < this.runtime.wrinklerPopAllUntil) return true;

    this.endPopAll('gave up after 2 minutes');
    return false;
  }

  /** WRINK-8: the button is shown while any wrinkler is there (crawling in or attached); what
   * it would pop and bring back right now. */
  popAllPreview(): { shown: boolean; count: number; cookies: number; shiny: number } {
    const views = this.views();
    const targets = popAllTargets(views);

    return {
      shown: this.game.getWrinklers().some((w) => !!w && w.phase > 0),
      count: targets.length,
      cookies: targets.reduce((s, w) => s + w.sucked * this.game.getWrinklerPopMult(false), 0),
      shiny: views.filter((w) => w.attached && w.shiny).length,
    };
  }

  /** Starts popping every wrinkler popAllTargets() names, or stops it when it runs. */
  togglePopAll(): void {
    if (this.runtime.wrinklerPopAllUntil) {
      this.endPopAll('stopped');
      return;
    }

    const p = this.popAllPreview();
    this.runtime.wrinklerPopAllUntil = Date.now() + POP_ALL_MS;
    this.runtime.wrinklerNextEvalAt = 0;
    this.log.log('pop wrinkler', `popping all: ${p.count} wrinkler(s)`, { cookies: Math.round(p.cookies) });
  }

  private endPopAll(why: string): void {
    this.runtime.wrinklerPopAllUntil = 0;
    this.runtime.wrinklerNextEvalAt = 0;
    this.log.log('pop wrinkler', `pop all ${why}`);
  }

  /** Popping allowed right now: auto play and popping on (or a forced debug pop, or the "Pop
   * all wrinklers" button), not paused after a failure, the AUTO-7 safety gates clear, and no
   * CpS buff running (wrinklers digest the buffed CpS, so that is exactly when they must stay
   * attached; the button, asked for now, doesn't wait for the buff). */
  private allowed(): boolean {
    const all = this.poppingAll();
    if (!all && !this.forced() && (this.data.config.autoPlay !== true || this.data.config.autoPopWrinklers === false)) return false;
    if (!this.game.isReady() || this.game.isAscending() || this.game.isPromptOpen()) return false;

    const now = Date.now();
    if (now < this.runtime.wrinklerBlockUntil || now < this.runtime.autoBlockUntil) return false;

    return !this.autoPlay.shoppingInterrupted() && (all || this.game.positiveCpsBuffs().length === 0);
  }

  /** The current pop plan (re-planned at most once a second), or null. A forced debug pop
   * plans the fattest attached normal wrinkler, skipping WRINK-2/3 (maturity, a purchase
   * needing it). Krumblor's next batch (KRUMB-2) asks before any purchase does. */
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

    if (this.poppingAll()) {
      const targets = popAllTargets(this.views());

      if (targets.length) {
        const mult = this.game.getWrinklerPopMult(false);
        this.runtime.wrinklerPlan = { ids: targets.map((w) => w.id), yield: targets.reduce((s, w) => s + w.sucked * mult, 0), forName: '"Pop all wrinklers"', cost: 0 };
      } else {
        this.endPopAll('done: none left to pop');
      }

      return this.runtime.wrinklerPlan;
    }

    try {
      const mature = this.mature();
      if (!mature.length) return null;

      // Krumblor's next batch of sacrifices waits for these cookies (KRUMB-2).
      const dragon = this.runtime.krumblorWrinklerNeed;
      const forDragon = dragon > 0 ? pickWrinklersToPop(mature, dragon) : null;
      if (forDragon) {
        this.runtime.wrinklerPlan = { ids: forDragon.map((w) => w.id), yield: stashOf(forDragon), forName: 'Krumblor', cost: dragon };
        return this.runtime.wrinklerPlan;
      }

      const r = this.autoPlay.decideWithExtraBank(stashOf(mature));
      const buy = r && r.decision.buy;
      if (!r || !buy) return null;

      const picked = pickWrinklersToPop(mature, buy.cost - (r.ctx.bank - r.ctx.reserve));
      if (!picked) return null;

      this.runtime.wrinklerPlan = { ids: picked.map((w) => w.id), yield: stashOf(picked), forName: buy.name, cost: buy.cost };
    } catch (e) {
      sayOops('Oopsie, I tripped while planning a wrinkler pop >_<', e);
      this.block(30000, errText(e));
    }

    return this.runtime.wrinklerPlan;
  }

  /** A pop is due (the scheduler, PendingWork and hammering use it). A dry run only logs; the
   * "Pop all wrinklers" button, asked for by hand, pops anyway. */
  pending(): boolean {
    return (this.data.config.autoDryRun !== true || this.poppingAll()) && this.plan() != null;
  }

  /** Job that pops the fattest wrinkler of the plan, or null. */
  job(): JobRequest | null {
    const plan = this.plan();
    if (!plan) return null;

    if (this.data.config.autoDryRun === true && !this.poppingAll()) {
      const now = Date.now();
      const last = this.runtime.autoWouldLog.get('wrinkler pop') || 0;

      if (now - last > 30000) {
        this.runtime.autoWouldLog.set('wrinkler pop', now);
        this.log.log('auto play (dry run)', `would pop ${plan.ids.length} wrinkler(s) for ${plan.forName}`, { yield: plan.yield, cost: plan.cost });
      }

      return null;
    }

    const id = plan.ids[0]!;

    // Its whole body is covered by wrinklers the game checks first: don't hand the scheduler a
    // job that would only be cancelled again every tick.
    const all = this.game.getWrinklers();
    const target = all.find((w) => w && w.id === id);
    if (target && !wrinklerPokeCanvasPoint(target, all)) {
      this.block(3000, 'I can\'t reach it (other wrinklers are in the way)');
      return null;
    }

    const action = new WrinklerPopAction(
      id,
      this.game,
      () => !this.allowed(),
      (popped, gained) => {
        this.runtime.wrinklerNextEvalAt = 0;
        this.runtime.autoNextEvalAt = 0;

        if (popped) {
          // A forced debug pop is done; a failed one keeps retrying within its 30s window.
          this.runtime.wrinklerForcePopUntil = 0;
          this.stats.recordWrinklerPop();
          this.log.log('pop wrinkler', `for ${plan.forName}`, { id, gained: Math.round(gained), cost: Math.round(plan.cost) });
          sayYay('Popped a stinky wrinkler! Yuckies!');
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
    const giveUp = this.runtime.wrinklerForcePopUntil > 0 && this.runtime.wrinklerForcePopUntil < this.runtime.wrinklerBlockUntil;
    sayCant(`Wanted to pop a wrinkler, but ${why}, ${giveUp ? 'giving up for now' : `trying again in ${Math.round(ms / 1000)}s`} :c`);
  }
}
